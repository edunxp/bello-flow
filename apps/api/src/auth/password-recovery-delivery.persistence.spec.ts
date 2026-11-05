import type { PrismaService } from '../prisma/prisma.service.js';
import {
  PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE,
  PasswordRecoveryDeliveryPersistence,
} from './password-recovery-delivery.persistence.js';

type RawCall = [TemplateStringsArray, ...unknown[]];

function sqlOf(call: RawCall): string {
  return call[0].join('?').replaceAll(/\s+/g, ' ').trim();
}

function createHarness(result: unknown[] = []) {
  const queryRaw = vi.fn().mockResolvedValue(result);
  const executeRaw = vi.fn().mockResolvedValue(0);
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  );
  const persistence = new PasswordRecoveryDeliveryPersistence({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { persistence, queryRaw, executeRaw, transaction };
}

describe('PasswordRecoveryDeliveryPersistence', () => {
  const requestId = '00000000-0000-4000-8000-000000000061';
  const attemptId = '00000000-0000-4000-8000-000000000062';
  const leaseId = '00000000-0000-4000-8000-000000000063';
  const tokenId = '00000000-0000-4000-8000-000000000064';
  const auditId = '00000000-0000-4000-8000-000000000065';
  const expiresAt = new Date('2030-01-01T00:30:00Z');

  it.each([
    'CLAIMED',
    'RESUMED_PREPARING',
    'RECOVERED_PREPARED',
    'RECOVERED_SENDING_UNKNOWN',
    'NO_WORK',
    'INCONSISTENT',
  ] as const)('maps claim outcome %s from exactly one row', async (outcome) => {
    const row = {
      outcome,
      recoveryRequestId: outcome === 'NO_WORK' ? null : requestId,
      deliveryAttemptId: outcome === 'NO_WORK' ? null : attemptId,
      attemptNumber: outcome === 'NO_WORK' ? null : 1,
      leaseId: outcome === 'CLAIMED' ? leaseId : null,
      leaseExpiresAt: outcome === 'CLAIMED' ? expiresAt : null,
      passwordResetTokenId: null,
    };
    const harness = createHarness([row]);
    await expect(
      harness.persistence.claim(attemptId, leaseId),
    ).resolves.toEqual(row);
    expect(sqlOf(harness.queryRaw.mock.calls[0] as RawCall)).toContain(
      'public.claim_password_recovery_delivery',
    );
  });

  it.each([
    'PREPARED',
    'ALREADY_PREPARED_MATCHING',
    'STALE_OWNER',
    'ALREADY_TERMINAL',
    'INCONSISTENT',
  ] as const)('maps preparation outcome %s', async (outcome) => {
    const row = {
      outcome,
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      passwordResetTokenId: tokenId,
      expiresAt,
    };
    const harness = createHarness([row]);
    await expect(
      harness.persistence.prepare({
        deliveryAttemptId: attemptId,
        leaseId,
        passwordResetTokenId: tokenId,
        tokenHash: new Uint8Array(32),
        expiresAt,
      }),
    ).resolves.toEqual(row);
    expect(sqlOf(harness.queryRaw.mock.calls[0] as RawCall)).toContain(
      'public.prepare_password_recovery_delivery',
    );
  });

  it.each([
    'SEND_AUTHORIZED',
    'ALREADY_SENDING',
    'STALE_OWNER',
    'ALREADY_TERMINAL',
    'INCONSISTENT',
  ] as const)('maps sending outcome %s', async (outcome) => {
    const row = {
      outcome,
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      leaseId: outcome === 'SEND_AUTHORIZED' ? leaseId : null,
      leaseExpiresAt: outcome === 'SEND_AUTHORIZED' ? expiresAt : null,
      recipientEmail:
        outcome === 'SEND_AUTHORIZED' ? 'synthetic@example.test' : null,
      tokenExpiresAt: outcome === 'SEND_AUTHORIZED' ? expiresAt : null,
    };
    const harness = createHarness([row]);
    await expect(
      harness.persistence.confirmSending(attemptId, leaseId),
    ).resolves.toEqual(row);
    expect(sqlOf(harness.queryRaw.mock.calls[0] as RawCall)).toContain(
      'public.confirm_password_recovery_sending',
    );
  });

  it('exposes SEND_AUTHORIZED only after the persistence transaction resolves', async () => {
    const row = {
      outcome: 'SEND_AUTHORIZED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      leaseId,
      leaseExpiresAt: expiresAt,
      recipientEmail: 'synthetic@example.test',
      tokenExpiresAt: expiresAt,
    };
    const queryRaw = vi.fn().mockResolvedValue([row]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    let releaseCommit!: () => void;
    const commitBarrier = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => {
      const result = await callback({
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
      });
      await commitBarrier;
      return result;
    });
    const persistence = new PasswordRecoveryDeliveryPersistence({
      $transaction: transaction,
    } as unknown as PrismaService);
    let exposed = false;
    const confirmation = persistence
      .confirmSending(attemptId, leaseId)
      .then((result) => {
        exposed = true;
        return result;
      });
    await vi.waitFor(() => expect(queryRaw).toHaveBeenCalledOnce());
    expect(exposed).toBe(false);
    releaseCommit();
    await expect(confirmation).resolves.toEqual(row);
    expect(exposed).toBe(true);
  });

  it.each([
    ['ACCEPTED', auditId, 'SENT'],
    ['NOT_ACCEPTED', null, 'FAILED'],
    ['INDETERMINATE', null, 'UNKNOWN'],
  ] as const)(
    'completes %s only through the protected function',
    async (externalResult, auditEventId, outcome) => {
      const row = {
        outcome,
        recoveryRequestId: requestId,
        deliveryAttemptId: attemptId,
        requestState: outcome,
        attemptState: outcome,
        nextEligibleAt: null,
      };
      const harness = createHarness([row]);
      await expect(
        harness.persistence.complete({
          deliveryAttemptId: attemptId,
          leaseId,
          externalResult,
          auditEventId,
        }),
      ).resolves.toEqual(row);
      const call = harness.queryRaw.mock.calls[0] as RawCall;
      expect(sqlOf(call)).toContain(
        'public.complete_password_recovery_delivery',
      );
      expect(call).toContain(auditEventId);
    },
  );

  it.each(['ALREADY_TERMINAL', 'STALE_OWNER', 'INCONSISTENT'] as const)(
    'maps guarded completion outcome %s',
    async (outcome) => {
      const row = {
        outcome,
        recoveryRequestId: requestId,
        deliveryAttemptId: attemptId,
        requestState: 'SENT',
        attemptState: 'SENT',
        nextEligibleAt: null,
      };
      const harness = createHarness([row]);
      await expect(
        harness.persistence.complete({
          deliveryAttemptId: attemptId,
          leaseId,
          externalResult: 'ACCEPTED',
          auditEventId: auditId,
        }),
      ).resolves.toEqual(row);
    },
  );

  it.each(['OBSERVED', 'NOT_FOUND', 'INCONSISTENT'] as const)(
    'returns observational reconciliation %s',
    async (outcome) => {
      const row = {
        outcome,
        recoveryRequestId: requestId,
        deliveryAttemptId: attemptId,
        requestState: 'PREPARED',
        attemptState: 'PREPARED',
        observedLeaseId: leaseId,
        passwordResetTokenId: tokenId,
        tokenExpiresAt: expiresAt,
        attemptNumber: 1,
        failureClass: null,
        attemptTerminalAt: null,
        tokenConsumedAt: null,
        tokenInvalidatedAt: null,
        tokenInvalidatedOperationId: null,
        acceptedAuditConfirmed: false,
      };
      const harness = createHarness([row]);
      await expect(
        harness.persistence.reconcile({
          recoveryRequestId: requestId,
          deliveryAttemptId: attemptId,
          leaseId,
          passwordResetTokenId: tokenId,
        }),
      ).resolves.toEqual(row);
      expect(sqlOf(harness.queryRaw.mock.calls[0] as RawCall)).toContain(
        'public.reconcile_password_recovery_delivery',
      );
      expect(harness.executeRaw).toHaveBeenCalledTimes(2);
    },
  );

  it.each([new Error('unavailable'), [], [{ outcome: 'OTHER' }]])(
    'fails reconciliation closed as UNKNOWN %#',
    async (failure) => {
      const harness = createHarness();
      if (failure instanceof Error) harness.queryRaw.mockRejectedValue(failure);
      else harness.queryRaw.mockResolvedValue(failure);
      await expect(
        harness.persistence.reconcile({
          recoveryRequestId: requestId,
          deliveryAttemptId: attemptId,
          leaseId,
          passwordResetTokenId: tokenId,
        }),
      ).resolves.toMatchObject({ outcome: 'UNKNOWN' });
    },
  );

  it('retries rollback-safe SQL states with the same identifiers', async () => {
    const row = {
      outcome: 'CLAIMED',
      recoveryRequestId: requestId,
      deliveryAttemptId: attemptId,
      attemptNumber: 1,
      leaseId,
      leaseExpiresAt: expiresAt,
      passwordResetTokenId: null,
    };
    const harness = createHarness();
    harness.queryRaw
      .mockRejectedValueOnce({ code: '40001' })
      .mockRejectedValueOnce({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '55P03',
              originalMessage: 'canceling statement due to lock timeout',
            },
          },
        },
      })
      .mockResolvedValue([row]);
    await expect(
      harness.persistence.claim(attemptId, leaseId),
    ).resolves.toEqual(row);
    expect(harness.queryRaw).toHaveBeenCalledTimes(3);
  });

  it.each([
    [{ code: '23505' }, 'ROLLBACK_CONFIRMED'],
    [{ code: '08006' }, 'OPERATION_INDETERMINATE'],
    [new Error('connection lost'), 'OPERATION_INDETERMINATE'],
  ])('classifies mutation failure %#', async (failure, code) => {
    const harness = createHarness();
    harness.queryRaw.mockRejectedValue(failure);
    await expect(
      harness.persistence.claim(attemptId, leaseId),
    ).rejects.toMatchObject({ code });
    expect(harness.queryRaw).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'claim',
      (persistence: PasswordRecoveryDeliveryPersistence) =>
        persistence.claim(attemptId, leaseId),
    ],
    [
      'prepare',
      (persistence: PasswordRecoveryDeliveryPersistence) =>
        persistence.prepare({
          deliveryAttemptId: attemptId,
          leaseId,
          passwordResetTokenId: tokenId,
          tokenHash: new Uint8Array(32),
          expiresAt,
        }),
    ],
    [
      'confirm',
      (persistence: PasswordRecoveryDeliveryPersistence) =>
        persistence.confirmSending(attemptId, leaseId),
    ],
    [
      'complete',
      (persistence: PasswordRecoveryDeliveryPersistence) =>
        persistence.complete({
          deliveryAttemptId: attemptId,
          leaseId,
          externalResult: 'INDETERMINATE',
          auditEventId: null,
        }),
    ],
  ] as const)(
    'classifies a simulated connection loss during %s as indeterminate',
    async (_name, operation) => {
      const harness = createHarness();
      harness.queryRaw.mockRejectedValue(new Error('connection lost'));
      await expect(operation(harness.persistence)).rejects.toMatchObject({
        code: PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      });
    },
  );

  it('keeps a simulated reconciliation connection loss observationally UNKNOWN', async () => {
    const harness = createHarness();
    harness.queryRaw.mockRejectedValue(new Error('connection lost'));
    await expect(
      harness.persistence.reconcile({
        recoveryRequestId: requestId,
        deliveryAttemptId: attemptId,
        leaseId,
        passwordResetTokenId: tokenId,
      }),
    ).resolves.toMatchObject({ outcome: 'UNKNOWN' });
  });

  it('exhausts retryable failures as a confirmed rollback', async () => {
    const harness = createHarness();
    harness.queryRaw.mockRejectedValue({ code: '40P01' });
    await expect(
      harness.persistence.claim(attemptId, leaseId),
    ).rejects.toMatchObject({
      code: PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED,
    });
    expect(harness.queryRaw).toHaveBeenCalledTimes(3);
  });

  it.each([
    () => createHarness().persistence.claim('invalid', leaseId),
    () =>
      createHarness().persistence.prepare({
        deliveryAttemptId: attemptId,
        leaseId,
        passwordResetTokenId: tokenId,
        tokenHash: new Uint8Array(31),
        expiresAt,
      }),
    () =>
      createHarness().persistence.prepare({
        deliveryAttemptId: attemptId,
        leaseId,
        passwordResetTokenId: tokenId,
        tokenHash: new Uint8Array(32),
        expiresAt: new Date('invalid'),
      }),
    () => createHarness().persistence.confirmSending(attemptId, 'invalid'),
    () =>
      createHarness().persistence.complete({
        deliveryAttemptId: attemptId,
        leaseId,
        externalResult: 'ACCEPTED',
        auditEventId: null,
      }),
    () =>
      createHarness().persistence.complete({
        deliveryAttemptId: attemptId,
        leaseId,
        externalResult: 'NOT_ACCEPTED',
        auditEventId: auditId,
      }),
    () =>
      createHarness().persistence.reconcile({
        recoveryRequestId: null,
        deliveryAttemptId: null,
        leaseId: null,
        passwordResetTokenId: null,
      }),
  ])('rejects invalid input before SQL %#', async (operation) => {
    await expect(operation()).rejects.toMatchObject({
      code: PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    });
  });

  it.each([
    () =>
      createHarness([{ outcome: 'OTHER' }]).persistence.claim(
        attemptId,
        leaseId,
      ),
    () => createHarness([]).persistence.confirmSending(attemptId, leaseId),
    () =>
      createHarness([{ outcome: 'OTHER' }]).persistence.complete({
        deliveryAttemptId: attemptId,
        leaseId,
        externalResult: 'INDETERMINATE',
        auditEventId: null,
      }),
  ])('rejects invalid cardinality or outcome %#', async (operation) => {
    await expect(operation()).rejects.toMatchObject({
      code: PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
    });
  });
});
