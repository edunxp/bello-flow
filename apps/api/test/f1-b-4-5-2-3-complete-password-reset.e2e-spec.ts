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
] as const;

const oldPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';
const newPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$bmV3c2FsdG5ld3NhbHQxMg$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTM';
const laterPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$bGF0ZXJzYWx0bGF0ZXIxMg$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTQ';

type CompletionRow = {
  account_id: string;
  state: 'COMPLETED' | 'REJECTED';
  revoked_session_count: string;
  invalidated_token_count: string;
  cancelled_request_count: string;
  cancelled_attempt_count: string;
};

type RecoveryOptions = {
  attemptState?: 'PREPARING' | 'PREPARED' | 'SENDING' | 'SENT';
  expired?: boolean;
  future?: boolean;
  requestState?:
    'RECEIVED' | 'PENDING' | 'PREPARING' | 'PREPARED' | 'SENDING' | 'SENT';
  withToken?: boolean;
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
): Promise<DatabaseError> {
  try {
    await operation;
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
    if (message) expect((error as DatabaseError).message).toBe(message);
    return error as DatabaseError;
  }
}

async function createDisposableDatabase(
  admin: Client,
  database: string,
): Promise<void> {
  expect(process.env.BELLO_EPHEMERAL_TEST_DATABASE).toBe('true');
  expect(database).toMatch(/^bello_f1b4523_[a-z]+_[a-f0-9]{32}$/);
  await admin.query(`CREATE DATABASE "${database}" OWNER bello_test_migrator`);
  try {
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE "${database}"
         TO bello_test_app, bello_test_migrator`,
    );
  } catch (provisionError) {
    await admin
      .query(`DROP DATABASE IF EXISTS "${database}"`)
      .catch(() => undefined);
    throw provisionError;
  }
}

async function dropDisposableDatabase(
  admin: Client,
  database: string,
): Promise<void> {
  expect(database).toMatch(/^bello_f1b4523_[a-z]+_[a-f0-9]{32}$/);
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
}

async function prepareSchema(client: Client): Promise<void> {
  const identity = await client.query<{ database: string; user: string }>(
    'SELECT current_database() AS database, current_user AS "user"',
  );
  expect(identity.rows[0]?.database).toMatch(
    /^bello_f1b4523_[a-z]+_[a-f0-9]{32}$/,
  );
  expect(identity.rows[0]?.user).toBe('bello_test_migrator');
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await client.query(
    `GRANT USAGE ON SCHEMA public
       TO bello_runtime, bello_bootstrap_executor, bello_audit_maintenance`,
  );
  await client.query(
    'GRANT USAGE, CREATE ON SCHEMA public TO bello_test_migrator',
  );
}

describe('F1-B.4.5.2.3 complete password reset operation', () => {
  const admin = new Client({
    connectionString: requiredUrl('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b4523_main_${randomUUID().replaceAll('-', '')}`;
  let migrator: Client;
  let runtime: Client;
  let adminConnected = false;
  let databaseCreated = false;

  async function createAccount(
    options: {
      active?: boolean;
      verified?: boolean;
    } = {},
  ): Promise<{ accountId: string; changedOperationId: string }> {
    const accountId = randomUUID();
    const changedOperationId = randomUUID();
    const now = new Date();
    const email = `${accountId.replaceAll('-', '')}@example.test`;
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES ($1, 'Test', 'Account', $2, $2,
                 CASE WHEN $3 THEN $5::timestamptz ELSE NULL END,
                 CASE WHEN $4 THEN 'ACTIVE' ELSE 'INACTIVE' END,
                 $5, NULL)`,
      [
        accountId,
        email,
        options.verified !== false,
        options.active !== false,
        now,
      ],
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
    options: RecoveryOptions = {},
  ): Promise<{
    attemptId: string;
    hash?: Buffer;
    requestId: string;
    tokenId?: string;
  }> {
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = options.withToken === false ? undefined : randomUUID();
    const hash = tokenId ? randomBytes(32) : undefined;
    const requestState = options.requestState ?? 'SENT';
    const attemptState = options.attemptState ?? 'SENT';
    const createdAt = new Date(
      Date.now() +
        (options.future === true
          ? 60_000
          : options.expired === true
            ? -31 * 60_000
            : -60_000),
    );
    const requestTerminal = ['SENT'].includes(requestState);
    const attemptTerminal = ['SENT'].includes(attemptState);
    const attemptLeased = ['PREPARING', 'PREPARED', 'SENDING'].includes(
      attemptState,
    );
    const sending = ['SENDING', 'SENT'].includes(attemptState);

    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, $3, $4, $4,
                 CASE WHEN $5 THEN $4::timestamptz ELSE NULL END, 1, NULL)`,
      [requestId, accountId, requestState, createdAt, requestTerminal],
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_delivery_attempt (
         delivery_attempt_id, recovery_request_id, attempt_number, state,
         scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
         accepted_at, terminal_at, failure_class, cancelled_operation_id
       ) VALUES (
         $1, $2, 1, $3::text, $4,
         CASE WHEN $5 THEN $8::uuid ELSE NULL END,
         CASE WHEN $5 THEN $4::timestamptz + INTERVAL '5 minutes' ELSE NULL END,
         CASE WHEN $6 THEN $4::timestamptz ELSE NULL END,
         CASE WHEN $3::text = 'SENT' THEN $4::timestamptz ELSE NULL END,
         CASE WHEN $7 THEN $4::timestamptz ELSE NULL END,
         NULL, NULL
       )`,
      [
        attemptId,
        requestId,
        attemptState,
        createdAt,
        attemptLeased,
        sending,
        attemptTerminal,
        randomUUID(),
      ],
    );
    if (tokenId && hash) {
      await migrator.query(
        `INSERT INTO public.password_reset_token (
           password_reset_token_id, delivery_attempt_id, account_id, token_hash,
           created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5,
                   $5::timestamptz + INTERVAL '30 minutes')`,
        [tokenId, attemptId, accountId, hash, createdAt],
      );
    }
    return { attemptId, hash, requestId, tokenId };
  }

  async function createSession(
    accountId: string,
    options: { expired?: boolean; revoked?: boolean } = {},
  ): Promise<string> {
    const sessionId = randomUUID();
    const createdAt = new Date(
      Date.now() - (options.expired === true ? 8 * 24 * 60 * 60_000 : 60_000),
    );
    await migrator.query(
      `INSERT INTO public.auth_session (
         id, account_id, token_hash, created_at, last_activity_at,
         absolute_expires_at, created_operation_id, revoked_at,
         revocation_reason, revoked_operation_id
       ) VALUES ($1, $2, $3, $4, $4,
                 $4::timestamptz + INTERVAL '168 hours', $5,
                 CASE WHEN $6 THEN $7::timestamptz ELSE NULL END,
                 CASE WHEN $6 THEN 'LOGOUT' ELSE NULL END,
                 CASE WHEN $6 THEN $8::uuid ELSE NULL END)`,
      [
        sessionId,
        accountId,
        randomBytes(32),
        createdAt,
        randomUUID(),
        options.revoked === true,
        new Date(),
        randomUUID(),
      ],
    );
    return sessionId;
  }

  async function start(
    client: Client,
    operationId: string,
    auditEventId: string,
    hash: Buffer,
  ): Promise<Array<{ account_id: string; state: string }>> {
    const result = await client.query<{ account_id: string; state: string }>(
      'SELECT * FROM public.start_password_reset_operation($1, $2, $3)',
      [operationId, auditEventId, hash],
    );
    return result.rows;
  }

  async function complete(
    client: Client,
    operationId: string,
    auditEventId: string,
    passwordHash = newPasswordHash,
  ): Promise<CompletionRow[]> {
    const result = await client.query<CompletionRow>(
      'SELECT * FROM public.complete_password_reset_operation($1, $2, $3)',
      [operationId, auditEventId, passwordHash],
    );
    return result.rows;
  }

  async function waitForAdvisoryBlock(applicationName: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activity = await admin.query<{ blocked: boolean }>(
        `SELECT COALESCE(
           pg_catalog.bool_or(wait_event_type = 'Lock' AND wait_event = 'advisory'),
           FALSE
         ) AS blocked
         FROM pg_catalog.pg_stat_activity
         WHERE application_name = $1`,
        [applicationName],
      );
      if (activity.rows[0]?.blocked === true) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('concurrent operation did not reach the advisory lock');
  }

  async function accountStateSnapshot(accountId: string): Promise<unknown> {
    const result = await migrator.query<{ snapshot: unknown }>(
      `SELECT pg_catalog.jsonb_build_object(
         'credential', (
           SELECT pg_catalog.jsonb_build_object(
             'password_hash', credential.password_hash,
             'changed_at', credential.changed_at,
             'changed_operation_id', credential.changed_operation_id
           )
           FROM public.password_credential AS credential
           WHERE credential.account_id = $1
         ),
         'operations', (
           SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', operation.reset_operation_id,
               'expected', operation.expected_changed_operation_id,
               'state', operation.state,
               'started_at', operation.started_at,
               'updated_at', operation.updated_at,
               'terminal_at', operation.terminal_at
             ) ORDER BY operation.reset_operation_id
           ), '[]'::jsonb)
           FROM public.password_reset_operation AS operation
           WHERE operation.account_id = $1
         ),
         'tokens', (
           SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', token.password_reset_token_id,
               'consumed_at', token.consumed_at,
               'consumed_operation_id', token.consumed_operation_id,
               'invalidated_at', token.invalidated_at,
               'invalidated_operation_id', token.invalidated_operation_id
             ) ORDER BY token.password_reset_token_id
           ), '[]'::jsonb)
           FROM public.password_reset_token AS token
           WHERE token.account_id = $1
         ),
         'requests', (
           SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', request.recovery_request_id,
               'state', request.state,
               'updated_at', request.updated_at,
               'terminal_at', request.terminal_at,
               'cancelled_operation_id', request.cancelled_operation_id
             ) ORDER BY request.recovery_request_id
           ), '[]'::jsonb)
           FROM public.password_recovery_request AS request
           WHERE request.account_id = $1
         ),
         'attempts', (
           SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', attempt.delivery_attempt_id,
               'state', attempt.state,
               'lease_id', attempt.lease_id,
               'lease_expires_at', attempt.lease_expires_at,
               'terminal_at', attempt.terminal_at,
               'cancelled_operation_id', attempt.cancelled_operation_id
             ) ORDER BY attempt.delivery_attempt_id
           ), '[]'::jsonb)
           FROM public.password_recovery_delivery_attempt AS attempt
           JOIN public.password_recovery_request AS request
             ON request.recovery_request_id = attempt.recovery_request_id
           WHERE request.account_id = $1
         ),
         'sessions', (
           SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', session.id,
               'revoked_at', session.revoked_at,
               'revocation_reason', session.revocation_reason,
               'revoked_operation_id', session.revoked_operation_id
             ) ORDER BY session.id
           ), '[]'::jsonb)
           FROM public.auth_session AS session
           WHERE session.account_id = $1
         ),
         'audit', (
           SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', event.id,
               'occurred_at', event.occurred_at,
               'operation', event.operation,
               'result', event.result,
               'context', event.context,
               'operation_id', event.operation_id,
               'correlation_id', event.correlation_id,
               'sequence', event.sequence
             ) ORDER BY event.id
           ), '[]'::jsonb)
           FROM public.audit_event AS event
           WHERE event.actor_account_id = $1
         )
       ) AS snapshot`,
      [accountId],
    );
    return result.rows[0]!.snapshot;
  }

  async function completeNewReset(
    accountId: string,
    passwordHash = newPasswordHash,
  ): Promise<{
    auditEventId: string;
    operationId: string;
    recovery: Awaited<ReturnType<typeof createRecovery>>;
    result: CompletionRow[];
  }> {
    const recovery = await createRecovery(accountId);
    const operationId = randomUUID();
    const auditEventId = randomUUID();
    await expect(
      start(runtime, operationId, randomUUID(), recovery.hash!),
    ).resolves.toEqual([{ account_id: accountId, state: 'STARTED' }]);
    const result = await complete(
      runtime,
      operationId,
      auditEventId,
      passwordHash,
    );
    expect(result).toEqual([
      expect.objectContaining({ account_id: accountId, state: 'COMPLETED' }),
    ]);
    return { auditEventId, operationId, recovery, result };
  }

  async function insertContradictoryCompletedSuccessor(
    accountId: string,
    predecessorOperationId: string,
    startedAt: Date,
  ): Promise<string> {
    const recovery = await createRecovery(accountId);
    const operationId = randomUUID();
    await migrator.query(
      `INSERT INTO public.password_reset_operation (
         reset_operation_id, account_id, password_reset_token_id,
         expected_changed_operation_id, state, started_at, updated_at, terminal_at
       ) VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $5, $5)`,
      [
        operationId,
        accountId,
        recovery.tokenId,
        predecessorOperationId,
        startedAt,
      ],
    );
    return operationId;
  }

  beforeAll(async () => {
    await admin.connect();
    adminConnected = true;
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

    await createDisposableDatabase(admin, database);
    databaseCreated = true;
    migrator = new Client({
      connectionString: urlForDatabase('MIGRATION_DATABASE_URL', database),
    });
    await migrator.connect();
    await prepareSchema(migrator);
    for (const name of migrationNames) {
      await migrator.query(await readMigration(name));
    }

    runtime = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    await runtime.connect();
  });

  afterAll(async () => {
    await Promise.all([
      runtime?.end().catch(() => undefined),
      migrator?.end().catch(() => undefined),
    ]);
    if (adminConnected && databaseCreated) {
      await dropDisposableDatabase(admin, database);
    }
    if (adminConnected) await admin.end();
  });

  it('completes atomically with all normative effects and idempotent evidence', async () => {
    const { accountId } = await createAccount();
    const presented = await createRecovery(accountId);
    const other = await createRecovery(accountId, {
      requestState: 'PREPARED',
      attemptState: 'PREPARED',
    });
    const preservedSending = await createRecovery(accountId, {
      requestState: 'SENDING',
      attemptState: 'SENDING',
      withToken: false,
    });
    const activeSession = await createSession(accountId);
    const expiredSession = await createSession(accountId, { expired: true });
    const revokedSession = await createSession(accountId, { revoked: true });
    const operationId = randomUUID();
    const auditEventId = randomUUID();
    await expect(
      start(runtime, operationId, randomUUID(), presented.hash!),
    ).resolves.toEqual([{ account_id: accountId, state: 'STARTED' }]);

    const expected = [
      {
        account_id: accountId,
        state: 'COMPLETED',
        revoked_session_count: '2',
        invalidated_token_count: '1',
        cancelled_request_count: '1',
        cancelled_attempt_count: '1',
      },
    ] as CompletionRow[];
    await expect(complete(runtime, operationId, auditEventId)).resolves.toEqual(
      expected,
    );
    const beforeIdempotentRepeat = await accountStateSnapshot(accountId);
    await expect(complete(runtime, operationId, auditEventId)).resolves.toEqual(
      expected,
    );
    expect(await accountStateSnapshot(accountId)).toEqual(
      beforeIdempotentRepeat,
    );
    await expectDatabaseError(
      complete(runtime, operationId, randomUUID()),
      'P0001',
      'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
    );

    const evidence = await migrator.query(
      `SELECT credential.password_hash, credential.changed_operation_id,
              presented.consumed_operation_id,
              other.invalidated_operation_id,
              other_request.state AS other_request_state,
              other_request.cancelled_operation_id AS request_operation_id,
              other_attempt.state AS other_attempt_state,
              other_attempt.cancelled_operation_id AS attempt_operation_id,
              sending_request.state AS sending_request_state,
              sending_attempt.state AS sending_attempt_state,
              active.revocation_reason AS active_reason,
              active.revoked_operation_id AS active_operation_id,
              expired.revoked_operation_id AS expired_operation_id,
              revoked.revocation_reason AS preserved_reason,
              operation.state, operation.terminal_at IS NOT NULL AS terminal,
              event.id AS audit_event_id, event.operation, event.result,
              event.context, event.before_data, event.after_data,
              (SELECT count(*)::integer FROM public.audit_event
               WHERE operation_id = $1) AS audit_count
       FROM public.password_credential AS credential
       JOIN public.password_reset_token AS presented
         ON presented.password_reset_token_id = $2
       JOIN public.password_reset_token AS other
         ON other.password_reset_token_id = $3
       JOIN public.password_recovery_request AS other_request
         ON other_request.recovery_request_id = $4
       JOIN public.password_recovery_delivery_attempt AS other_attempt
         ON other_attempt.delivery_attempt_id = $5
       JOIN public.password_recovery_request AS sending_request
         ON sending_request.recovery_request_id = $6
       JOIN public.password_recovery_delivery_attempt AS sending_attempt
         ON sending_attempt.delivery_attempt_id = $7
       JOIN public.auth_session AS active ON active.id = $8
       JOIN public.auth_session AS expired ON expired.id = $9
       JOIN public.auth_session AS revoked ON revoked.id = $10
       JOIN public.password_reset_operation AS operation
         ON operation.reset_operation_id = $1
       JOIN public.audit_event AS event ON event.operation_id = $1
       WHERE credential.account_id = $11`,
      [
        operationId,
        presented.tokenId,
        other.tokenId,
        other.requestId,
        other.attemptId,
        preservedSending.requestId,
        preservedSending.attemptId,
        activeSession,
        expiredSession,
        revokedSession,
        accountId,
      ],
    );
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        password_hash: newPasswordHash,
        changed_operation_id: operationId,
        consumed_operation_id: operationId,
        invalidated_operation_id: operationId,
        other_request_state: 'CANCELLED',
        request_operation_id: operationId,
        other_attempt_state: 'CANCELLED',
        attempt_operation_id: operationId,
        sending_request_state: 'SENDING',
        sending_attempt_state: 'SENDING',
        active_reason: 'PASSWORD_RESET',
        active_operation_id: operationId,
        expired_operation_id: operationId,
        preserved_reason: 'LOGOUT',
        state: 'COMPLETED',
        terminal: true,
        audit_event_id: auditEventId,
        operation: 'AUTH_PASSWORD_RESET_SUCCEEDED',
        result: 'SUCCESS',
        context: {
          reason: 'PASSWORD_RESET',
          revoked_session_count: 2,
          invalidated_token_count: 1,
          cancelled_request_count: 1,
          cancelled_attempt_count: 1,
        },
        before_data: null,
        after_data: null,
        audit_count: 1,
      }),
    ]);

    const reusedOperationId = randomUUID();
    await expect(
      start(runtime, reusedOperationId, randomUUID(), presented.hash!),
    ).resolves.toEqual([{ account_id: accountId, state: 'REJECTED' }]);
    const reused = await migrator.query(
      `SELECT token.consumed_operation_id, operation.state,
              (SELECT count(*)::integer FROM public.audit_event
               WHERE operation_id = $1) AS audit_count
       FROM public.password_reset_token AS token
       JOIN public.password_reset_operation AS operation
         ON operation.reset_operation_id = $1
       WHERE token.password_reset_token_id = $2`,
      [reusedOperationId, presented.tokenId],
    );
    expect(reused.rows).toEqual([
      {
        consumed_operation_id: operationId,
        state: 'REJECTED',
        audit_count: 1,
      },
    ]);
  });

  it('returns the first completion idempotently after a later successful reset', async () => {
    const { accountId } = await createAccount();
    const first = await completeNewReset(accountId, newPasswordHash);
    await createSession(accountId);
    const second = await completeNewReset(accountId, laterPasswordHash);

    const credential = await migrator.query(
      `SELECT password_hash, changed_operation_id
       FROM public.password_credential
       WHERE account_id = $1`,
      [accountId],
    );
    expect(credential.rows).toEqual([
      {
        password_hash: laterPasswordHash,
        changed_operation_id: second.operationId,
      },
    ]);

    const beforeRepeat = await accountStateSnapshot(accountId);
    await expect(
      complete(runtime, first.operationId, first.auditEventId, newPasswordHash),
    ).resolves.toEqual(first.result);
    expect(await accountStateSnapshot(accountId)).toEqual(beforeRepeat);
  });

  it('fails closed when the current credential requires an absent successor', async () => {
    const { accountId } = await createAccount();
    const first = await completeNewReset(accountId);
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_operation_id = $2
       WHERE account_id = $1`,
      [accountId, randomUUID()],
    );
    const beforeRepeat = await accountStateSnapshot(accountId);

    await expectDatabaseError(
      complete(runtime, first.operationId, first.auditEventId),
      'P0001',
      'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
    );
    expect(await accountStateSnapshot(accountId)).toEqual(beforeRepeat);
  });

  it('fails closed when two completed successors reference one predecessor', async () => {
    const { accountId } = await createAccount();
    const first = await completeNewReset(accountId);
    await completeNewReset(accountId, laterPasswordHash);
    const predecessor = await migrator.query<{ terminal_at: Date }>(
      `SELECT terminal_at
       FROM public.password_reset_operation
       WHERE reset_operation_id = $1`,
      [first.operationId],
    );
    await insertContradictoryCompletedSuccessor(
      accountId,
      first.operationId,
      new Date(predecessor.rows[0]!.terminal_at.getTime() + 1),
    );
    const beforeRepeat = await accountStateSnapshot(accountId);

    await expectDatabaseError(
      complete(runtime, first.operationId, first.auditEventId),
      'P0001',
      'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
    );
    expect(await accountStateSnapshot(accountId)).toEqual(beforeRepeat);
  });

  it('fails closed for a single temporally divergent successor', async () => {
    const { accountId } = await createAccount();
    const first = await completeNewReset(accountId);
    const second = await completeNewReset(accountId, laterPasswordHash);
    const predecessor = await migrator.query<{ terminal_at: Date }>(
      `SELECT terminal_at
       FROM public.password_reset_operation
       WHERE reset_operation_id = $1`,
      [first.operationId],
    );
    await migrator.query(
      `UPDATE public.password_reset_operation
       SET started_at = $2
       WHERE reset_operation_id = $1`,
      [second.operationId, predecessor.rows[0]!.terminal_at],
    );
    const beforeRepeat = await accountStateSnapshot(accountId);

    await expectDatabaseError(
      complete(runtime, first.operationId, first.auditEventId),
      'P0001',
      'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
    );
    expect(await accountStateSnapshot(accountId)).toEqual(beforeRepeat);
  });

  it('fails closed when a valid successor coexists with a temporal contradiction', async () => {
    const { accountId } = await createAccount();
    const first = await completeNewReset(accountId);
    await completeNewReset(accountId, laterPasswordHash);
    const predecessor = await migrator.query<{ terminal_at: Date }>(
      `SELECT terminal_at
       FROM public.password_reset_operation
       WHERE reset_operation_id = $1`,
      [first.operationId],
    );
    await insertContradictoryCompletedSuccessor(
      accountId,
      first.operationId,
      predecessor.rows[0]!.terminal_at,
    );
    const beforeRepeat = await accountStateSnapshot(accountId);

    await expectDatabaseError(
      complete(runtime, first.operationId, first.auditEventId),
      'P0001',
      'BF_PASSWORD_RESET_COMPLETION_EVIDENCE_INCONSISTENT',
    );
    expect(await accountStateSnapshot(accountId)).toEqual(beforeRepeat);
  });

  it('serializes concurrent completion of the same operation into one effect', async () => {
    const { accountId } = await createAccount();
    const recovery = await createRecovery(accountId);
    await createSession(accountId);
    const operationId = randomUUID();
    const auditEventId = randomUUID();
    await start(runtime, operationId, randomUUID(), recovery.hash!);
    const first = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    const applicationName = `f1b4523-same-${randomUUID()}`;
    const secondUrl = new URL(urlForDatabase('DATABASE_URL', database));
    secondUrl.searchParams.set('application_name', applicationName);
    const second = new Client({ connectionString: secondUrl.toString() });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await first.query('BEGIN');
      const winner = await complete(first, operationId, auditEventId);
      const contender = complete(second, operationId, auditEventId);
      await waitForAdvisoryBlock(applicationName);
      await first.query('COMMIT');
      await expect(contender).resolves.toEqual(winner);
      const counts = await migrator.query(
        `SELECT
           (SELECT count(*)::integer FROM public.password_reset_token
            WHERE consumed_operation_id = $1) AS consumed,
           (SELECT count(*)::integer FROM public.audit_event
            WHERE operation_id = $1) AS audited,
           (SELECT count(*)::integer FROM public.auth_session
            WHERE revoked_operation_id = $1) AS revoked`,
        [operationId],
      );
      expect(counts.rows).toEqual([{ consumed: 1, audited: 1, revoked: 1 }]);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('serializes distinct recoveries of one account and rejects the loser', async () => {
    const { accountId } = await createAccount();
    const firstRecovery = await createRecovery(accountId);
    const secondRecovery = await createRecovery(accountId, {
      attemptState: 'PREPARED',
      requestState: 'PREPARED',
    });
    const sessionId = await createSession(accountId);
    const firstOperationId = randomUUID();
    const secondOperationId = randomUUID();
    const firstAuditId = randomUUID();
    const secondAuditId = randomUUID();
    await start(runtime, firstOperationId, randomUUID(), firstRecovery.hash!);
    await start(runtime, secondOperationId, randomUUID(), secondRecovery.hash!);
    const first = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    const applicationName = `f1b4523-account-${randomUUID()}`;
    const secondUrl = new URL(urlForDatabase('DATABASE_URL', database));
    secondUrl.searchParams.set('application_name', applicationName);
    const second = new Client({ connectionString: secondUrl.toString() });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await first.query('BEGIN');
      const winningResult = await complete(
        first,
        firstOperationId,
        firstAuditId,
      );
      expect(winningResult).toEqual([
        {
          account_id: accountId,
          state: 'COMPLETED',
          revoked_session_count: '1',
          invalidated_token_count: '1',
          cancelled_request_count: '1',
          cancelled_attempt_count: '1',
        },
      ]);
      const losingCompletion = complete(
        second,
        secondOperationId,
        secondAuditId,
      );
      await waitForAdvisoryBlock(applicationName);
      await first.query('COMMIT');
      const losingResult = await losingCompletion;
      expect(losingResult).toEqual([
        {
          account_id: accountId,
          state: 'REJECTED',
          revoked_session_count: '0',
          invalidated_token_count: '0',
          cancelled_request_count: '0',
          cancelled_attempt_count: '0',
        },
      ]);
      const evidence = await migrator.query(
        `SELECT credential.password_hash, credential.changed_operation_id,
                first_token.consumed_operation_id AS first_consumed_operation_id,
                first_token.invalidated_operation_id AS first_invalidated_operation_id,
                second_token.consumed_operation_id AS second_consumed_operation_id,
                second_token.invalidated_operation_id AS second_invalidated_operation_id,
                first_operation.state AS first_state,
                second_operation.state AS second_state,
                second_request.state AS second_request_state,
                second_request.cancelled_operation_id AS request_cancelled_operation_id,
                second_attempt.state AS second_attempt_state,
                second_attempt.cancelled_operation_id AS attempt_cancelled_operation_id,
                session.revocation_reason, session.revoked_operation_id,
                success.operation AS success_operation,
                success.result AS success_result,
                success.context AS success_context,
                rejection.operation AS rejection_operation,
                rejection.result AS rejection_result,
                rejection.context AS rejection_context,
                (SELECT count(*)::integer FROM public.audit_event
                 WHERE operation_id IN ($2, $3)) AS audit_count,
                (SELECT count(*)::integer FROM public.password_credential
                 WHERE changed_operation_id = $3)
                + (SELECT count(*)::integer FROM public.password_reset_token
                   WHERE consumed_operation_id = $3
                      OR invalidated_operation_id = $3)
                + (SELECT count(*)::integer FROM public.password_recovery_request
                   WHERE cancelled_operation_id = $3)
                + (SELECT count(*)::integer
                   FROM public.password_recovery_delivery_attempt
                   WHERE cancelled_operation_id = $3)
                + (SELECT count(*)::integer FROM public.auth_session
                   WHERE revoked_operation_id = $3) AS losing_success_effect_count
         FROM public.password_credential AS credential
         JOIN public.password_reset_token AS first_token
           ON first_token.password_reset_token_id = $4
         JOIN public.password_reset_token AS second_token
           ON second_token.password_reset_token_id = $5
         JOIN public.password_reset_operation AS first_operation
           ON first_operation.reset_operation_id = $2
         JOIN public.password_reset_operation AS second_operation
           ON second_operation.reset_operation_id = $3
         JOIN public.password_recovery_request AS second_request
           ON second_request.recovery_request_id = $6
         JOIN public.password_recovery_delivery_attempt AS second_attempt
           ON second_attempt.delivery_attempt_id = $7
         JOIN public.auth_session AS session ON session.id = $8
         JOIN public.audit_event AS success ON success.operation_id = $2
         JOIN public.audit_event AS rejection ON rejection.operation_id = $3
         WHERE credential.account_id = $1`,
        [
          accountId,
          firstOperationId,
          secondOperationId,
          firstRecovery.tokenId,
          secondRecovery.tokenId,
          secondRecovery.requestId,
          secondRecovery.attemptId,
          sessionId,
        ],
      );
      expect(evidence.rows).toEqual([
        {
          password_hash: newPasswordHash,
          changed_operation_id: firstOperationId,
          first_consumed_operation_id: firstOperationId,
          first_invalidated_operation_id: null,
          second_consumed_operation_id: null,
          second_invalidated_operation_id: firstOperationId,
          first_state: 'COMPLETED',
          second_state: 'REJECTED',
          second_request_state: 'CANCELLED',
          request_cancelled_operation_id: firstOperationId,
          second_attempt_state: 'CANCELLED',
          attempt_cancelled_operation_id: firstOperationId,
          revocation_reason: 'PASSWORD_RESET',
          revoked_operation_id: firstOperationId,
          success_operation: 'AUTH_PASSWORD_RESET_SUCCEEDED',
          success_result: 'SUCCESS',
          success_context: {
            reason: 'PASSWORD_RESET',
            revoked_session_count: 1,
            invalidated_token_count: 1,
            cancelled_request_count: 1,
            cancelled_attempt_count: 1,
          },
          rejection_operation: 'AUTH_PASSWORD_RESET_REJECTED',
          rejection_result: 'DENIED',
          rejection_context: {
            reason: 'PASSWORD_RESET',
            revoked_session_count: 0,
            invalidated_token_count: 0,
            cancelled_request_count: 0,
            cancelled_attempt_count: 0,
          },
          audit_count: 2,
          losing_success_effect_count: 0,
        },
      ]);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('rejects expired, ineligible and changed-credential operations without success effects', async () => {
    const expiredAccount = await createAccount();
    const expired = await createRecovery(expiredAccount.accountId, {
      expired: true,
    });
    const expiredSessionId = await createSession(expiredAccount.accountId);
    const expiredOperationId = randomUUID();
    const expiredAuditId = randomUUID();
    await expect(
      start(runtime, expiredOperationId, expiredAuditId, expired.hash!),
    ).resolves.toEqual([
      { account_id: expiredAccount.accountId, state: 'REJECTED' },
    ]);
    await expect(
      complete(runtime, expiredOperationId, expiredAuditId),
    ).resolves.toEqual([expect.objectContaining({ state: 'REJECTED' })]);
    const expiredEvidence = await migrator.query(
      `SELECT credential.password_hash, credential.changed_operation_id,
              token.consumed_at, token.consumed_operation_id,
              token.invalidated_at, token.invalidated_operation_id,
              request.state AS request_state,
              request.cancelled_operation_id AS request_cancelled_operation_id,
              attempt.state AS attempt_state,
              attempt.cancelled_operation_id AS attempt_cancelled_operation_id,
              session.revoked_at, session.revoked_operation_id,
              operation.state, event.operation AS audit_operation,
              event.result AS audit_result, event.context,
              (SELECT count(*)::integer FROM public.password_credential
               WHERE changed_operation_id = $1)
              + (SELECT count(*)::integer FROM public.password_reset_token
                 WHERE consumed_operation_id = $1
                    OR invalidated_operation_id = $1)
              + (SELECT count(*)::integer FROM public.password_recovery_request
                 WHERE cancelled_operation_id = $1)
              + (SELECT count(*)::integer
                 FROM public.password_recovery_delivery_attempt
                 WHERE cancelled_operation_id = $1)
              + (SELECT count(*)::integer FROM public.auth_session
                 WHERE revoked_operation_id = $1) AS success_effect_count
       FROM public.password_credential AS credential
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = $2
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.delivery_attempt_id = token.delivery_attempt_id
       JOIN public.password_recovery_request AS request
         ON request.recovery_request_id = attempt.recovery_request_id
       JOIN public.auth_session AS session ON session.id = $3
       JOIN public.password_reset_operation AS operation
         ON operation.reset_operation_id = $1
       JOIN public.audit_event AS event ON event.operation_id = $1
       WHERE credential.account_id = $4`,
      [
        expiredOperationId,
        expired.tokenId,
        expiredSessionId,
        expiredAccount.accountId,
      ],
    );
    expect(expiredEvidence.rows).toEqual([
      {
        password_hash: oldPasswordHash,
        changed_operation_id: expiredAccount.changedOperationId,
        consumed_at: null,
        consumed_operation_id: null,
        invalidated_at: null,
        invalidated_operation_id: null,
        request_state: 'SENT',
        request_cancelled_operation_id: null,
        attempt_state: 'SENT',
        attempt_cancelled_operation_id: null,
        revoked_at: null,
        revoked_operation_id: null,
        state: 'REJECTED',
        audit_operation: 'AUTH_PASSWORD_RESET_REJECTED',
        audit_result: 'DENIED',
        context: {
          reason: 'PASSWORD_RESET',
          revoked_session_count: 0,
          invalidated_token_count: 0,
          cancelled_request_count: 0,
          cancelled_attempt_count: 0,
        },
        success_effect_count: 0,
      },
    ]);

    const changedAccount = await createAccount();
    const changed = await createRecovery(changedAccount.accountId);
    const changedOperationId = randomUUID();
    const changedAuditId = randomUUID();
    await start(runtime, changedOperationId, randomUUID(), changed.hash!);
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_operation_id = $2
       WHERE account_id = $1`,
      [changedAccount.accountId, randomUUID()],
    );
    await expect(
      complete(runtime, changedOperationId, changedAuditId),
    ).resolves.toEqual([expect.objectContaining({ state: 'REJECTED' })]);
    const evidence = await migrator.query(
      `SELECT token.consumed_at, token.invalidated_at, operation.state,
              event.operation, event.context
       FROM public.password_reset_token AS token
       JOIN public.password_reset_operation AS operation
         ON operation.reset_operation_id = $1
       JOIN public.audit_event AS event ON event.operation_id = $1
       WHERE token.password_reset_token_id = $2`,
      [changedOperationId, changed.tokenId],
    );
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        consumed_at: null,
        invalidated_at: null,
        state: 'REJECTED',
        operation: 'AUTH_PASSWORD_RESET_REJECTED',
        context: expect.objectContaining({ revoked_session_count: 0 }),
      }),
    ]);
  });

  it('refuses absent or incompatible markers and invalid PHCs before effects', async () => {
    await expectDatabaseError(
      complete(runtime, randomUUID(), randomUUID()),
      'P0001',
      'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
    );

    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const operationId = randomUUID();
    await start(runtime, operationId, randomUUID(), recovery.hash!);
    await migrator.query(
      `UPDATE public.password_reset_operation
       SET state = 'UNKNOWN'
       WHERE reset_operation_id = $1`,
      [operationId],
    );
    await expectDatabaseError(
      complete(runtime, operationId, randomUUID()),
      'P0001',
      'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
    );
    await expectDatabaseError(
      complete(
        runtime,
        operationId,
        randomUUID(),
        '$argon2id$v=19$m=8,t=1,p=1$c2FsdA$YWJjZA',
      ),
      '22023',
      'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
    );
    const evidence = await migrator.query(
      `SELECT credential.changed_operation_id, token.consumed_at,
              (SELECT count(*)::integer FROM public.audit_event
               WHERE operation_id = $1) AS audit_count
       FROM public.password_credential AS credential
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = $2
       WHERE credential.account_id = $3`,
      [operationId, recovery.tokenId, accountId],
    );
    expect(evidence.rows).toEqual([
      {
        changed_operation_id: changedOperationId,
        consumed_at: null,
        audit_count: 0,
      },
    ]);

    const partialAccount = await createAccount();
    const partialRecovery = await createRecovery(partialAccount.accountId);
    const partialSessionId = await createSession(partialAccount.accountId);
    const partialOperationId = randomUUID();
    await start(
      runtime,
      partialOperationId,
      randomUUID(),
      partialRecovery.hash!,
    );
    await migrator.query(
      `UPDATE public.auth_session
       SET revoked_at = pg_catalog.transaction_timestamp(),
           revocation_reason = 'PASSWORD_RESET',
           revoked_operation_id = $2
       WHERE id = $1`,
      [partialSessionId, partialOperationId],
    );
    await expectDatabaseError(
      complete(runtime, partialOperationId, randomUUID()),
      'P0001',
      'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
    );
    const partialEvidence = await migrator.query(
      `SELECT operation.state, token.consumed_at,
              credential.changed_operation_id,
              (SELECT count(*)::integer FROM public.audit_event
               WHERE operation_id = $1) AS audit_count
       FROM public.password_reset_operation AS operation
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = operation.password_reset_token_id
       JOIN public.password_credential AS credential
         ON credential.account_id = operation.account_id
       WHERE operation.reset_operation_id = $1`,
      [partialOperationId],
    );
    expect(partialEvidence.rows).toEqual([
      {
        state: 'STARTED',
        consumed_at: null,
        changed_operation_id: partialAccount.changedOperationId,
        audit_count: 0,
      },
    ]);

    const futureAccount = await createAccount();
    const futurePresented = await createRecovery(futureAccount.accountId);
    await createRecovery(futureAccount.accountId, {
      attemptState: 'PREPARED',
      future: true,
      requestState: 'PREPARED',
      withToken: false,
    });
    const futureOperationId = randomUUID();
    await start(
      runtime,
      futureOperationId,
      randomUUID(),
      futurePresented.hash!,
    );
    await expectDatabaseError(
      complete(runtime, futureOperationId, randomUUID()),
      'P0001',
      'BF_PASSWORD_RESET_CANCELLATION_GRAPH_INCONSISTENT',
    );
    const futureEvidence = await migrator.query(
      `SELECT operation.state, token.consumed_at,
              credential.changed_operation_id
       FROM public.password_reset_operation AS operation
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = operation.password_reset_token_id
       JOIN public.password_credential AS credential
         ON credential.account_id = operation.account_id
       WHERE operation.reset_operation_id = $1`,
      [futureOperationId],
    );
    expect(futureEvidence.rows).toEqual([
      {
        state: 'STARTED',
        consumed_at: null,
        changed_operation_id: futureAccount.changedOperationId,
      },
    ]);
  });

  it('rejects null, non-v4 and invalid-variant UUID arguments without effects', async () => {
    const { accountId } = await createAccount();
    const presented = await createRecovery(accountId);
    await createRecovery(accountId, {
      attemptState: 'PREPARED',
      requestState: 'PREPARED',
    });
    await createSession(accountId);
    const operationId = randomUUID();
    await start(runtime, operationId, randomUUID(), presented.hash!);
    const beforeInvalidArguments = await accountStateSnapshot(accountId);
    const nonV4 = '00000000-0000-3000-8000-000000000000';
    const invalidVariant = '00000000-0000-4000-7000-000000000000';
    const cases: Array<{
      auditEventId: string | null;
      resetOperationId: string | null;
    }> = [
      { resetOperationId: null, auditEventId: randomUUID() },
      { resetOperationId: nonV4, auditEventId: randomUUID() },
      { resetOperationId: invalidVariant, auditEventId: randomUUID() },
      { resetOperationId: operationId, auditEventId: null },
      { resetOperationId: operationId, auditEventId: nonV4 },
      { resetOperationId: operationId, auditEventId: invalidVariant },
    ];

    for (const invalidCase of cases) {
      await expectDatabaseError(
        runtime.query(
          `SELECT * FROM public.complete_password_reset_operation(
             $1::uuid, $2::uuid, $3::text
           )`,
          [
            invalidCase.resetOperationId,
            invalidCase.auditEventId,
            newPasswordHash,
          ],
        ),
        '22023',
        'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
      );
    }

    expect(await accountStateSnapshot(accountId)).toEqual(
      beforeInvalidArguments,
    );
  });

  it('rolls every effect back when a controlled audit failure occurs', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const recovery = await createRecovery(accountId);
    const other = await createRecovery(accountId, {
      requestState: 'PREPARED',
      attemptState: 'PREPARED',
    });
    const sessionId = await createSession(accountId);
    const operationId = randomUUID();
    await start(runtime, operationId, randomUUID(), recovery.hash!);
    await migrator.query(`
      CREATE FUNCTION public.f1b4523_controlled_audit_failure()
      RETURNS trigger LANGUAGE plpgsql AS $trigger$
      BEGIN
        IF NEW.operation_id = '${operationId}'::uuid THEN
          RAISE EXCEPTION USING MESSAGE = 'controlled audit failure', ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END
      $trigger$;
      CREATE TRIGGER f1b4523_controlled_audit_failure
      BEFORE INSERT ON public.audit_event
      FOR EACH ROW EXECUTE FUNCTION public.f1b4523_controlled_audit_failure();
    `);
    try {
      await expectDatabaseError(
        complete(runtime, operationId, randomUUID()),
        'P0001',
        'controlled audit failure',
      );
    } finally {
      await migrator.query(`
        DROP TRIGGER f1b4523_controlled_audit_failure ON public.audit_event;
        DROP FUNCTION public.f1b4523_controlled_audit_failure();
      `);
    }
    const evidence = await migrator.query(
      `SELECT credential.password_hash, credential.changed_operation_id,
              presented.consumed_at, other.invalidated_at,
              request.state AS request_state, attempt.state AS attempt_state,
              session.revoked_at, operation.state,
              (SELECT count(*)::integer FROM public.audit_event
               WHERE operation_id = $1) AS audit_count
       FROM public.password_credential AS credential
       JOIN public.password_reset_token AS presented
         ON presented.password_reset_token_id = $2
       JOIN public.password_reset_token AS other
         ON other.password_reset_token_id = $3
       JOIN public.password_recovery_request AS request
         ON request.recovery_request_id = $4
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.delivery_attempt_id = $5
       JOIN public.auth_session AS session ON session.id = $6
       JOIN public.password_reset_operation AS operation
         ON operation.reset_operation_id = $1
       WHERE credential.account_id = $7`,
      [
        operationId,
        recovery.tokenId,
        other.tokenId,
        other.requestId,
        other.attemptId,
        sessionId,
        accountId,
      ],
    );
    expect(evidence.rows).toEqual([
      {
        password_hash: oldPasswordHash,
        changed_operation_id: changedOperationId,
        consumed_at: null,
        invalidated_at: null,
        request_state: 'PREPARED',
        attempt_state: 'PREPARED',
        revoked_at: null,
        state: 'STARTED',
        audit_count: 0,
      },
    ]);
  });

  it('exposes only the hardened runtime function and preserves earlier operations', async () => {
    const metadata = await migrator.query<{
      configuration: string[];
      definition: string;
      owner: string;
      security_definer: boolean;
    }>(
      `SELECT owner.rolname AS owner,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS configuration,
              pg_catalog.pg_get_functiondef(procedure.oid) AS definition
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid =
         'public.complete_password_reset_operation(uuid,uuid,text)'::regprocedure`,
    );
    expect(metadata.rows).toEqual([
      expect.objectContaining({
        owner: 'bello_test_migrator',
        security_definer: true,
        configuration: ['search_path=pg_catalog, public, pg_temp'],
      }),
    ]);
    expect(metadata.rows[0]!.definition).not.toMatch(/\bEXECUTE\b/i);

    const privileges = await migrator.query(
      `SELECT
         pg_catalog.has_function_privilege(
           'bello_runtime',
           'public.complete_password_reset_operation(uuid,uuid,text)', 'EXECUTE'
         ) AS runtime_execute,
         pg_catalog.has_function_privilege(
           'bello_bootstrap_executor',
           'public.complete_password_reset_operation(uuid,uuid,text)', 'EXECUTE'
         ) AS bootstrap_execute,
         pg_catalog.has_function_privilege(
           'bello_audit_maintenance',
           'public.complete_password_reset_operation(uuid,uuid,text)', 'EXECUTE'
         ) AS maintenance_execute,
         pg_catalog.has_table_privilege(
           'bello_runtime', 'public.password_credential', 'UPDATE'
         ) AS runtime_update_credential,
         pg_catalog.has_table_privilege(
           'bello_runtime', 'public.password_reset_token', 'UPDATE'
         ) AS runtime_update_token,
         NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc AS procedure,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(procedure.proacl,
                    pg_catalog.acldefault('f', procedure.proowner))
                ) AS privilege
           WHERE procedure.oid =
             'public.complete_password_reset_operation(uuid,uuid,text)'::regprocedure
             AND privilege.grantee = 0
             AND privilege.privilege_type = 'EXECUTE'
         ) AS public_denied`,
    );
    expect(privileges.rows).toEqual([
      {
        runtime_execute: true,
        bootstrap_execute: false,
        maintenance_execute: false,
        runtime_update_credential: false,
        runtime_update_token: false,
        public_denied: true,
      },
    ]);
    const { accountId } = await createAccount();
    const recovery = await createRecovery(accountId);
    await expect(
      start(runtime, randomUUID(), randomUUID(), recovery.hash!),
    ).resolves.toEqual([{ account_id: accountId, state: 'STARTED' }]);
    await expect(
      runtime.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1::uuid)',
        [accountId],
      ),
    ).resolves.toBeDefined();
  });
});
