import type { PrismaService } from '../prisma/prisma.service.js';
import {
  PASSWORD_RESET_PERSISTENCE_ERROR_CODE,
  PasswordResetPersistence,
} from './password-reset.persistence.js';

type RawCall = [TemplateStringsArray, ...unknown[]];

function sqlOf(call: RawCall): string {
  return call[0].join('?').replaceAll(/\s+/g, ' ').trim();
}

function createHarness() {
  const queryRaw = vi.fn();
  const persistence = new PasswordResetPersistence({
    $queryRaw: queryRaw,
  } as unknown as PrismaService);
  return { persistence, queryRaw };
}

describe('PasswordResetPersistence', () => {
  const resetOperationId = '00000000-0000-4000-8000-000000000050';
  const auditEventId = '00000000-0000-4000-8000-000000000051';
  const accountId = '00000000-0000-4000-8000-000000000052';
  const tokenHash = new Uint8Array(32).fill(7);
  const passwordHash =
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

  it.each(['STARTED', 'REJECTED'] as const)(
    'calls the protected start operation and maps %s',
    async (state) => {
      const harness = createHarness();
      harness.queryRaw.mockResolvedValue([{ accountId, state }]);
      await expect(
        harness.persistence.start({
          resetOperationId,
          auditEventId,
          presentedTokenHash: tokenHash,
        }),
      ).resolves.toBe(state);
      const call = harness.queryRaw.mock.calls[0] as RawCall;
      expect(sqlOf(call)).toContain('public.start_password_reset_operation');
      expect(call).toContain(resetOperationId);
      expect(call).toContain(auditEventId);
      expect(call.some((value) => Buffer.isBuffer(value))).toBe(true);
    },
  );

  it('maps zero start rows to an opaque unresolved token', async () => {
    const harness = createHarness();
    harness.queryRaw.mockResolvedValue([]);
    await expect(
      harness.persistence.start({
        resetOperationId,
        auditEventId,
        presentedTokenHash: tokenHash,
      }),
    ).resolves.toBe('NOT_RESOLVED');
  });

  it.each(['COMPLETED', 'REJECTED'] as const)(
    'calls the protected complete operation and validates %s evidence shape',
    async (state) => {
      const harness = createHarness();
      harness.queryRaw.mockResolvedValue([
        {
          accountId,
          state,
          revokedSessionCount: 2n,
          invalidatedTokenCount: 1n,
          cancelledRequestCount: 0n,
          cancelledAttemptCount: 0n,
        },
      ]);
      await expect(
        harness.persistence.complete({
          resetOperationId,
          auditEventId,
          newPasswordHash: passwordHash,
        }),
      ).resolves.toBe(state);
      const call = harness.queryRaw.mock.calls[0] as RawCall;
      expect(sqlOf(call)).toContain('public.complete_password_reset_operation');
      expect(call).toContain(passwordHash);
    },
  );

  it.each([
    {
      rows: [
        { accountId, state: 'STARTED' },
        { accountId, state: 'STARTED' },
      ],
    },
    { rows: [{ accountId: 'invalid', state: 'STARTED' }] },
    { rows: [{ accountId, state: 'OTHER' }] },
    {
      rows: [
        {
          accountId,
          state: 'COMPLETED',
          revokedSessionCount: -1n,
          invalidatedTokenCount: 0n,
          cancelledRequestCount: 0n,
          cancelledAttemptCount: 0n,
        },
      ],
    },
  ])('fails closed for an invalid protected result %#', async ({ rows }) => {
    const harness = createHarness();
    harness.queryRaw.mockResolvedValue(rows);
    const action =
      rows.length === 0 || rows[0]?.state === 'STARTED'
        ? harness.persistence.start({
            resetOperationId,
            auditEventId,
            presentedTokenHash: tokenHash,
          })
        : harness.persistence.complete({
            resetOperationId,
            auditEventId,
            newPasswordHash: passwordHash,
          });
    await expect(action).rejects.toMatchObject({
      code: PASSWORD_RESET_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      resetOperationId,
    });
  });

  it.each([
    {
      resetOperationId: 'invalid',
      auditEventId,
      presentedTokenHash: tokenHash,
    },
    {
      resetOperationId,
      auditEventId: 'invalid',
      presentedTokenHash: tokenHash,
    },
    { resetOperationId, auditEventId, presentedTokenHash: new Uint8Array(31) },
  ])('rejects invalid start arguments before SQL %#', async (input) => {
    const harness = createHarness();
    await expect(harness.persistence.start(input)).rejects.toMatchObject({
      code: PASSWORD_RESET_PERSISTENCE_ERROR_CODE.NOT_SENT,
    });
    expect(harness.queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a PHC outside the approved profile before SQL', async () => {
    const harness = createHarness();
    await expect(
      harness.persistence.complete({
        resetOperationId,
        auditEventId,
        newPasswordHash: 'not-a-phc',
      }),
    ).rejects.toMatchObject({
      code: PASSWORD_RESET_PERSISTENCE_ERROR_CODE.NOT_SENT,
    });
    expect(harness.queryRaw).not.toHaveBeenCalled();
  });

  it.each(['40001', '40P01'])(
    'retries %s at most twice with the same identifiers',
    async (code) => {
      const harness = createHarness();
      harness.queryRaw
        .mockRejectedValueOnce({ code })
        .mockRejectedValueOnce({
          code: 'P2010',
          meta: {
            driverAdapterError: { cause: { originalCode: code } },
          },
        })
        .mockResolvedValue([{ accountId, state: 'STARTED' }]);
      await expect(
        harness.persistence.start({
          resetOperationId,
          auditEventId,
          presentedTokenHash: tokenHash,
        }),
      ).resolves.toBe('STARTED');
      expect(harness.queryRaw).toHaveBeenCalledTimes(3);
      for (const call of harness.queryRaw.mock.calls as RawCall[]) {
        expect(call).toContain(resetOperationId);
        expect(call).toContain(auditEventId);
      }
    },
  );

  it('retries 55P03 only when PostgreSQL identifies lock_timeout', async () => {
    const harness = createHarness();
    harness.queryRaw
      .mockRejectedValueOnce({
        code: 'P2010',
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '55P03',
              originalMessage: 'canceling statement due to lock timeout',
            },
          },
        },
      })
      .mockResolvedValue([{ accountId, state: 'STARTED' }]);
    await expect(
      harness.persistence.start({
        resetOperationId,
        auditEventId,
        presentedTokenHash: tokenHash,
      }),
    ).resolves.toBe('STARTED');
    expect(harness.queryRaw).toHaveBeenCalledTimes(2);
  });

  it('does not retry a generic 55P03 and reports confirmed rollback', async () => {
    const harness = createHarness();
    harness.queryRaw.mockRejectedValue({
      code: '55P03',
      message: 'lock unavailable',
    });
    await expect(
      harness.persistence.start({
        resetOperationId,
        auditEventId,
        presentedTokenHash: tokenHash,
      }),
    ).rejects.toMatchObject({
      code: PASSWORD_RESET_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED,
    });
    expect(harness.queryRaw).toHaveBeenCalledOnce();
  });

  it('reports an exhausted retry policy as confirmed rollback', async () => {
    const harness = createHarness();
    harness.queryRaw.mockRejectedValue({ code: '40P01' });
    await expect(
      harness.persistence.start({
        resetOperationId,
        auditEventId,
        presentedTokenHash: tokenHash,
      }),
    ).rejects.toMatchObject({
      code: PASSWORD_RESET_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED,
    });
    expect(harness.queryRaw).toHaveBeenCalledTimes(3);
  });

  it.each([
    new Error('connection lost'),
    { code: '08006' },
    { code: '57P01' },
    { code: 'P2010', meta: {} },
  ])(
    'does not retry or infer rollback from an indeterminate failure %#',
    async (failure) => {
      const harness = createHarness();
      harness.queryRaw.mockRejectedValue(failure);
      await expect(
        harness.persistence.complete({
          resetOperationId,
          auditEventId,
          newPasswordHash: passwordHash,
        }),
      ).rejects.toMatchObject({
        code: PASSWORD_RESET_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      });
      expect(harness.queryRaw).toHaveBeenCalledOnce();
    },
  );

  it.each([
    'COMPLETED',
    'REJECTED',
    'NOT_FOUND',
    'INCONSISTENT',
    'UNKNOWN',
  ] as const)(
    'returns the observational reconciliation outcome %s',
    async (outcome) => {
      const harness = createHarness();
      harness.queryRaw.mockResolvedValue([{ outcome }]);
      await expect(
        harness.persistence.reconcile(resetOperationId),
      ).resolves.toBe(outcome);
      expect(sqlOf(harness.queryRaw.mock.calls[0] as RawCall)).toContain(
        'public.reconcile_password_reset_operation',
      );
    },
  );

  it.each([new Error('unavailable'), [], [{ outcome: 'OTHER' }]])(
    'fails reconciliation closed as UNKNOWN %#',
    async (failure) => {
      const harness = createHarness();
      if (failure instanceof Error) harness.queryRaw.mockRejectedValue(failure);
      else harness.queryRaw.mockResolvedValue(failure);
      await expect(
        harness.persistence.reconcile(resetOperationId),
      ).resolves.toBe('UNKNOWN');
    },
  );
});
