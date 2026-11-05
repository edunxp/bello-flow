import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { PasswordRecoveryDeliveryAdapter } from './password-recovery-delivery.adapter.js';
import type { PasswordRecoveryDeliveryConfig } from './password-recovery-delivery.config.js';
import type { PasswordRecoveryDeliveryPersistence } from './password-recovery-delivery.persistence.js';
import {
  buildPasswordRecoveryUrl,
  createPasswordRecoveryToken,
  PasswordRecoveryDeliveryProcessor,
} from './password-recovery-delivery.processor.js';

const requestId = '00000000-0000-4000-8000-000000000071';
const attemptId = '00000000-0000-4000-8000-000000000072';
const leaseId = '00000000-0000-4000-8000-000000000073';
const tokenId = '00000000-0000-4000-8000-000000000074';
const expiresAt = new Date('2030-01-01T00:30:00Z');

function claimed() {
  return {
    outcome: 'CLAIMED' as const,
    recoveryRequestId: requestId,
    deliveryAttemptId: attemptId,
    attemptNumber: 1,
    leaseId,
    leaseExpiresAt: new Date('2030-01-01T00:01:00Z'),
    passwordResetTokenId: null,
  };
}

function noWork() {
  return {
    outcome: 'NO_WORK' as const,
    recoveryRequestId: null,
    deliveryAttemptId: null,
    attemptNumber: null,
    leaseId: null,
    leaseExpiresAt: null,
    passwordResetTokenId: null,
  };
}

function createHarness(
  adapterResult: 'ACCEPTED' | 'NOT_ACCEPTED' | 'INDETERMINATE' = 'ACCEPTED',
  mode: 'disabled' | 'controlled' = 'controlled',
) {
  const persistence = {
    claim: vi.fn().mockResolvedValueOnce(claimed()).mockResolvedValue(noWork()),
    prepare: vi.fn().mockResolvedValue({
      outcome: 'PREPARED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      passwordResetTokenId: tokenId,
      expiresAt,
    }),
    confirmSending: vi.fn().mockResolvedValue({
      outcome: 'SEND_AUTHORIZED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      leaseId,
      leaseExpiresAt: new Date('2030-01-01T00:01:00Z'),
      recipientEmail: 'synthetic@example.test',
      tokenExpiresAt: expiresAt,
    }),
    complete: vi.fn().mockResolvedValue({
      outcome: adapterResult === 'ACCEPTED' ? 'SENT' : 'FAILED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'SENT',
      attemptState: 'SENT',
      nextEligibleAt: null,
    }),
    reconcile: vi.fn().mockResolvedValue({
      outcome: 'UNKNOWN',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: null,
      attemptState: null,
      observedLeaseId: null,
      passwordResetTokenId: null,
      tokenExpiresAt: null,
    }),
  };
  const adapter = {
    deliver: vi.fn().mockResolvedValue({ status: adapterResult }),
  };
  const config: PasswordRecoveryDeliveryConfig = {
    mode,
    publicOrigin: mode === 'controlled' ? 'https://bello.example' : null,
    idlePollingMilliseconds: 1_000,
    maximumClaimsPerCycle: 10,
    adapterTimeoutMilliseconds: 10_000,
  };
  const processor = new PasswordRecoveryDeliveryProcessor(
    config,
    adapter as PasswordRecoveryDeliveryAdapter,
    persistence as unknown as PasswordRecoveryDeliveryPersistence,
  );
  return { processor, persistence, adapter, config };
}

