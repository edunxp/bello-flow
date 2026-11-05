import { Prisma } from '../generated/prisma/client.js';
import type { EmailKey } from '../identity/account-email.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE,
  PasswordRecoveryRequestPersistence,
} from './password-recovery-request.persistence.js';

type RawCall = [TemplateStringsArray, ...unknown[]];

function sqlOf(call: RawCall): string {
  return call[0].join('?').replaceAll(/\s+/g, ' ').trim();
}

function createHarness() {
  const queryRaw = vi.fn().mockResolvedValue([{ outcome: 'RECORDED' }]);
  const persistence = new PasswordRecoveryRequestPersistence({
    $queryRaw: queryRaw,
  } as unknown as PrismaService);
  return { persistence, queryRaw };
}

describe('PasswordRecoveryRequestPersistence', () => {
  const recoveryRequestId = '00000000-0000-4000-8000-000000000040';
  const auditEventId = '00000000-0000-4000-8000-000000000041';
  const normalizedEmailKey = 'user@example.test' as EmailKey;

  it('records through the protected function and exposes only RECORDED', async () => {
    const harness = createHarness();

    await expect(
      harness.persistence.record({
        recoveryRequestId,
        auditEventId,
        normalizedEmailKey,
      }),
    ).resolves.toBe('RECORDED');

    expect(harness.queryRaw).toHaveBeenCalledOnce();
    const call = harness.queryRaw.mock.calls[0] as RawCall;
    expect(sqlOf(call)).toContain('public.request_password_recovery');
    expect(call).toContain(recoveryRequestId);
    expect(call).toContain(auditEventId);
    expect(call).toContain(normalizedEmailKey);
  });

  it.each([
    {
      recoveryRequestId: 'not-a-uuid',
      auditEventId,
      normalizedEmailKey,
    },
    {
      recoveryRequestId,
      auditEventId: '00000000-0000-1000-8000-000000000041',
      normalizedEmailKey,
    },
    {
      recoveryRequestId,
      auditEventId,
      normalizedEmailKey: 'User@example.test' as EmailKey,
    },
  ])('rejects invalid input before sending SQL', async (input) => {
    const harness = createHarness();
    await expect(harness.persistence.record(input)).rejects.toMatchObject({
      code: PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    });
    expect(harness.queryRaw).not.toHaveBeenCalled();
  });

  it('accepts null only as the non-normalizable identity representation', async () => {
    const harness = createHarness();
    await expect(
      harness.persistence.record({
        recoveryRequestId,
        auditEventId,
        normalizedEmailKey: null,
      }),
    ).resolves.toBe('RECORDED');
    expect(harness.queryRaw.mock.calls[0]).toContain(null);
  });

  it.each([
    Object.create(Prisma.PrismaClientKnownRequestError.prototype) as Error,
    new Prisma.PrismaClientKnownRequestError('insufficient database metadata', {
      code: 'P2010',
      clientVersion: 'test',
      meta: {},
    }),
    new Prisma.PrismaClientKnownRequestError('operation timed out', {
      code: 'P1008',
      clientVersion: 'test',
    }),
    new Error('connection lost'),
    [{ outcome: 'PENDING' }],
    [],
  ])(
    'classifies an unprovable record result as indeterminate',
    async (failure) => {
      const harness = createHarness();
      if (failure instanceof Error) {
        harness.queryRaw.mockRejectedValue(failure);
      } else {
        harness.queryRaw.mockResolvedValue(failure);
      }

      await expect(
        harness.persistence.record({
          recoveryRequestId,
          auditEventId,
          normalizedEmailKey,
        }),
      ).rejects.toMatchObject({
        code: PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        recoveryRequestId,
      });
    },
  );

  it.each(['RECORDED', 'INCONSISTENT', 'UNKNOWN'] as const)(
    'returns the observational reconciliation outcome %s',
    async (outcome) => {
      const harness = createHarness();
      harness.queryRaw.mockResolvedValue([{ outcome }]);
      await expect(
        harness.persistence.reconcile(recoveryRequestId),
      ).resolves.toBe(outcome);
      expect(sqlOf(harness.queryRaw.mock.calls[0] as RawCall)).toContain(
        'public.reconcile_password_recovery_request',
      );
    },
  );

  it.each([new Error('unavailable'), [{ outcome: 'unexpected' }], []])(
    'fails closed as UNKNOWN when reconciliation is not provable',
    async (failure) => {
      const harness = createHarness();
      if (failure instanceof Error) {
        harness.queryRaw.mockRejectedValue(failure);
      } else {
        harness.queryRaw.mockResolvedValue(failure);
      }
      await expect(
        harness.persistence.reconcile(recoveryRequestId),
      ).resolves.toBe('UNKNOWN');
    },
  );

  it('rejects an invalid reconciliation identifier before SQL', async () => {
    const harness = createHarness();
    await expect(
      harness.persistence.reconcile('invalid'),
    ).rejects.toMatchObject({
      code: PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    });
    expect(harness.queryRaw).not.toHaveBeenCalled();
  });
});
