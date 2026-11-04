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
import { DEFAULT_LOGIN_ADMISSION_CONFIG } from './login-admission.config.js';
import {
  LoginAdmissionService,
  SYSTEM_LOGIN_ADMISSION_TIME,
} from './login-admission.service.js';
import {
  AUTH_SESSION_AUDIT_OPERATION,
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
  const authenticationContext = { trustedIp: '192.0.2.10' } as const;
  const findUnique = vi.fn();
  const verifyPassword = vi.fn();
  const performNegativeVerification = vi.fn();
  const createSession = vi.fn();
  const recordFailedLogin = vi.fn();
  const resolveSession = vi.fn();
  const logoutSession = vi.fn();
  const revokeAllSessions = vi.fn();
  const revokeUndeliveredSession = vi.fn();
  const reconcileOperation = vi.fn();
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
      await authenticate(input);
      throw new Error('Expected authentication to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthenticationError);
      return error as AuthenticationError;
    }
  }

  function authenticate(input: AuthenticateWithPasswordInput) {
    return service.authenticateWithPassword(input, authenticationContext);
  }

  async function serviceFailure(
    operation: () => Promise<unknown>,
  ): Promise<AuthenticationError> {
    try {
      await operation();
      throw new Error('Expected session operation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthenticationError);
      return error as AuthenticationError;
    }
  }

  function resolvedSession() {
    return {
      sessionId: generateSessionId(),
      accountId,
      createdAt,
      lastActivityAt: createdAt,
      absoluteExpiresAt,
    };
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
    resolveSession.mockResolvedValue(null);
    logoutSession.mockResolvedValue({
      operationId: generateOperationId(),
      revokedSessionCount: 1,
      alreadyCompleted: false,
    });
    revokeAllSessions.mockResolvedValue({
      operationId: generateOperationId(),
      revokedSessionCount: 1,
      alreadyCompleted: false,
    });
    revokeUndeliveredSession.mockResolvedValue({
      operationId: generateOperationId(),
      revokedSessionCount: 1,
      alreadyCompleted: false,
    });
    reconcileOperation.mockResolvedValue('COMPLETED');
    service = new AuthenticationService(
      { account: { findUnique } } as unknown as PrismaService,
      {
        verifyPassword,
        performNegativeVerification,
      } as unknown as PasswordCredentialService,
      {
        createSession,
        recordFailedLogin,
        resolveSession,
        logoutSession,
        revokeAllSessions,
        revokeUndeliveredSession,
        reconcileOperation,
      } as unknown as AuthSessionPersistence,
      new LoginAdmissionService(
        DEFAULT_LOGIN_ADMISSION_CONFIG,
        SYSTEM_LOGIN_ADMISSION_TIME,
      ),
    );
  });

  it('normalizes the identity and returns the committed session contract', async () => {
    const result = await authenticate({
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

  it('fails safely without a runtime context before authentication work', async () => {
    const runtimeConsumer = service as unknown as {
      authenticateWithPassword(
        input: AuthenticateWithPasswordInput,
      ): Promise<unknown>;
    };

    await expect(
      runtimeConsumer.authenticateWithPassword({
        email: 'user@example.com',
        password,
      }),
    ).rejects.toMatchObject({
      code: AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
    } satisfies Partial<AuthenticationError>);
    expect(findUnique).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(performNegativeVerification).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
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

  it('blocks before database, Argon2id, and audit after consuming identity budget', async () => {
    verifyPassword.mockResolvedValue({ status: 'NO_MATCH' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const error = await failure({ email: 'limited@example.com', password });
      expect(error.code).toBe(
        AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
      );
    }

    await expect(
      authenticate({ email: 'limited@example.com', password }),
    ).rejects.toMatchObject({
      code: AUTHENTICATION_ERROR_CODE.RATE_LIMITED,
      retryAfterSeconds: 180,
    } satisfies Partial<AuthenticationError>);
    expect(findUnique).toHaveBeenCalledTimes(5);
    expect(verifyPassword).toHaveBeenCalledTimes(5);
    expect(recordFailedLogin).toHaveBeenCalledTimes(5);
    expect(createSession).not.toHaveBeenCalled();
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

  describe('public session use cases', () => {
    it('resolves only the authenticated account identity', async () => {
      const token = generateSessionToken();
      resolveSession.mockResolvedValue(resolvedSession());

      await expect(service.resolveAuthenticatedSession(token)).resolves.toEqual(
        {
          accountId,
        },
      );
      expect(resolveSession).toHaveBeenCalledWith(token);
    });

    it.each([
      ['absent', undefined],
      ['invalid', 'invalid-token'],
      ['expired', generateSessionToken()],
      ['revoked', generateSessionToken()],
    ])('maps an %s session to null', async (_state, token) => {
      resolveSession.mockResolvedValue(null);

      await expect(
        service.resolveAuthenticatedSession(token),
      ).resolves.toBeNull();
      expect(resolveSession).toHaveBeenCalledWith(token);
    });

    it.each([
      SESSION_PERSISTENCE_ERROR_CODE.SESSION_RESOLUTION_FAILED,
      SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
    ])(
      'maps resolution failure %s without exposing the token',
      async (code) => {
        const token = generateSessionToken();
        resolveSession.mockRejectedValue(new SessionPersistenceError(code));

        const error = await serviceFailure(() =>
          service.resolveAuthenticatedSession(token),
        );

        expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
        expect(error.message).not.toContain(token);
        expect(resolveSession).toHaveBeenCalledOnce();
      },
    );

    it('logs out the current session once and returns only completion', async () => {
      const token = generateSessionToken();
      const session = resolvedSession();
      resolveSession.mockResolvedValue(session);

      const result = await service.logoutCurrentSession(token);

      expect(result).toEqual({ status: 'COMPLETED' });
      expect(logoutSession).toHaveBeenCalledOnce();
      expect(logoutSession).toHaveBeenCalledWith({
        accountId,
        sessionId: session.sessionId,
        operationId: expect.any(String),
      });
      expect(reconcileOperation).not.toHaveBeenCalled();
      expect(resolveSession.mock.invocationCallOrder[0]).toBeLessThan(
        logoutSession.mock.invocationCallOrder[0]!,
      );
    });

    it('treats an absent current session idempotently without mutation', async () => {
      const token = generateSessionToken();
      resolveSession.mockResolvedValue(null);

      await expect(service.logoutCurrentSession(token)).resolves.toEqual({
        status: 'NO_ACTIVE_SESSION',
      });
      expect(logoutSession).not.toHaveBeenCalled();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it.each([
      SESSION_PERSISTENCE_ERROR_CODE.SESSION_NOT_FOUND,
      SESSION_PERSISTENCE_ERROR_CODE.SESSION_ALREADY_REVOKED,
    ])('treats a current-session race %s idempotently', async (code) => {
      resolveSession.mockResolvedValue(resolvedSession());
      logoutSession.mockRejectedValue(new SessionPersistenceError(code));

      await expect(
        service.logoutCurrentSession(generateSessionToken()),
      ).resolves.toEqual({ status: 'NO_ACTIVE_SESSION' });
      expect(logoutSession).toHaveBeenCalledOnce();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it('maps a determined current logout failure without retrying', async () => {
      resolveSession.mockResolvedValue(resolvedSession());
      logoutSession.mockRejectedValue(new Error('database detail'));

      const error = await serviceFailure(() =>
        service.logoutCurrentSession(generateSessionToken()),
      );

      expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
      expect(error.message).not.toContain('database detail');
      expect(logoutSession).toHaveBeenCalledOnce();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it.each([
      ['COMPLETED', null],
      ['NOT_FOUND', AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE],
      ['INCONSISTENT', AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE],
      ['UNKNOWN', AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE],
    ] as const)(
      'reconciles an indeterminate current logout as %s',
      async (status, expectedErrorCode) => {
        const session = resolvedSession();
        resolveSession.mockResolvedValue(session);
        logoutSession.mockImplementation(
          async (input: {
            operationId: ReturnType<typeof generateOperationId>;
          }) => {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
              input.operationId,
              session.sessionId,
            );
          },
        );
        reconcileOperation.mockResolvedValue(status);

        const operation = () =>
          service.logoutCurrentSession(generateSessionToken());
        if (expectedErrorCode === null) {
          await expect(operation()).resolves.toEqual({ status: 'COMPLETED' });
        } else {
          const error = await serviceFailure(operation);
          expect(error.code).toBe(expectedErrorCode);
        }

        const mutationInput = logoutSession.mock.calls[0]![0];
        expect(logoutSession).toHaveBeenCalledOnce();
        expect(reconcileOperation).toHaveBeenCalledWith({
          accountId,
          sessionId: session.sessionId,
          operationId: mutationInput.operationId,
          operation: AUTH_SESSION_AUDIT_OPERATION.SESSION_LOGOUT,
        });
        expect(reconcileOperation).toHaveBeenCalledOnce();
        expect(logoutSession.mock.invocationCallOrder[0]).toBeLessThan(
          reconcileOperation.mock.invocationCallOrder[0]!,
        );
      },
    );

    it('logs out all sessions once without exposing persistence details', async () => {
      const session = resolvedSession();
      resolveSession.mockResolvedValue(session);
      revokeAllSessions.mockResolvedValue({
        operationId: generateOperationId(),
        revokedSessionCount: 42,
        alreadyCompleted: false,
      });

      const result = await service.logoutAllSessions(generateSessionToken());

      expect(result).toEqual({ status: 'COMPLETED' });
      expect(revokeAllSessions).toHaveBeenCalledWith({
        accountId,
        operationId: expect.any(String),
      });
      expect(revokeAllSessions).toHaveBeenCalledOnce();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it('rejects global logout without an authenticated session', async () => {
      resolveSession.mockResolvedValue(null);

      await expect(
        service.logoutAllSessions(generateSessionToken()),
      ).resolves.toEqual({ status: 'UNAUTHENTICATED' });
      expect(revokeAllSessions).not.toHaveBeenCalled();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it('maps a determined global logout failure without retrying', async () => {
      resolveSession.mockResolvedValue(resolvedSession());
      revokeAllSessions.mockRejectedValue(
        new SessionPersistenceError(
          SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
        ),
      );

      const error = await serviceFailure(() =>
        service.logoutAllSessions(generateSessionToken()),
      );

      expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
      expect(revokeAllSessions).toHaveBeenCalledOnce();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it.each([
      ['COMPLETED', null],
      ['NOT_FOUND', AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE],
      ['INCONSISTENT', AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE],
      ['UNKNOWN', AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE],
    ] as const)(
      'reconciles an indeterminate global logout as %s',
      async (status, expectedErrorCode) => {
        resolveSession.mockResolvedValue(resolvedSession());
        revokeAllSessions.mockImplementation(
          async (input: {
            operationId: ReturnType<typeof generateOperationId>;
          }) => {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
              input.operationId,
            );
          },
        );
        reconcileOperation.mockResolvedValue(status);

        const operation = () =>
          service.logoutAllSessions(generateSessionToken());
        if (expectedErrorCode === null) {
          await expect(operation()).resolves.toEqual({ status: 'COMPLETED' });
        } else {
          const error = await serviceFailure(operation);
          expect(error.code).toBe(expectedErrorCode);
        }

        const mutationInput = revokeAllSessions.mock.calls[0]![0];
        expect(revokeAllSessions).toHaveBeenCalledOnce();
        expect(reconcileOperation).toHaveBeenCalledWith({
          accountId,
          operationId: mutationInput.operationId,
          operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
        });
        expect(reconcileOperation).toHaveBeenCalledOnce();
      },
    );

    it('revokes an undelivered session once and returns no value', async () => {
      const sessionId = generateSessionId();

      const result = await service.revokeUndeliveredSession({
        accountId,
        sessionId,
      });

      expect(result).toBeUndefined();
      expect(revokeUndeliveredSession).toHaveBeenCalledWith({
        accountId,
        sessionId,
        operationId: expect.any(String),
      });
      expect(revokeUndeliveredSession).toHaveBeenCalledOnce();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it.each([
      SESSION_PERSISTENCE_ERROR_CODE.SESSION_NOT_FOUND,
      SESSION_PERSISTENCE_ERROR_CODE.SESSION_ALREADY_REVOKED,
    ])('treats an undelivered session %s idempotently', async (code) => {
      revokeUndeliveredSession.mockRejectedValue(
        new SessionPersistenceError(code),
      );

      await expect(
        service.revokeUndeliveredSession({
          accountId,
          sessionId: generateSessionId(),
        }),
      ).resolves.toBeUndefined();
      expect(revokeUndeliveredSession).toHaveBeenCalledOnce();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it('maps a determined compensation failure without retrying', async () => {
      revokeUndeliveredSession.mockRejectedValue(
        new SessionPersistenceError(
          SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
        ),
      );

      const error = await serviceFailure(() =>
        service.revokeUndeliveredSession({
          accountId,
          sessionId: generateSessionId(),
        }),
      );

      expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
      expect(revokeUndeliveredSession).toHaveBeenCalledOnce();
      expect(reconcileOperation).not.toHaveBeenCalled();
    });

    it.each([
      ['COMPLETED', null],
      ['NOT_FOUND', AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE],
      ['INCONSISTENT', AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE],
      ['UNKNOWN', AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE],
    ] as const)(
      'reconciles an indeterminate compensation as %s',
      async (status, expectedErrorCode) => {
        const sessionId = generateSessionId();
        revokeUndeliveredSession.mockImplementation(
          async (input: {
            operationId: ReturnType<typeof generateOperationId>;
          }) => {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
              input.operationId,
              sessionId,
            );
          },
        );
        reconcileOperation.mockResolvedValue(status);

        const operation = () =>
          service.revokeUndeliveredSession({ accountId, sessionId });
        if (expectedErrorCode === null) {
          await expect(operation()).resolves.toBeUndefined();
        } else {
          const error = await serviceFailure(operation);
          expect(error.code).toBe(expectedErrorCode);
        }

        const mutationInput = revokeUndeliveredSession.mock.calls[0]![0];
        expect(revokeUndeliveredSession).toHaveBeenCalledOnce();
        expect(reconcileOperation).toHaveBeenCalledWith({
          accountId,
          sessionId,
          operationId: mutationInput.operationId,
          operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
        });
        expect(reconcileOperation).toHaveBeenCalledOnce();
      },
    );

    it('maps a reconciliation exception without repeating compensation', async () => {
      const sessionId = generateSessionId();
      revokeUndeliveredSession.mockImplementation(
        async (input: {
          operationId: ReturnType<typeof generateOperationId>;
        }) => {
          throw new SessionPersistenceError(
            SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
            input.operationId,
            sessionId,
          );
        },
      );
      reconcileOperation.mockRejectedValue(new Error('reconciliation detail'));

      const error = await serviceFailure(() =>
        service.revokeUndeliveredSession({ accountId, sessionId }),
      );

      expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
      expect(error.message).not.toContain('reconciliation detail');
      expect(revokeUndeliveredSession).toHaveBeenCalledOnce();
      expect(reconcileOperation).toHaveBeenCalledOnce();
    });
  });
});
