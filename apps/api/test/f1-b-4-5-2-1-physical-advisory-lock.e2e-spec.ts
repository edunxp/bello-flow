import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, DatabaseError } from 'pg';
import { deriveAccountAdvisoryLockKey } from '../src/auth/session-primitives.js';

const migrationNames = [
  '20261102000000_f1_a_1_identity_foundation',
  '20261102010000_f1_b_2_1_auth_session',
  '20261103000000_f1_b_3_3_2_failed_login_reconciliation',
  '20261104000000_f1_b_4_5_1_password_recovery_foundation',
  '20261105000000_f1_b_4_5_2_1_physical_advisory_lock',
] as const;
const physicalMigrationName = migrationNames.at(-1)!;
const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';
const positiveAccountId = '00000000-0000-4000-8000-000000000000';
const negativeAccountId = '00000000-0000-4000-8000-000000000003';

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
): Promise<DatabaseError> {
  try {
    await operation;
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
    return error as DatabaseError;
  }
}

async function createDisposableDatabase(
  admin: Client,
  database: string,
  provision: (
    admin: Client,
    database: string,
  ) => Promise<void> = provisionDisposableDatabase,
): Promise<void> {
  expect(process.env.BELLO_EPHEMERAL_TEST_DATABASE).toBe('true');
  expect(database).toMatch(/^bello_f1b4521_[a-z]+_[a-f0-9]{32}$/);
  await admin.query(`CREATE DATABASE "${database}" OWNER bello_test_migrator`);

  try {
    await provision(admin, database);
  } catch (provisionError) {
    try {
      await dropDisposableDatabase(admin, database);
    } catch (cleanupError) {
      throw new AggregateError(
        [provisionError, cleanupError],
        `Failed to provision and clean up disposable database ${database}`,
      );
    }
    throw provisionError;
  }
}

async function provisionDisposableDatabase(
  admin: Client,
  database: string,
): Promise<void> {
  await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
  await admin.query(
    `GRANT CONNECT ON DATABASE "${database}"
       TO bello_test_app, bello_test_migrator, bello_test_bootstrap,
          bello_test_audit_maintenance`,
  );
}

async function dropDisposableDatabase(
  admin: Client,
  database: string,
): Promise<void> {
  expect(database).toMatch(/^bello_f1b4521_[a-z]+_[a-f0-9]{32}$/);
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
}

