import type { LoginAdmissionConfig } from './login-admission.config.js';
import {
  LoginAdmissionService,
  type LoginAdmissionTime,
} from './login-admission.service.js';
import {
  Argon2ExecutionError,
  Argon2ExecutionService,
} from './argon2-execution.service.js';

class ControlledTime implements LoginAdmissionTime {
  private current = 0;
  private nextId = 0;
  private readonly tasks = new Map<
    number,
    { readonly at: number; readonly callback: () => void }
  >();

  now(): number {
    return this.current;
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.current + delayMs, callback });
    return () => this.tasks.delete(id);
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= this.current)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.tasks.delete(due[0]);
      due[1].callback();
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const config: LoginAdmissionConfig = {
  identityBucketsMax: 100,
  ipBucketsMax: 100,
  concurrency: 2,
  queueMax: 4,
  waitTimeoutMs: 1_000,
};

describe('Argon2ExecutionService', () => {
  it('P01/P08 shares a global maximum of two between login and reset consumers', async () => {
    const time = new ControlledTime();
    const executor = new Argon2ExecutionService(config, time);
    const login = new LoginAdmissionService(config, time, executor);
    const gates = Array.from({ length: 4 }, () => deferred<void>());
    let active = 0;
    let maximum = 0;
    const protectedWork = async (
      consumer: 'LOGIN' | 'RESET',
      index: number,
    ) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gates[index]!.promise;
      active -= 1;
      return consumer;
    };
    const start = (consumer: 'LOGIN' | 'RESET', index: number) => {
      if (consumer === 'LOGIN') {
        return login.executeProtected({
          email: `login${index}@example.com`,
          trustedIp: `192.0.2.${index + 1}`,
          operation: async () => ({
            status: 'AUTHENTICATED',
            value: await protectedWork(consumer, index),
          }),
        });
      }
      return executor.execute(() => protectedWork(consumer, index));
    };
    const executions = [
      start('LOGIN', 0),
      start('RESET', 1),
      start('LOGIN', 2),
      start('RESET', 3),
    ];
    await Promise.resolve();
    expect(active).toBe(2);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.all(executions.slice(0, 2));
    await Promise.resolve();
    expect(active).toBe(2);
    gates[2]!.resolve();
    gates[3]!.resolve();
    await expect(Promise.all(executions)).resolves.toEqual([
      'LOGIN',
      'RESET',
      'LOGIN',
      'RESET',
    ]);
    expect(maximum).toBe(2);
  });

  it('P02 preserves FIFO acquisition order', async () => {
    const executor = new Argon2ExecutionService(
      { ...config, concurrency: 1 },
      new ControlledTime(),
    );
    const gates = Array.from({ length: 4 }, () => deferred<void>());
    const started: number[] = [];
    const executions = gates.map((gate, index) =>
      executor.execute(async () => {
        started.push(index);
        await gate.promise;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0]);
    for (let index = 0; index < gates.length; index += 1) {
      gates[index]!.resolve();
      await executions[index];
      await Promise.resolve();
    }
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('P03 limits the FIFO queue to four waiters', async () => {
    const executor = new Argon2ExecutionService(
      { ...config, concurrency: 1 },
      new ControlledTime(),
    );
    const gate = deferred<void>();
    const active = executor.execute(() => gate.promise);
    const queued = Array.from({ length: 4 }, (_, index) =>
      executor.execute(async () => index),
    );
    const overflowWork = vi.fn(async () => 99);
    await expect(executor.execute(overflowWork)).rejects.toBeInstanceOf(
      Argon2ExecutionError,
    );
    expect(overflowWork).not.toHaveBeenCalled();
    gate.resolve();
    await active;
    await expect(Promise.all(queued)).resolves.toEqual([0, 1, 2, 3]);
  });

  it('P04 times out after exactly one second without executing later', async () => {
    const time = new ControlledTime();
    const executor = new Argon2ExecutionService(
      { ...config, concurrency: 1 },
      time,
    );
    const gate = deferred<void>();
    const active = executor.execute(() => gate.promise);
    const work = vi.fn(async () => undefined);
    const waiting = executor.execute(work);
    await Promise.resolve();
    time.advance(999);
    expect(work).not.toHaveBeenCalled();
    time.advance(1);
    await expect(waiting).rejects.toBeInstanceOf(Argon2ExecutionError);
    gate.resolve();
    await active;
    expect(work).not.toHaveBeenCalled();
  });

  it('P05 cancels only before acquisition and never runs cancelled work', async () => {
    const executor = new Argon2ExecutionService(
      { ...config, concurrency: 1 },
      new ControlledTime(),
    );
    const gate = deferred<void>();
    const activeController = new AbortController();
    const active = executor.execute(
      () => gate.promise,
      activeController.signal,
    );
    const waitingController = new AbortController();
    const waitingWork = vi.fn(async () => undefined);
    const waiting = executor.execute(waitingWork, waitingController.signal);
    await Promise.resolve();
    waitingController.abort();
    await expect(waiting).rejects.toBeInstanceOf(Argon2ExecutionError);
    activeController.abort();
    const replacement = vi.fn(async () => undefined);
    const replacementExecution = executor.execute(replacement);
    await Promise.resolve();
    expect(replacement).not.toHaveBeenCalled();
    gate.resolve();
    await active;
    await replacementExecution;
    expect(waitingWork).not.toHaveBeenCalled();
  });

  it('P06 makes acquisition win a same-boundary timeout exactly once', async () => {
    const time = new ControlledTime();
    const executor = new Argon2ExecutionService(
      { ...config, concurrency: 1 },
      time,
    );
    const gate = deferred<void>();
    const active = executor.execute(() => gate.promise);
    const work = vi.fn(async () => 'acquired');
    const waiting = executor.execute(work);
    await Promise.resolve();
    gate.resolve();
    await active;
    time.advance(1_000);
    await expect(waiting).resolves.toBe('acquired');
    expect(work).toHaveBeenCalledOnce();
  });

  it('P06 makes timeout win before a later cancellation and release', async () => {
    const time = new ControlledTime();
    const executor = new Argon2ExecutionService(config, time);
    const gates = [deferred<void>(), deferred<void>()];
    const active = gates.map((gate) => executor.execute(() => gate.promise));
    const controller = new AbortController();
    const expiredWork = vi.fn(async () => undefined);
    const expired = executor.execute(expiredWork, controller.signal);
    await Promise.resolve();

    time.advance(1_000);
    await expect(expired).rejects.toBeInstanceOf(Argon2ExecutionError);
    controller.abort();
    gates[0]!.resolve();
    await active[0];
    await expect(executor.execute(async () => 'replacement')).resolves.toBe(
      'replacement',
    );
    expect(expiredWork).not.toHaveBeenCalled();
    gates[1]!.resolve();
    await active[1];
  });

  it('P06 makes cancellation win before a later timeout and release', async () => {
    const time = new ControlledTime();
    const executor = new Argon2ExecutionService(config, time);
    const gates = [deferred<void>(), deferred<void>()];
    const active = gates.map((gate) => executor.execute(() => gate.promise));
    const controller = new AbortController();
    const cancelledWork = vi.fn(async () => undefined);
    const cancelled = executor.execute(cancelledWork, controller.signal);
    await Promise.resolve();

    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(Argon2ExecutionError);
    time.advance(1_000);
    gates[0]!.resolve();
    await active[0];
    await expect(executor.execute(async () => 'replacement')).resolves.toBe(
      'replacement',
    );
    expect(cancelledWork).not.toHaveBeenCalled();
    gates[1]!.resolve();
    await active[1];
  });

  it('P06 keeps an acquired slot until completion when abort follows promotion', async () => {
    const executor = new Argon2ExecutionService(config, new ControlledTime());
    const gates = Array.from({ length: 4 }, () => deferred<void>());
    const started: string[] = [];
    let activeCount = 0;
    let maximum = 0;
    const run = (name: string, index: number, signal?: AbortSignal) =>
      executor.execute(async () => {
        started.push(name);
        activeCount += 1;
        maximum = Math.max(maximum, activeCount);
        try {
          await gates[index]!.promise;
        } finally {
          activeCount -= 1;
        }
      }, signal);

    const first = run('first', 0);
    const second = run('second', 1);
    const controller = new AbortController();
    const promoted = run('promoted', 2, controller.signal);
    await Promise.resolve();
    gates[0]!.resolve();
    await first;
    await Promise.resolve();
    expect(started).toEqual(['first', 'second', 'promoted']);

    controller.abort();
    const following = run('following', 3);
    await Promise.resolve();
    expect(started).toEqual(['first', 'second', 'promoted']);
    expect(activeCount).toBe(2);

    gates[2]!.resolve();
    await promoted;
    await Promise.resolve();
    expect(started).toEqual(['first', 'second', 'promoted', 'following']);
    expect(maximum).toBe(2);
    gates[3]!.resolve();
    gates[1]!.resolve();
    await Promise.all([second, following]);
  });

  it('P07/P10 releases once and promotes FIFO after a synchronous throw', async () => {
    const executor = new Argon2ExecutionService(
      { ...config, concurrency: 1 },
      new ControlledTime(),
    );
    const failure = new Error('synchronous failure');
    const gate = deferred<void>();
    const started: string[] = [];
    const failed = executor.execute(() => {
      started.push('failed');
      throw failure;
    });
    const first = executor.execute(async () => {
      started.push('first');
      await gate.promise;
      return 'first';
    });
    const second = executor.execute(async () => {
      started.push('second');
      return 'second';
    });

    await expect(failed).rejects.toBe(failure);
    await Promise.resolve();
    expect(started).toEqual(['failed', 'first']);
    gate.resolve();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(started).toEqual(['failed', 'first', 'second']);
  });

  it('P07/P10 releases once and promotes FIFO after an asynchronous rejection', async () => {
    const executor = new Argon2ExecutionService(
      { ...config, concurrency: 1 },
      new ControlledTime(),
    );
    const failure = new Error('asynchronous failure');
    const gate = deferred<void>();
    const started: string[] = [];
    const failed = executor.execute(() => {
      started.push('failed');
      return Promise.reject(failure);
    });
    const first = executor.execute(async () => {
      started.push('first');
      await gate.promise;
      return 'first';
    });
    const second = executor.execute(async () => {
      started.push('second');
      return 'second';
    });

    await expect(failed).rejects.toBe(failure);
    await Promise.resolve();
    expect(started).toEqual(['failed', 'first']);
    gate.resolve();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(started).toEqual(['failed', 'first', 'second']);
  });

  it('P07 makes duplicate release observable across cancellation, timeout, and reuse', async () => {
    const time = new ControlledTime();
    const executor = new Argon2ExecutionService(config, time);
    const gates = Array.from({ length: 4 }, () => deferred<void>());
    const started: string[] = [];
    const completed: string[] = [];
    let activeCount = 0;
    let maximum = 0;
    const run = (name: string, index: number) =>
      executor.execute(async () => {
        started.push(name);
        activeCount += 1;
        maximum = Math.max(maximum, activeCount);
        try {
          await gates[index]!.promise;
          completed.push(name);
        } finally {
          activeCount -= 1;
        }
      });

    const first = run('first', 0);
    const second = run('second', 1);
    const cancelledController = new AbortController();
    const cancelledWork = vi.fn(async () => undefined);
    const cancelled = executor.execute(
      cancelledWork,
      cancelledController.signal,
    );
    const expiredWork = vi.fn(async () => undefined);
    const expired = executor.execute(expiredWork);
    await Promise.resolve();
    cancelledController.abort();
    await expect(cancelled).rejects.toBeInstanceOf(Argon2ExecutionError);
    time.advance(1_000);
    await expect(expired).rejects.toBeInstanceOf(Argon2ExecutionError);

    gates[0]!.resolve();
    await first;
    const third = run('third', 2);
    const fourth = run('fourth', 3);
    await Promise.resolve();
    expect(started).toEqual(['first', 'second', 'third']);
    gates[2]!.resolve();
    await third;
    await Promise.resolve();
    expect(started).toEqual(['first', 'second', 'third', 'fourth']);
    gates[3]!.resolve();
    gates[1]!.resolve();
    await Promise.all([second, fourth]);

    expect(cancelledWork).not.toHaveBeenCalled();
    expect(expiredWork).not.toHaveBeenCalled();
    expect(maximum).toBe(2);
    expect(completed).toEqual(['first', 'third', 'fourth', 'second']);
    await expect(
      executor.execute(async () => {
        started.push('reused');
        return 'reused';
      }),
    ).resolves.toBe('reused');
    expect(started).toEqual(['first', 'second', 'third', 'fourth', 'reused']);
  });
});
