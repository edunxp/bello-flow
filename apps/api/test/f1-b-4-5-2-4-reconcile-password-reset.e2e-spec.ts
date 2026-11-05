import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, DatabaseError } from 'pg';

const migrationNames = [
  '20261102000000_f1_a_1_identity_foundation',
  '20261102010000_f1_b_2_1_auth_session',
  '20261103000000_f1_b_3_3_2_failed_login_reconciliation',
  '20261104000000_f1_b_4_5_1_password_recovery_foundation',
  '20261105000000_f1_b_4_5_2_1_physical_advisory_lock',
  '20261106000000_f1_b_4_5_2_2_start_password_reset',
  '20261107000000_f1_b_4_5_2_3_complete_password_reset',
  '20261108000000_f1_b_4_5_2_4_reconcile_password_reset',
] as const;

const oldPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';
const newPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$bmV3c2FsdG5ld3NhbHQxMg$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTM';

type Recovery = {
  attemptId: string;
  hash: Buffer;
  requestId: string;
  tokenId: string;
};

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function urlForDatabase(name: string, database: string): string {
  const url = new URL(requiredUrl(name));
  url.pathname = `/${database}`;
  return url.toString();
}

async function readMigration(name: string): Promise<string> {
  return readFile(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  );
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  code: string,
  message?: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
    if (message) expect((error as DatabaseError).message).toBe(message);
  }
}

