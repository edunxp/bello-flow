import type { PrismaService } from '../prisma/prisma.service.js';
import {
  AuthSessionPersistence,
  SESSION_PERSISTENCE_ERROR_CODE,
  SessionPersistenceError,
} from './auth-session.persistence.js';
import {
  AUTH_SESSION_AUDIT_OPERATION,
  generateOperationId,
  generateSessionId,
  generateSessionToken,
} from './session-primitives.js';

type RawCall = [TemplateStringsArray, ...unknown[]];

function sqlOf(call: RawCall): string {
  return call[0].join('?').replaceAll(/\s+/g, ' ').trim();
}

function createHarness() {
  const createdAt = new Date('2026-11-02T12:00:00.000Z');
  const absoluteExpiresAt = new Date('2026-11-09T12:00:00.000Z');
  const create = vi.fn().mockResolvedValue({});
  const executeRaw = vi.fn().mockResolvedValue(1);
  const queryRaw = vi.fn(async (...call: RawCall): Promise<unknown> => {
    const sql = sqlOf(call);
    if (sql.includes('pg_advisory_xact_lock')) {
      return [{ pg_advisory_xact_lock: null }];
    }
    if (sql.includes('reconcile_auth_session_operation')) {
      return [{ status: 'NOT_FOUND' }];
    }
    if (sql.includes('credential.password_hash')) {
      return [
        {
          status: 'ACTIVE',
          emailVerifiedAt: createdAt,
          deactivatedAt: null,
          credentialMatches: true,
        },
      ];
    }
    if (sql.includes('observed_at + INTERVAL')) {
      return [{ databaseNow: createdAt, absoluteExpiresAt }];
    }
    return [];
  });
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      authSession: { create },
    }),
  );
  const rootQueryRaw = vi.fn();
  const prisma = {
    $transaction: transaction,
    $queryRaw: rootQueryRaw,
  } as unknown as PrismaService;

  return {
    service: new AuthSessionPersistence(prisma),
    transaction,
    queryRaw,
    executeRaw,
    rootQueryRaw,
    create,
    createdAt,
    absoluteExpiresAt,
  };
}

