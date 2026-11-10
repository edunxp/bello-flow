import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AUTH_SESSION_AUDIT_OPERATION,
  deriveOperationAdvisoryLockKey,
  generateOperationId,
  generateSessionId,
  generateSessionToken,
  hashSessionToken,
  type AuthSessionAuditOperation,
  type OperationId,
  type SessionId,
  type SessionToken,
  type SessionTokenHash,
  SESSION_REVOCATION_REASON,
  type SessionRevocationReason,
} from './session-primitives.js';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SESSION_PERSISTENCE_ERROR_CODE = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  ACCOUNT_NOT_ELIGIBLE: 'ACCOUNT_NOT_ELIGIBLE',
  CREDENTIAL_CHANGED: 'CREDENTIAL_CHANGED',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_ALREADY_REVOKED: 'SESSION_ALREADY_REVOKED',
  SESSION_RESOLUTION_FAILED: 'SESSION_RESOLUTION_FAILED',
  OPERATION_ALREADY_COMPLETED: 'OPERATION_ALREADY_COMPLETED',
  RECONCILIATION_INCONSISTENT: 'RECONCILIATION_INCONSISTENT',
  OPERATION_INDETERMINATE: 'OPERATION_INDETERMINATE',
} as const);

export type SessionPersistenceErrorCode =
  (typeof SESSION_PERSISTENCE_ERROR_CODE)[keyof typeof SESSION_PERSISTENCE_ERROR_CODE];

export class SessionPersistenceError extends Error {
  constructor(
    public readonly code: SessionPersistenceErrorCode,
    public readonly operationId?: OperationId,
    public readonly sessionId?: SessionId,
  ) {
    super(code);
    this.name = 'SessionPersistenceError';
  }
}

export interface AuthenticatedCredentialPrecondition {
  readonly encodedPasswordHash: string;
  readonly changedAt: Date;
}

export interface CreateAuthSessionInput {
  readonly accountId: string;
  readonly credential: AuthenticatedCredentialPrecondition;
  readonly sessionId?: SessionId;
  readonly operationId?: OperationId;
}

export interface CreatedAuthSession {
  readonly sessionId: SessionId;
  readonly operationId: OperationId;
  readonly token: SessionToken;
  readonly createdAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface RecordFailedLoginInput {
  readonly accountId: string | null;
  readonly operationId?: OperationId;
}

export interface RecordedFailedLogin {
  readonly operationId: OperationId;
  readonly alreadyCompleted: boolean;
}

export interface ResolvedAuthSession {
  readonly sessionId: SessionId;
  readonly accountId: string;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface RevokeAuthSessionInput {
  readonly accountId: string;
  readonly sessionId: SessionId;
  readonly operationId?: OperationId;
}

export interface RevokeAllAuthSessionsInput {
  readonly accountId: string;
  readonly operationId?: OperationId;
}

export interface SessionRevocationResult {
  readonly operationId: OperationId;
  readonly revokedSessionCount: number;
  readonly alreadyCompleted: boolean;
}

export type ReconciliationStatus =
  'COMPLETED' | 'NOT_FOUND' | 'INCONSISTENT' | 'UNKNOWN';

export type ReconcileAuthSessionOperationInput =
  | {
      readonly accountId: string | null;
      readonly operationId: OperationId;
      readonly operation: typeof AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED;
      readonly sessionId?: never;
    }
  | {
      readonly accountId: string;
      readonly operationId: OperationId;
      readonly operation: Exclude<
        AuthSessionAuditOperation,
        typeof AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED
      >;
      readonly sessionId?: SessionId;
    };

type DatabaseClock = {
  databaseNow: Date;
  absoluteExpiresAt: Date;
};

type AccountPrecondition = {
  status: string;
  emailVerifiedAt: Date | null;
  deactivatedAt: Date | null;
  credentialMatches: boolean;
};

type SessionRow = {
  id: string;
  accountId: string;
  createdAt: Date;
  lastActivityAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
  revokedOperationId: string | null;
  shouldRefreshActivity?: boolean;
};

type ReconciliationRow = { status: string };
type CountRow = { count: bigint };

function assertUuidV4(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new SessionPersistenceError(
      SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
    );
  }
}

function assertCredentialPrecondition(
  value: AuthenticatedCredentialPrecondition,
): void {
  if (
    typeof value?.encodedPasswordHash !== 'string' ||
    value.encodedPasswordHash.length === 0 ||
    !(value.changedAt instanceof Date) ||
    !Number.isFinite(value.changedAt.getTime())
  ) {
    throw new SessionPersistenceError(
      SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
    );
  }
}

function isKnownPersistenceError(
  error: unknown,
): error is SessionPersistenceError {
  return error instanceof SessionPersistenceError;
}

@Injectable()
export class AuthSessionPersistence {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    input: CreateAuthSessionInput,
  ): Promise<CreatedAuthSession> {
    assertUuidV4(input.accountId);
    assertCredentialPrecondition(input.credential);

    const sessionId = input.sessionId ?? generateSessionId();
    const operationId = input.operationId ?? generateOperationId();
    assertUuidV4(sessionId);
    assertUuidV4(operationId);

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    try {
      const committed = await this.prisma.$transaction(
        async (tx) => {
          await this.configureTransaction(tx);
          await this.acquireAccountAdvisoryLock(tx, input.accountId);

          const existing = await this.reconcileWithinTransaction(tx, {
            accountId: input.accountId,
            operationId,
            operation: AUTH_SESSION_AUDIT_OPERATION.LOGIN_SUCCEEDED,
            sessionId,
          });
          if (existing === 'COMPLETED') {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.OPERATION_ALREADY_COMPLETED,
              operationId,
              sessionId,
            );
          }
          if (existing === 'INCONSISTENT') {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
              operationId,
              sessionId,
            );
          }

          const account = await this.readAccountPrecondition(
            tx,
            input.accountId,
            input.credential,
          );
          if (
            !account ||
            account.status !== 'ACTIVE' ||
            account.emailVerifiedAt === null ||
            account.deactivatedAt !== null
          ) {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
              operationId,
              sessionId,
            );
          }
          if (!account.credentialMatches) {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.CREDENTIAL_CHANGED,
              operationId,
              sessionId,
            );
          }