async function prepareSchema(client: Client): Promise<void> {
  const identity = await client.query<{ database: string; user: string }>(
    'SELECT current_database() AS database, current_user AS "user"',
  );
  expect(identity.rows[0]?.database).toMatch(
    /^bello_f1b4521_[a-z]+_[a-f0-9]{32}$/,
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

async function applyMigrations(
  client: Client,
  names: readonly string[] = migrationNames,
): Promise<void> {
  for (const name of names) await client.query(await readMigration(name));
}

async function bootstrapAccount(
  bootstrap: Client,
  accountId: string,
  operationId: string,
): Promise<void> {
  const result = await bootstrap.query<{ outcome: string }>(
    `SELECT outcome
     FROM public.bootstrap_initial_admin(
       $1, $2, $3, $4, 'Ada', 'Lovelace', 'ada@example.com', $5,
       'operator', 'authorization', 'installation'
     )`,
    [operationId, accountId, randomUUID(), randomUUID(), validPasswordHash],
  );
  expect(result.rows).toEqual([{ outcome: 'COMPLETED' }]);
}

describe('F1-B.4.5.2.1 physical model and shared account advisory lock', () => {
  const admin = new Client({
    connectionString: requiredUrl('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b4521_main_${randomUUID().replaceAll('-', '')}`;
  let migrator: Client;
  let runtime: Client;
  let bootstrap: Client;
  let maintenance: Client;
  let accountId: string;
  let changedOperationId: string;
  let adminConnected = false;
  let databaseCreated = false;

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

    accountId = randomUUID();
    changedOperationId = randomUUID();
    await bootstrapAccount(bootstrap, accountId, changedOperationId);
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

  it('applies the incremental migration cleanly and preserves physical invariants', async () => {
    const operationId = randomUUID();
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = randomUUID();
    const startedAt = new Date('2026-11-05T12:00:00.000Z');

    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, 'PREPARED', $3, $3, NULL, 1, NULL)`,
      [requestId, accountId, startedAt],
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_delivery_attempt (
         delivery_attempt_id, recovery_request_id, attempt_number, state,
         scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
         accepted_at, terminal_at, failure_class, cancelled_operation_id
       ) VALUES ($1, $2, 1, 'PREPARED', $3, $4,
                 $3::timestamptz + INTERVAL '5 minutes', NULL, NULL, NULL,
                 NULL, NULL)`,
      [attemptId, requestId, startedAt, randomUUID()],
    );
    await migrator.query(
      `INSERT INTO public.password_reset_token (
         password_reset_token_id, delivery_attempt_id, account_id, token_hash,
         created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5,
                 $5::timestamptz + INTERVAL '30 minutes')`,
      [tokenId, attemptId, accountId, Buffer.alloc(32, 7), startedAt],
    );
    await migrator.query(
      `INSERT INTO public.password_reset_operation (
         reset_operation_id, account_id, password_reset_token_id,
         expected_changed_operation_id, state, started_at, updated_at, terminal_at
       ) VALUES ($1, $2, $3, $4, 'REJECTED', $5, $5, $5)`,
      [operationId, accountId, tokenId, changedOperationId, startedAt],
    );

    await expectDatabaseError(
      migrator.query(
        `UPDATE public.password_reset_operation
         SET terminal_at = NULL
         WHERE reset_operation_id = $1`,
        [operationId],
      ),
      '23514',
    );
    await expectDatabaseError(
      migrator.query(
        `UPDATE public.password_reset_operation
         SET state = 'STARTED'
         WHERE reset_operation_id = $1`,
        [operationId],
      ),
      '23514',
    );

    await migrator.query(
      `UPDATE public.password_recovery_delivery_attempt
       SET state = 'CANCELLED', terminal_at = $2,
           lease_id = NULL, lease_expires_at = NULL,
           cancelled_operation_id = $3
       WHERE delivery_attempt_id = $1`,
      [attemptId, startedAt, operationId],
    );
    await expectDatabaseError(
      migrator.query(
        `UPDATE public.password_recovery_delivery_attempt
         SET cancelled_operation_id = NULL
         WHERE delivery_attempt_id = $1`,
        [attemptId],
      ),
      '23514',
    );
    await expectDatabaseError(
      migrator.query(
        `INSERT INTO public.password_recovery_delivery_attempt (
           delivery_attempt_id, recovery_request_id, attempt_number, state,
           scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
           accepted_at, terminal_at, failure_class, cancelled_operation_id
         ) VALUES ($1, $2, 2, 'PREPARING', $3, $4,
                   $3::timestamptz + INTERVAL '5 minutes', NULL, NULL, NULL,
                   NULL, $5)`,
        [randomUUID(), requestId, startedAt, randomUUID(), operationId],
      ),
      '23514',
    );
    await expectDatabaseError(
      migrator.query(
        `UPDATE public.password_recovery_delivery_attempt
         SET cancelled_operation_id = '00000000-0000-3000-8000-000000000000'
         WHERE delivery_attempt_id = $1`,
        [attemptId],
      ),
      '23514',
    );

    const index = await migrator.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_catalog.pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'password_recovery_delivery_attempt_cancelled_operation_idx'`,
    );
    expect(index.rows).toEqual([
      {
        indexname: 'password_recovery_delivery_attempt_cancelled_operation_idx',
      },
    ]);
  });

  it('removes a disposable database after partial provisioning failure', async () => {
    const failedDatabase = `bello_f1b4521_partial_${randomUUID().replaceAll('-', '')}`;

    await expect(
      createDisposableDatabase(
        admin,
        failedDatabase,
        async (provisioningAdmin, provisioningDatabase) => {
          await provisioningAdmin.query(
            `REVOKE ALL ON DATABASE "${provisioningDatabase}" FROM PUBLIC`,
          );
          throw new Error('controlled provisioning failure');
        },
      ),
    ).rejects.toThrow('controlled provisioning failure');

    const evidence = await admin.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_database
         WHERE datname = $1
       ) AS exists`,
      [failedDatabase],
    );
    expect(evidence.rows).toEqual([{ exists: false }]);
  });

  it('rolls the whole migration back when an uncorrelated CANCELLED attempt exists', async () => {
    const rollbackDatabase = `bello_f1b4521_rollback_${randomUUID().replaceAll('-', '')}`;
    const rollbackMigrator = new Client({
      connectionString: urlForDatabase(
        'MIGRATION_DATABASE_URL',
        rollbackDatabase,
      ),
    });
    const rollbackBootstrap = new Client({
      connectionString: urlForDatabase(
        'BOOTSTRAP_DATABASE_URL',
        rollbackDatabase,
      ),
    });
    let rollbackDatabaseCreated = false;

    try {
      await createDisposableDatabase(admin, rollbackDatabase);
      rollbackDatabaseCreated = true;
      await rollbackMigrator.connect();
      await prepareSchema(rollbackMigrator);
      await applyMigrations(rollbackMigrator, migrationNames.slice(0, -1));
      await rollbackBootstrap.connect();
      const legacyAccountId = randomUUID();
      await bootstrapAccount(rollbackBootstrap, legacyAccountId, randomUUID());
      const requestId = randomUUID();
      const scheduledAt = new Date('2026-11-05T12:00:00.000Z');
      await rollbackMigrator.query(
        `INSERT INTO public.password_recovery_request (
           recovery_request_id, account_id, state, received_at, updated_at,
           terminal_at, current_attempt_number, cancelled_operation_id
         ) VALUES ($1, $2, 'PREPARED', $3, $3, NULL, 1, NULL)`,
        [requestId, legacyAccountId, scheduledAt],
      );
      await rollbackMigrator.query(
        `INSERT INTO public.password_recovery_delivery_attempt (
           delivery_attempt_id, recovery_request_id, attempt_number, state,
           scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
           accepted_at, terminal_at, failure_class
         ) VALUES ($1, $2, 1, 'CANCELLED', $3, NULL, NULL, NULL, NULL, $3, NULL)`,
        [randomUUID(), requestId, scheduledAt],
      );

      const error = await expectDatabaseError(
        rollbackMigrator.query(await readMigration(physicalMigrationName)),
        'P0001',
      );
      expect(error.message).toContain(
        'BF_PASSWORD_RECOVERY_CANCELLED_ATTEMPT_CORRELATION_REQUIRED',
      );
      await rollbackMigrator.query('ROLLBACK');

      const evidence = await rollbackMigrator.query<{
        cancelled_column: number;
        rejected_allowed: boolean;
        lock_function: string | null;
      }>(`
        SELECT
          (SELECT count(*)::integer
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'password_recovery_delivery_attempt'
             AND column_name = 'cancelled_operation_id') AS cancelled_column,
          pg_catalog.pg_get_constraintdef(oid) LIKE '%REJECTED%'
            AS rejected_allowed,
          pg_catalog.to_regprocedure(
            'public.acquire_auth_account_advisory_xact_lock(uuid)'
          )::text AS lock_function
        FROM pg_catalog.pg_constraint
        WHERE conname = 'password_reset_operation_state_check'
      `);
      expect(evidence.rows).toEqual([
        {
          cancelled_column: 0,
          rejected_allowed: false,
          lock_function: null,
        },
      ]);
    } finally {
      await rollbackBootstrap.end().catch(() => undefined);
      await rollbackMigrator.end().catch(() => undefined);
      if (rollbackDatabaseCreated) {
        await dropDisposableDatabase(admin, rollbackDatabase);
      }
    }
  });

  it.each([
    [positiveAccountId, 5_305_774_703_633_831_484n],
    [negativeAccountId, -9_219_222_644_233_059_831n],
  ])('matches the TypeScript signed key for %s', async (id, expected) => {
    const result = await migrator.query<{ key: string }>(
      'SELECT public.auth_account_advisory_lock_key($1::uuid)::text AS key',
      [id],
    );
    expect(BigInt(result.rows[0]!.key)).toBe(expected);
    expect(BigInt(result.rows[0]!.key)).toBe(deriveAccountAdvisoryLockKey(id));
  });

  it('rejects NULL, non-v4 and invalid-variant UUIDs before acquiring a lock', async () => {
    await expectDatabaseError(
      migrator.query(
        'SELECT public.auth_account_advisory_lock_key(NULL::uuid)',
      ),
      '22023',
    );
    await expectDatabaseError(
      migrator.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock(NULL::uuid)',
      ),
      '22023',
    );
    await expectDatabaseError(
      migrator.query(
        `SELECT public.acquire_auth_account_advisory_xact_lock(
           '00000000-0000-3000-8000-000000000000'::uuid
         )`,
      ),
      '22023',
    );
    await expectDatabaseError(
      migrator.query(
        `SELECT public.acquire_auth_account_advisory_xact_lock(
           '00000000-0000-4000-7000-000000000000'::uuid
         )`,
      ),
      '22023',
    );
  });

  it('uses hardened SECURITY DEFINER metadata and least-privilege grants', async () => {
    const metadata = await migrator.query<{
      name: string;
      owner: string;
      security_definer: boolean;
      configuration: string[];
      definition: string;
    }>(`
      SELECT
        procedure.proname AS name,
        owner.rolname AS owner,
        procedure.prosecdef AS security_definer,
        procedure.proconfig AS configuration,
        pg_catalog.pg_get_functiondef(procedure.oid) AS definition
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname IN (
          'auth_account_advisory_lock_key',
          'acquire_auth_account_advisory_xact_lock'
        )
      ORDER BY procedure.proname
    `);
    expect(metadata.rows).toHaveLength(2);
    for (const row of metadata.rows) {
      expect(row).toMatchObject({
        owner: 'bello_test_migrator',
        security_definer: true,
        configuration: ['search_path=pg_catalog, public, pg_temp'],
      });
      expect(row.definition).not.toMatch(/\bEXECUTE\b/i);
    }

    const privileges = await migrator.query<{
      runtime_helper: boolean;
      runtime_acquire: boolean;
      bootstrap_helper: boolean;
      bootstrap_acquire: boolean;
      maintenance_helper: boolean;
      maintenance_acquire: boolean;
      public_helper: boolean;
      public_acquire: boolean;
    }>(`
      SELECT
        pg_catalog.has_function_privilege(
          'bello_runtime', 'public.auth_account_advisory_lock_key(uuid)', 'EXECUTE'
        ) AS runtime_helper,
        pg_catalog.has_function_privilege(
          'bello_runtime', 'public.acquire_auth_account_advisory_xact_lock(uuid)', 'EXECUTE'
        ) AS runtime_acquire,
        pg_catalog.has_function_privilege(
          'bello_bootstrap_executor', 'public.auth_account_advisory_lock_key(uuid)', 'EXECUTE'
        ) AS bootstrap_helper,
        pg_catalog.has_function_privilege(
          'bello_bootstrap_executor', 'public.acquire_auth_account_advisory_xact_lock(uuid)', 'EXECUTE'
        ) AS bootstrap_acquire,
        pg_catalog.has_function_privilege(
          'bello_audit_maintenance', 'public.auth_account_advisory_lock_key(uuid)', 'EXECUTE'
        ) AS maintenance_helper,
        pg_catalog.has_function_privilege(
          'bello_audit_maintenance', 'public.acquire_auth_account_advisory_xact_lock(uuid)', 'EXECUTE'
        ) AS maintenance_acquire,
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS procedure,
               LATERAL pg_catalog.aclexplode(
                 COALESCE(
                   procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner)
                 )
               ) AS privilege
          WHERE procedure.oid =
            'public.auth_account_advisory_lock_key(uuid)'::regprocedure
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ) AS public_helper,
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS procedure,
               LATERAL pg_catalog.aclexplode(
                 COALESCE(
                   procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner)
                 )
               ) AS privilege
          WHERE procedure.oid =
            'public.acquire_auth_account_advisory_xact_lock(uuid)'::regprocedure
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ) AS public_acquire
    `);
    expect(privileges.rows[0]).toEqual({
      runtime_helper: false,
      runtime_acquire: true,
      bootstrap_helper: false,
      bootstrap_acquire: false,
      maintenance_helper: false,
      maintenance_acquire: false,
      public_helper: true,
      public_acquire: true,
    });

    const overloads = await migrator.query<{
      helper_bigint: string | null;
      acquire_bigint: string | null;
    }>(`
      SELECT
        pg_catalog.to_regprocedure(
          'public.auth_account_advisory_lock_key(bigint)'
        )::text AS helper_bigint,
        pg_catalog.to_regprocedure(
          'public.acquire_auth_account_advisory_xact_lock(bigint)'
        )::text AS acquire_bigint
    `);
    expect(overloads.rows).toEqual([
      { helper_bigint: null, acquire_bigint: null },
    ]);

    await expectDatabaseError(
      runtime.query('SELECT public.auth_account_advisory_lock_key($1::uuid)', [
        accountId,
      ]),
      '42501',
    );
    await expect(
      runtime.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1::uuid)',
        [accountId],
      ),
    ).resolves.toBeDefined();
  });

  it('does not allow pg_temp shadowing of the internal derivation', async () => {
    const probe = new Client({
      connectionString: urlForDatabase('MIGRATION_DATABASE_URL', database),
    });
    await probe.connect();
    try {
      await migrator.query('BEGIN');
      await migrator.query(`
        CREATE FUNCTION pg_temp.auth_account_advisory_lock_key(UUID)
        RETURNS BIGINT
        LANGUAGE sql
        IMMUTABLE
        AS 'SELECT 1::bigint'
      `);
      await migrator.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1::uuid)',
        [accountId],
      );
      const locked = await probe.query<{ acquired: boolean }>(
        'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [deriveAccountAdvisoryLockKey(accountId)],
      );
      expect(locked.rows).toEqual([{ acquired: false }]);
    } finally {
      await migrator.query('ROLLBACK');
      await probe.end();
    }
  });

  it('serializes old and new acquisition in both directions with timeout', async () => {
    const oldClient = new Client({
      connectionString: urlForDatabase('MIGRATION_DATABASE_URL', database),
    });
    const newClient = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    await Promise.all([oldClient.connect(), newClient.connect()]);
    const key = deriveAccountAdvisoryLockKey(accountId);

    try {
      await oldClient.query('BEGIN');
      await oldClient.query(
        'SELECT pg_catalog.pg_advisory_xact_lock($1::bigint)',
        [key],
      );
      await newClient.query('BEGIN');
      await newClient.query("SET LOCAL lock_timeout = '250ms'");
      await expectDatabaseError(
        newClient.query(
          'SELECT public.acquire_auth_account_advisory_xact_lock($1::uuid)',
          [accountId],
        ),
        '55P03',
      );
      await newClient.query('ROLLBACK');
      await oldClient.query('COMMIT');

      await newClient.query('BEGIN');
      await newClient.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1::uuid)',
        [accountId],
      );
      await oldClient.query('BEGIN');
      const blocked = await oldClient.query<{ acquired: boolean }>(
        'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [key],
      );
      expect(blocked.rows).toEqual([{ acquired: false }]);
      await oldClient.query('ROLLBACK');
      await newClient.query('ROLLBACK');

      await oldClient.query('BEGIN');
      const released = await oldClient.query<{ acquired: boolean }>(
        'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [key],
      );
      expect(released.rows).toEqual([{ acquired: true }]);
      await oldClient.query('ROLLBACK');
    } finally {
      await oldClient.query('ROLLBACK').catch(() => undefined);
      await newClient.query('ROLLBACK').catch(() => undefined);
      await Promise.all([oldClient.end(), newClient.end()]);
    }
  });

  it('keeps independent accounts concurrent and releases locks after commit', async () => {
    const first = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    const second = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    const probe = new Client({
      connectionString: urlForDatabase('MIGRATION_DATABASE_URL', database),
    });
    await Promise.all([first.connect(), second.connect(), probe.connect()]);
    const otherAccountId = randomUUID();

    try {
      await first.query('BEGIN');
      await first.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1::uuid)',
        [accountId],
      );
      await second.query('BEGIN');
      await second.query("SET LOCAL lock_timeout = '250ms'");
      await expect(
        second.query(
          'SELECT public.acquire_auth_account_advisory_xact_lock($1::uuid)',
          [otherAccountId],
        ),
      ).resolves.toBeDefined();
      await second.query('COMMIT');
      await first.query('COMMIT');

      await probe.query('BEGIN');
      const released = await probe.query<{ acquired: boolean }>(
        'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [deriveAccountAdvisoryLockKey(accountId)],
      );
      expect(released.rows).toEqual([{ acquired: true }]);
      await probe.query('ROLLBACK');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      await probe.query('ROLLBACK').catch(() => undefined);
      await Promise.all([first.end(), second.end(), probe.end()]);
    }
  });
});