describe('AuthSessionPersistence creation', () => {
  const accountId = '00000000-0000-4000-8000-000000000001';
  const changedAt = new Date('2026-11-02T11:00:00.000Z');
  const encodedPasswordHash = '$argon2id$synthetic-test-hash';

  it('creates a session and audit event in one transaction', async () => {
    const harness = createHarness();
    const sessionId = generateSessionId();
    const operationId = generateOperationId();

    const result = await harness.service.createSession({
      accountId,
      sessionId,
      operationId,
      credential: { encodedPasswordHash, changedAt },
    });

    expect(result).toMatchObject({
      sessionId,
      operationId,
      createdAt: harness.createdAt,
      absoluteExpiresAt: harness.absoluteExpiresAt,
    });
    expect(result.token).toHaveLength(43);
    expect(harness.transaction).toHaveBeenCalledOnce();
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.create.mock.calls[0]![0].data.tokenHash).toHaveLength(32);

    const queries = harness.queryRaw.mock.calls.map((call) =>
      sqlOf(call as RawCall),
    );
    expect(
      queries.findIndex((sql) => sql.includes('pg_advisory_xact_lock')),
    ).toBeLessThan(
      queries.findIndex((sql) => sql.includes('credential.password_hash')),
    );
    expect(queries.at(-1)).toContain('clock_timestamp');

    const auditCall = harness.executeRaw.mock.calls.find((call) =>
      sqlOf(call as RawCall).includes('INSERT INTO public.audit_event'),
    ) as RawCall;
    expect(sqlOf(auditCall)).not.toContain('RETURNING');
    expect(auditCall).toContain(AUTH_SESSION_AUDIT_OPERATION.LOGIN_SUCCEEDED);
    expect(JSON.stringify(auditCall)).not.toContain(result.token);
    expect(JSON.stringify(auditCall)).not.toContain(encodedPasswordHash);
  });

  it.each([
    [
      'inactive account',
      {
        status: 'INACTIVE',
        emailVerifiedAt: changedAt,
        deactivatedAt: null,
        credentialMatches: true,
      },
      SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
    ],
    [
      'unverified account',
      {
        status: 'ACTIVE',
        emailVerifiedAt: null,
        deactivatedAt: null,
        credentialMatches: true,
      },
      SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
    ],
    [
      'deactivated account',
      {
        status: 'ACTIVE',
        emailVerifiedAt: changedAt,
        deactivatedAt: changedAt,
        credentialMatches: true,
      },
      SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
    ],
    [
      'changed credential',
      {
        status: 'ACTIVE',
        emailVerifiedAt: changedAt,
        deactivatedAt: null,
        credentialMatches: false,
      },
      SESSION_PERSISTENCE_ERROR_CODE.CREDENTIAL_CHANGED,
    ],
  ])('rejects %s after the account lock', async (_name, row, expectedCode) => {
    const harness = createHarness();
    harness.queryRaw.mockImplementation(async (...call: RawCall) => {
      const sql = sqlOf(call);
      if (sql.includes('pg_advisory_xact_lock')) {
        return [{ pg_advisory_xact_lock: null }];
      }
      if (sql.includes('reconcile_auth_session_operation')) {
        return [{ status: 'NOT_FOUND' }];
      }
      if (sql.includes('credential.password_hash')) return [row];
      return [];
    });

    await expect(
      harness.service.createSession({
        accountId,
        credential: { encodedPasswordHash, changedAt },
      }),
    ).rejects.toMatchObject({ code: expectedCode });
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('rejects invalid inputs before opening a transaction', async () => {
    const harness = createHarness();
    const expectedError = {
      code: SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
    };

    await expect(
      harness.service.createSession({
        accountId: 'not-a-uuid',
        credential: { encodedPasswordHash, changedAt },
      }),
    ).rejects.toMatchObject(expectedError);
    await expect(
      harness.service.createSession({
        accountId,
        credential: { encodedPasswordHash: '', changedAt },
      }),
    ).rejects.toMatchObject(expectedError);
    await expect(
      harness.service.createSession({
        accountId,
        credential: {
          encodedPasswordHash,
          changedAt: new Date(Number.NaN),
        },
      }),
    ).rejects.toMatchObject(expectedError);
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it('classifies an unexpected transaction failure conservatively without retry', async () => {
    const harness = createHarness();
    harness.transaction.mockRejectedValue(new Error('connection lost'));

    let thrown: unknown;
    try {
      await harness.service.createSession({
        accountId,
        credential: { encodedPasswordHash, changedAt },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SessionPersistenceError);
    expect(thrown).toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      message: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
    });
    expect(harness.transaction).toHaveBeenCalledOnce();
    expect(JSON.stringify(thrown)).not.toContain(encodedPasswordHash);
  });
});

describe('AuthSessionPersistence failed login auditing', () => {
  const accountId = '00000000-0000-4000-8000-000000000001';

  function configureHarness(existing = false) {
    const harness = createHarness();
    let reconciliationCount = 0;
    harness.queryRaw.mockImplementation(async (...call: RawCall) => {
      const sql = sqlOf(call);
      if (sql.includes('pg_advisory_xact_lock')) {
        return [{ pg_advisory_xact_lock: null }];
      }
      if (sql.includes('observed_at + INTERVAL')) {
        return [
          {
            databaseNow: harness.createdAt,
            absoluteExpiresAt: harness.absoluteExpiresAt,
          },
        ];
      }
      if (sql.includes('reconcile_auth_session_operation')) {
        reconciliationCount += 1;
        return [
          {
            status:
              existing || reconciliationCount > 1 ? 'COMPLETED' : 'NOT_FOUND',
          },
        ];
      }
      return [];
    });
    return harness;
  }

  it.each([
    ['known account', accountId],
    ['unknown identity', null],
  ])('records one denied audit event for %s', async (_name, account) => {
    const harness = configureHarness();
    const operationId = generateOperationId();

    await expect(
      harness.service.recordFailedLogin({ accountId: account, operationId }),
    ).resolves.toEqual({ operationId, alreadyCompleted: false });

    const auditCall = harness.executeRaw.mock.calls.find((call) =>
      sqlOf(call as RawCall).includes('INSERT INTO public.audit_event'),
    ) as RawCall;
    expect(sqlOf(auditCall)).not.toContain('ON CONFLICT');
    expect(auditCall).toContain(account);
    expect(auditCall).toContain(AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED);
    expect(auditCall).toContain(
      JSON.stringify({ authentication_type: 'PASSWORD' }),
    );
    expect(JSON.stringify(auditCall)).not.toContain('email@example.com');
    expect(JSON.stringify(auditCall)).not.toContain('candidate-password');
    expect(JSON.stringify(auditCall)).not.toContain('$argon2id$');
  });

  it('returns an idempotent result when the operation already exists', async () => {
    const harness = configureHarness(true);
    const operationId = generateOperationId();

    await expect(
      harness.service.recordFailedLogin({ accountId: null, operationId }),
    ).resolves.toEqual({ operationId, alreadyCompleted: true });
  });

  it('rejects incompatible operation evidence', async () => {
    const harness = createHarness();
    harness.queryRaw.mockImplementation(async (...call: RawCall) => {
      const sql = sqlOf(call);
      if (sql.includes('pg_advisory_xact_lock')) {
        return [{ pg_advisory_xact_lock: null }];
      }
      if (sql.includes('reconcile_auth_session_operation')) {
        return [{ status: 'INCONSISTENT' }];
      }
      return [];
    });

    await expect(
      harness.service.recordFailedLogin({
        accountId,
        operationId: generateOperationId(),
      }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
    });
  });

  it('classifies an unexpected transaction failure conservatively', async () => {
    const harness = createHarness();
    const operationId = generateOperationId();
    harness.transaction.mockRejectedValueOnce(new Error('commit unavailable'));

    await expect(
      harness.service.recordFailedLogin({ accountId: null, operationId }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      operationId,
    });
  });

  it('rejects an invalid known account before opening a transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.service.recordFailedLogin({ accountId: 'invalid' }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
    });
    expect(harness.transaction).not.toHaveBeenCalled();
  });
});

