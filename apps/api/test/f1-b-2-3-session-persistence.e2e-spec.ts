import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  AuthSessionPersistence,
  SESSION_PERSISTENCE_ERROR_CODE,
} from '../src/auth/auth-session.persistence.js';
import {
  deriveAccountAdvisoryLockKey,
  generateOperationId,
  generateSessionId,
  hashSessionToken,
} from '../src/auth/session-primitives.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function migratorClient(): Client {
  return new Client({
    connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
  });
}

describe('F1-B.2.3 session persistence (PostgreSQL)', () => {
  const migrator = migratorClient();
  const prisma = new PrismaService();
  const service = new AuthSessionPersistence(prisma);
  let accountId: string;
  let changedAt: Date;

  async function createAccount(): Promise<string> {
    const id = randomUUID();
    const email = `${id}@session.example.com`;
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES (
         $1, 'Session', 'Test', $2, $2, pg_catalog.clock_timestamp(),
         'ACTIVE', pg_catalog.clock_timestamp(), NULL
       )`,
      [id, email],
    );
    const rows = await migrator.query<{ changed_at: Date }>(
      `INSERT INTO public.password_credential (
         account_id, password_hash, changed_at, changed_operation_id
       ) VALUES ($1, $2, pg_catalog.clock_timestamp(), $3)
       RETURNING changed_at`,
      [id, validPasswordHash, randomUUID()],
    );
    changedAt = rows.rows[0]!.changed_at;
    return id;
  }

  function credential() {
    return { encodedPasswordHash: validPasswordHash, changedAt };
  }

  async function resetData(): Promise<void> {
    if (process.env.BELLO_EPHEMERAL_TEST_DATABASE !== 'true') {
      throw new Error('F1-B tests require an explicitly ephemeral database');
    }
    const identity = await migrator.query<{
      database: string;
      user: string;
    }>('SELECT current_database() AS database, current_user AS "user"');
    expect(identity.rows[0]).toEqual({
      database: 'bello_test',
      user: 'bello_test_migrator',
    });

    await migrator.query(
      'DROP TRIGGER IF EXISTS _f1b23_audit_failure ON public.audit_event',
    );
    await migrator.query(
      'DROP FUNCTION IF EXISTS public._f1b23_audit_failure()',
    );
    await migrator.query('DELETE FROM public.auth_session');
    await migrator.query('DELETE FROM public.audit_event');
    await migrator.query('DELETE FROM public.global_role_assignment');
    await migrator.query('DELETE FROM public.password_credential');
    await migrator.query(`
      UPDATE public.bootstrap_state
      SET status = 'PENDING', initial_account_id = NULL,
          operation_id = NULL, completed_at = NULL
      WHERE singleton_id = 1
    `);
    await migrator.query('DELETE FROM public.account');
    accountId = await createAccount();
  }

  async function installAuditFailure(body: string): Promise<void> {
    await migrator.query(`
      CREATE FUNCTION public._f1b23_audit_failure()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        ${body}
        RETURN NEW;
      END
      $function$;
      CREATE TRIGGER _f1b23_audit_failure
      BEFORE INSERT ON public.audit_event
      FOR EACH ROW EXECUTE FUNCTION public._f1b23_audit_failure()
    `);
  }

  beforeAll(async () => {
    await migrator.connect();
    await prisma.onModuleInit();
  });

  beforeEach(resetData);

  afterAll(async () => {
    await migrator.query(
      'DROP TRIGGER IF EXISTS _f1b23_audit_failure ON public.audit_event',
    );
    await migrator.query(
      'DROP FUNCTION IF EXISTS public._f1b23_audit_failure()',
    );
    await prisma.onModuleDestroy();
    await migrator.end();
  });

  it('creates the session and login audit atomically with the approved evidence', async () => {
    const result = await service.createSession({
      accountId,
      credential: credential(),
    });
    const evidence = await migrator.query<{
      token_hash: Buffer;
      created_at: Date;
      absolute_expires_at: Date;
      operation: string;
      result: string;
      entity_type: string;
      entity_id: string;
      context: Record<string, unknown>;
    }>(
      `SELECT
         session.token_hash, session.created_at, session.absolute_expires_at,
         event.operation, event.result, event.entity_type, event.entity_id,
         event.context
       FROM public.auth_session AS session
       JOIN public.audit_event AS event
         ON event.operation_id = session.created_operation_id
       WHERE session.id = $1`,
      [result.sessionId],
    );

    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]!.token_hash).toEqual(
      hashSessionToken(result.token),
    );
    expect(
      evidence.rows[0]!.absolute_expires_at.getTime() -
        evidence.rows[0]!.created_at.getTime(),
    ).toBe(604_800_000);
    expect(evidence.rows[0]).toMatchObject({
      operation: 'AUTH_LOGIN_SUCCEEDED',
      result: 'SUCCESS',
      entity_type: 'AUTH_SESSION',
      entity_id: result.sessionId,
      context: { authentication_type: 'PASSWORD' },
    });
    await expect(
      service.reconcileOperation({
        accountId,
        operationId: result.operationId,
        operation: 'AUTH_LOGIN_SUCCEEDED',
        sessionId: result.sessionId,
      }),
    ).resolves.toBe('COMPLETED');
  });

  it('rolls back session creation when mandatory auditing fails', async () => {
    await installAuditFailure(
      `IF NEW.operation = 'AUTH_LOGIN_SUCCEEDED' THEN
         RAISE EXCEPTION 'controlled audit failure';
       END IF;`,
    );
    const operationId = generateOperationId();

    await expect(
      service.createSession({
        accountId,
        operationId,
        credential: credential(),
      }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      operationId,
    });

    const counts = await migrator.query<{ sessions: number; events: number }>(
      `SELECT
         (SELECT count(*)::integer FROM public.auth_session
          WHERE created_operation_id = $1) AS sessions,
         (SELECT count(*)::integer FROM public.audit_event
          WHERE operation_id = $1) AS events`,
      [operationId],
    );
    expect(counts.rows[0]).toEqual({ sessions: 0, events: 0 });
    const lockProbe = await migrator.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',
      [deriveAccountAdvisoryLockKey(accountId)],
    );
    expect(lockProbe.rows[0]!.acquired).toBe(true);
  });

  it('does not duplicate a completed session creation operation', async () => {
    const sessionId = generateSessionId();
    const operationId = generateOperationId();
    await service.createSession({
      accountId,
      sessionId,
      operationId,
      credential: credential(),
    });

    await expect(
      service.createSession({
        accountId,
        sessionId,
        operationId,
        credential: credential(),
      }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_ALREADY_COMPLETED,
      operationId,
      sessionId,
    });
    const evidence = await migrator.query<{ sessions: number; events: number }>(
      `SELECT
         (SELECT count(*)::integer FROM public.auth_session
          WHERE created_operation_id = $1) AS sessions,
         (SELECT count(*)::integer FROM public.audit_event
          WHERE operation_id = $1) AS events`,
      [operationId],
    );
    expect(evidence.rows[0]).toEqual({ sessions: 1, events: 1 });
  });

  it('enforces account and current credential preconditions after the lock', async () => {
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_at = changed_at + INTERVAL '1 second',
           changed_operation_id = $2
       WHERE account_id = $1`,
      [accountId, randomUUID()],
    );
    await expect(
      service.createSession({ accountId, credential: credential() }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.CREDENTIAL_CHANGED,
    });

    changedAt = new Date(changedAt.getTime() + 1_000);
    await migrator.query(
      `UPDATE public.account SET status = 'INACTIVE' WHERE id = $1`,
      [accountId],
    );
    await expect(
      service.createSession({ accountId, credential: credential() }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE,
    });
  });

  it('refreshes activity only after five minutes using PostgreSQL time', async () => {
    const created = await service.createSession({
      accountId,
      credential: credential(),
    });
    const recent = await service.resolveSession(created.token);
    expect(recent?.lastActivityAt).toEqual(created.createdAt);

    await migrator.query(
      `WITH clock AS MATERIALIZED (
         SELECT pg_catalog.clock_timestamp() AS observed_at
       )
       UPDATE public.auth_session
       SET created_at = clock.observed_at - INTERVAL '1 hour',
           last_activity_at = clock.observed_at - INTERVAL '6 minutes',
           absolute_expires_at =
             clock.observed_at - INTERVAL '1 hour' + INTERVAL '168 hours'
       FROM clock
       WHERE id = $1`,
      [created.sessionId],
    );
    const refreshed = await service.resolveSession(created.token);
    expect(refreshed).not.toBeNull();
    expect(refreshed!.lastActivityAt.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it('rejects inactive, absolutely expired and revoked sessions without reactivation', async () => {
    const created = await service.createSession({
      accountId,
      credential: credential(),
    });
    await migrator.query(
      `WITH clock AS MATERIALIZED (
         SELECT pg_catalog.clock_timestamp() AS observed_at
       )
       UPDATE public.auth_session
       SET created_at = clock.observed_at - INTERVAL '9 hours',
           last_activity_at = clock.observed_at - INTERVAL '8 hours',
           absolute_expires_at =
             clock.observed_at - INTERVAL '9 hours' + INTERVAL '168 hours'
       FROM clock
       WHERE id = $1`,
      [created.sessionId],
    );
    await expect(service.resolveSession(created.token)).resolves.toBeNull();

    await migrator.query(
      `WITH clock AS MATERIALIZED (
         SELECT pg_catalog.clock_timestamp() AS observed_at
       )
       UPDATE public.auth_session
       SET created_at = clock.observed_at - INTERVAL '169 hours',
           last_activity_at = clock.observed_at - INTERVAL '1 hour',
           absolute_expires_at =
             clock.observed_at - INTERVAL '169 hours' + INTERVAL '168 hours'
       FROM clock
       WHERE id = $1`,
      [created.sessionId],
    );
    await expect(service.resolveSession(created.token)).resolves.toBeNull();

    await migrator.query(
      `UPDATE public.auth_session
       SET revoked_at = pg_catalog.clock_timestamp(),
           revocation_reason = 'LOGOUT', revoked_operation_id = $2
       WHERE id = $1`,
      [created.sessionId, randomUUID()],
    );
    await expect(service.resolveSession(created.token)).resolves.toBeNull();
    const state = await migrator.query<{ revoked_at: Date }>(
      'SELECT revoked_at FROM public.auth_session WHERE id = $1',
      [created.sessionId],
    );
    expect(state.rows[0]!.revoked_at).not.toBeNull();
  });

  it('keeps concurrent activity updates monotonic', async () => {
    const created = await service.createSession({
      accountId,
      credential: credential(),
    });
    await migrator.query(
      `WITH clock AS MATERIALIZED (
         SELECT pg_catalog.clock_timestamp() AS observed_at
       )
       UPDATE public.auth_session
       SET created_at = clock.observed_at - INTERVAL '1 hour',
           last_activity_at = clock.observed_at - INTERVAL '6 minutes',
           absolute_expires_at =
             clock.observed_at - INTERVAL '1 hour' + INTERVAL '168 hours'
       FROM clock
       WHERE id = $1`,
      [created.sessionId],
    );
    const before = await migrator.query<{ last_activity_at: Date }>(
      'SELECT last_activity_at FROM public.auth_session WHERE id = $1',
      [created.sessionId],
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.resolveSession(created.token)),
    );
    expect(results.every((result) => result !== null)).toBe(true);
    const after = await migrator.query<{ last_activity_at: Date }>(
      'SELECT last_activity_at FROM public.auth_session WHERE id = $1',
      [created.sessionId],
    );
    expect(after.rows[0]!.last_activity_at.getTime()).toBeGreaterThan(
      before.rows[0]!.last_activity_at.getTime(),
    );
    expect(
      results.every(
        (result) =>
          result!.lastActivityAt.getTime() >=
          before.rows[0]!.last_activity_at.getTime(),
      ),
    ).toBe(true);
  });

  it('audits individual logout once and reconciles its reexecution', async () => {
    const created = await service.createSession({
      accountId,
      credential: credential(),
    });
    const operationId = generateOperationId();
    const first = await service.logoutSession({
      accountId,
      sessionId: created.sessionId,
      operationId,
    });
    const second = await service.logoutSession({
      accountId,
      sessionId: created.sessionId,
      operationId,
    });
    expect(first).toMatchObject({
      revokedSessionCount: 1,
      alreadyCompleted: false,
    });
    expect(second).toMatchObject({
      revokedSessionCount: 1,
      alreadyCompleted: true,
    });
    const event = await migrator.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM public.audit_event
       WHERE operation_id = $1 AND operation = 'AUTH_SESSION_LOGOUT'`,
      [operationId],
    );
    expect(event.rows[0]!.count).toBe(1);
  });

  it('audits global revocation, including zero sessions, without duplication', async () => {
    await service.createSession({ accountId, credential: credential() });
    await service.createSession({ accountId, credential: credential() });
    const first = await service.revokeAllSessions({ accountId });
    expect(first).toMatchObject({
      revokedSessionCount: 2,
      alreadyCompleted: false,
    });

    const secondOperationId = generateOperationId();
    const zero = await service.revokeAllSessions({
      accountId,
      operationId: secondOperationId,
    });
    const repeated = await service.revokeAllSessions({
      accountId,
      operationId: secondOperationId,
    });
    expect(zero).toMatchObject({
      revokedSessionCount: 0,
      alreadyCompleted: false,
    });
    expect(repeated).toMatchObject({
      revokedSessionCount: 0,
      alreadyCompleted: true,
    });

    const event = await migrator.query<{
      context: { reason: string; revoked_session_count: number };
    }>(`SELECT context FROM public.audit_event WHERE operation_id = $1`, [
      secondOperationId,
    ]);
    expect(event.rows).toEqual([
      { context: { reason: 'GLOBAL_LOGOUT', revoked_session_count: 0 } },
    ]);
  });

  it('revokes an undelivered session with its restricted evidence', async () => {
    const created = await service.createSession({
      accountId,
      credential: credential(),
    });
    const result = await service.revokeUndeliveredSession({
      accountId,
      sessionId: created.sessionId,
    });
    const evidence = await migrator.query<{
      revocation_reason: string;
      operation: string;
      entity_type: string;
      context: { reason: string; revoked_session_count: number };
    }>(
      `SELECT session.revocation_reason, event.operation, event.entity_type,
              event.context
       FROM public.auth_session AS session
       JOIN public.audit_event AS event
         ON event.operation_id = session.revoked_operation_id
       WHERE session.id = $1`,
      [created.sessionId],
    );
    expect(result.revokedSessionCount).toBe(1);
    expect(evidence.rows[0]).toEqual({
      revocation_reason: 'DELIVERY_FAILED',
      operation: 'AUTH_SESSIONS_REVOKED',
      entity_type: 'ACCOUNT',
      context: { reason: 'DELIVERY_FAILED', revoked_session_count: 1 },
    });
  });

  it('serializes one account, keeps another independent and reads time after waiting', async () => {
    const firstChangedAt = changedAt;
    const otherAccountId = await createAccount();
    const otherChangedAt = changedAt;
    const blocker = migratorClient();
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock($1::bigint)', [
      deriveAccountAdvisoryLockKey(accountId),
    ]);

    let firstSettled = false;
    const first = service
      .createSession({
        accountId,
        credential: {
          encodedPasswordHash: validPasswordHash,
          changedAt: firstChangedAt,
        },
      })
      .finally(() => {
        firstSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(firstSettled).toBe(false);

    const independent = await service.createSession({
      accountId: otherAccountId,
      credential: {
        encodedPasswordHash: validPasswordHash,
        changedAt: otherChangedAt,
      },
    });
    expect(independent.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const releasedAt = Date.now();
    await blocker.query('ROLLBACK');
    await blocker.end();
    const waited = await first;
    expect(waited.createdAt.getTime()).toBeGreaterThanOrEqual(releasedAt - 10);
  });

  it('applies lock timeout and releases transaction locks after rollback', async () => {
    const blocker = migratorClient();
    await blocker.connect();
    await blocker.query('BEGIN');
    const key = deriveAccountAdvisoryLockKey(accountId);
    await blocker.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);

    const startedAt = Date.now();
    await expect(
      service.createSession({ accountId, credential: credential() }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
    });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(1_800);
    expect(elapsed).toBeLessThan(4_000);
    await blocker.query('ROLLBACK');

    await blocker.query('BEGIN');
    const available = await blocker.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',
      [key],
    );
    expect(available.rows[0]!.acquired).toBe(true);
    await blocker.query('ROLLBACK');
    await blocker.end();
  });

  it('applies statement timeout and rolls back the pending session', async () => {
    await installAuditFailure(`
      IF NEW.operation = 'AUTH_LOGIN_SUCCEEDED' THEN
        PERFORM pg_catalog.pg_sleep(6);
      END IF;
    `);
    const operationId = generateOperationId();
    const startedAt = Date.now();
    await expect(
      service.createSession({
        accountId,
        operationId,
        credential: credential(),
      }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
    });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(4_700);
    expect(elapsed).toBeLessThan(7_000);
    const session = await migrator.query(
      'SELECT 1 FROM public.auth_session WHERE created_operation_id = $1',
      [operationId],
    );
    expect(session.rowCount).toBe(0);
  }, 10_000);

  it('keeps absent reconciliation distinct from completion', async () => {
    await expect(
      service.reconcileOperation({
        accountId,
        operationId: generateOperationId(),
        operation: 'AUTH_SESSIONS_REVOKED',
      }),
    ).resolves.toBe('NOT_FOUND');
  });
});
