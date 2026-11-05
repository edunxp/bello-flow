import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, DatabaseError } from 'pg';
import { deriveAccountAdvisoryLockKey } from '../src/auth/session-primitives.js';

const migrationNames = [
  '20261102000000_f1_a_1_identity_foundation',
  '20261102010000_f1_b_2_1_auth_session',
  '20261103000000_f1_b_3_3_2_failed_login_reconciliation',
  '20261104000000_f1_b_4_5_1_password_recovery_foundation',
  '20261105000000_f1_b_4_5_2_1_physical_advisory_lock',
  '20261106000000_f1_b_4_5_2_2_start_password_reset',
] as const;
const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

type AccountOptions = {
  credential?: boolean;
  emailVerified?: boolean;
  status?: 'ACTIVE' | 'INACTIVE';
  deactivated?: boolean;
};

type TokenOptions = {
  consumed?: boolean;
  expired?: boolean;
  invalidated?: boolean;
  requestAccountId?: string;
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
  expect(database).toMatch(/^bello_f1b4522_[a-z]+_[a-f0-9]{32}$/);
  await admin.query(`CREATE DATABASE "${database}" OWNER bello_test_migrator`);
  try {
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE "${database}"
         TO bello_test_app, bello_test_migrator, bello_test_bootstrap,
            bello_test_audit_maintenance`,
    );
  } catch (provisionError) {
    try {
      await dropDisposableDatabase(admin, database);
    } catch (cleanupError) {
      throw new AggregateError([provisionError, cleanupError]);
    }
    throw provisionError;
  }
}

async function dropDisposableDatabase(
  admin: Client,
  database: string,
): Promise<void> {
  expect(database).toMatch(/^bello_f1b4522_[a-z]+_[a-f0-9]{32}$/);
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
}

async function prepareSchema(client: Client): Promise<void> {
  const identity = await client.query<{ database: string; user: string }>(
    'SELECT current_database() AS database, current_user AS "user"',
  );
  expect(identity.rows[0]?.database).toMatch(
    /^bello_f1b4522_[a-z]+_[a-f0-9]{32}$/,
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

async function applyMigrations(client: Client): Promise<void> {
  for (const name of migrationNames) {
    await client.query(await readMigration(name));
  }
}

describe('F1-B.4.5.2.2 start password reset operation', () => {
  const admin = new Client({
    connectionString: requiredUrl('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b4522_main_${randomUUID().replaceAll('-', '')}`;
  let migrator: Client;
  let runtime: Client;
  let bootstrap: Client;
  let maintenance: Client;
  let adminConnected = false;
  let databaseCreated = false;

  async function createAccount(options: AccountOptions = {}): Promise<{
    accountId: string;
    changedOperationId?: string;
  }> {
    const accountId = randomUUID();
    const changedOperationId =
      options.credential === false ? undefined : randomUUID();
    const now = new Date();
    const email = `${accountId.replaceAll('-', '')}@example.test`;
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES ($1, 'Test', 'Account', $2, $2,
                 CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,
                 $5, $4,
                 CASE WHEN $6 THEN $4::timestamptz ELSE NULL END)`,
      [
        accountId,
        email,
        options.emailVerified !== false,
        now,
        options.status ?? 'ACTIVE',
        options.deactivated === true,
      ],
    );
    if (changedOperationId) {
      await migrator.query(
        `INSERT INTO public.password_credential (
           account_id, password_hash, changed_at, changed_operation_id
         ) VALUES ($1, $2, $3, $4)`,
        [accountId, validPasswordHash, now, changedOperationId],
      );
    }
    return { accountId, changedOperationId };
  }

  async function createToken(
    accountId: string,
    options: TokenOptions = {},
  ): Promise<{ hash: Buffer; tokenId: string }> {
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = randomUUID();
    const hash = randomBytes(32);
    const createdAt = new Date(
      Date.now() - (options.expired === true ? 31 * 60_000 : 60_000),
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, 'SENT', $3, $3, $3, 1, NULL)`,
      [requestId, options.requestAccountId ?? accountId, createdAt],
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
         created_at, expires_at, consumed_at, consumed_operation_id,
         invalidated_at, invalidated_operation_id
       ) VALUES (
         $1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '30 minutes',
         CASE WHEN $6 THEN $5::timestamptz ELSE NULL END,
         CASE WHEN $6 THEN $8::uuid ELSE NULL END,
         CASE WHEN $7 THEN $5::timestamptz ELSE NULL END,
         CASE WHEN $7 THEN $9::uuid ELSE NULL END
       )`,
      [
        tokenId,
        attemptId,
        accountId,
        hash,
        createdAt,
        options.consumed === true,
        options.invalidated === true,
        randomUUID(),
        randomUUID(),
      ],
    );
    return { hash, tokenId };
  }

  async function createSession(accountId: string): Promise<void> {
    const createdAt = new Date(Date.now() - 60_000);
    await migrator.query(
      `INSERT INTO public.auth_session (
         id, account_id, token_hash, created_at, last_activity_at,
         absolute_expires_at, created_operation_id, revoked_at,
         revocation_reason, revoked_operation_id
       ) VALUES ($1, $2, $3, $4, $4,
                 $4::timestamptz + INTERVAL '168 hours', $5,
                 NULL, NULL, NULL)`,
      [randomUUID(), accountId, randomBytes(32), createdAt, randomUUID()],
    );
  }

  async function start(
    client: Client,
    operationId: string,
    auditEventId: string,
    hash: Buffer,
  ): Promise<Array<{ account_id: string; state: string }>> {
    const result = await client.query<{ account_id: string; state: string }>(
      `SELECT account_id, state
       FROM public.start_password_reset_operation($1, $2, $3)`,
      [operationId, auditEventId, hash],
    );
    return result.rows;
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
    await applyMigrations(migrator);

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
      migrator?.end().catch(() => undefined),
      bootstrap?.end().catch(() => undefined),
      maintenance?.end().catch(() => undefined),
    ]);
    if (adminConnected && databaseCreated) {
      await dropDisposableDatabase(admin, database);
    }
    if (adminConnected) await admin.end();
  });

  it('persists a valid STARTED intention without changing token or credential', async () => {
    const { accountId, changedOperationId } = await createAccount();
    const { hash, tokenId } = await createToken(accountId);
    const operationId = randomUUID();

    await expect(
      start(runtime, operationId, randomUUID(), hash),
    ).resolves.toEqual([{ account_id: accountId, state: 'STARTED' }]);

    const evidence = await migrator.query(
      `SELECT operation.account_id, operation.password_reset_token_id,
              operation.expected_changed_operation_id, operation.state,
              operation.terminal_at,
              token.consumed_at, token.invalidated_at,
              credential.changed_operation_id,
              (SELECT count(*)::integer FROM public.audit_event AS event
               WHERE event.operation_id = $1) AS audit_count
       FROM public.password_reset_operation AS operation
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = operation.password_reset_token_id
       JOIN public.password_credential AS credential
         ON credential.account_id = operation.account_id
       WHERE operation.reset_operation_id = $1`,
      [operationId],
    );
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        account_id: accountId,
        password_reset_token_id: tokenId,
        expected_changed_operation_id: changedOperationId,
        state: 'STARTED',
        terminal_at: null,
        consumed_at: null,
        invalidated_at: null,
        changed_operation_id: changedOperationId,
        audit_count: 0,
      }),
    ]);
    await expectDatabaseError(
      migrator.query(
        `DELETE FROM public.password_reset_token
         WHERE password_reset_token_id = $1`,
        [tokenId],
      ),
      '23001',
    );
  });

  it('returns no row and persists nothing for an unresolved token hash', async () => {
    const operationId = randomUUID();
    await expect(
      start(runtime, operationId, randomUUID(), randomBytes(32)),
    ).resolves.toEqual([]);
    const evidence = await migrator.query<{ count: number }>(
      `SELECT
         (SELECT count(*)::integer FROM public.password_reset_operation
          WHERE reset_operation_id = $1)
         +
         (SELECT count(*)::integer FROM public.audit_event
          WHERE operation_id = $1) AS count`,
      [operationId],
    );
    expect(evidence.rows).toEqual([{ count: 0 }]);
  });

  it.each([
    ['expired', { expired: true }],
    ['consumed', { consumed: true }],
    ['invalidated', { invalidated: true }],
  ] as const)(
    'persists an audited REJECTED result for a %s token',
    async (_name, options) => {
      const { accountId } = await createAccount();
      const { hash } = await createToken(accountId, options);
      const operationId = randomUUID();
      const auditEventId = randomUUID();

      await expect(
        start(runtime, operationId, auditEventId, hash),
      ).resolves.toEqual([{ account_id: accountId, state: 'REJECTED' }]);
      await expect(
        start(runtime, operationId, auditEventId, hash),
      ).resolves.toEqual([{ account_id: accountId, state: 'REJECTED' }]);
      await expectDatabaseError(
        runtime.query(
          'SELECT * FROM public.start_password_reset_operation($1, $2, $3)',
          [operationId, randomUUID(), hash],
        ),
        'P0001',
        'BF_PASSWORD_RESET_REJECTION_EVIDENCE_INCONSISTENT',
      );
      const evidence = await migrator.query(
        `SELECT operation.state, operation.terminal_at IS NOT NULL AS terminal,
              event.id, event.operation, event.result, event.context,
              event.before_data, event.after_data
       FROM public.password_reset_operation AS operation
       JOIN public.audit_event AS event
         ON event.operation_id = operation.reset_operation_id
        AND event.sequence = 1
       WHERE operation.reset_operation_id = $1`,
        [operationId],
      );
      expect(evidence.rows).toEqual([
        {
          state: 'REJECTED',
          terminal: true,
          id: auditEventId,
          operation: 'AUTH_PASSWORD_RESET_REJECTED',
          result: 'DENIED',
          context: {
            reason: 'PASSWORD_RESET',
            revoked_session_count: 0,
            invalidated_token_count: 0,
            cancelled_request_count: 0,
            cancelled_attempt_count: 0,
          },
          before_data: null,
          after_data: null,
        },
      ]);
    },
  );

  it('rejects an ineligible account with a credential and zero success effects', async () => {
    const { accountId, changedOperationId } = await createAccount({
      status: 'INACTIVE',
    });
    const { hash } = await createToken(accountId);
    await createSession(accountId);
    const operationId = randomUUID();
    await expect(
      start(runtime, operationId, randomUUID(), hash),
    ).resolves.toEqual([{ account_id: accountId, state: 'REJECTED' }]);
    const evidence = await migrator.query(
      `SELECT credential.changed_operation_id, token.consumed_at,
              token.invalidated_at,
              (SELECT count(*)::integer FROM public.auth_session AS session
               WHERE session.account_id = $1 AND session.revoked_at IS NOT NULL)
                AS revoked_sessions
       FROM public.password_credential AS credential
       JOIN public.password_reset_token AS token ON token.account_id = $1
       WHERE credential.account_id = $1`,
      [accountId],
    );
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        changed_operation_id: changedOperationId,
        consumed_at: null,
        invalidated_at: null,
        revoked_sessions: 0,
      }),
    ]);
  });

  it('fails closed without any mutation when the known account has no credential', async () => {
    const { accountId } = await createAccount({ credential: false });
    const { hash, tokenId } = await createToken(accountId);
    await createSession(accountId);
    const operationId = randomUUID();
    const before = await migrator.query(
      `SELECT account.status, account.email_verified_at,
              token.consumed_at, token.invalidated_at,
              request.state AS request_state, attempt.state AS attempt_state,
              (SELECT count(*)::integer FROM public.password_reset_operation
               WHERE account_id = $1) AS operation_count,
              (SELECT count(*)::integer FROM public.audit_event
               WHERE actor_account_id = $1) AS audit_count,
              (SELECT count(*)::integer FROM public.auth_session
               WHERE account_id = $1) AS session_count,
              (SELECT count(*)::integer FROM public.auth_session
               WHERE account_id = $1 AND revoked_at IS NOT NULL)
                AS revoked_session_count
       FROM public.account AS account
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = $2
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.delivery_attempt_id = token.delivery_attempt_id
       JOIN public.password_recovery_request AS request
         ON request.recovery_request_id = attempt.recovery_request_id
       WHERE account.id = $1`,
      [accountId, tokenId],
    );

    await expectDatabaseError(
      runtime.query(
        'SELECT * FROM public.start_password_reset_operation($1, $2, $3)',
        [operationId, randomUUID(), hash],
      ),
      'P0001',
      'BF_PASSWORD_RESET_CREDENTIAL_MISSING',
    );

    const after = await migrator.query(
      `SELECT account.status, account.email_verified_at,
              token.consumed_at, token.invalidated_at,
              request.state AS request_state, attempt.state AS attempt_state,
              (SELECT count(*)::integer FROM public.password_reset_operation
               WHERE account_id = $1) AS operation_count,
              (SELECT count(*)::integer FROM public.audit_event
               WHERE actor_account_id = $1) AS audit_count,
              (SELECT count(*)::integer FROM public.auth_session
               WHERE account_id = $1) AS session_count,
              (SELECT count(*)::integer FROM public.auth_session
               WHERE account_id = $1 AND revoked_at IS NOT NULL)
                AS revoked_session_count
       FROM public.account AS account
       JOIN public.password_reset_token AS token
         ON token.password_reset_token_id = $2
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.delivery_attempt_id = token.delivery_attempt_id
       JOIN public.password_recovery_request AS request
         ON request.recovery_request_id = attempt.recovery_request_id
       WHERE account.id = $1`,
      [accountId, tokenId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('is idempotent for the same operation and rejects a contradictory binding', async () => {
    const { accountId } = await createAccount();
    const firstToken = await createToken(accountId);
    const secondToken = await createToken(accountId);
    const operationId = randomUUID();
    const auditEventId = randomUUID();

    const expected = [{ account_id: accountId, state: 'STARTED' }];
    await expect(
      start(runtime, operationId, auditEventId, firstToken.hash),
    ).resolves.toEqual(expected);
    await expect(
      start(runtime, operationId, auditEventId, firstToken.hash),
    ).resolves.toEqual(expected);
    await expectDatabaseError(
      runtime.query(
        'SELECT * FROM public.start_password_reset_operation($1, $2, $3)',
        [operationId, auditEventId, secondToken.hash],
      ),
      '22023',
      'BF_PASSWORD_RESET_OPERATION_BINDING_MISMATCH',
    );
    const count = await migrator.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.password_reset_operation
       WHERE reset_operation_id = $1`,
      [operationId],
    );
    expect(count.rows).toEqual([{ count: 1 }]);

    await migrator.query(
      `UPDATE public.password_reset_operation
       SET state = 'COMPLETED', terminal_at = updated_at
       WHERE reset_operation_id = $1`,
      [operationId],
    );
    await expectDatabaseError(
      runtime.query(
        'SELECT * FROM public.start_password_reset_operation($1, $2, $3)',
        [operationId, auditEventId, firstToken.hash],
      ),
      'P0001',
      'BF_PASSWORD_RESET_RECONCILIATION_REQUIRED',
    );
  });

  it('serializes concurrent starts for one token and rejects the losing operation', async () => {
    const { accountId } = await createAccount();
    const { hash } = await createToken(accountId);
    const first = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    const secondApplicationName = `f1b4522-${randomUUID()}`;
    const secondUrl = new URL(urlForDatabase('DATABASE_URL', database));
    secondUrl.searchParams.set('application_name', secondApplicationName);
    const second = new Client({ connectionString: secondUrl.toString() });
    await Promise.all([first.connect(), second.connect()]);
    const firstOperationId = randomUUID();
    const secondOperationId = randomUUID();
    try {
      await first.query('BEGIN');
      await start(first, firstOperationId, randomUUID(), hash);
      const secondStart = start(second, secondOperationId, randomUUID(), hash);

      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await admin.query<{ blocked: boolean }>(
          `SELECT COALESCE(
             pg_catalog.bool_or(wait_event_type = 'Lock' AND wait_event = 'advisory'),
             FALSE
           ) AS blocked
           FROM pg_catalog.pg_stat_activity
           WHERE application_name = $1`,
          [secondApplicationName],
        );
        blocked = activity.rows[0]?.blocked === true;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await first.query('COMMIT');
      await expect(secondStart).resolves.toEqual([
        { account_id: accountId, state: 'REJECTED' },
      ]);

      const states = await migrator.query<{ state: string; count: number }>(
        `SELECT state, count(*)::integer AS count
         FROM public.password_reset_operation
         WHERE reset_operation_id IN ($1, $2)
         GROUP BY state
         ORDER BY state`,
        [firstOperationId, secondOperationId],
      );
      expect(states.rows).toEqual([
        { state: 'REJECTED', count: 1 },
        { state: 'STARTED', count: 1 },
      ]);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('rolls back the marker and releases the account advisory lock', async () => {
    const { accountId } = await createAccount();
    const { hash } = await createToken(accountId);
    const operationId = randomUUID();
    const probe = new Client({
      connectionString: urlForDatabase('MIGRATION_DATABASE_URL', database),
    });
    await probe.connect();
    try {
      await runtime.query('BEGIN');
      await start(runtime, operationId, randomUUID(), hash);
      const locked = await probe.query<{ acquired: boolean }>(
        'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [deriveAccountAdvisoryLockKey(accountId)],
      );
      expect(locked.rows).toEqual([{ acquired: false }]);
      await runtime.query('ROLLBACK');
      const released = await probe.query<{ acquired: boolean }>(
        'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [deriveAccountAdvisoryLockKey(accountId)],
      );
      expect(released.rows).toEqual([{ acquired: true }]);
      const count = await migrator.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM public.password_reset_operation
         WHERE reset_operation_id = $1`,
        [operationId],
      );
      expect(count.rows).toEqual([{ count: 0 }]);
    } finally {
      await runtime.query('ROLLBACK').catch(() => undefined);
      await probe.query('ROLLBACK').catch(() => undefined);
      await probe.end();
    }
  });

  it('fails without a marker when the token/request account graph is inconsistent', async () => {
    const first = await createAccount();
    const second = await createAccount();
    const { hash } = await createToken(first.accountId, {
      requestAccountId: second.accountId,
    });
    const operationId = randomUUID();
    await expectDatabaseError(
      runtime.query(
        'SELECT * FROM public.start_password_reset_operation($1, $2, $3)',
        [operationId, randomUUID(), hash],
      ),
      'P0001',
      'BF_PASSWORD_RESET_TOKEN_GRAPH_INCONSISTENT',
    );
    const count = await migrator.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.password_reset_operation
       WHERE reset_operation_id = $1`,
      [operationId],
    );
    expect(count.rows).toEqual([{ count: 0 }]);
  });

  it('validates identifiers and token hash before effects', async () => {
    await expectDatabaseError(
      runtime.query(
        'SELECT * FROM public.start_password_reset_operation(NULL, $1, $2)',
        [randomUUID(), randomBytes(32)],
      ),
      '22023',
      'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
    );
    await expectDatabaseError(
      runtime.query(
        `SELECT * FROM public.start_password_reset_operation(
           '00000000-0000-3000-8000-000000000000', $1, $2
         )`,
        [randomUUID(), randomBytes(32)],
      ),
      '22023',
      'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
    );
    await expectDatabaseError(
      runtime.query(
        'SELECT * FROM public.start_password_reset_operation($1, $2, $3)',
        [randomUUID(), randomUUID(), randomBytes(31)],
      ),
      '22023',
      'BF_PASSWORD_RESET_INVALID_ARGUMENTS',
    );
  });

  it('uses hardened SECURITY DEFINER metadata, grants and qualified lock acquisition', async () => {
    const metadata = await migrator.query<{
      owner: string;
      security_definer: boolean;
      configuration: string[];
      definition: string;
    }>(
      `SELECT owner.rolname AS owner,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS configuration,
              pg_catalog.pg_get_functiondef(procedure.oid) AS definition
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid =
         'public.start_password_reset_operation(uuid,uuid,bytea)'::regprocedure`,
    );
    expect(metadata.rows).toEqual([
      expect.objectContaining({
        owner: 'bello_test_migrator',
        security_definer: true,
        configuration: ['search_path=pg_catalog, public, pg_temp'],
      }),
    ]);
    expect(metadata.rows[0]!.definition).not.toMatch(/\bEXECUTE\b/i);
    expect(metadata.rows[0]!.definition).toContain(
      'public.acquire_auth_account_advisory_xact_lock',
    );

    const privileges = await migrator.query(
      `SELECT
         pg_catalog.has_function_privilege(
           'bello_runtime',
           'public.start_password_reset_operation(uuid,uuid,bytea)', 'EXECUTE'
         ) AS runtime_execute,
         pg_catalog.has_function_privilege(
           'bello_bootstrap_executor',
           'public.start_password_reset_operation(uuid,uuid,bytea)', 'EXECUTE'
         ) AS bootstrap_execute,
         pg_catalog.has_function_privilege(
           'bello_audit_maintenance',
           'public.start_password_reset_operation(uuid,uuid,bytea)', 'EXECUTE'
         ) AS maintenance_execute,
         pg_catalog.has_table_privilege(
           'bello_runtime', 'public.password_reset_operation', 'INSERT'
         ) AS runtime_insert_marker,
         pg_catalog.has_table_privilege(
           'bello_runtime', 'public.audit_event', 'INSERT'
         ) AS runtime_insert_audit,
         NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc AS procedure,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(procedure.proacl,
                    pg_catalog.acldefault('f', procedure.proowner))
                ) AS privilege
           WHERE procedure.oid =
             'public.start_password_reset_operation(uuid,uuid,bytea)'::regprocedure
             AND privilege.grantee = 0
             AND privilege.privilege_type = 'EXECUTE'
         ) AS public_denied`,
    );
    expect(privileges.rows).toEqual([
      {
        runtime_execute: true,
        bootstrap_execute: false,
        maintenance_execute: false,
        runtime_insert_marker: false,
        runtime_insert_audit: false,
        public_denied: true,
      },
    ]);

    const { accountId } = await createAccount();
    const { hash } = await createToken(accountId);
    const probe = new Client({
      connectionString: urlForDatabase('MIGRATION_DATABASE_URL', database),
    });
    await probe.connect();
    try {
      await migrator.query('BEGIN');
      await migrator.query(`
        CREATE FUNCTION pg_temp.acquire_auth_account_advisory_xact_lock(UUID)
        RETURNS VOID LANGUAGE plpgsql AS 'BEGIN NULL; END'
      `);
      await start(migrator, randomUUID(), randomUUID(), hash);
      const locked = await probe.query<{ acquired: boolean }>(
        'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [deriveAccountAdvisoryLockKey(accountId)],
      );
      expect(locked.rows).toEqual([{ acquired: false }]);
    } finally {
      await migrator.query('ROLLBACK').catch(() => undefined);
      await probe.end();
    }
  });
});