describe('AuthSessionPersistence resolution and reconciliation', () => {
  it('rejects malformed tokens without querying PostgreSQL', async () => {
    const harness = createHarness();
    await expect(harness.service.resolveSession('invalid-token')).resolves.toBe(
      null,
    );
    expect(harness.rootQueryRaw).not.toHaveBeenCalled();
  });

  it('resolves an eligible session without refreshing recent activity', async () => {
    const harness = createHarness();
    const token = generateSessionToken();
    const sessionId = generateSessionId();
    harness.rootQueryRaw.mockResolvedValue([
      {
        id: sessionId,
        accountId: '00000000-0000-4000-8000-000000000001',
        createdAt: harness.createdAt,
        lastActivityAt: harness.createdAt,
        absoluteExpiresAt: harness.absoluteExpiresAt,
        revokedAt: null,
        revocationReason: null,
        revokedOperationId: null,
        shouldRefreshActivity: false,
      },
    ]);

    await expect(harness.service.resolveSession(token)).resolves.toMatchObject({
      sessionId,
      lastActivityAt: harness.createdAt,
    });
    expect(harness.rootQueryRaw).toHaveBeenCalledOnce();
  });

  it('returns UNKNOWN for unavailable or unexpected reconciliation evidence', async () => {
    const harness = createHarness();
    const input = {
      accountId: '00000000-0000-4000-8000-000000000001',
      operationId: generateOperationId(),
      operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
    } as const;

    harness.rootQueryRaw.mockRejectedValueOnce(new Error('connection lost'));
    await expect(harness.service.reconcileOperation(input)).resolves.toBe(
      'UNKNOWN',
    );

    harness.rootQueryRaw.mockResolvedValueOnce([{ status: 'UNEXPECTED' }]);
    await expect(harness.service.reconcileOperation(input)).resolves.toBe(
      'UNKNOWN',
    );
    expect(harness.rootQueryRaw).toHaveBeenCalledTimes(2);
  });

  it('classifies database failures without exposing token material', async () => {
    const harness = createHarness();
    const token = generateSessionToken();
    harness.rootQueryRaw.mockRejectedValue(new Error('query failed'));

    await expect(harness.service.resolveSession(token)).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.SESSION_RESOLUTION_FAILED,
      message: SESSION_PERSISTENCE_ERROR_CODE.SESSION_RESOLUTION_FAILED,
    });
  });

  it('refreshes eligible activity and re-reads when the conditional update loses a race', async () => {
    const harness = createHarness();
    const token = generateSessionToken();
    const sessionId = generateSessionId();
    const accountId = '00000000-0000-4000-8000-000000000001';
    const stale = new Date('2026-11-02T11:50:00.000Z');
    const refreshed = new Date('2026-11-02T12:00:00.000Z');
    const row = {
      id: sessionId,
      accountId,
      createdAt: harness.createdAt,
      lastActivityAt: stale,
      absoluteExpiresAt: harness.absoluteExpiresAt,
      revokedAt: null,
      revocationReason: null,
      revokedOperationId: null,
      shouldRefreshActivity: true,
    };
    harness.rootQueryRaw
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ lastActivityAt: refreshed }]);

    await expect(harness.service.resolveSession(token)).resolves.toMatchObject({
      sessionId,
      lastActivityAt: refreshed,
    });

    row.lastActivityAt = stale;
    harness.rootQueryRaw.mockReset();
    harness.rootQueryRaw
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row, shouldRefreshActivity: false }]);
    await expect(harness.service.resolveSession(token)).resolves.toMatchObject({
      sessionId,
      lastActivityAt: stale,
    });

    row.lastActivityAt = stale;
    harness.rootQueryRaw.mockReset();
    harness.rootQueryRaw
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(harness.service.resolveSession(token)).resolves.toBeNull();
  });

  it('returns every recognized reconciliation status', async () => {
    const harness = createHarness();
    const input = {
      accountId: '00000000-0000-4000-8000-000000000001',
      operationId: generateOperationId(),
      operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
    } as const;

    for (const status of ['COMPLETED', 'NOT_FOUND', 'INCONSISTENT'] as const) {
      harness.rootQueryRaw.mockResolvedValueOnce([{ status }]);
      await expect(harness.service.reconcileOperation(input)).resolves.toBe(
        status,
      );
    }
    await expect(
      harness.service.reconcileOperation({
        ...input,
        accountId: 'invalid',
      }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
    });
  });

  it('allows a null account for failed-login reconciliation', async () => {
    const harness = createHarness();
    harness.rootQueryRaw.mockResolvedValueOnce([{ status: 'COMPLETED' }]);
    const operationId = generateOperationId();

    await expect(
      harness.service.reconcileOperation({
        accountId: null,
        operationId,
        operation: AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED,
      }),
    ).resolves.toBe('COMPLETED');
    expect(harness.rootQueryRaw.mock.calls[0]).toContain(null);
  });
});

