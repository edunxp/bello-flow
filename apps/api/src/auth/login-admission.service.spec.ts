import type { LoginAdmissionConfig } from './login-admission.config.js';
import {
  LOGIN_ADMISSION_ERROR_CODE,
  LoginAdmissionError,
  LoginAdmissionService,
  canonicalizeTrustedIp,
  type LoginAdmissionCompletion,
  type LoginAdmissionTime,
} from './login-admission.service.js';

class ControlledTime implements LoginAdmissionTime {
  private current = 0;
  private nextTaskId = 0;
  private readonly tasks = new Map<
    number,
    { readonly at: number; readonly callback: () => void }
  >();

  now(): number {
    return this.current;
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const id = this.nextTaskId++;
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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const DEFAULT_TEST_CONFIG: LoginAdmissionConfig = {
  identityBucketsMax: 100,
  ipBucketsMax: 100,
  concurrency: 2,
  queueMax: 4,
  waitTimeoutMs: 1_000,
};

const determinedError = new Error('determined');
const operationalError = new Error('operational');
const indeterminateError = new Error('indeterminate');

function completion<T>(value: T): LoginAdmissionCompletion<T> {
  return { status: 'AUTHENTICATED', value };
}

function rejection(): LoginAdmissionCompletion<never> {
  return { status: 'DETERMINED_REJECTION', error: determinedError };
}

function operationalFailure(): LoginAdmissionCompletion<never> {
  return { status: 'OPERATIONAL_FAILURE', error: operationalError };
}

function indeterminateFailure(): LoginAdmissionCompletion<never> {
  return { status: 'INDETERMINATE', error: indeterminateError };
}

function makeService(
  time = new ControlledTime(),
  overrides: Partial<LoginAdmissionConfig> = {},
) {
  return {
    time,
    service: new LoginAdmissionService(
      { ...DEFAULT_TEST_CONFIG, ...overrides },
      time,
    ),
  };
}

async function execute<T>(
  service: LoginAdmissionService,
  operation: () => Promise<LoginAdmissionCompletion<T>>,
  options: {
    email?: unknown;
    trustedIp?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  return service.executeProtected({
    email: Object.hasOwn(options, 'email') ? options.email : 'user@example.com',
    trustedIp: Object.hasOwn(options, 'trustedIp')
      ? options.trustedIp
      : '192.0.2.1',
    signal: options.signal,
    operation,
  });
}

async function expectFailure(
  operation: Promise<unknown>,
  expected: unknown,
): Promise<unknown> {
  try {
    await operation;
    throw new Error('Expected operation to fail');
  } catch (error) {
    expect(error).toEqual(expected);
    return error;
  }
}

describe('trusted IP canonicalization', () => {
  it.each([
    ['192.0.2.1', 'ipv4:192.0.2.1'],
    ['2001:db8::1', 'ipv6:2001:db8::1'],
    ['2001:0db8:0:0:0:0:0:1', 'ipv6:2001:db8::1'],
    ['::ffff:192.0.2.1', 'ipv4:192.0.2.1'],
    ['::ffff:c000:201', 'ipv4:192.0.2.1'],
  ])('canonicalizes %s', (input, expected) => {
    expect(canonicalizeTrustedIp(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    'example.com',
    '192.0.2.999',
    '192.168.001.001',
    '2001:db8::1%eth0',
    42,
  ])('rejects an untrusted address value %j', (input) => {
    expect(canonicalizeTrustedIp(input)).toBeNull();
  });
});

describe('login admission token buckets', () => {
  it('rejects an absent IP before creating buckets or executing work', async () => {
    const { service } = makeService();
    const operation = vi.fn(async () => completion('unexpected'));

    const error = await expectFailure(
      service.executeProtected({
        email: 'user@example.com',
        trustedIp: undefined,
        operation,
      }),
      expect.any(LoginAdmissionError),
    );

    expect(error).toMatchObject({
      code: LOGIN_ADMISSION_ERROR_CODE.SERVICE_UNAVAILABLE,
      retryAfterSeconds: undefined,
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it('enforces five identity tokens and preserves the next refill instant', async () => {
    const { service, time } = makeService();
    const operation = vi.fn(async () => rejection());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectFailure(execute(service, operation), determinedError);
    }

    const limited = (await expectFailure(
      execute(service, operation),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(limited).toMatchObject({
      code: LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED,
      retryAfterSeconds: 180,
    });
    expect(operation).toHaveBeenCalledTimes(5);

    time.advance(179_000);
    const almostReady = (await expectFailure(
      execute(service, operation),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(almostReady.retryAfterSeconds).toBe(1);
    time.advance(1_000);
    await expectFailure(execute(service, operation), determinedError);
    expect(operation).toHaveBeenCalledTimes(6);
  });

  it('does not bank refill time while a bucket is at capacity', async () => {
    const { service, time } = makeService();
    const operation = vi.fn(async () => rejection());
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expectFailure(execute(service, operation), determinedError);
    }
    time.advance(1_800_000);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectFailure(execute(service, operation), determinedError);
    }
    const limited = (await expectFailure(
      execute(service, operation),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(limited.retryAfterSeconds).toBe(180);
  });

  it('enforces sixty IP tokens and refills one token after five seconds', async () => {
    const { service, time } = makeService(undefined, {
      identityBucketsMax: 100,
    });
    const operation = vi.fn(async () => rejection());
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expectFailure(
        execute(service, operation, { email: `user${attempt}@example.com` }),
        determinedError,
      );
    }

    const limited = (await expectFailure(
      execute(service, operation, { email: 'next@example.com' }),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(limited).toMatchObject({
      code: LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED,
      retryAfterSeconds: 5,
    });
    time.advance(5_000);
    await expectFailure(
      execute(service, operation, { email: 'next@example.com' }),
      determinedError,
    );
  });

  it('uses the greater Retry-After when identity and IP are both exhausted', async () => {
    const { service } = makeService();
    const operation = vi.fn(async () => rejection());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectFailure(execute(service, operation), determinedError);
    }
    for (let attempt = 0; attempt < 55; attempt += 1) {
      await expectFailure(
        execute(service, operation, {
          email: `shared-ip${attempt}@example.com`,
        }),
        determinedError,
      );
    }

    const limited = (await expectFailure(
      execute(service, operation),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(limited).toMatchObject({
      code: LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED,
      retryAfterSeconds: 180,
    });
  });

  it('shares normalized identities and keeps the invalid-email sentinel separate', async () => {
    const { service } = makeService();
    const operation = vi.fn(async () => rejection());
    for (const email of [
      ' USER@Example.COM ',
      'user@example.com',
      'User@EXAMPLE.com',
      'user@example.com ',
      ' USER@example.com',
    ]) {
      await expectFailure(
        execute(service, operation, { email }),
        determinedError,
      );
    }
    await expectFailure(
      execute(service, operation, { email: 'user@example.com' }),
      expect.any(LoginAdmissionError),
    );

    for (const email of [null, '', 'invalid', 'a@b', 'usér@example.com']) {
      await expectFailure(
        execute(service, operation, { email }),
        determinedError,
      );
    }
    const sentinelLimit = (await expectFailure(
      execute(service, operation, { email: undefined }),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(sentinelLimit.code).toBe(LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED);
    expect(operation).toHaveBeenCalledTimes(10);
  });

  it('stores only a technical symbol for an invalid email', async () => {
    const { service } = makeService();
    const rawEmail = 'not-an-email-value';
    await expectFailure(
      execute(service, async () => rejection(), { email: rawEmail }),
      determinedError,
    );

    const state = service as unknown as {
      readonly identityBuckets: Map<unknown, unknown>;
    };
    expect([...state.identityBuckets.keys()]).toEqual([expect.any(Symbol)]);
    expect(JSON.stringify([...state.identityBuckets.keys()])).not.toContain(
      rawEmail,
    );
  });

  it('does not debit the other dimension when a joint reservation is rejected', async () => {
    const { service } = makeService(undefined, {
      identityBucketsMax: 100,
      ipBucketsMax: 2,
    });
    const operation = vi.fn(async () => rejection());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectFailure(execute(service, operation), determinedError);
    }
    await expectFailure(
      execute(service, operation, { trustedIp: '192.0.2.2' }),
      expect.any(LoginAdmissionError),
    );

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expectFailure(
        execute(service, operation, {
          email: `other${attempt}@example.com`,
          trustedIp: '192.0.2.2',
        }),
        determinedError,
      );
    }
    const ipLimit = (await expectFailure(
      execute(service, operation, {
        email: 'last@example.com',
        trustedIp: '192.0.2.2',
      }),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(ipLimit.retryAfterSeconds).toBe(5);
  });

  it('refunds operational and indeterminate outcomes without retrying work', async () => {
    const { service } = makeService();
    const operational = vi.fn(async () => operationalFailure());
    const indeterminate = vi.fn(async () => indeterminateFailure());
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expectFailure(execute(service, operational), operationalError);
      await expectFailure(execute(service, indeterminate), indeterminateError);
    }
    expect(operational).toHaveBeenCalledTimes(8);
    expect(indeterminate).toHaveBeenCalledTimes(8);
  });

  it('resets identity after success without resetting the exhausted IP', async () => {
    const { service } = makeService();
    const rejected = vi.fn(async () => rejection());
    for (let attempt = 0; attempt < 59; attempt += 1) {
      await expectFailure(
        execute(service, rejected, {
          email: `ip-budget${attempt}@example.com`,
        }),
        determinedError,
      );
    }
    await expect(
      execute(service, async () => completion('ok'), {
        email: 'successful@example.com',
      }),
    ).resolves.toBe('ok');

    const exhaustedIpWork = vi.fn(async () => rejection());
    const limited = (await expectFailure(
      execute(service, exhaustedIpWork, {
        email: 'successful@example.com',
      }),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(limited).toMatchObject({
      code: LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED,
      retryAfterSeconds: 5,
    });
    expect(exhaustedIpWork).not.toHaveBeenCalled();

    await expectFailure(
      execute(service, rejected, {
        email: 'successful@example.com',
        trustedIp: '192.0.2.2',
      }),
      determinedError,
    );
  });

  it('prevents an old reservation from refunding a generation created by success', async () => {
    const { service } = makeService();
    const first = deferred<LoginAdmissionCompletion<string>>();
    const second = deferred<LoginAdmissionCompletion<string>>();
    const firstExecution = execute(service, () => first.promise);
    const secondExecution = execute(service, () => second.promise);
    await Promise.resolve();

    first.resolve(completion('authenticated'));
    await expect(firstExecution).resolves.toBe('authenticated');
    await expectFailure(
      execute(service, async () => rejection()),
      determinedError,
    );
    second.resolve(operationalFailure());
    await expectFailure(secondExecution, operationalError);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expectFailure(
        execute(service, async () => rejection()),
        determinedError,
      );
    }
    const limited = (await expectFailure(
      execute(service, async () => rejection()),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(limited.code).toBe(LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED);
  });
});

describe('login admission concurrency and memory', () => {
  it('runs two operations and starts four queued operations in FIFO order', async () => {
    const { service } = makeService();
    const gates = Array.from({ length: 6 }, () =>
      deferred<LoginAdmissionCompletion<number>>(),
    );
    const started: number[] = [];
    const executions = gates.map((gate, index) =>
      execute(
        service,
        () => {
          started.push(index);
          return gate.promise;
        },
        { email: `user${index}@example.com` },
      ),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    for (let index = 0; index < gates.length; index += 1) {
      gates[index]!.resolve(completion(index));
      await expect(executions[index]).resolves.toBe(index);
      await Promise.resolve();
    }
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('rejects a full queue and refunds its reservation', async () => {
    const { service } = makeService(undefined, {
      concurrency: 1,
      queueMax: 1,
    });
    const gate = deferred<LoginAdmissionCompletion<string>>();
    const active = execute(service, () => gate.promise);
    const queued = execute(service, async () => completion('queued'), {
      email: 'queued@example.com',
    });
    const overflowWork = vi.fn(async () => completion('overflow'));
    await Promise.resolve();

    const error = (await expectFailure(
      execute(service, overflowWork, { email: 'overflow@example.com' }),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(error.code).toBe(LOGIN_ADMISSION_ERROR_CODE.SERVICE_UNAVAILABLE);
    expect(overflowWork).not.toHaveBeenCalled();
    gate.resolve(completion('active'));
    await expect(active).resolves.toBe('active');
    await expect(queued).resolves.toBe('queued');
    await expect(
      execute(service, overflowWork, { email: 'overflow@example.com' }),
    ).resolves.toBe('overflow');
  });

  it('times out without late execution and makes timeout lose to acquisition', async () => {
    const { service, time } = makeService(undefined, {
      concurrency: 1,
      queueMax: 2,
      waitTimeoutMs: 100,
    });
    const firstGate = deferred<LoginAdmissionCompletion<string>>();
    const first = execute(service, () => firstGate.promise);
    const timedWork = vi.fn(async () => completion('timed'));
    const timed = execute(service, timedWork, { email: 'timed@example.com' });
    await Promise.resolve();
    time.advance(100);
    await expectFailure(timed, expect.any(LoginAdmissionError));
    firstGate.resolve(completion('first'));
    await expect(first).resolves.toBe('first');
    expect(timedWork).not.toHaveBeenCalled();

    const secondGate = deferred<LoginAdmissionCompletion<string>>();
    const second = execute(service, () => secondGate.promise, {
      email: 'second@example.com',
    });
    const acquired = execute(service, async () => completion('acquired'), {
      email: 'acquired@example.com',
    });
    await Promise.resolve();
    secondGate.resolve(completion('second'));
    await expect(second).resolves.toBe('second');
    time.advance(100);
    await expect(acquired).resolves.toBe('acquired');
  });

  it('cancels only before acquisition and releases after real completion', async () => {
    const { service } = makeService(undefined, {
      concurrency: 1,
      queueMax: 2,
    });
    const activeGate = deferred<LoginAdmissionCompletion<string>>();
    const activeController = new AbortController();
    const active = execute(service, () => activeGate.promise, {
      signal: activeController.signal,
    });
    const queuedController = new AbortController();
    const queuedWork = vi.fn(async () => completion('queued'));
    const queued = execute(service, queuedWork, {
      email: 'queued@example.com',
      signal: queuedController.signal,
    });
    await Promise.resolve();
    queuedController.abort();
    await expectFailure(queued, expect.any(LoginAdmissionError));
    expect(queuedWork).not.toHaveBeenCalled();

    activeController.abort();
    const replacementWork = vi.fn(async () => completion('replacement'));
    const replacement = execute(service, replacementWork, {
      email: 'replacement@example.com',
    });
    await Promise.resolve();
    expect(replacementWork).not.toHaveBeenCalled();
    activeGate.resolve(completion('active'));
    await expect(active).resolves.toBe('active');
    await expect(replacement).resolves.toBe('replacement');
  });

  it('rejects an already cancelled request without executing it', async () => {
    const { service } = makeService();
    const controller = new AbortController();
    controller.abort();
    const work = vi.fn(async () => completion('unexpected'));

    await expectFailure(
      execute(service, work, { signal: controller.signal }),
      expect.any(LoginAdmissionError),
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('localizes saturation, preserves active buckets, and recovers eligible entries', async () => {
    const { service, time } = makeService(undefined, {
      identityBucketsMax: 1,
      ipBucketsMax: 1,
      concurrency: 2,
    });
    const gate = deferred<LoginAdmissionCompletion<string>>();
    const active = execute(service, () => gate.promise);
    await Promise.resolve();

    const saturated = (await expectFailure(
      execute(service, async () => completion('other'), {
        email: 'other@example.com',
        trustedIp: '192.0.2.2',
      }),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(saturated.code).toBe(LOGIN_ADMISSION_ERROR_CODE.SERVICE_UNAVAILABLE);
    await expect(
      execute(service, async () => completion('same')),
    ).resolves.toBe('same');
    gate.resolve(operationalFailure());
    await expectFailure(active, operationalError);

    time.advance(180_000);
    await expect(
      execute(service, async () => completion('recovered'), {
        email: 'other@example.com',
        trustedIp: '192.0.2.2',
      }),
    ).resolves.toBe('recovered');
  });

  it('saturates only the IP map and recovers without bypassing either dimension', async () => {
    const { service, time } = makeService(undefined, {
      identityBucketsMax: 10,
      ipBucketsMax: 2,
    });
    const rejected = vi.fn(async () => rejection());
    await expectFailure(
      execute(service, rejected, {
        email: 'first@example.com',
        trustedIp: '192.0.2.1',
      }),
      determinedError,
    );
    await expectFailure(
      execute(service, rejected, {
        email: 'second@example.com',
        trustedIp: '192.0.2.2',
      }),
      determinedError,
    );

    const overflowWork = vi.fn(async () => rejection());
    const saturated = (await expectFailure(
      execute(service, overflowWork, {
        email: 'overflow@example.com',
        trustedIp: '192.0.2.3',
      }),
      expect.any(LoginAdmissionError),
    )) as LoginAdmissionError;
    expect(saturated.code).toBe(LOGIN_ADMISSION_ERROR_CODE.SERVICE_UNAVAILABLE);
    expect(overflowWork).not.toHaveBeenCalled();

    const state = service as unknown as {
      readonly identityBuckets: Map<unknown, unknown>;
      readonly ipBuckets: Map<unknown, unknown>;
    };
    expect(state.ipBuckets.size).toBe(2);
    expect(state.ipBuckets.has('ipv4:192.0.2.1')).toBe(true);
    expect(state.ipBuckets.has('ipv4:192.0.2.2')).toBe(true);
    expect(state.identityBuckets.has('overflow@example.com')).toBe(false);

    await expectFailure(
      execute(service, rejected, {
        email: 'existing-origin@example.com',
        trustedIp: '192.0.2.1',
      }),
      determinedError,
    );
    time.advance(5_000);

    const recoveredWork = vi.fn(async () => rejection());
    await expectFailure(
      execute(service, recoveredWork, {
        email: 'recovered@example.com',
        trustedIp: '192.0.2.3',
      }),
      determinedError,
    );
    expect(recoveredWork).toHaveBeenCalledOnce();
    expect(state.ipBuckets.size).toBe(2);
    expect(state.ipBuckets.has('ipv4:192.0.2.1')).toBe(true);
    expect(state.ipBuckets.has('ipv4:192.0.2.2')).toBe(false);
    expect(state.ipBuckets.has('ipv4:192.0.2.3')).toBe(true);
    expect(state.identityBuckets.has('recovered@example.com')).toBe(true);
  });

  it('uses the exceptional full scan for an eligible bucket beyond the incremental batch', async () => {
    const { service } = makeService(undefined, {
      identityBucketsMax: 100,
      ipBucketsMax: 34,
      concurrency: 2,
    });
    const restrictiveIps = Array.from(
      { length: 32 },
      (_, index) => `198.51.100.${index + 1}`,
    );
    for (const [index, trustedIp] of restrictiveIps.entries()) {
      await expectFailure(
        execute(service, async () => rejection(), {
          email: `restrictive${index}@example.com`,
          trustedIp,
        }),
        determinedError,
      );
    }

    const recoverableIp = '198.51.100.33';
    const recoverableGate = deferred<LoginAdmissionCompletion<string>>();
    const recoverable = execute(service, () => recoverableGate.promise, {
      email: 'recoverable@example.com',
      trustedIp: recoverableIp,
    });
    await Promise.resolve();
    const lastRestrictiveIp = '198.51.100.34';
    await expectFailure(
      execute(service, async () => rejection(), {
        email: 'last-restrictive@example.com',
        trustedIp: lastRestrictiveIp,
      }),
      determinedError,
    );
    recoverableGate.resolve(operationalFailure());
    await expectFailure(recoverable, operationalError);

    const state = service as unknown as {
      readonly ipBuckets: Map<unknown, unknown>;
    };
    expect([...state.ipBuckets.keys()]).toEqual([
      ...restrictiveIps.map((ip) => `ipv4:${ip}`),
      `ipv4:${recoverableIp}`,
      `ipv4:${lastRestrictiveIp}`,
    ]);
    expect(state.ipBuckets.size).toBe(34);

    const replacementIp = '198.51.100.35';
    const replacementWork = vi.fn(async () => rejection());
    await expectFailure(
      execute(service, replacementWork, {
        email: 'replacement@example.com',
        trustedIp: replacementIp,
      }),
      determinedError,
    );

    expect(replacementWork).toHaveBeenCalledOnce();
    expect(state.ipBuckets.size).toBe(34);
    for (const ip of [...restrictiveIps, lastRestrictiveIp]) {
      expect(state.ipBuckets.has(`ipv4:${ip}`)).toBe(true);
    }
    expect(state.ipBuckets.has(`ipv4:${recoverableIp}`)).toBe(false);
    expect(state.ipBuckets.has(`ipv4:${replacementIp}`)).toBe(true);
  });

  it('limits normal cleanup work and removes only fully recovered buckets', async () => {
    const { service, time } = makeService(undefined, {
      identityBucketsMax: 100,
      ipBucketsMax: 100,
    });
    for (let index = 0; index < 40; index += 1) {
      await expectFailure(
        execute(service, async () => rejection(), {
          email: `cleanup${index}@example.com`,
          trustedIp: `192.0.2.${index + 1}`,
        }),
        determinedError,
      );
    }
    time.advance(180_000);

    await expectFailure(
      execute(service, async () => rejection(), {
        email: 'after-cleanup@example.com',
        trustedIp: '198.51.100.1',
      }),
      determinedError,
    );

    const state = service as unknown as {
      readonly identityBuckets: Map<unknown, unknown>;
      readonly ipBuckets: Map<unknown, unknown>;
    };
    expect(state.identityBuckets.size).toBe(9);
    expect(state.ipBuckets.size).toBe(9);
  });

  it('uses fresh in-memory counters after a new service instance', async () => {
    const time = new ControlledTime();
    const first = makeService(time).service;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectFailure(
        execute(first, async () => rejection()),
        determinedError,
      );
    }
    await expectFailure(
      execute(first, async () => rejection()),
      expect.any(LoginAdmissionError),
    );

    const restarted = makeService(time).service;
    await expectFailure(
      execute(restarted, async () => rejection()),
      determinedError,
    );
  });
});
