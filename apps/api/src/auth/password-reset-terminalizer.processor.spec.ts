import { Logger } from '@nestjs/common';
import type { PasswordResetTerminalizerConfig } from './password-reset-terminalizer.config.js';
import type { PasswordResetTerminalizerPersistence } from './password-reset-terminalizer.persistence.js';
import { PasswordResetTerminalizerProcessor } from './password-reset-terminalizer.processor.js';

const operationId = '00000000-0000-4000-8000-000000000091';
function createHarness(mode: 'disabled' | 'internal' = 'disabled') {
  const persistence = {
    find: vi
      .fn()
      .mockResolvedValue({ outcome: 'NO_CANDIDATE', resetOperationId: null }),
    terminalize: vi.fn(),
    hasInconsistent: vi.fn().mockResolvedValue(false),
  };
  const config: PasswordResetTerminalizerConfig = {
    mode,
    pollingMilliseconds: 60_000,
    maximumOperationsPerCycle: 10,
    lockTimeoutMilliseconds: 2_000,
    statementTimeoutMilliseconds: 5_000,
  };
  return {
    persistence,
    processor: new PasswordResetTerminalizerProcessor(
      config,
      persistence as unknown as PasswordResetTerminalizerPersistence,
    ),
  };
}

describe('PasswordResetTerminalizerProcessor', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('reports idle without mutation', async () => {
    const h = createHarness();
    await expect(h.processor.runCycle()).resolves.toEqual({
      processed: 0,
      noCandidate: true,
      inconsistent: false,
      infrastructureError: false,
    });
    expect(h.persistence.terminalize).not.toHaveBeenCalled();
  });
  it('processes sequentially and probes once after a full batch', async () => {
    const h = createHarness();
    h.persistence.find.mockResolvedValue({
      outcome: 'CANDIDATE',
      resetOperationId: operationId,
    });
    h.persistence.terminalize.mockResolvedValue('TERMINALIZED');
    h.persistence.hasInconsistent.mockResolvedValue(true);
    await expect(h.processor.runCycle()).resolves.toEqual({
      processed: 10,
      noCandidate: false,
      inconsistent: true,
      infrastructureError: false,
    });
    expect(h.persistence.terminalize).toHaveBeenCalledTimes(10);
    expect(h.persistence.hasInconsistent).toHaveBeenCalledOnce();
  });
  it('does not let an inconsistency identifier reach logs', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const h = createHarness();
    h.persistence.find.mockResolvedValue({
      outcome: 'INCONSISTENT',
      resetOperationId: operationId,
    });
    await h.processor.runCycle();
    expect(JSON.stringify(error.mock.calls)).not.toContain(operationId);
  });
  it.each(['INDETERMINATE', 'INFRASTRUCTURE_ERROR'] as const)(
    'stops a cycle on %s',
    async (outcome) => {
      const h = createHarness();
      h.persistence.find.mockResolvedValue({
        outcome: 'CANDIDATE',
        resetOperationId: operationId,
      });
      h.persistence.terminalize.mockResolvedValue(outcome);
      await expect(h.processor.runCycle()).resolves.toMatchObject({
        processed: 1,
        infrastructureError: true,
      });
    },
  );
  it('does not start from environmental mode in tests when injected disabled', () => {
    vi.useFakeTimers();
    const h = createHarness('disabled');
    h.processor.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('starts explicitly, schedules polling, and cancels idle work on shutdown', async () => {
    vi.useFakeTimers();
    const h = createHarness('internal');
    h.processor.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(1);
    await vi.runOnlyPendingTimersAsync();
    expect(h.persistence.find).toHaveBeenCalled();
    await h.processor.onApplicationShutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('awaits an active SQL observation during conservative shutdown', async () => {
    vi.useFakeTimers();
    const h = createHarness('internal');
    let release!: () => void;
    h.persistence.find.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () =>
          resolve({ outcome: 'NO_CANDIDATE', resetOperationId: null });
      }),
    );
    h.processor.onApplicationBootstrap();
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    let stopped = false;
    const shutdown = h.processor.onApplicationShutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await shutdown;
  });

  it('keeps independent instances free to process concurrently', async () => {
    const first = createHarness();
    const second = createHarness();
    for (const h of [first, second]) {
      h.persistence.find
        .mockResolvedValueOnce({
          outcome: 'CANDIDATE',
          resetOperationId: operationId,
        })
        .mockResolvedValueOnce({
          outcome: 'NO_CANDIDATE',
          resetOperationId: null,
        });
    }
    first.persistence.terminalize.mockResolvedValue('TERMINALIZED');
    second.persistence.terminalize.mockResolvedValue('ALREADY_TERMINAL');
    await expect(
      Promise.all([first.processor.runCycle(), second.processor.runCycle()]),
    ).resolves.toEqual([
      {
        processed: 1,
        noCandidate: true,
        inconsistent: false,
        infrastructureError: false,
      },
      {
        processed: 1,
        noCandidate: true,
        inconsistent: false,
        infrastructureError: false,
      },
    ]);
  });
});