describe('password recovery delivery primitives', () => {
  it('creates a canonical 32-byte token and domain-separated hash', () => {
    const generated = createPasswordRecoveryToken();
    const bytes = Buffer.from(generated.rawToken, 'base64url');
    expect(generated.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(bytes).toHaveLength(32);
    expect(Buffer.from(generated.tokenHash)).toEqual(
      createHash('sha256')
        .update(Buffer.from('bello-flow/password-reset/v1\0'))
        .update(bytes)
        .digest(),
    );
  });

  it('builds only the approved fragment URL', () => {
    expect(buildPasswordRecoveryUrl('https://bello.example', 'a_b-c')).toBe(
      'https://bello.example/reset-password#token=a_b-c',
    );
  });
});

describe('PasswordRecoveryDeliveryProcessor', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['ACCEPTED', 'NOT_ACCEPTED', 'INDETERMINATE'] as const)(
    'executes the post-commit flow for %s',
    async (adapterResult) => {
      const harness = createHarness(adapterResult);
      await expect(harness.processor.runCycle()).resolves.toEqual({
        processed: 1,
        noWork: true,
        infrastructureError: false,
      });
      expect(harness.persistence.prepare).toHaveBeenCalledOnce();
      expect(harness.persistence.confirmSending).toHaveBeenCalledOnce();
      expect(harness.adapter.deliver).toHaveBeenCalledOnce();
      expect(harness.persistence.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          externalResult: adapterResult,
          auditEventId:
            adapterResult === 'ACCEPTED' ? expect.any(String) : null,
        }),
      );
      expect(harness.adapter.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: 'synthetic@example.test',
          recoveryUrl: expect.stringMatching(
            /^https:\/\/bello\.example\/reset-password#token=[A-Za-z0-9_-]{43}$/,
          ),
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );

  it('keeps recipient, token and recovery URL out of operational logs', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const harness = createHarness();

    await harness.processor.runCycle();

    const rendered = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(rendered).not.toContain('synthetic@example.test');
    expect(rendered).not.toContain('/reset-password#token=');
    expect(rendered).not.toContain(requestId);
    expect(rendered).not.toContain(attemptId);
    expect(rendered).not.toContain(leaseId);
  });

  it('does not expose delivery before sending commit resolves', async () => {
    const harness = createHarness();
    let resolveConfirmation!: (value: unknown) => void;
    harness.persistence.confirmSending.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConfirmation = resolve;
      }),
    );
    const cycle = harness.processor.runCycle();
    await vi.waitFor(() =>
      expect(harness.persistence.confirmSending).toHaveBeenCalledOnce(),
    );
    expect(harness.adapter.deliver).not.toHaveBeenCalled();
    resolveConfirmation({
      outcome: 'SEND_AUTHORIZED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      leaseId,
      leaseExpiresAt: expiresAt,
      recipientEmail: 'synthetic@example.test',
      tokenExpiresAt: expiresAt,
    });
    await cycle;
    expect(harness.adapter.deliver).toHaveBeenCalledOnce();
  });

  it.each([
    'ALREADY_SENDING',
    'STALE_OWNER',
    'ALREADY_TERMINAL',
    'INCONSISTENT',
  ])('never sends from confirmation outcome %s', async (outcome) => {
    const harness = createHarness();
    harness.persistence.confirmSending.mockResolvedValueOnce({
      outcome,
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      leaseId: null,
      leaseExpiresAt: null,
      recipientEmail: null,
      tokenExpiresAt: null,
    });
    await harness.processor.runCycle();
    expect(harness.adapter.deliver).not.toHaveBeenCalled();
    expect(harness.persistence.complete).not.toHaveBeenCalled();
  });

  it('discards authorization after indeterminate sending commit', async () => {
    const harness = createHarness();
    harness.persistence.confirmSending.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    harness.persistence.reconcile.mockResolvedValueOnce({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'SENDING',
      attemptState: 'SENDING',
      observedLeaseId: leaseId,
      passwordResetTokenId: tokenId,
      tokenExpiresAt: expiresAt,
    });
    await expect(harness.processor.runCycle()).resolves.toMatchObject({
      infrastructureError: true,
    });
    expect(harness.adapter.deliver).not.toHaveBeenCalled();
    expect(harness.persistence.reconcile).toHaveBeenCalledOnce();
  });

  it('continues with the same in-memory token after proven preparation commit', async () => {
    const harness = createHarness();
    harness.persistence.prepare.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    harness.persistence.reconcile.mockImplementationOnce(async (input) => ({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'PREPARED',
      attemptState: 'PREPARED',
      observedLeaseId: leaseId,
      passwordResetTokenId: input.passwordResetTokenId,
      tokenExpiresAt: expiresAt,
    }));
    await harness.processor.runCycle();
    expect(harness.persistence.prepare).toHaveBeenCalledTimes(2);
    expect(harness.persistence.confirmSending).toHaveBeenCalledOnce();
    expect(harness.adapter.deliver).toHaveBeenCalledOnce();
  });

  it('fails closed when the proven preparation replay also fails', async () => {
    const harness = createHarness();
    harness.persistence.prepare.mockRejectedValue(new Error('connection lost'));
    harness.persistence.reconcile.mockImplementationOnce(async (input) => ({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'PREPARED',
      attemptState: 'PREPARED',
      observedLeaseId: leaseId,
      passwordResetTokenId: input.passwordResetTokenId,
      tokenExpiresAt: expiresAt,
    }));

    await expect(harness.processor.runCycle()).resolves.toMatchObject({
      infrastructureError: true,
    });
    expect(harness.persistence.prepare).toHaveBeenCalledTimes(2);
    expect(harness.adapter.deliver).not.toHaveBeenCalled();
  });

  it('repeats sending confirmation only when PREPARED is proven', async () => {
    const harness = createHarness();
    harness.persistence.confirmSending.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    harness.persistence.reconcile.mockImplementationOnce(async (input) => ({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'PREPARED',
      attemptState: 'PREPARED',
      observedLeaseId: leaseId,
      passwordResetTokenId: input.passwordResetTokenId,
      tokenExpiresAt: expiresAt,
    }));

    await harness.processor.runCycle();

    expect(harness.persistence.confirmSending).toHaveBeenCalledTimes(2);
    expect(harness.adapter.deliver).toHaveBeenCalledOnce();
  });

  it('repeats only completion after SENDING is proven', async () => {
    const harness = createHarness();
    harness.persistence.complete.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    harness.persistence.reconcile.mockResolvedValueOnce({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'SENDING',
      attemptState: 'SENDING',
      observedLeaseId: leaseId,
      passwordResetTokenId: tokenId,
      tokenExpiresAt: expiresAt,
    });

    await harness.processor.runCycle();

    expect(harness.adapter.deliver).toHaveBeenCalledOnce();
    expect(harness.persistence.complete).toHaveBeenCalledTimes(2);
    expect(harness.persistence.complete.mock.calls[1]?.[0]).toEqual(
      harness.persistence.complete.mock.calls[0]?.[0],
    );
  });

  it('fails closed when the proven completion replay also fails', async () => {
    const harness = createHarness();
    harness.persistence.complete.mockRejectedValue(
      new Error('connection lost'),
    );
    harness.persistence.reconcile.mockResolvedValueOnce({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'SENDING',
      attemptState: 'SENDING',
      observedLeaseId: leaseId,
      passwordResetTokenId: tokenId,
      tokenExpiresAt: expiresAt,
    });

    await expect(harness.processor.runCycle()).resolves.toMatchObject({
      infrastructureError: true,
    });
    expect(harness.adapter.deliver).toHaveBeenCalledOnce();
    expect(harness.persistence.complete).toHaveBeenCalledTimes(2);
  });

  it('fails closed when completion reconciliation is unavailable', async () => {
    const harness = createHarness();
    harness.persistence.complete.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    harness.persistence.reconcile.mockRejectedValueOnce(
      new Error('observation lost'),
    );

    await expect(harness.processor.runCycle()).resolves.toMatchObject({
      infrastructureError: true,
    });
    expect(harness.adapter.deliver).toHaveBeenCalledOnce();
    expect(harness.persistence.complete).toHaveBeenCalledOnce();
  });

  it.each([
    ['ACCEPTED', 'SENT', 'SENT'],
    ['NOT_ACCEPTED', 'PENDING', 'FAILED'],
    ['INDETERMINATE', 'UNKNOWN', 'UNKNOWN'],
  ] as const)(
    'accepts terminal evidence for indeterminate %s completion',
    async (externalResult, requestState, attemptState) => {
      const harness = createHarness(externalResult);
      harness.persistence.complete.mockRejectedValueOnce(
        new Error('connection lost'),
      );
      harness.persistence.reconcile.mockResolvedValueOnce({
        outcome: 'OBSERVED',
        recoveryRequestId: requestId,
        deliveryAttemptId: attemptId,
        requestState,
        attemptState,
        observedLeaseId: null,
        passwordResetTokenId: tokenId,
        tokenExpiresAt: expiresAt,
        attemptNumber: 1,
        failureClass:
          externalResult === 'NOT_ACCEPTED' ? 'DELIVERY_FAILURE' : null,
        attemptTerminalAt: new Date('2030-01-01T00:02:00Z'),
        tokenConsumedAt: null,
        tokenInvalidatedAt:
          externalResult === 'NOT_ACCEPTED'
            ? new Date('2030-01-01T00:02:00Z')
            : null,
        tokenInvalidatedOperationId:
          externalResult === 'NOT_ACCEPTED' ? attemptId : null,
        acceptedAuditConfirmed: externalResult === 'ACCEPTED',
      });

      await expect(harness.processor.runCycle()).resolves.toMatchObject({
        infrastructureError: false,
      });
      expect(harness.adapter.deliver).toHaveBeenCalledOnce();
      expect(harness.persistence.complete).toHaveBeenCalledOnce();
    },
  );

  it('rejects partial terminal evidence after an indeterminate completion', async () => {
    const harness = createHarness('ACCEPTED');
    harness.persistence.complete.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    harness.persistence.reconcile.mockResolvedValueOnce({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      requestState: 'SENT',
      attemptState: 'SENT',
      observedLeaseId: null,
      passwordResetTokenId: tokenId,
      tokenExpiresAt: expiresAt,
      acceptedAuditConfirmed: false,
    });

    await expect(harness.processor.runCycle()).resolves.toMatchObject({
      infrastructureError: true,
    });
    expect(harness.adapter.deliver).toHaveBeenCalledOnce();
    expect(harness.persistence.complete).toHaveBeenCalledOnce();
  });

  it.each(['RECOVERED_PREPARED', 'RECOVERED_SENDING_UNKNOWN'] as const)(
    'observes %s as work without sending',
    async (outcome) => {
      const harness = createHarness();
      harness.persistence.claim.mockReset();
      harness.persistence.claim
        .mockResolvedValueOnce({ ...claimed(), outcome, leaseId: null })
        .mockResolvedValueOnce(noWork());
      await expect(harness.processor.runCycle()).resolves.toMatchObject({
        processed: 1,
        noWork: true,
      });
      expect(harness.persistence.prepare).not.toHaveBeenCalled();
      expect(harness.adapter.deliver).not.toHaveBeenCalled();
    },
  );

  it('resumes a proven claim after an indeterminate claim result', async () => {
    const harness = createHarness();
    harness.persistence.claim.mockReset();
    harness.persistence.claim
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(noWork());
    harness.persistence.reconcile.mockImplementationOnce(async (input) => ({
      outcome: 'OBSERVED',
      recoveryRequestId: requestId,
      deliveryAttemptId: input.deliveryAttemptId,
      requestState: 'PREPARING',
      attemptState: 'PREPARING',
      observedLeaseId: input.leaseId,
      passwordResetTokenId: null,
      tokenExpiresAt: null,
    }));
    await harness.processor.runCycle();
    expect(harness.persistence.prepare).toHaveBeenCalledOnce();
  });

  it.each([
    { outcome: 'INCONSISTENT' },
    { outcome: 'CLAIMED', recoveryRequestId: null },
  ])('fails closed for an unusable claim %#', async (override) => {
    const harness = createHarness();
    harness.persistence.claim.mockReset();
    harness.persistence.claim.mockResolvedValueOnce({
      ...claimed(),
      ...override,
    });
    await expect(harness.processor.runCycle()).resolves.toMatchObject({
      infrastructureError: true,
    });
    expect(harness.adapter.deliver).not.toHaveBeenCalled();
  });

  it('classifies adapter exceptions and timeout as indeterminate', async () => {
    const exceptionHarness = createHarness();
    exceptionHarness.adapter.deliver.mockRejectedValueOnce(new Error('lost'));
    await exceptionHarness.processor.runCycle();
    expect(exceptionHarness.persistence.complete).toHaveBeenCalledWith(
      expect.objectContaining({ externalResult: 'INDETERMINATE' }),
    );

    vi.useFakeTimers();
    const timeoutHarness = createHarness();
    timeoutHarness.adapter.deliver.mockReturnValueOnce(new Promise(() => {}));
    const cycle = timeoutHarness.processor.runCycle();
    await vi.advanceTimersByTimeAsync(10_000);
    await cycle;
    expect(timeoutHarness.persistence.complete).toHaveBeenCalledWith(
      expect.objectContaining({ externalResult: 'INDETERMINATE' }),
    );
    expect(
      timeoutHarness.adapter.deliver.mock.calls[0]?.[0].signal.aborted,
    ).toBe(true);
  });

  it('stops new work and aborts an active controlled call on shutdown', async () => {
    const harness = createHarness();
    let signal: AbortSignal | undefined;
    harness.adapter.deliver.mockImplementationOnce(
      async (input) =>
        new Promise((resolve) => {
          signal = input.signal;
          input.signal.addEventListener('abort', () =>
            resolve({ status: 'INDETERMINATE' }),
          );
        }),
    );
    const cycle = harness.processor.runCycle();
    await vi.waitFor(() => expect(harness.adapter.deliver).toHaveBeenCalled());
    await harness.processor.onApplicationShutdown();
    await cycle;
    expect(signal?.aborted).toBe(true);
    expect(harness.persistence.claim).toHaveBeenCalledOnce();
  });

  it('starts only in controlled mode and polls after confirmed NO_WORK', async () => {
    vi.useFakeTimers();
    const controlled = createHarness();
    controlled.persistence.claim.mockReset();
    controlled.persistence.claim.mockResolvedValue(noWork());
    controlled.processor.onApplicationBootstrap();
    expect(controlled.persistence.claim).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(controlled.persistence.claim).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(controlled.persistence.claim).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(controlled.persistence.claim).toHaveBeenCalledTimes(2);
    await controlled.processor.onApplicationShutdown();

    const disabled = createHarness('ACCEPTED', 'disabled');
    disabled.processor.onApplicationBootstrap();
    await vi.runAllTimersAsync();
    expect(disabled.persistence.claim).not.toHaveBeenCalled();
    await disabled.processor.onApplicationShutdown();
  });
});