describe('AuthSessionPersistence revocation', () => {
  const accountId = '00000000-0000-4000-8000-000000000001';
  const eligibleAccount = {
    status: 'ACTIVE',
    emailVerifiedAt: new Date('2026-11-02T10:00:00.000Z'),
    deactivatedAt: null,
  };

  function configureRevocationHarness(options?: {
    reconciliation?: string;
    session?: Record<string, unknown> | null;
    activeSessionIds?: string[];
    count?: bigint;
  }) {
    const harness = createHarness();
    const sessionId = generateSessionId();
    const session =
      options?.session === null
        ? null
        : {
            id: sessionId,
            accountId,
            createdAt: harness.createdAt,
            lastActivityAt: harness.createdAt,
            absoluteExpiresAt: harness.absoluteExpiresAt,
            revokedAt: null,
            revocationReason: null,
            revokedOperationId: null,
            ...options?.session,
          };
    harness.queryRaw.mockImplementation(
      async (...call: RawCall): Promise<unknown> => {
        const sql = sqlOf(call);
        if (sql.includes('pg_advisory_xact_lock')) return [{}];
        if (sql.includes('reconcile_auth_session_operation')) {
          return [{ status: options?.reconciliation ?? 'NOT_FOUND' }];
        }
        if (sql.includes('SELECT status')) return [eligibleAccount];
        if (sql.includes('WHERE id =') && sql.includes('FOR UPDATE')) {
          return session ? [session] : [];
        }
        if (sql.includes('WHERE account_id') && sql.includes('FOR UPDATE')) {
          return (options?.activeSessionIds ?? []).map((id) => ({ id }));
        }
        if (sql.includes('observed_at + INTERVAL')) {
          return [
            {
              databaseNow: harness.createdAt,
              absoluteExpiresAt: harness.absoluteExpiresAt,
            },
          ];
        }
        if (sql.includes('count(*) AS count')) {
          return [{ count: options?.count ?? 0n }];
        }
        return [];
      },
    );
    return { ...harness, sessionId };
  }

  it('logs out one session and builds the approved audit event', async () => {
    const harness = configureRevocationHarness();
    const operationId = generateOperationId();
    await expect(
      harness.service.logoutSession({
        accountId,
        sessionId: harness.sessionId,
        operationId,
      }),
    ).resolves.toEqual({
      operationId,
      revokedSessionCount: 1,
      alreadyCompleted: false,
    });
    const calls = harness.executeRaw.mock.calls.map((call) => call as RawCall);
    expect(
      calls.some((call) => sqlOf(call).includes('UPDATE public.auth_session')),
    ).toBe(true);
    const audit = calls.find((call) =>
      sqlOf(call).includes('INSERT INTO public.audit_event'),
    )!;
    expect(audit).toContain('AUTH_SESSION_LOGOUT');
    expect(audit).toContain('AUTH_SESSION');
    expect(audit).toContain(JSON.stringify({ reason: 'LOGOUT' }));
  });

  it('revokes an undelivered session with aggregate audit evidence', async () => {
    const harness = configureRevocationHarness();
    await harness.service.revokeUndeliveredSession({
      accountId,
      sessionId: harness.sessionId,
    });
    const audit = harness.executeRaw.mock.calls
      .map((call) => call as RawCall)
      .find((call) => sqlOf(call).includes('INSERT INTO public.audit_event'))!;
    expect(audit).toContain('AUTH_SESSIONS_REVOKED');
    expect(audit).toContain('ACCOUNT');
    expect(audit).toContain(
      JSON.stringify({ reason: 'DELIVERY_FAILED', revoked_session_count: 1 }),
    );
  });

  it.each([
    ['missing', null, SESSION_PERSISTENCE_ERROR_CODE.SESSION_NOT_FOUND],
    [
      'already revoked',
      { revokedAt: new Date() },
      SESSION_PERSISTENCE_ERROR_CODE.SESSION_ALREADY_REVOKED,
    ],
  ])('rejects a %s session', async (_name, session, code) => {
    const harness = configureRevocationHarness({ session });
    await expect(
      harness.service.logoutSession({
        accountId,
        sessionId: harness.sessionId,
      }),
    ).rejects.toMatchObject({ code });
  });

  it('returns completed revocation without duplicating writes', async () => {
    const harness = configureRevocationHarness({ reconciliation: 'COMPLETED' });
    await expect(
      harness.service.logoutSession({
        accountId,
        sessionId: harness.sessionId,
      }),
    ).resolves.toMatchObject({ alreadyCompleted: true });
    expect(harness.executeRaw).toHaveBeenCalledTimes(2);
  });

  it('revokes all locked sessions and also audits an empty set', async () => {
    const firstId = generateSessionId();
    const secondId = generateSessionId();
    const harness = configureRevocationHarness({
      activeSessionIds: [firstId, secondId],
    });
    await expect(
      harness.service.revokeAllSessions({ accountId }),
    ).resolves.toMatchObject({
      revokedSessionCount: 2,
      alreadyCompleted: false,
    });
    const audit = harness.executeRaw.mock.calls
      .map((call) => call as RawCall)
      .find((call) => sqlOf(call).includes('INSERT INTO public.audit_event'))!;
    expect(audit).toContain(
      JSON.stringify({ reason: 'GLOBAL_LOGOUT', revoked_session_count: 2 }),
    );

    const empty = configureRevocationHarness();
    await expect(
      empty.service.revokeAllSessions({ accountId }),
    ).resolves.toMatchObject({ revokedSessionCount: 0 });
    expect(
      empty.executeRaw.mock.calls.some((call) =>
        sqlOf(call as RawCall).includes('UPDATE public.auth_session'),
      ),
    ).toBe(false);
  });

  it('reconciles a repeated global revocation and preserves its count', async () => {
    const harness = configureRevocationHarness({
      reconciliation: 'COMPLETED',
      count: 3n,
    });
    await expect(
      harness.service.revokeAllSessions({ accountId }),
    ).resolves.toMatchObject({
      revokedSessionCount: 3,
      alreadyCompleted: true,
    });
  });

  it.each(['logout', 'global'] as const)(
    'rejects inconsistent %s evidence',
    async (kind) => {
      const harness = configureRevocationHarness({
        reconciliation: 'INCONSISTENT',
      });
      const action =
        kind === 'logout'
          ? harness.service.logoutSession({
              accountId,
              sessionId: harness.sessionId,
            })
          : harness.service.revokeAllSessions({ accountId });
      await expect(action).rejects.toMatchObject({
        code: SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
      });
    },
  );

  it.each(['logout', 'global'] as const)(
    'does not retry an indeterminate %s operation',
    async (kind) => {
      const harness = configureRevocationHarness();
      harness.transaction.mockRejectedValue(new Error('connection lost'));
      const action =
        kind === 'logout'
          ? harness.service.logoutSession({
              accountId,
              sessionId: harness.sessionId,
            })
          : harness.service.revokeAllSessions({ accountId });
      await expect(action).rejects.toMatchObject({
        code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      });
      expect(harness.transaction).toHaveBeenCalledOnce();
    },
  );
});