describe('F1-B.4.5.2.4 reconcile password reset operation', () => {
  const admin = new Client({
    connectionString: requiredUrl('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b4524_main_${randomUUID().replaceAll('-', '')}`;
  let migrator: Client;
  let runtime: Client;
  let bootstrap: Client;
  let maintenance: Client;
  let databaseCreated = false;

  async function createAccount(): Promise<{
    accountId: string;
    changedOperationId: string;
  }> {
    const accountId = randomUUID();
    const changedOperationId = randomUUID();
    const now = new Date();
    const email = `${accountId.replaceAll('-', '')}@example.test`;
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES ($1, 'Test', 'Account', $2, $2, $3, 'ACTIVE', $3, NULL)`,
      [accountId, email, now],
    );
    await migrator.query(
      `INSERT INTO public.password_credential (
         account_id, password_hash, changed_at, changed_operation_id
       ) VALUES ($1, $2, $3, $4)`,
      [accountId, oldPasswordHash, now, changedOperationId],
    );
    return { accountId, changedOperationId };
  }

  async function createRecovery(
    accountId: string,
    expired = false,
  ): Promise<Recovery> {
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = randomUUID();
    const hash = randomBytes(32);
    const createdAt = new Date(Date.now() - (expired ? 31 * 60_000 : 0));
    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, 'SENT', $3, $3, $3, 1, NULL)`,
      [requestId, accountId, createdAt],
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_delivery_attempt (
         delivery_attempt_id, recovery_request_id, attempt_number, state,
         scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
         accepted_at, terminal_at, failure_class, cancelled_operation_id
       ) VALUES ($1, $2, 1, 'SENT', $3, NULL, NULL, $3, $3, $3, NULL, NULL)`,
      [attemptId, requestId, createdAt],
    );
    await migrator.query(
      `INSERT INTO public.password_reset_token (
         password_reset_token_id, delivery_attempt_id, account_id, token_hash,
         created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '30 minutes')`,
      [tokenId, attemptId, accountId, hash, createdAt],
    );
    return { attemptId, hash, requestId, tokenId };
  }

  async function createPendingRecovery(accountId: string): Promise<Recovery> {
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = randomUUID();
    const hash = randomBytes(32);
    const scheduledAt = new Date();
    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, 'PREPARED', $3, $3, NULL, 1, NULL)`,
      [requestId, accountId, scheduledAt],
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_delivery_attempt (
         delivery_attempt_id, recovery_request_id, attempt_number, state,
         scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
         accepted_at, terminal_at, failure_class, cancelled_operation_id
       ) VALUES ($1, $2, 1, 'PREPARED', $3, $4,
                 $3::timestamptz + INTERVAL '5 minutes',
                 NULL, NULL, NULL, NULL, NULL)`,
      [attemptId, requestId, scheduledAt, randomUUID()],
    );
    await migrator.query(
      `INSERT INTO public.password_reset_token (
         password_reset_token_id, delivery_attempt_id, account_id, token_hash,
         created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '30 minutes')`,
      [tokenId, attemptId, accountId, hash, scheduledAt],
    );
    return { attemptId, hash, requestId, tokenId };
  }

  async function createSession(accountId: string): Promise<string> {
    const sessionId = randomUUID();
    const createdAt = new Date(Date.now() - 60_000);
    await migrator.query(
      `INSERT INTO public.auth_session (
         id, account_id, token_hash, created_at, last_activity_at,
         absolute_expires_at, created_operation_id, revoked_at,
         revocation_reason, revoked_operation_id
       ) VALUES ($1, $2, $3, $4, $4,
                 $4::timestamptz + INTERVAL '168 hours', $5,
                 NULL, NULL, NULL)`,
      [sessionId, accountId, randomBytes(32), createdAt, randomUUID()],
    );
    return sessionId;
  }

  async function start(
    client: Client,
    operationId: string,
    recovery: Recovery,
  ): Promise<string> {
    const result = await client.query<{ state: string }>(
      'SELECT state FROM public.start_password_reset_operation($1, $2, $3)',
      [operationId, randomUUID(), recovery.hash],
    );
    return result.rows[0]!.state;
  }

  async function complete(
    client: Client,
    operationId: string,
  ): Promise<string> {
    const result = await client.query<{ state: string }>(
      'SELECT state FROM public.complete_password_reset_operation($1, $2, $3)',
      [operationId, randomUUID(), newPasswordHash],
    );
    return result.rows[0]!.state;
  }

  async function reconcile(
    client: Client,
    operationId: string | null,
  ): Promise<string> {
    const result = await client.query<{ result: string }>(
      'SELECT public.reconcile_password_reset_operation($1) AS result',
      [operationId],
    );
    return result.rows[0]!.result;
  }

  async function startAndComplete(accountId: string): Promise<{
    operationId: string;
    recovery: Recovery;
  }> {
    const recovery = await createRecovery(accountId);
    const operationId = randomUUID();
    expect(await start(runtime, operationId, recovery)).toBe('STARTED');
    expect(await complete(runtime, operationId)).toBe('COMPLETED');
    return { operationId, recovery };
  }

  async function snapshot(accountId: string): Promise<unknown> {
    const result = await migrator.query<{ snapshot: unknown }>(
      `SELECT pg_catalog.jsonb_build_object(
         'credential', (SELECT pg_catalog.to_jsonb(credential)
                        FROM public.password_credential AS credential
                        WHERE credential.account_id = $1),
         'operations', (SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(operation) ORDER BY operation.reset_operation_id
         ), '[]'::jsonb) FROM public.password_reset_operation AS operation
           WHERE operation.account_id = $1),
         'tokens', (SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(token) - 'token_hash'
           ORDER BY token.password_reset_token_id
         ), '[]'::jsonb) FROM public.password_reset_token AS token
           WHERE token.account_id = $1),
         'requests', (SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(request) ORDER BY request.recovery_request_id
         ), '[]'::jsonb) FROM public.password_recovery_request AS request
           WHERE request.account_id = $1),
         'attempts', (SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(attempt) ORDER BY attempt.delivery_attempt_id
         ), '[]'::jsonb)
           FROM public.password_recovery_delivery_attempt AS attempt
           JOIN public.password_recovery_request AS request
             ON request.recovery_request_id = attempt.recovery_request_id
           WHERE request.account_id = $1),
         'sessions', (SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(session) - 'token_hash' ORDER BY session.id
         ), '[]'::jsonb) FROM public.auth_session AS session
           WHERE session.account_id = $1),
         'audit', (SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(event) ORDER BY event.id
         ), '[]'::jsonb) FROM public.audit_event AS event
           WHERE event.operation_id IN (
             SELECT operation.reset_operation_id
             FROM public.password_reset_operation AS operation
             WHERE operation.account_id = $1
           ))
       ) AS snapshot`,
      [accountId],
    );
    return result.rows[0]!.snapshot;
  }

  async function insertMarker(
    accountId: string,
    changedOperationId: string,
    recovery: Recovery,
    state: 'COMPLETED' | 'INCONSISTENT' | 'NOT_FOUND',
    startedAt = new Date(),
  ): Promise<string> {
    const operationId = randomUUID();
    await migrator.query(
      `INSERT INTO public.password_reset_operation (
         reset_operation_id, account_id, password_reset_token_id,
         expected_changed_operation_id, state, started_at, updated_at, terminal_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $6, $6)`,
      [
        operationId,
        accountId,
        recovery.tokenId,
        changedOperationId,
        state,
        startedAt,
      ],
    );
    return operationId;
  }

  async function insertCompletedEvidence(options: {
    accountId: string;
    audit?: boolean;
    cancelledAttemptCount?: number;
    cancelledRequestCount?: number;
    expectedChangedOperationId: string;
    invalidatedTokenCount?: number;
    recovery: Recovery;
    revokedSessionCount?: number;
    terminalAt?: Date;
  }): Promise<string> {
    const operationId = randomUUID();
    const terminalAt = options.terminalAt ?? new Date();
    await migrator.query(
      `INSERT INTO public.password_reset_operation (
         reset_operation_id, account_id, password_reset_token_id,
         expected_changed_operation_id, state, started_at, updated_at, terminal_at
       ) VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $5, $5)`,
      [
        operationId,
        options.accountId,
        options.recovery.tokenId,
        options.expectedChangedOperationId,
        terminalAt,
      ],
    );
    await migrator.query(
      `UPDATE public.password_reset_token
       SET consumed_at = $2, consumed_operation_id = $1
       WHERE password_reset_token_id = $3`,
      [operationId, terminalAt, options.recovery.tokenId],
    );
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_at = $2, changed_operation_id = $1
       WHERE account_id = $3`,
      [operationId, terminalAt, options.accountId],
    );
    if (options.audit !== false) {
      await migrator.query(
        `INSERT INTO public.audit_event (
           id, occurred_at, actor_account_id, origin, scope, operation, result,
           entity_type, entity_id, before_data, after_data, context,
           correlation_id, operation_id, sequence
         ) VALUES (
           $1, $2, $3, 'HTTP_API', 'SECURITY',
           'AUTH_PASSWORD_RESET_SUCCEEDED', 'SUCCESS', 'ACCOUNT', $3,
           NULL, NULL, pg_catalog.jsonb_build_object(
             'reason', 'PASSWORD_RESET',
             'revoked_session_count', $5::integer,
             'invalidated_token_count', $6::integer,
             'cancelled_request_count', $7::integer,
             'cancelled_attempt_count', $8::integer
           ), $4, $4, 1
         )`,
        [
          randomUUID(),
          terminalAt,
          options.accountId,
          operationId,
          options.revokedSessionCount ?? 0,
          options.invalidatedTokenCount ?? 0,
          options.cancelledRequestCount ?? 0,
          options.cancelledAttemptCount ?? 0,
        ],
      );
    }
    return operationId;
  }

  async function waitForAdvisoryBlock(applicationName: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activity = await admin.query<{ blocked: boolean }>(
        `SELECT COALESCE(pg_catalog.bool_or(
           wait_event_type = 'Lock' AND wait_event = 'advisory'
         ), FALSE) AS blocked
         FROM pg_catalog.pg_stat_activity
         WHERE application_name = $1`,
        [applicationName],
      );
      if (activity.rows[0]?.blocked === true) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('reconciliation did not reach the advisory lock');
  }

  beforeAll(async () => {
    await admin.connect();
    const identity = await admin.query<{
      database: string;
      user: string;
      version: string;
    }>(
      `SELECT current_database() AS database, current_user AS "user",
              current_setting('server_version') AS version`,
    );
    expect(identity.rows[0]).toMatchObject({
      database: 'postgres',
      user: 'bello_admin',
    });
    expect(identity.rows[0]?.version).toMatch(/^18\.6(?:\s|$)/);

    expect(process.env.BELLO_EPHEMERAL_TEST_DATABASE).toBe('true');
    expect(database).toMatch(/^bello_f1b4524_[a-z]+_[a-f0-9]{32}$/);
    await admin.query(
      `CREATE DATABASE "${database}" OWNER bello_test_migrator`,
    );
    databaseCreated = true;
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE "${database}"
       TO bello_test_app, bello_test_migrator, bello_test_bootstrap,
          bello_test_audit_maintenance`,
    );

    migrator = new Client({
      connectionString: urlForDatabase('MIGRATION_DATABASE_URL', database),
    });
    await migrator.connect();
    await migrator.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await migrator.query(
      `GRANT USAGE ON SCHEMA public
       TO bello_runtime, bello_bootstrap_executor, bello_audit_maintenance`,
    );
    await migrator.query(
      'GRANT USAGE, CREATE ON SCHEMA public TO bello_test_migrator',
    );
    for (const name of migrationNames) {
      await migrator.query(await readMigration(name));
    }

    runtime = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    bootstrap = new Client({
      connectionString: urlForDatabase('BOOTSTRAP_DATABASE_URL', database),
    });
    maintenance = new Client({
      connectionString: urlForDatabase('MAINTENANCE_DATABASE_URL', database),
    });
    await Promise.all([
      runtime.connect(),
      bootstrap.connect(),
      maintenance.connect(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      runtime?.end().catch(() => undefined),
      bootstrap?.end().catch(() => undefined),
      maintenance?.end().catch(() => undefined),
      migrator?.end().catch(() => undefined),
    ]);
    if (databaseCreated) {
      expect(database).toMatch(/^bello_f1b4524_[a-z]+_[a-f0-9]{32}$/);
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await admin.end();
  });

  it('R01 classifies an absent operation as UNKNOWN and recognizes coherent NOT_FOUND only in its proof window', async () => {
    await expect(reconcile(runtime, randomUUID())).resolves.toBe('UNKNOWN');

    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = await insertMarker(
      accountId,
      changedOperationId,
      recovery,
      'NOT_FOUND',
    );
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('NOT_FOUND');
    expect(await snapshot(accountId)).toEqual(before);

    await migrator.query(
      `UPDATE public.password_reset_operation
       SET started_at = started_at - INTERVAL '31 days',
           updated_at = updated_at - INTERVAL '31 days',
           terminal_at = terminal_at - INTERVAL '31 days'
       WHERE reset_operation_id = $1`,
      [operationId],
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('UNKNOWN');
  });

  it('R02 keeps an intact STARTED marker observationally UNKNOWN', async () => {
    const { accountId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = randomUUID();
    expect(await start(runtime, operationId, recovery)).toBe('STARTED');
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('UNKNOWN');
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('R03 recognizes all persisted evidence of a coherent COMPLETED marker', async () => {
    const { accountId } = await createAccount();
    const presented = await createRecovery(accountId);
    const pending = await createPendingRecovery(accountId);
    const sessionId = await createSession(accountId);
    const operationId = randomUUID();
    expect(await start(runtime, operationId, presented)).toBe('STARTED');
    expect(await complete(runtime, operationId)).toBe('COMPLETED');
    await expect(reconcile(runtime, operationId)).resolves.toBe('COMPLETED');

    const evidence = await migrator.query(
      `SELECT marker.state, marker.terminal_at,
              credential.changed_operation_id,
              presented.consumed_operation_id,
              pending.invalidated_operation_id,
              request.state AS request_state,
              request.cancelled_operation_id AS request_operation_id,
              attempt.state AS attempt_state,
              attempt.cancelled_operation_id AS attempt_operation_id,
              session.revocation_reason,
              session.revoked_operation_id,
              event.operation, event.result, event.context,
              (SELECT pg_catalog.count(*)::integer
               FROM public.password_reset_token AS token
               WHERE token.invalidated_operation_id = $1) AS invalidated_count,
              (SELECT pg_catalog.count(*)::integer
               FROM public.password_recovery_request AS cancelled
               WHERE cancelled.cancelled_operation_id = $1) AS request_count,
              (SELECT pg_catalog.count(*)::integer
               FROM public.password_recovery_delivery_attempt AS cancelled
               WHERE cancelled.cancelled_operation_id = $1) AS attempt_count,
              (SELECT pg_catalog.count(*)::integer
               FROM public.auth_session AS revoked
               WHERE revoked.revoked_operation_id = $1) AS session_count
       FROM public.password_reset_operation AS marker
       JOIN public.password_credential AS credential
         ON credential.account_id = marker.account_id
       JOIN public.password_reset_token AS presented
         ON presented.password_reset_token_id = $2
       JOIN public.password_reset_token AS pending
         ON pending.password_reset_token_id = $3
       JOIN public.password_recovery_request AS request
         ON request.recovery_request_id = $4
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.delivery_attempt_id = $5
       JOIN public.auth_session AS session ON session.id = $6
       JOIN public.audit_event AS event ON event.operation_id = marker.reset_operation_id
       WHERE marker.reset_operation_id = $1`,
      [
        operationId,
        presented.tokenId,
        pending.tokenId,
        pending.requestId,
        pending.attemptId,
        sessionId,
      ],
    );
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        state: 'COMPLETED',
        changed_operation_id: operationId,
        consumed_operation_id: operationId,
        invalidated_operation_id: operationId,
        request_state: 'CANCELLED',
        request_operation_id: operationId,
        attempt_state: 'CANCELLED',
        attempt_operation_id: operationId,
        revocation_reason: 'PASSWORD_RESET',
        revoked_operation_id: operationId,
        operation: 'AUTH_PASSWORD_RESET_SUCCEEDED',
        result: 'SUCCESS',
        context: {
          reason: 'PASSWORD_RESET',
          revoked_session_count: 1,
          invalidated_token_count: 1,
          cancelled_request_count: 1,
          cancelled_attempt_count: 1,
        },
        invalidated_count: 1,
        request_count: 1,
        attempt_count: 1,
        session_count: 1,
      }),
    ]);
  });

  it('R04 recognizes a coherent functional REJECTED marker', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId, true);
    const preserved = await createRecovery(accountId);
    const sessionId = await createSession(accountId);
    const operationId = randomUUID();
    expect(await start(runtime, operationId, recovery)).toBe('REJECTED');
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('REJECTED');
    expect(await snapshot(accountId)).toEqual(before);

    const evidence = await migrator.query(
      `SELECT marker.state, marker.terminal_at,
              credential.changed_operation_id,
              rejected.consumed_operation_id AS rejected_consumed,
              rejected.invalidated_operation_id AS rejected_invalidated,
              preserved.consumed_operation_id AS preserved_consumed,
              preserved.invalidated_operation_id AS preserved_invalidated,
              session.revoked_operation_id,
              event.operation, event.result, event.context,
              (SELECT pg_catalog.count(*)::integer
               FROM public.password_reset_token AS token
               WHERE token.consumed_operation_id = $1
                  OR token.invalidated_operation_id = $1) AS token_effects,
              (SELECT pg_catalog.count(*)::integer
               FROM public.password_recovery_request AS request
               WHERE request.cancelled_operation_id = $1) AS request_effects,
              (SELECT pg_catalog.count(*)::integer
               FROM public.password_recovery_delivery_attempt AS attempt
               WHERE attempt.cancelled_operation_id = $1) AS attempt_effects,
              (SELECT pg_catalog.count(*)::integer
               FROM public.auth_session AS affected
               WHERE affected.revoked_operation_id = $1) AS session_effects
       FROM public.password_reset_operation AS marker
       JOIN public.password_credential AS credential
         ON credential.account_id = marker.account_id
       JOIN public.password_reset_token AS rejected
         ON rejected.password_reset_token_id = $2
       JOIN public.password_reset_token AS preserved
         ON preserved.password_reset_token_id = $3
       JOIN public.auth_session AS session ON session.id = $4
       JOIN public.audit_event AS event ON event.operation_id = marker.reset_operation_id
       WHERE marker.reset_operation_id = $1`,
      [operationId, recovery.tokenId, preserved.tokenId, sessionId],
    );
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        state: 'REJECTED',
        changed_operation_id: changedOperationId,
        rejected_consumed: null,
        rejected_invalidated: null,
        preserved_consumed: null,
        preserved_invalidated: null,
        revoked_operation_id: null,
        operation: 'AUTH_PASSWORD_RESET_REJECTED',
        result: 'DENIED',
        context: {
          reason: 'PASSWORD_RESET',
          revoked_session_count: 0,
          invalidated_token_count: 0,
          cancelled_request_count: 0,
          cancelled_attempt_count: 0,
        },
        token_effects: 0,
        request_effects: 0,
        attempt_effects: 0,
        session_effects: 0,
      }),
    ]);
  });

  it('R05 rejects a terminal marker with only partial evidence', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = await insertMarker(
      accountId,
      changedOperationId,
      recovery,
      'COMPLETED',
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
  });

  it('R06 detects missing audit evidence instead of trusting COMPLETED', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = await insertMarker(
      accountId,
      changedOperationId,
      recovery,
      'COMPLETED',
    );
    const terminal = await migrator.query<{ terminal_at: Date }>(
      `SELECT terminal_at FROM public.password_reset_operation
       WHERE reset_operation_id = $1`,
      [operationId],
    );
    await migrator.query(
      `UPDATE public.password_reset_token
       SET consumed_at = $2, consumed_operation_id = $1
       WHERE password_reset_token_id = $3`,
      [operationId, terminal.rows[0]!.terminal_at, recovery.tokenId],
    );
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_at = $2, changed_operation_id = $1
       WHERE account_id = $3`,
      [operationId, terminal.rows[0]!.terminal_at, accountId],
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
  });

  it('R06 returns UNKNOWN when only the 24-month audit evidence was retained away', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const terminalAt = new Date();
    terminalAt.setUTCFullYear(terminalAt.getUTCFullYear() - 3);
    const accountCreatedAt = new Date(terminalAt.getTime() - 24 * 60 * 60_000);
    const recoveryAt = new Date(terminalAt.getTime() - 60_000);
    await migrator.query(
      `UPDATE public.account
       SET created_at = $2, email_verified_at = $2
       WHERE id = $1`,
      [accountId, accountCreatedAt],
    );
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_at = $2
       WHERE account_id = $1`,
      [accountId, accountCreatedAt],
    );
    const recovery = await createRecovery(accountId);
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET received_at = $2, updated_at = $2, terminal_at = $2
       WHERE recovery_request_id = $1`,
      [recovery.requestId, recoveryAt],
    );
    await migrator.query(
      `UPDATE public.password_recovery_delivery_attempt
       SET scheduled_at = $2, sending_confirmed_at = $2,
           accepted_at = $2, terminal_at = $2
       WHERE delivery_attempt_id = $1`,
      [recovery.attemptId, recoveryAt],
    );
    await migrator.query(
      `UPDATE public.password_reset_token
       SET created_at = $2, expires_at = $2::timestamptz + INTERVAL '30 minutes'
       WHERE password_reset_token_id = $1`,
      [recovery.tokenId, recoveryAt],
    );
    const operationId = await insertMarker(
      accountId,
      changedOperationId,
      recovery,
      'COMPLETED',
      terminalAt,
    );
    await migrator.query(
      `UPDATE public.password_reset_token
       SET consumed_at = $2, consumed_operation_id = $1
       WHERE password_reset_token_id = $3`,
      [operationId, terminalAt, recovery.tokenId],
    );
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_at = $2, changed_operation_id = $1
       WHERE account_id = $3`,
      [operationId, terminalAt, accountId],
    );
    await migrator.query(
      `INSERT INTO public.audit_event (
         id, occurred_at, actor_account_id, origin, scope, operation, result,
         entity_type, entity_id, before_data, after_data, context,
         correlation_id, operation_id, sequence
       ) VALUES (
         $1, $2, $3, 'HTTP_API', 'SECURITY',
         'AUTH_PASSWORD_RESET_SUCCEEDED', 'SUCCESS', 'ACCOUNT', $3,
         NULL, NULL, pg_catalog.jsonb_build_object(
           'reason', 'PASSWORD_RESET',
           'revoked_session_count', 0,
           'invalidated_token_count', 0,
           'cancelled_request_count', 0,
           'cancelled_attempt_count', 0
         ), $4, $4, 1
       )`,
      [randomUUID(), terminalAt, accountId, operationId],
    );
    await migrator.query(
      'DELETE FROM public.audit_event WHERE operation_id = $1',
      [operationId],
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('UNKNOWN');
  });

  it('R07 detects a credential that cannot be reached by a valid later-reset chain', async () => {
    const { accountId } = await createAccount();
    const { operationId } = await startAndComplete(accountId);
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_at = pg_catalog.clock_timestamp(), changed_operation_id = $2
       WHERE account_id = $1`,
      [accountId, randomUUID()],
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
  });

  it('R08 detects a token and account binding contradiction', async () => {
    const first = await createAccount();
    const second = await createAccount();
    const firstRecovery = await createRecovery(first.accountId);
    const secondRecovery = await createRecovery(second.accountId);
    const operationId = randomUUID();
    expect(await start(runtime, operationId, firstRecovery)).toBe('STARTED');
    await migrator.query(
      `UPDATE public.password_reset_operation
       SET password_reset_token_id = $2
       WHERE reset_operation_id = $1`,
      [operationId, secondRecovery.tokenId],
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
  });

  it('R09 detects audited counts that differ from correlated rows', async () => {
    const { accountId } = await createAccount();
    const { operationId } = await startAndComplete(accountId);
    const extra = await createRecovery(accountId);
    const contradictoryAt = new Date();
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = 'CANCELLED', updated_at = $3, terminal_at = $3,
           cancelled_operation_id = $1
       WHERE recovery_request_id = $2`,
      [operationId, extra.requestId, contradictoryAt],
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
  });

  it('R10 recognizes a completed historical operation through one valid successor', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const first = await startAndComplete(accountId);
    const second = await startAndComplete(accountId);
    await expect(reconcile(runtime, first.operationId)).resolves.toBe(
      'COMPLETED',
    );
    await expect(reconcile(runtime, second.operationId)).resolves.toBe(
      'COMPLETED',
    );
    const evidence = await migrator.query<{
      consumed_operation_id: string;
      context: {
        cancelled_attempt_count: number;
        cancelled_request_count: number;
        invalidated_token_count: number;
        reason: string;
        revoked_session_count: number;
      };
      correlation_id: string;
      expected_changed_operation_id: string;
      operation: string;
      reset_operation_id: string;
      result: string;
      sequence: number;
      started_at: Date;
      state: string;
      terminal_at: Date;
    }>(
      `SELECT marker.reset_operation_id, marker.expected_changed_operation_id,
              marker.state, marker.started_at, marker.terminal_at,
              token.consumed_operation_id, event.operation, event.result,
              event.context, event.correlation_id, event.sequence
       FROM public.password_reset_operation AS marker
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = marker.password_reset_token_id
       JOIN public.audit_event AS event
         ON event.operation_id = marker.reset_operation_id
       WHERE marker.reset_operation_id IN ($1, $2)
       ORDER BY marker.started_at`,
      [first.operationId, second.operationId],
    );
    expect(evidence.rows).toHaveLength(2);
    expect(evidence.rows[0]).toMatchObject({
      reset_operation_id: first.operationId,
      expected_changed_operation_id: changedOperationId,
      state: 'COMPLETED',
      consumed_operation_id: first.operationId,
      operation: 'AUTH_PASSWORD_RESET_SUCCEEDED',
      result: 'SUCCESS',
      correlation_id: first.operationId,
      sequence: 1,
      context: {
        reason: 'PASSWORD_RESET',
        revoked_session_count: 0,
        invalidated_token_count: 0,
        cancelled_request_count: 0,
        cancelled_attempt_count: 0,
      },
    });
    expect(evidence.rows[1]).toMatchObject({
      reset_operation_id: second.operationId,
      expected_changed_operation_id: first.operationId,
      state: 'COMPLETED',
      consumed_operation_id: second.operationId,
      operation: 'AUTH_PASSWORD_RESET_SUCCEEDED',
      result: 'SUCCESS',
      correlation_id: second.operationId,
      sequence: 1,
      context: {
        reason: 'PASSWORD_RESET',
        revoked_session_count: 0,
        invalidated_token_count: 0,
        cancelled_request_count: 0,
        cancelled_attempt_count: 0,
      },
    });
    expect(evidence.rows[1]!.started_at.getTime()).toBeGreaterThan(
      evidence.rows[0]!.terminal_at.getTime(),
    );
    const credential = await migrator.query<{ changed_operation_id: string }>(
      `SELECT changed_operation_id FROM public.password_credential
       WHERE account_id = $1`,
      [accountId],
    );
    expect(credential.rows).toEqual([
      { changed_operation_id: second.operationId },
    ]);
  });

  it('R11 detects more than one COMPLETED successor before filtering evidence', async () => {
    const { accountId } = await createAccount();
    const first = await startAndComplete(accountId);
    await startAndComplete(accountId);
    const contradictory = await createRecovery(accountId);
    await insertMarker(
      accountId,
      first.operationId,
      contradictory,
      'COMPLETED',
      new Date(Date.now() + 1_000),
    );
    await expect(reconcile(runtime, first.operationId)).resolves.toBe(
      'INCONSISTENT',
    );
  });

  it('R12 detects a successor whose chronology does not follow its predecessor', async () => {
    const { accountId } = await createAccount();
    const first = await startAndComplete(accountId);
    const second = await startAndComplete(accountId);
    const predecessor = await migrator.query<{ started_at: Date }>(
      `SELECT started_at FROM public.password_reset_operation
       WHERE reset_operation_id = $1`,
      [first.operationId],
    );
    await migrator.query(
      `UPDATE public.password_reset_operation
       SET started_at = $2
       WHERE reset_operation_id = $1`,
      [second.operationId, predecessor.rows[0]!.started_at],
    );
    await expect(reconcile(runtime, first.operationId)).resolves.toBe(
      'INCONSISTENT',
    );
  });

  it('R12 rejects positive marker evidence dated in the future', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = await insertMarker(
      accountId,
      changedOperationId,
      recovery,
      'NOT_FOUND',
      new Date(Date.now() + 60_000),
    );
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
  });

  it('rejects a COMPLETED operation whose presented token expired before consumption', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const terminalAt = new Date();
    const operationId = await insertCompletedEvidence({
      accountId,
      expectedChangedOperationId: changedOperationId,
      recovery,
      terminalAt,
    });
    await migrator.query(
      `UPDATE public.password_reset_token
       SET created_at = $2::timestamptz - INTERVAL '31 minutes',
           expires_at = $2::timestamptz - INTERVAL '1 minute'
       WHERE password_reset_token_id = $1`,
      [recovery.tokenId, terminalAt],
    );
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('rejects an inapplicable expired token attributed as invalidated', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const presented = await createRecovery(accountId);
    const inapplicable = await createRecovery(accountId);
    const terminalAt = new Date();
    const operationId = await insertCompletedEvidence({
      accountId,
      expectedChangedOperationId: changedOperationId,
      invalidatedTokenCount: 1,
      recovery: presented,
      terminalAt,
    });
    await migrator.query(
      `UPDATE public.password_reset_token
       SET created_at = $2::timestamptz - INTERVAL '31 minutes',
           expires_at = $2::timestamptz - INTERVAL '1 minute',
           invalidated_at = $2, invalidated_operation_id = $3
       WHERE password_reset_token_id = $1`,
      [inapplicable.tokenId, terminalAt, operationId],
    );
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('rejects cancellation of the presented token ancestral request', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const terminalAt = new Date();
    const operationId = await insertCompletedEvidence({
      accountId,
      cancelledRequestCount: 1,
      expectedChangedOperationId: changedOperationId,
      recovery,
      terminalAt,
    });
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = 'CANCELLED', updated_at = $2, terminal_at = $2,
           cancelled_operation_id = $3
       WHERE recovery_request_id = $1`,
      [recovery.requestId, terminalAt, operationId],
    );
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('rejects a cancelled attempt whose parent request belongs to another operation', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const presented = await createRecovery(accountId);
    const contradictory = await createRecovery(accountId);
    const terminalAt = new Date();
    const operationId = await insertCompletedEvidence({
      accountId,
      cancelledAttemptCount: 1,
      expectedChangedOperationId: changedOperationId,
      recovery: presented,
      terminalAt,
    });
    const otherOperationId = randomUUID();
    await migrator.query(
      `UPDATE public.password_reset_token
       SET created_at = $2::timestamptz - INTERVAL '31 minutes',
           expires_at = $2::timestamptz - INTERVAL '1 minute'
       WHERE password_reset_token_id = $1`,
      [contradictory.tokenId, terminalAt],
    );
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = 'CANCELLED', updated_at = $2, terminal_at = $2,
           cancelled_operation_id = $3
       WHERE recovery_request_id = $1`,
      [contradictory.requestId, terminalAt, otherOperationId],
    );
    await migrator.query(
      `UPDATE public.password_recovery_delivery_attempt
       SET state = 'CANCELLED', sending_confirmed_at = NULL,
           accepted_at = NULL, terminal_at = $2,
           cancelled_operation_id = $3
       WHERE delivery_attempt_id = $1`,
      [contradictory.attemptId, terminalAt, operationId],
    );
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('INCONSISTENT');
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('rejects an invalid token to request graph in a later completed link', async () => {
    const firstAccount = await createAccount();
    const secondAccount = await createAccount();
    const first = await startAndComplete(firstAccount.accountId);
    const second = await startAndComplete(firstAccount.accountId);
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET account_id = $2
       WHERE recovery_request_id = $1`,
      [second.recovery.requestId, secondAccount.accountId],
    );
    const beforeFirst = await snapshot(firstAccount.accountId);
    const beforeSecond = await snapshot(secondAccount.accountId);
    await expect(reconcile(runtime, first.operationId)).resolves.toBe(
      'INCONSISTENT',
    );
    expect(await snapshot(firstAccount.accountId)).toEqual(beforeFirst);
    expect(await snapshot(secondAccount.accountId)).toEqual(beforeSecond);
  });

  it('rejects a later completed link whose whole evidence is in the future', async () => {
    const { accountId } = await createAccount();
    const first = await startAndComplete(accountId);
    const recovery = await createRecovery(accountId);
    const future = new Date(Date.now() + 60_000);
    await insertCompletedEvidence({
      accountId,
      expectedChangedOperationId: first.operationId,
      recovery,
      terminalAt: future,
    });
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, first.operationId)).resolves.toBe(
      'INCONSISTENT',
    );
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('rejects a valid successor coexisting with a cross-account completed successor', async () => {
    const firstAccount = await createAccount();
    const secondAccount = await createAccount();
    const first = await startAndComplete(firstAccount.accountId);
    await startAndComplete(firstAccount.accountId);
    const contradictory = await createRecovery(secondAccount.accountId);
    await insertCompletedEvidence({
      accountId: secondAccount.accountId,
      expectedChangedOperationId: first.operationId,
      recovery: contradictory,
    });
    const beforeFirst = await snapshot(firstAccount.accountId);
    const beforeSecond = await snapshot(secondAccount.accountId);
    await expect(reconcile(runtime, first.operationId)).resolves.toBe(
      'INCONSISTENT',
    );
    expect(await snapshot(firstAccount.accountId)).toEqual(beforeFirst);
    expect(await snapshot(secondAccount.accountId)).toEqual(beforeSecond);
  });

  it('R13 repeats reconciliation with stable results and no effects', async () => {
    const { accountId } = await createAccount();
    const { operationId } = await startAndComplete(accountId);
    const before = await snapshot(accountId);
    await expect(reconcile(runtime, operationId)).resolves.toBe('COMPLETED');
    await expect(reconcile(runtime, operationId)).resolves.toBe('COMPLETED');
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('R14 waits for a concurrent conclusion and classifies its committed evidence', async () => {
    const { accountId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = randomUUID();
    expect(await start(runtime, operationId, recovery)).toBe('STARTED');

    const writer = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
      application_name: `f1b4524-writer-${operationId}`,
    });
    const observerName = `f1b4524-observer-${operationId}`;
    const observer = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
      application_name: observerName,
    });
    await Promise.all([writer.connect(), observer.connect()]);
    try {
      await writer.query('BEGIN');
      expect(await complete(writer, operationId)).toBe('COMPLETED');
      const observation = reconcile(observer, operationId);
      await waitForAdvisoryBlock(observerName);
      await writer.query('COMMIT');
      await expect(observation).resolves.toBe('COMPLETED');
      await expect(reconcile(runtime, operationId)).resolves.toBe('COMPLETED');
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      await Promise.all([writer.end(), observer.end()]);
    }
  });

  it('R15 grants only runtime execution and preserves protected-table privileges', async () => {
    const acl = await migrator.query<{
      bootstrap: boolean;
      maintenance: boolean;
      public_execute: boolean;
      runtime: boolean;
      security_definer: boolean;
      settings: string[];
    }>(
      `SELECT procedure.prosecdef AS security_definer,
              procedure.proconfig AS settings,
              has_function_privilege('bello_runtime', procedure.oid, 'EXECUTE') AS runtime,
              has_function_privilege('bello_bootstrap_executor', procedure.oid, 'EXECUTE') AS bootstrap,
              has_function_privilege('bello_audit_maintenance', procedure.oid, 'EXECUTE') AS maintenance,
              has_function_privilege('public', procedure.oid, 'EXECUTE') AS public_execute
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid =
         'public.reconcile_password_reset_operation(uuid)'::regprocedure`,
    );
    expect(acl.rows).toEqual([
      {
        bootstrap: false,
        maintenance: false,
        public_execute: false,
        runtime: true,
        security_definer: true,
        settings: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
    await expectDatabaseError(reconcile(bootstrap, randomUUID()), '42501');
    await expectDatabaseError(reconcile(maintenance, randomUUID()), '42501');
    await expect(reconcile(runtime, randomUUID())).resolves.toBe('UNKNOWN');
  });

  it('R16 leaves complete account snapshots immutable for every observation', async () => {
    const { accountId } = await createAccount();
    const completed = await startAndComplete(accountId);
    const before = await snapshot(accountId);
    await reconcile(runtime, completed.operationId);
    await reconcile(runtime, completed.operationId);
    expect(await snapshot(accountId)).toEqual(before);
  });

  it('R17 preserves start and complete behavior through the new migration', async () => {
    const { accountId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = randomUUID();
    await expect(start(runtime, operationId, recovery)).resolves.toBe(
      'STARTED',
    );
    await expect(complete(runtime, operationId)).resolves.toBe('COMPLETED');
    await expect(reconcile(runtime, operationId)).resolves.toBe('COMPLETED');
  });

  it.each([
    ['null', null],
    ['non-v4 UUID', '00000000-0000-3000-8000-000000000001'],
    ['invalid UUID variant', '00000000-0000-4000-7000-000000000001'],
  ])('rejects %s input before any effect', async (_label, operationId) => {
    await expectDatabaseError(
      reconcile(runtime, operationId),
      '22023',
      'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
    );
  });
});
