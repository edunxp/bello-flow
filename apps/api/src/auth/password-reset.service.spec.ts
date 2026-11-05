const cryptoMocks = vi.hoisted(() => ({
  createHash: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  cryptoMocks.createHash.mockImplementation(actual.createHash);
  cryptoMocks.randomUUID.mockImplementation(actual.randomUUID);
  return {
    ...actual,
    createHash: cryptoMocks.createHash,
    randomUUID: cryptoMocks.randomUUID,
  };
});

import { createHash } from 'node:crypto';
import type { PasswordCredentialService } from '../credentials/password-credential.service.js';
import type { Argon2ExecutionService } from './argon2-execution.service.js';
import type { PasswordRecoveryAdmissionService } from './password-recovery-admission.service.js';
import {
  PASSWORD_RESET_PERSISTENCE_ERROR_CODE,
  PasswordResetPersistenceError,
  type CompletePasswordResetInput,
  type PasswordResetPersistence,
  type PasswordResetCompleteOutcome,
  type PasswordResetReconciliationOutcome,
  type PasswordResetStartOutcome,
  type StartPasswordResetInput,
} from './password-reset.persistence.js';
import {
  hashCanonicalPasswordResetToken,
  PasswordResetService,
  PasswordResetValidationError,
} from './password-reset.service.js';

const tokenBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const token = tokenBytes.toString('base64url');
const password = 'correct horse battery staple';
const passwordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

function createHarness(
  admissionStatus:
    'ADMITTED' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE' = 'ADMITTED',
) {
  const events: string[] = [];
  let reservationState: 'OPEN' | 'COMMITTED' | 'REFUNDED' = 'OPEN';
  const commit = vi.fn(() => {
    if (reservationState !== 'OPEN') return;
    reservationState = 'COMMITTED';
    events.push('commit');
  });
  const refund = vi.fn(() => {
    if (reservationState !== 'OPEN') return;
    reservationState = 'REFUNDED';
    events.push('refund');
  });
  const admitReset = vi.fn(() => {
    events.push('admit');
    if (admissionStatus === 'RATE_LIMITED') {
      return {
        status: 'RATE_LIMITED' as const,
        flow: 'RESET' as const,
        retryAfterSeconds: 5,
      };
    }
    if (admissionStatus === 'SERVICE_UNAVAILABLE') {
      return { status: 'SERVICE_UNAVAILABLE' as const, flow: 'RESET' as const };
    }
    return {
      status: 'ADMITTED' as const,
      flow: 'RESET' as const,
      reservation: { flow: 'RESET' as const, commit, refund },
    };
  });
  const start = vi.fn(
    async (
      _input: StartPasswordResetInput,
    ): Promise<PasswordResetStartOutcome> => {
      events.push('start');
      return 'STARTED' as const;
    },
  );
  const complete = vi.fn(
    async (
      _input: CompletePasswordResetInput,
    ): Promise<PasswordResetCompleteOutcome> => {
      events.push('complete');
      return 'COMPLETED';
    },
  );
  const reconcile = vi.fn(
    async (
      _resetOperationId: string,
    ): Promise<PasswordResetReconciliationOutcome> => 'UNKNOWN',
  );
  const validatePassword = vi.fn();
  const hashPassword = vi.fn().mockResolvedValue(passwordHash);
  const execute = vi.fn(
    async (operation: () => Promise<unknown>, _signal?: AbortSignal) => {
      events.push('argon-acquire');
      return operation();
    },
  );
  const service = new PasswordResetService(
    { admitReset } as unknown as PasswordRecoveryAdmissionService,
    { start, complete, reconcile } as unknown as PasswordResetPersistence,
    { execute } as unknown as Argon2ExecutionService,
    { validatePassword, hashPassword } as unknown as PasswordCredentialService,
  );
  return {
    service,
    events,
    admitReset,
    commit,
    refund,
    start,
    complete,
    reconcile,
    validatePassword,
    hashPassword,
    execute,
    getReservationState: () => reservationState,
  };
}

describe('password reset token primitive', () => {
  it('accepts only the canonical 32-byte Base64URL representation and hashes the domain', () => {
    const expected = createHash('sha256')
      .update(Buffer.from('bello-flow/password-reset/v1\0', 'utf8'))
      .update(tokenBytes)
      .digest();
    expect(hashCanonicalPasswordResetToken(token)).toEqual(expected);
    expect(token).toHaveLength(43);
  });

  it.each([
    null,
    '',
    `${token}=`,
    token.replace('A', '+'),
    Buffer.alloc(31).toString('base64url'),
    Buffer.alloc(33).toString('base64url'),
    'A'.repeat(42),
    'A'.repeat(44),
  ])(
    'rejects a noncanonical representation without throwing %#',
    (candidate) => {
      expect(hashCanonicalPasswordResetToken(candidate)).toBeNull();
    },
  );
});

describe('PasswordResetService', () => {
  const input = { token, newPassword: password, trustedIp: '192.0.2.20' };

  beforeEach(() => {
    cryptoMocks.createHash.mockClear();
    cryptoMocks.randomUUID.mockClear();
  });

  it('validates structure and password before admission or cryptography', async () => {
    const harness = createHarness();
    harness.validatePassword.mockImplementation(() => {
      throw new Error('policy');
    });
    await expect(harness.service.reset(input)).rejects.toBeInstanceOf(
      PasswordResetValidationError,
    );
    await expect(
      harness.service.reset({ ...input, token: null }),
    ).rejects.toBeInstanceOf(PasswordResetValidationError);
    expect(harness.admitReset).not.toHaveBeenCalled();
    expect(harness.hashPassword).not.toHaveBeenCalled();
  });

  it.each(['RATE_LIMITED', 'SERVICE_UNAVAILABLE'] as const)(
    'ends on pre-admission %s without a reservation or await work',
    async (status) => {
      const harness = createHarness(status);
      await expect(harness.service.reset(input)).resolves.toEqual(
        status === 'RATE_LIMITED'
          ? { status, retryAfterSeconds: 5 }
          : { status },
      );
      expect(harness.start).not.toHaveBeenCalled();
      expect(harness.execute).not.toHaveBeenCalled();
    },
  );

  it('commits malformed canonical-token admission as an opaque rejection', async () => {
    const harness = createHarness();
    await expect(
      harness.service.reset({ ...input, token: `${token}=` }),
    ).resolves.toEqual({
      status: 'AUTHENTICATION_FAILED',
    });
    expect(harness.commit).toHaveBeenCalledOnce();
    expect(harness.refund).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.hashPassword).not.toHaveBeenCalled();
  });

  it('refunds exactly once when local token hashing fails before start', async () => {
    const harness = createHarness();
    cryptoMocks.createHash.mockImplementationOnce(() => {
      throw new Error('cryptographic service unavailable');
    });

    await expect(harness.service.reset(input)).resolves.toEqual({
      status: 'SERVICE_UNAVAILABLE',
    });
    expect(harness.refund).toHaveBeenCalledOnce();
    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.getReservationState()).toBe('REFUNDED');
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.reconcile).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])(
    'refunds exactly once when local UUID generation call %i fails before start',
    async (failedCall) => {
      const harness = createHarness();
      for (let call = 1; call < failedCall; call += 1) {
        cryptoMocks.randomUUID.mockReturnValueOnce(
          `00000000-0000-4000-8000-00000000000${call}`,
        );
      }
      cryptoMocks.randomUUID.mockImplementationOnce(() => {
        throw new Error('entropy unavailable');
      });

      await expect(harness.service.reset(input)).resolves.toEqual({
        status: 'SERVICE_UNAVAILABLE',
      });
      expect(harness.refund).toHaveBeenCalledOnce();
      expect(harness.commit).not.toHaveBeenCalled();
      expect(harness.getReservationState()).toBe('REFUNDED');
      expect(harness.start).not.toHaveBeenCalled();
      expect(harness.execute).not.toHaveBeenCalled();
      expect(harness.complete).not.toHaveBeenCalled();
      expect(harness.reconcile).not.toHaveBeenCalled();
    },
  );

  it.each(['NOT_RESOLVED', 'REJECTED'] as const)(
    'commits determined start outcome %s without Argon2id',
    async (outcome) => {
      const harness = createHarness();
      harness.start.mockResolvedValue(outcome);
      await expect(harness.service.reset(input)).resolves.toEqual({
        status: 'AUTHENTICATION_FAILED',
      });
      expect(harness.commit).toHaveBeenCalledOnce();
      expect(harness.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    PASSWORD_RESET_PERSISTENCE_ERROR_CODE.NOT_SENT,
    PASSWORD_RESET_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED,
  ] as const)(
    'refunds only confirmed no-effect start failure %s',
    async (code) => {
      const harness = createHarness();
      harness.start.mockRejectedValue(new PasswordResetPersistenceError(code));
      await expect(harness.service.reset(input)).resolves.toEqual({
        status: 'SERVICE_UNAVAILABLE',
      });
      expect(harness.refund).toHaveBeenCalledOnce();
      expect(harness.commit).not.toHaveBeenCalled();
      expect(harness.reconcile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['COMPLETED', 'COMPLETED'],
    ['REJECTED', 'AUTHENTICATION_FAILED'],
    ['NOT_FOUND', 'SERVICE_UNAVAILABLE'],
    ['INCONSISTENT', 'SERVICE_UNAVAILABLE'],
    ['UNKNOWN', 'SERVICE_UNAVAILABLE'],
  ] as const)(
    'commits possible start send and maps reconciliation %s to %s',
    async (outcome, status) => {
      const harness = createHarness();
      harness.start.mockRejectedValue(new Error('connection lost'));
      harness.reconcile.mockResolvedValue(outcome);
      await expect(harness.service.reset(input)).resolves.toEqual({ status });
      expect(harness.commit).toHaveBeenCalledOnce();
      expect(harness.refund).not.toHaveBeenCalled();
      expect(harness.getReservationState()).toBe('COMMITTED');
      expect(
        harness.commit.mock.calls.length + harness.refund.mock.calls.length,
      ).toBe(1);
      expect(harness.start).toHaveBeenCalledOnce();
      expect(harness.reconcile).toHaveBeenCalledWith(
        harness.start.mock.calls[0]![0].resetOperationId,
      );
      expect(harness.execute).not.toHaveBeenCalled();
    },
  );

  it('commits STARTED before acquiring the shared Argon2id executor', async () => {
    const harness = createHarness();
    await expect(harness.service.reset(input)).resolves.toEqual({
      status: 'COMPLETED',
    });
    expect(harness.events).toEqual([
      'admit',
      'start',
      'commit',
      'argon-acquire',
      'complete',
    ]);
    expect(harness.hashPassword).toHaveBeenCalledWith(password);
    expect(harness.complete.mock.calls[0]![0].resetOperationId).toBe(
      harness.start.mock.calls[0]![0].resetOperationId,
    );
    expect(harness.start.mock.calls[0]![0].auditEventId).not.toBe(
      harness.complete.mock.calls[0]![0].auditEventId,
    );
  });

  it('keeps STARTED committed when Argon2id acquisition or hashing fails', async () => {
    const harness = createHarness();
    harness.execute.mockRejectedValue(new Error('unavailable'));
    await expect(harness.service.reset(input)).resolves.toEqual({
      status: 'SERVICE_UNAVAILABLE',
    });
    expect(harness.commit).toHaveBeenCalledOnce();
    expect(harness.refund).not.toHaveBeenCalled();
    expect(harness.getReservationState()).toBe('COMMITTED');
    expect(
      harness.commit.mock.calls.length + harness.refund.mock.calls.length,
    ).toBe(1);
    expect(harness.complete).not.toHaveBeenCalled();
  });

  it('passes cancellation only to the shared executor', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    await harness.service.reset({ ...input, signal: controller.signal });
    expect(harness.execute.mock.calls[0]![1]).toBe(controller.signal);
  });

  it('maps a determined complete rejection without retry or refund', async () => {
    const harness = createHarness();
    harness.complete.mockResolvedValue('REJECTED');
    await expect(harness.service.reset(input)).resolves.toEqual({
      status: 'AUTHENTICATION_FAILED',
    });
    expect(harness.complete).toHaveBeenCalledOnce();
    expect(harness.reconcile).not.toHaveBeenCalled();
    expect(harness.refund).not.toHaveBeenCalled();
  });

  it.each([
    ['COMPLETED', 'COMPLETED'],
    ['REJECTED', 'AUTHENTICATION_FAILED'],
    ['NOT_FOUND', 'SERVICE_UNAVAILABLE'],
    ['INCONSISTENT', 'SERVICE_UNAVAILABLE'],
    ['UNKNOWN', 'SERVICE_UNAVAILABLE'],
  ] as const)(
    'does not repeat indeterminate complete and maps %s to %s',
    async (outcome, status) => {
      const harness = createHarness();
      harness.complete.mockRejectedValue(new Error('possible commit'));
      harness.reconcile.mockResolvedValue(outcome);
      await expect(harness.service.reset(input)).resolves.toEqual({ status });
      expect(harness.complete).toHaveBeenCalledOnce();
      expect(harness.reconcile).toHaveBeenCalledWith(
        harness.complete.mock.calls[0]![0].resetOperationId,
      );
      expect(harness.refund).not.toHaveBeenCalled();
    },
  );

  it('fails closed when reconciliation observation itself fails', async () => {
    const harness = createHarness();
    harness.complete.mockRejectedValue(new Error('possible commit'));
    harness.reconcile.mockRejectedValue(new Error('observation failed'));
    await expect(harness.service.reset(input)).resolves.toEqual({
      status: 'SERVICE_UNAVAILABLE',
    });
    expect(harness.complete).toHaveBeenCalledOnce();
  });
});