          const clock = await this.readDatabaseClock(tx);
          await tx.authSession.create({
            data: {
              id: sessionId,
              accountId: input.accountId,
              tokenHash: Uint8Array.from(tokenHash),
              createdAt: clock.databaseNow,
              lastActivityAt: clock.databaseNow,
              absoluteExpiresAt: clock.absoluteExpiresAt,
              createdOperationId: operationId,
            },
          });
          await this.insertAuditEvent(tx, {
            occurredAt: clock.databaseNow,
            actorAccountId: input.accountId,
            operation: AUTH_SESSION_AUDIT_OPERATION.LOGIN_SUCCEEDED,
            entityType: 'AUTH_SESSION',
            entityId: sessionId,
            context: { authentication_type: 'PASSWORD' },
            operationId,
          });

          return clock;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );

      return {
        sessionId,
        operationId,
        token,
        createdAt: committed.databaseNow,
        absoluteExpiresAt: committed.absoluteExpiresAt,
      };
    } catch (error) {
      if (isKnownPersistenceError(error)) {
        throw error;
      }
      throw new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        operationId,
        sessionId,
      );
    }
  }

  async resolveSession(
    token: unknown,
    refreshActivity = true,
  ): Promise<ResolvedAuthSession | null> {
    let tokenHash: SessionTokenHash;
    try {
      tokenHash = hashSessionToken(token);
    } catch {
      return null;
    }

    try {
      const rows = await this.readEligibleSession(tokenHash);
      const session = rows[0];
      if (!session) {
        return null;
      }

      if (refreshActivity && session.shouldRefreshActivity === true) {
        const updated = await this.updateActivity(session.id, tokenHash);
        if (updated === null) {
          const current = (await this.readEligibleSession(tokenHash))[0];
          return current ? this.toResolvedSession(current) : null;
        }
        session.lastActivityAt = updated;
      }

      return this.toResolvedSession(session);
    } catch {
      throw new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.SESSION_RESOLUTION_FAILED,
      );
    }
  }

  async recordFailedLogin(
    input: RecordFailedLoginInput,
  ): Promise<RecordedFailedLogin> {
    if (input.accountId !== null) {
      assertUuidV4(input.accountId);
    }
    const operationId = input.operationId ?? generateOperationId();
    assertUuidV4(operationId);
    const lockKey = deriveOperationAdvisoryLockKey(operationId);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.configureTransaction(tx);
          await this.acquireAdvisoryLock(tx, lockKey);
          const existing = await this.reconcileWithinTransaction(tx, {
            accountId: input.accountId,
            operationId,
            operation: AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED,
          });
          if (existing === 'COMPLETED') {
            return { operationId, alreadyCompleted: true };
          }
          if (existing === 'INCONSISTENT') {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
              operationId,
            );
          }

          const clock = await this.readDatabaseClock(tx);
          await this.insertFailedLoginAuditEvent(tx, {
            occurredAt: clock.databaseNow,
            accountId: input.accountId,
            operationId,
          });
          const reconciliation = await this.reconcileWithinTransaction(tx, {
            accountId: input.accountId,
            operationId,
            operation: AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED,
          });
          if (reconciliation === 'COMPLETED') {
            return { operationId, alreadyCompleted: false };
          }
          if (reconciliation === 'INCONSISTENT') {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
              operationId,
            );
          }
          throw new Error('Failed login audit was not reconciled');
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (isKnownPersistenceError(error)) {
        throw error;
      }
      throw new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        operationId,
      );
    }
  }

  async logoutSession(
    input: RevokeAuthSessionInput,
  ): Promise<SessionRevocationResult> {
    return this.revokeSingleSession(
      input,
      SESSION_REVOCATION_REASON.LOGOUT,
      AUTH_SESSION_AUDIT_OPERATION.SESSION_LOGOUT,
    );
  }

  async revokeUndeliveredSession(
    input: RevokeAuthSessionInput,
  ): Promise<SessionRevocationResult> {
    return this.revokeSingleSession(
      input,
      SESSION_REVOCATION_REASON.DELIVERY_FAILED,
      AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
    );
  }

  async revokeAllSessions(
    input: RevokeAllAuthSessionsInput,
  ): Promise<SessionRevocationResult> {
    assertUuidV4(input.accountId);
    const operationId = input.operationId ?? generateOperationId();
    assertUuidV4(operationId);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.configureTransaction(tx);
          await this.acquireAccountAdvisoryLock(tx, input.accountId);

          const reconciliation = await this.reconcileWithinTransaction(tx, {
            accountId: input.accountId,
            operationId,
            operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
          });
          if (reconciliation === 'COMPLETED') {
            return {
              operationId,
              revokedSessionCount: await this.countRevokedByOperation(
                tx,
                operationId,
              ),
              alreadyCompleted: true,
            };
          }
          if (reconciliation === 'INCONSISTENT') {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
              operationId,
            );
          }

          await this.assertEligibleAccount(tx, input.accountId, operationId);
          const sessions = await this.lockActiveSessions(tx, input.accountId);
          const clock = await this.readDatabaseClock(tx);
          const sessionIds = sessions.map((session) => session.id);

          if (sessionIds.length > 0) {
            await tx.$executeRaw`
              UPDATE public.auth_session
              SET revoked_at = ${clock.databaseNow},
                  revocation_reason = ${SESSION_REVOCATION_REASON.GLOBAL_LOGOUT},
                  revoked_operation_id = ${operationId}::uuid
              WHERE account_id = ${input.accountId}::uuid
                AND revoked_at IS NULL
                AND id = ANY(${sessionIds}::uuid[])
            `;
          }

          await this.insertAuditEvent(tx, {
            occurredAt: clock.databaseNow,
            actorAccountId: input.accountId,
            operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
            entityType: 'ACCOUNT',
            entityId: input.accountId,
            context: {
              reason: SESSION_REVOCATION_REASON.GLOBAL_LOGOUT,
              revoked_session_count: sessionIds.length,
            },
            operationId,
          });

          return {
            operationId,
            revokedSessionCount: sessionIds.length,
            alreadyCompleted: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (isKnownPersistenceError(error)) {
        throw error;
      }
      throw new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        operationId,
      );
    }
  }

  async reconcileOperation(
    input: ReconcileAuthSessionOperationInput,
  ): Promise<ReconciliationStatus> {
    if (input.accountId === null) {
      if (input.operation !== AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED) {
        throw new SessionPersistenceError(
          SESSION_PERSISTENCE_ERROR_CODE.INVALID_INPUT,
        );
      }
    } else {
      assertUuidV4(input.accountId);
    }
    assertUuidV4(input.operationId);
    if (input.sessionId !== undefined) {
      assertUuidV4(input.sessionId);
    }
    try {
      const rows = await this.prisma.$queryRaw<ReconciliationRow[]>`
        SELECT public.reconcile_auth_session_operation(
          ${input.operationId}::uuid,
          ${input.accountId}::uuid,
          ${input.operation},
          ${input.sessionId ?? null}::uuid
        ) AS status
      `;
      return this.parseReconciliationStatus(rows[0]?.status);
    } catch {
      return 'UNKNOWN';
    }
  }

  private async revokeSingleSession(
    input: RevokeAuthSessionInput,
    reason: Extract<SessionRevocationReason, 'LOGOUT' | 'DELIVERY_FAILED'>,
    operation: Extract<
      AuthSessionAuditOperation,
      'AUTH_SESSION_LOGOUT' | 'AUTH_SESSIONS_REVOKED'
    >,
  ): Promise<SessionRevocationResult> {
    assertUuidV4(input.accountId);
    assertUuidV4(input.sessionId);
    const operationId = input.operationId ?? generateOperationId();
    assertUuidV4(operationId);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.configureTransaction(tx);
          await this.acquireAccountAdvisoryLock(tx, input.accountId);

          const reconciliation = await this.reconcileWithinTransaction(tx, {
            accountId: input.accountId,
            operationId,
            operation,
            sessionId: input.sessionId,
          });
          if (reconciliation === 'COMPLETED') {
            return {
              operationId,
              revokedSessionCount: 1,
              alreadyCompleted: true,
            };
          }
          if (reconciliation === 'INCONSISTENT') {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
              operationId,
            );
          }

          await this.assertEligibleAccount(tx, input.accountId, operationId);
          const session = await this.lockSession(
            tx,
            input.accountId,
            input.sessionId,
          );
          if (!session) {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.SESSION_NOT_FOUND,
              operationId,
            );
          }
          if (session.revokedAt !== null) {
            throw new SessionPersistenceError(
              SESSION_PERSISTENCE_ERROR_CODE.SESSION_ALREADY_REVOKED,
              operationId,
            );
          }

          const clock = await this.readDatabaseClock(tx);
          await tx.$executeRaw`
            UPDATE public.auth_session
            SET revoked_at = ${clock.databaseNow},
                revocation_reason = ${reason},
                revoked_operation_id = ${operationId}::uuid
            WHERE id = ${input.sessionId}::uuid
              AND account_id = ${input.accountId}::uuid
              AND revoked_at IS NULL
          `;

          await this.insertAuditEvent(tx, {
            occurredAt: clock.databaseNow,
            actorAccountId: input.accountId,
            operation,
            entityType:
              operation === AUTH_SESSION_AUDIT_OPERATION.SESSION_LOGOUT
                ? 'AUTH_SESSION'
                : 'ACCOUNT',
            entityId:
              operation === AUTH_SESSION_AUDIT_OPERATION.SESSION_LOGOUT
                ? input.sessionId
                : input.accountId,
            context:
              operation === AUTH_SESSION_AUDIT_OPERATION.SESSION_LOGOUT
                ? { reason }
                : { reason, revoked_session_count: 1 },
            operationId,
          });

          return {
            operationId,
            revokedSessionCount: 1,
            alreadyCompleted: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (isKnownPersistenceError(error)) {
        throw error;
      }
      throw new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        operationId,
      );
    }
  }

  private async configureTransaction(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
  }

  private async acquireAdvisoryLock(
    tx: Prisma.TransactionClient,
    lockKey: bigint,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT pg_catalog.pg_advisory_xact_lock(${lockKey}::bigint)::text
        AS "lockAcquired"
    `;
  }

  private async acquireAccountAdvisoryLock(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT public.acquire_auth_account_advisory_xact_lock(
        ${accountId}::uuid
      )::text AS "lockAcquired"
    `;
  }

  private async readAccountPrecondition(
    tx: Prisma.TransactionClient,
    accountId: string,
    credential: AuthenticatedCredentialPrecondition,
  ): Promise<AccountPrecondition | undefined> {
    const rows = await tx.$queryRaw<AccountPrecondition[]>`
      SELECT
        account.status,
        account.email_verified_at AS "emailVerifiedAt",
        account.deactivated_at AS "deactivatedAt",
        (
          credential.password_hash = ${credential.encodedPasswordHash}
          AND pg_catalog.date_trunc(
            'milliseconds', credential.changed_at
          ) = ${credential.changedAt}
        ) AS "credentialMatches"
      FROM public.account AS account
      JOIN public.password_credential AS credential
        ON credential.account_id = account.id
      WHERE account.id = ${accountId}::uuid
    `;
    return rows[0];
  }

  private async assertEligibleAccount(
    tx: Prisma.TransactionClient,
    accountId: string,
    operationId: OperationId,
  ): Promise<void> {
    const rows = await tx.$queryRaw<
      Pick<
        AccountPrecondition,
        'status' | 'emailVerifiedAt' | 'deactivatedAt'
      >[]
    >`
      SELECT
        status,
        email_verified_at AS "emailVerifiedAt",
        deactivated_at AS "deactivatedAt"
      FROM public.account
      WHERE id = ${accountId}::uuid
    `;
    const account = rows[0];
    if (
      !account ||
      account.status !== 'ACTIVE' ||
      account.emailVerifiedAt === null ||
      account.deactivatedAt !== null
    ) {
      throw new SessionPersistenceError(
        SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
        operationId,
      );
    }
  }

  private async readDatabaseClock(
    tx: Prisma.TransactionClient,
  ): Promise<DatabaseClock> {
    const rows = await tx.$queryRaw<DatabaseClock[]>`
      SELECT
        observed_at AS "databaseNow",
        observed_at + INTERVAL '168 hours' AS "absoluteExpiresAt"
      FROM (
        SELECT pg_catalog.clock_timestamp()::timestamptz(6) AS observed_at
      ) AS clock
    `;
    const clock = rows[0];
    if (!clock) {
      throw new Error('Database clock unavailable');
    }
    return clock;
  }

  private async lockSession(
    tx: Prisma.TransactionClient,
    accountId: string,
    sessionId: SessionId,
  ): Promise<SessionRow | undefined> {
    const rows = await tx.$queryRaw<SessionRow[]>`
      SELECT
        id,
        account_id AS "accountId",
        created_at AS "createdAt",
        last_activity_at AS "lastActivityAt",
        absolute_expires_at AS "absoluteExpiresAt",
        revoked_at AS "revokedAt",
        revocation_reason AS "revocationReason",
        revoked_operation_id AS "revokedOperationId"
      FROM public.auth_session
      WHERE id = ${sessionId}::uuid
        AND account_id = ${accountId}::uuid
      ORDER BY id
      FOR UPDATE
    `;
    return rows[0];
  }

  private async lockActiveSessions(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<Array<{ id: string }>> {
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM public.auth_session
      WHERE account_id = ${accountId}::uuid
        AND revoked_at IS NULL
      ORDER BY id
      FOR UPDATE
    `;
  }

  private async insertAuditEvent(
    tx: Prisma.TransactionClient,
    event: {
      occurredAt: Date;
      actorAccountId: string;
      operation: AuthSessionAuditOperation;
      entityType: 'ACCOUNT' | 'AUTH_SESSION';
      entityId: string;
      context: Record<string, unknown>;
      operationId: OperationId;
    },
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO public.audit_event (
        id, occurred_at, actor_account_id, origin, scope, operation, result,
        entity_type, entity_id, before_data, after_data, context,
        correlation_id, operation_id, sequence
      ) VALUES (
        ${randomUUID()}::uuid,
        ${event.occurredAt},
        ${event.actorAccountId}::uuid,
        'HTTP_API',
        'SECURITY',
        ${event.operation},
        'SUCCESS',
        ${event.entityType},
        ${event.entityId}::uuid,
        NULL,
        NULL,
        ${JSON.stringify(event.context)}::jsonb,
        ${event.operationId}::uuid,
        ${event.operationId}::uuid,
        1
      )
    `;
  }

  private async insertFailedLoginAuditEvent(
    tx: Prisma.TransactionClient,
    event: {
      occurredAt: Date;
      accountId: string | null;
      operationId: OperationId;
    },
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO public.audit_event (
        id, occurred_at, actor_account_id, origin, scope, operation, result,
        entity_type, entity_id, before_data, after_data, context,
        correlation_id, operation_id, sequence
      ) VALUES (
        ${randomUUID()}::uuid,
        ${event.occurredAt},
        ${event.accountId}::uuid,
        'HTTP_API',
        'SECURITY',
        ${AUTH_SESSION_AUDIT_OPERATION.LOGIN_FAILED},
        'DENIED',
        'ACCOUNT',
        ${event.accountId}::uuid,
        NULL,
        NULL,
        ${JSON.stringify({ authentication_type: 'PASSWORD' })}::jsonb,
        ${event.operationId}::uuid,
        ${event.operationId}::uuid,
        1
      )
    `;
  }

  private async reconcileWithinTransaction(
    tx: Prisma.TransactionClient,
    input: ReconcileAuthSessionOperationInput,
  ): Promise<Exclude<ReconciliationStatus, 'UNKNOWN'>> {
    const rows = await tx.$queryRaw<ReconciliationRow[]>`
      SELECT public.reconcile_auth_session_operation(
        ${input.operationId}::uuid,
        ${input.accountId}::uuid,
        ${input.operation},
        ${input.sessionId ?? null}::uuid
      ) AS status
    `;
    const status = this.parseReconciliationStatus(rows[0]?.status);
    if (status === 'UNKNOWN') {
      throw new Error('Unexpected reconciliation result');
    }
    return status;
  }

  private parseReconciliationStatus(status: string | undefined) {
    if (
      status === 'COMPLETED' ||
      status === 'NOT_FOUND' ||
      status === 'INCONSISTENT'
    ) {
      return status;
    }
    return 'UNKNOWN' as const;
  }

  private async countRevokedByOperation(
    tx: Prisma.TransactionClient,
    operationId: OperationId,
  ): Promise<number> {
    const rows = await tx.$queryRaw<CountRow[]>`
      SELECT pg_catalog.count(*) AS count
      FROM public.auth_session
      WHERE revoked_operation_id = ${operationId}::uuid
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  private async readEligibleSession(
    tokenHash: SessionTokenHash,
  ): Promise<SessionRow[]> {
    return this.prisma.$queryRaw<SessionRow[]>`
      SELECT
        session.id,
        session.account_id AS "accountId",
        session.created_at AS "createdAt",
        session.last_activity_at AS "lastActivityAt",
        session.absolute_expires_at AS "absoluteExpiresAt",
        session.revoked_at AS "revokedAt",
        session.revocation_reason AS "revocationReason",
        session.revoked_operation_id AS "revokedOperationId",
        clock.observed_at
            >= session.last_activity_at + INTERVAL '5 minutes'
          AS "shouldRefreshActivity"
      FROM public.auth_session AS session
      JOIN public.account AS account ON account.id = session.account_id
      CROSS JOIN LATERAL (
        SELECT pg_catalog.clock_timestamp() AS observed_at
      ) AS clock
      WHERE session.token_hash = ${tokenHash}
        AND session.revoked_at IS NULL
        AND account.status = 'ACTIVE'
        AND account.email_verified_at IS NOT NULL
        AND account.deactivated_at IS NULL
        AND clock.observed_at < session.absolute_expires_at
        AND clock.observed_at < session.last_activity_at + INTERVAL '8 hours'
      LIMIT 1
    `;
  }

  private async updateActivity(
    sessionId: string,
    tokenHash: SessionTokenHash,
  ): Promise<Date | null> {
    const rows = await this.prisma.$queryRaw<Array<{ lastActivityAt: Date }>>`
      UPDATE public.auth_session AS session
      SET last_activity_at = LEAST(
        pg_catalog.clock_timestamp()::timestamptz(6),
        session.absolute_expires_at
      )
      FROM public.account AS account
      WHERE session.id = ${sessionId}::uuid
        AND session.token_hash = ${tokenHash}
        AND account.id = session.account_id
        AND session.revoked_at IS NULL
        AND account.status = 'ACTIVE'
        AND account.email_verified_at IS NOT NULL
        AND account.deactivated_at IS NULL
        AND pg_catalog.clock_timestamp() < session.absolute_expires_at
        AND pg_catalog.clock_timestamp()
          < session.last_activity_at + INTERVAL '8 hours'
        AND pg_catalog.clock_timestamp()
          >= session.last_activity_at + INTERVAL '5 minutes'
      RETURNING session.last_activity_at AS "lastActivityAt"
    `;
    return rows[0]?.lastActivityAt ?? null;
  }

  private toResolvedSession(session: SessionRow): ResolvedAuthSession {
    return {
      sessionId: session.id as SessionId,
      accountId: session.accountId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  }
}
