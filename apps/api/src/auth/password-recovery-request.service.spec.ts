import type { PasswordRecoveryAdmissionService } from './password-recovery-admission.service.js';
import {
  PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE,
  PasswordRecoveryPersistenceError,
  type PasswordRecoveryRequestPersistence,
} from './password-recovery-request.persistence.js';
import { PasswordRecoveryRequestService } from './password-recovery-request.service.js';

function createHarness(
  admissionResult:
    'ADMITTED' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE' = 'ADMITTED',
) {
  const commit = vi.fn();
  const refund = vi.fn();
  const admitRequest = vi.fn(() => {
    if (admissionResult === 'RATE_LIMITED') {
      return {
        status: 'RATE_LIMITED' as const,
        flow: 'REQUEST' as const,
        retryAfterSeconds: 600,
      };
    }
    if (admissionResult === 'SERVICE_UNAVAILABLE') {
      return {
        status: 'SERVICE_UNAVAILABLE' as const,
        flow: 'REQUEST' as const,
      };
    }
    return {
      status: 'ADMITTED' as const,
      flow: 'REQUEST' as const,
      reservation: { flow: 'REQUEST' as const, commit, refund },
    };
  });
  const record = vi.fn().mockResolvedValue('RECORDED');
  const reconcile = vi.fn().mockResolvedValue('UNKNOWN');
  const service = new PasswordRecoveryRequestService(
    { admitRequest } as unknown as PasswordRecoveryAdmissionService,
    { record, reconcile } as unknown as PasswordRecoveryRequestPersistence,
  );
  return { service, admitRequest, record, reconcile, commit, refund };
}

describe('PasswordRecoveryRequestService', () => {
  it('normalizes once for persistence and commits a recorded request', async () => {
    const harness = createHarness();
    await expect(
      harness.service.request({
        email: ' User@Example.Test ',
        trustedIp: '192.0.2.10',
      }),
    ).resolves.toEqual({ status: 'RECORDED' });

    expect(harness.admitRequest).toHaveBeenCalledWith(
      ' User@Example.Test ',
      '192.0.2.10',
    );
    expect(harness.record).toHaveBeenCalledOnce();
    expect(harness.record.mock.calls[0]![0]).toMatchObject({
      normalizedEmailKey: 'user@example.test',
    });
    expect(harness.commit).toHaveBeenCalledOnce();
    expect(harness.refund).not.toHaveBeenCalled();
  });

  it('uses null for a non-normalizable identity without exposing classification', async () => {
    const harness = createHarness();
    await expect(
      harness.service.request({
        email: 'invalid',
        trustedIp: '192.0.2.11',
      }),
    ).resolves.toEqual({ status: 'RECORDED' });
    expect(harness.record.mock.calls[0]![0]).toMatchObject({
      normalizedEmailKey: null,
    });
  });

  it('rejects quota before PostgreSQL and preserves Retry-After', async () => {
    const harness = createHarness('RATE_LIMITED');
    await expect(
      harness.service.request({
        email: 'user@example.test',
        trustedIp: '192.0.2.12',
      }),
    ).resolves.toEqual({
      status: 'RATE_LIMITED',
      retryAfterSeconds: 600,
    });
    expect(harness.record).not.toHaveBeenCalled();
    expect(harness.reconcile).not.toHaveBeenCalled();
  });

  it('rejects saturation before PostgreSQL', async () => {
    const harness = createHarness('SERVICE_UNAVAILABLE');
    await expect(
      harness.service.request({ email: null, trustedIp: null }),
    ).resolves.toEqual({ status: 'SERVICE_UNAVAILABLE' });
    expect(harness.record).not.toHaveBeenCalled();
  });

  it.each([
    PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED,
  ] as const)('refunds only a confirmed no-effect result: %s', async (code) => {
    const harness = createHarness();
    harness.record.mockRejectedValue(
      new PasswordRecoveryPersistenceError(code),
    );
    await expect(
      harness.service.request({
        email: 'user@example.test',
        trustedIp: '192.0.2.13',
      }),
    ).resolves.toEqual({ status: 'SERVICE_UNAVAILABLE' });
    expect(harness.refund).toHaveBeenCalledOnce();
    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.reconcile).not.toHaveBeenCalled();
  });

  it('reconciles an indeterminate send with the same request id', async () => {
    const harness = createHarness();
    harness.record.mockRejectedValue(
      new PasswordRecoveryPersistenceError(
        PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      ),
    );
    harness.reconcile.mockResolvedValue('RECORDED');

    await expect(
      harness.service.request({
        email: 'user@example.test',
        trustedIp: '192.0.2.14',
      }),
    ).resolves.toEqual({ status: 'RECORDED' });

    const requestId = harness.record.mock.calls[0]![0].recoveryRequestId;
    expect(harness.reconcile).toHaveBeenCalledWith(requestId);
    expect(harness.record).toHaveBeenCalledOnce();
    expect(harness.commit).toHaveBeenCalledOnce();
    expect(harness.refund).not.toHaveBeenCalled();
  });

  it.each(['UNKNOWN', 'INCONSISTENT'] as const)(
    'consumes the reservation without success or retry for %s',
    async (outcome) => {
      const harness = createHarness();
      harness.record.mockRejectedValue(new Error('connection lost'));
      harness.reconcile.mockResolvedValue(outcome);
      await expect(
        harness.service.request({
          email: 'user@example.test',
          trustedIp: '192.0.2.15',
        }),
      ).resolves.toEqual({ status: 'SERVICE_UNAVAILABLE' });
      expect(harness.record).toHaveBeenCalledOnce();
      expect(harness.reconcile).toHaveBeenCalledOnce();
      expect(harness.reconcile).toHaveBeenCalledWith(
        harness.record.mock.calls[0]![0].recoveryRequestId,
      );
      expect(harness.commit).toHaveBeenCalledOnce();
      expect(harness.refund).not.toHaveBeenCalled();
    },
  );

  it('consumes the reservation when reconciliation itself fails', async () => {
    const harness = createHarness();
    harness.record.mockRejectedValue(new Error('connection lost'));
    harness.reconcile.mockRejectedValue(new Error('observation failed'));
    await expect(
      harness.service.request({
        email: 'user@example.test',
        trustedIp: '192.0.2.16',
      }),
    ).resolves.toEqual({ status: 'SERVICE_UNAVAILABLE' });
    expect(harness.commit).toHaveBeenCalledOnce();
    expect(harness.refund).not.toHaveBeenCalled();
  });
});
