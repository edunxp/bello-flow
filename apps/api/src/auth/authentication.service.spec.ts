import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AuthSessionPersistence,
  SESSION_PERSISTENCE_ERROR_CODE,
  SessionPersistenceError,
} from './auth-session.persistence.js';
import {
  AUTHENTICATION_ERROR_CODE,
  AuthenticationError,
  AuthenticationService,
  type AuthenticateWithPasswordInput,
} from './authentication.service.js';
import {
  generateOperationId,
  generateSessionId,
  generateSessionToken,
} from './session-primitives.js';

describe('AuthenticationService', () => {
  const changedAt = new Date('2026-11-03T10:00:00.000Z');
  const createdAt = new Date('2026-11-03T10:01:00.000Z');
  const absoluteExpiresAt = new Date('2026-11-10T10:01:00.000Z');
  const accountId = 'aeffae80-df85-4daa-9d42-dfb74abb1bf1';
  const passwordHash = '$argon2id$approved';
  const password = 'Correct horse battery staple! 42';
  const findUnique = vi.fn();
  const verifyPassword = vi.fn();
  const performNegativeVerification = vi.fn();
  const createSession = vi.fn();
  const recordFailedLogin = vi.fn();
  let service: AuthenticationService;

  function eligibleAccount(overrides: Record<string, unknown> = {}) {
    return {
      id: accountId,
      status: 'ACTIVE',
      emailVerifiedAt: new Date('2026-11-02T10:00:00.000Z'),
      deactivatedAt: null,
      credential: { passwordHash, changedAt },
      ...overrides,
    };
  }

  async function failure(
    input: AuthenticateWithPasswordInput,
  ): Promise<AuthenticationError> {
    try {
      await service.authenticateWithPassword(input);
      throw new Error('Expected authentication to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthenticationError);
      return error as AuthenticationError;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(eligibleAccount());
    verifyPassword.mockResolvedValue({ status: 'MATCH' });
    performNegativeVerification.mockResolvedValue({
      status: 'COMPLETED',
      candidateStatus: 'VALID',
    });
    recordFailedLogin.mockResolvedValue({
      operationId: generateOperationId(),
      alreadyCompleted: false,
    });
    createSession.mockImplementation(
      async (input: {
        operationId: ReturnType<typeof generateOperationId>;
      }) => ({
        sessionId: generateSessionId(),
        operationId: input.operationId,
        token: generateSessionToken(),
        createdAt,
        absoluteExpiresAt,
      }),
    );
    service = new AuthenticationService(
      { account: { findUnique } } as unknown as PrismaService,
      {
        verifyPassword,
        performNegativeVerification,
      } as unknown as PasswordCredentialService,
      { createSession, recordFailedLogin } as unknown as AuthSessionPersistence,
    );
  });

  it('normalizes the identity and returns the committed session contract', async () => {
    const result = await service.authenticateWithPassword({
      email: '  USER@Example.COM  ',
      password,
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { emailKey: 'user@example.com' },
      select: {
        id: true,
        status: true,
        emailVerifiedAt: true,
        deactivatedAt: true,
        credential: { select: { passwordHash: true, changedAt: true } },
      },
    });
    expect(verifyPassword).toHaveBeenCalledWith(password, passwordHash);
    expect(createSession).toHaveBeenCalledWith({
      accountId,
      credential: { encodedPasswordHash: passwordHash, changedAt },
      operationId: result.operationId,
    });
    expect(result).toMatchObject({
      accountId,
      createdAt,
      absoluteExpiresAt,
    });
    expect(recordFailedLogin).not.toHaveBeenCalled();
  });

  it('classifies invalid email after negative work and records a null identity', async () => {
    const error = await failure({ email: 'inválido@example.com', password });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.INVALID_INPUT);
    expect(performNegativeVerification).toHaveBeenCalledWith(password);
    expect(findUnique).not.toHaveBeenCalled();
    expect(recordFailedLogin).toHaveBeenCalledWith({
      accountId: null,
      operationId: error.operationId,
    });
  });

  it.each([
    ['unknown account', null, null],
    ['missing credential', eligibleAccount({ credential: null }), accountId],
  ])(
    'performs negative work and uniformly rejects %s',
    async (_name, account, expectedAccountId) => {
      findUnique.mockResolvedValue(account);
      const error = await failure({ email: 'user@example.com', password });

      expect(error.code).toBe(
        AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
      );
      expect(performNegativeVerification).toHaveBeenCalledWith(password);
      expect(recordFailedLogin).toHaveBeenCalledWith({
        accountId: expectedAccountId,
        operationId: error.operationId,
      });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('executes substitute work for an invalid password candidate', async () => {
    verifyPassword.mockResolvedValue({ status: 'INVALID_CANDIDATE' });
    performNegativeVerification.mockResolvedValue({
      status: 'COMPLETED',
      candidateStatus: 'INVALID',
    });

    const error = await failure({
      email: 'user@example.com',
      password: 'short',
    });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.INVALID_INPUT);
    expect(performNegativeVerification).toHaveBeenCalledWith('short');
    expect(recordFailedLogin).toHaveBeenCalledWith({
      accountId,
      operationId: error.operationId,
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('uses negative candidate classification when no credential exists', async () => {
    findUnique.mockResolvedValue(null);
    performNegativeVerification.mockResolvedValue({
      status: 'COMPLETED',
      candidateStatus: 'INVALID',
    });

    const error = await failure({ email: 'missing@example.com', password: 42 });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.INVALID_INPUT);
    expect(recordFailedLogin).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong password', { status: 'NO_MATCH' }, eligibleAccount()],
    [
      'inactive account',
      { status: 'MATCH' },
      eligibleAccount({ status: 'INACTIVE' }),
    ],
    [
      'unverified account',
      { status: 'MATCH' },
      eligibleAccount({ emailVerifiedAt: null }),
    ],
    [
      'deactivated account',
      { status: 'MATCH' },
      eligibleAccount({ deactivatedAt: new Date() }),
    ],
  ])('uniformly rejects %s', async (_name, verification, account) => {
    verifyPassword.mockResolvedValue(verification);
    findUnique.mockResolvedValue(account);

    const error = await failure({ email: 'user@example.com', password });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED);
    expect(recordFailedLogin).toHaveBeenCalledWith({
      accountId,
      operationId: error.operationId,
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it.each(['INVALID_STORED_HASH', 'OPERATIONAL_FAILURE'])(
    'maps %s verification to an unaudited operational failure',
    async (status) => {
      verifyPassword.mockResolvedValue({ status });

      const error = await failure({ email: 'user@example.com', password });

      expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
      expect(recordFailedLogin).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('preserves an operational failure from negative verification', async () => {
    findUnique.mockResolvedValue(null);
    performNegativeVerification.mockResolvedValue({
      status: 'OPERATIONAL_FAILURE',
    });

    const error = await failure({ email: 'missing@example.com', password });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
    expect(recordFailedLogin).not.toHaveBeenCalled();
  });

  it.each([
    SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
    SESSION_PERSISTENCE_ERROR_CODE.CREDENTIAL_CHANGED,
  ])(
    'audits determined session rejection %s without retrying',
    async (code) => {
      createSession.mockRejectedValue(
        new SessionPersistenceError(code, generateOperationId()),
      );

      const error = await failure({ email: 'user@example.com', password });

      expect(error.code).toBe(
        AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
      );
      expect(verifyPassword).toHaveBeenCalledOnce();
      expect(createSession).toHaveBeenCalledOnce();
      expect(recordFailedLogin).toHaveBeenCalledWith({
        accountId,
        operationId: error.operationId,
      });
    },
  );

  it('preserves operation and session identifiers for indeterminate creation', async () => {
    const persistenceOperationId = generateOperationId();
    const sessionId = generateSessionId();
    createSession.mockRejectedValue(
      new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        persistenceOperationId,
        sessionId,
      ),
    );

    const error = await failure({ email: 'user@example.com', password });

    expect(error).toMatchObject({
      code: AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE,
      operationId: persistenceOperationId,
      sessionId,
    });
    expect(recordFailedLogin).not.toHaveBeenCalled();
  });

  it.each([
    SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
    SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
  ])('maps persistence failure %s to operational failure', async (code) => {
    createSession.mockRejectedValue(
      new SessionPersistenceError(code, generateOperationId()),
    );

    const error = await failure({ email: 'user@example.com', password });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
    expect(recordFailedLogin).not.toHaveBeenCalled();
  });

  it('maps an indeterminate failed-login audit without repeating it', async () => {
    verifyPassword.mockResolvedValue({ status: 'NO_MATCH' });
    recordFailedLogin.mockImplementation(
      async (input: {
        operationId: ReturnType<typeof generateOperationId>;
      }) => {
        throw new SessionPersistenceError(
          SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
          input.operationId,
        );
      },
    );

    const error = await failure({ email: 'user@example.com', password });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE);
    expect(recordFailedLogin).toHaveBeenCalledOnce();
  });

  it('maps audit inconsistency, query errors and unexpected crypto errors safely', async () => {
    verifyPassword.mockResolvedValueOnce({ status: 'NO_MATCH' });
    recordFailedLogin.mockRejectedValueOnce(
      new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
      ),
    );
    expect((await failure({ email: 'user@example.com', password })).code).toBe(
      AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
    );

    findUnique.mockRejectedValueOnce(new Error('database details'));
    const databaseError = await failure({
      email: 'user@example.com',
      password,
    });
    expect(databaseError.code).toBe(
      AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
    );
    expect(databaseError.message).not.toContain('database details');

    findUnique.mockResolvedValueOnce(eligibleAccount());
    verifyPassword.mockRejectedValueOnce(
      new Error('candidate and PHC details'),
    );
    const cryptoError = await failure({ email: 'user@example.com', password });
    expect(cryptoError.code).toBe(
      AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
    );
    expect(cryptoError.message).not.toContain('candidate');
    expect(recordFailedLogin).toHaveBeenCalledOnce();
  });
});
