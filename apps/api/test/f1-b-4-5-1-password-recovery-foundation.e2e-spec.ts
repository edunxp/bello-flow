import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, DatabaseError } from 'pg';

const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

const historicalMigrationNames = [
  '20261102000000_f1_a_1_identity_foundation',
  '20261102010000_f1_b_2_1_auth_session',
  '20261103000000_f1_b_3_3_2_failed_login_reconciliation',
] as const;
const foundationMigrationName =
  '20261104000000_f1_b_4_5_1_password_recovery_foundation';

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function clientFor(name: string): Client {
  return new Client({ connectionString: requiredUrl(name) });
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
  }
}

async function readMigration(name: string): Promise<string> {
  return readFile(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  );
}

async function applyHistoricalMigrations(client: Client): Promise<void> {
  for (const name of historicalMigrationNames) {
    await client.query(await readMigration(name));
  }
}

async function callBootstrap(client: Client, operationId = randomUUID()) {
  const accountId = randomUUID();
  const result = await client.query<{
    outcome: string;
    created_account_id: string;
    completed_operation_id: string;
  }>(
    `SELECT *
     FROM public.bootstrap_initial_admin(
       $1, $2, $3, $4, 'Ada', 'Lovelace', 'ada@example.com', $5,
       'operator', 'authorization', 'installation'
     )`,
    [operationId, accountId, randomUUID(), randomUUID(), validPasswordHash],
  );
  return { accountId, operationId, result: result.rows[0] };
}

describe('F1-B.4.5.1 password recovery PostgreSQL foundation', () => {
  const runtime = clientFor('DATABASE_URL');
  const migrator = clientFor('MIGRATION_DATABASE_URL');
  const bootstrap = clientFor('BOOTSTRAP_DATABASE_URL');
  const maintenance = clientFor('MAINTENANCE_DATABASE_URL');
  const admin = clientFor('ADMIN_TEST_DATABASE_URL');
  let accountId: string;
  let bootstrapOperationId: string;

  async function resetSharedData(): Promise<void> {
    if (process.env.BELLO_EPHEMERAL_TEST_DATABASE !== 'true') {
      throw new Error('F1-B.4.5.1 requires an explicitly ephemeral database');
    }
    const identity = await migrator.query<{ database: string; user: string }>(
      'SELECT current_database() AS database, current_user AS "user"',
    );
    expect(identity.rows[0]).toEqual({
      database: 'bello_test',
      user: 'bello_test_migrator',
    });

    await migrator.query('BEGIN');
    try {
      await migrator.query('DELETE FROM public.password_reset_operation');
      await migrator.query('DELETE FROM public.password_reset_token');
      await migrator.query(
        'DELETE FROM public.password_recovery_delivery_attempt',
      );
      await migrator.query('DELETE FROM public.password_recovery_request');
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
      await migrator.query('COMMIT');
    } catch (error) {
      await migrator.query('ROLLBACK');
      throw error;
    }
  }

  async function bootstrapSharedAccount(): Promise<void> {
    const completed = await callBootstrap(bootstrap);
    accountId = completed.accountId;
    bootstrapOperationId = completed.operationId;
    expect(completed.result).toEqual({
      outcome: 'COMPLETED',
      created_account_id: accountId,
      completed_operation_id: bootstrapOperationId,
    });
  }

  async function createValidRecoveryGraph(): Promise<{
    requestId: string;
    attemptId: string;
    tokenId: string;
  }> {
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = randomUUID();
    const scheduledAt = new Date('2026-11-04T12:00:00.000Z');
    const leaseExpiresAt = new Date('2026-11-04T12:05:00.000Z');

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
         accepted_at, terminal_at, failure_class
       ) VALUES ($1, $2, 1, 'PREPARED', $3, $4, $5, NULL, NULL, NULL, NULL)`,
      [attemptId, requestId, scheduledAt, randomUUID(), leaseExpiresAt],
    );
    await migrator.query(
      `INSERT INTO public.password_reset_token (
         password_reset_token_id, delivery_attempt_id, account_id, token_hash,
         created_at, expires_at, consumed_at, consumed_operation_id,
         invalidated_at, invalidated_operation_id
       ) VALUES ($1, $2, $3, $4, $5::timestamptz,
                 $5::timestamptz + INTERVAL '30 minutes',
                 NULL, NULL, NULL, NULL)`,
      [tokenId, attemptId, accountId, Buffer.alloc(32, 1), scheduledAt],
    );
    return { requestId, attemptId, tokenId };
  }

  beforeAll(async () => {
    await Promise.all([
      runtime.connect(),
      migrator.connect(),
      bootstrap.connect(),
      maintenance.connect(),
      admin.connect(),
    ]);
    await resetSharedData();
  });

  beforeEach(async () => {
    await resetSharedData();
    await bootstrapSharedAccount();
  });

  afterAll(async () => {
    await resetSharedData();
    await Promise.all([
      runtime.end(),
      migrator.end(),
      bootstrap.end(),
      maintenance.end(),
      admin.end(),
    ]);
  });

  it('backfills a completed bootstrap and accepts an empty foundation database', async () => {
    const foundationMigration = await readMigration(foundationMigrationName);

    for (const scenario of ['empty', 'completed'] as const) {
      const database = `bello_f1b451_${scenario}_${randomUUID().replaceAll('-', '')}`;
      expect(database).toMatch(/^bello_f1b451_(empty|completed)_[a-f0-9]{32}$/);
      const migrationUrl = new URL(requiredUrl('MIGRATION_DATABASE_URL'));
      migrationUrl.pathname = `/${database}`;
      let scratch: Client | undefined;

      try {
        await admin.query(
          `CREATE DATABASE "${database}" OWNER bello_test_migrator`,
        );
        scratch = new Client({ connectionString: migrationUrl.toString() });
        await scratch.connect();
        await applyHistoricalMigrations(scratch);

        let completed: Awaited<ReturnType<typeof callBootstrap>> | undefined;
        if (scenario === 'completed') completed = await callBootstrap(scratch);

        await scratch.query(foundationMigration);
        const evidence = await scratch.query<{
          credential_count: number;
          null_correlations: number;
          matching_correlations: number;
          request_table: string;
        }>(`
          SELECT
            (SELECT count(*)::integer FROM public.password_credential)
              AS credential_count,
            (SELECT count(*)::integer FROM public.password_credential
             WHERE changed_operation_id IS NULL) AS null_correlations,
            (SELECT count(*)::integer
             FROM public.password_credential AS credential
             JOIN public.bootstrap_state AS state
               ON state.initial_account_id = credential.account_id
              AND state.operation_id = credential.changed_operation_id)
              AS matching_correlations,
            pg_catalog.to_regclass('public.password_recovery_request')::text
              AS request_table
        `);
        expect(evidence.rows[0]).toEqual({
          credential_count: scenario === 'completed' ? 1 : 0,
          null_correlations: 0,
          matching_correlations: scenario === 'completed' ? 1 : 0,
          request_table: 'password_recovery_request',
        });
        if (completed) {
          const credential = await scratch.query<{
            changed_operation_id: string;
          }>(
            `SELECT changed_operation_id
             FROM public.password_credential
             WHERE account_id = $1`,
            [completed.accountId],
          );
          expect(credential.rows).toEqual([
            { changed_operation_id: completed.operationId },
          ]);
        }
      } finally {
        if (scratch) await scratch.end();
        await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      }
    }
  });

  it('aborts an unproven backfill and rolls every schema change back', async () => {
    const database = `bello_f1b451_rollback_${randomUUID().replaceAll('-', '')}`;
    expect(database).toMatch(/^bello_f1b451_rollback_[a-f0-9]{32}$/);
    const migrationUrl = new URL(requiredUrl('MIGRATION_DATABASE_URL'));
    migrationUrl.pathname = `/${database}`;
    let scratch: Client | undefined;

    try {
      await admin.query(
        `CREATE DATABASE "${database}" OWNER bello_test_migrator`,
      );
      scratch = new Client({ connectionString: migrationUrl.toString() });
      await scratch.connect();
      await applyHistoricalMigrations(scratch);
      const inconsistentAccountId = randomUUID();
      await scratch.query(
        `INSERT INTO public.account (
           id, first_name, last_name, email, email_key, email_verified_at,
           status, created_at, deactivated_at
         ) VALUES ($1, 'Invalid', 'Origin', 'invalid@example.com',
                   'invalid@example.com', pg_catalog.clock_timestamp(),
                   'ACTIVE', pg_catalog.clock_timestamp(), NULL)`,
        [inconsistentAccountId],
      );
      await scratch.query(
        `INSERT INTO public.password_credential (
           account_id, password_hash, changed_at
         ) VALUES ($1, $2, pg_catalog.clock_timestamp())`,
        [inconsistentAccountId, validPasswordHash],
      );

      await expectDatabaseError(
        scratch.query(await readMigration(foundationMigrationName)),
        'P0001',
      );
      await scratch.query('ROLLBACK');

      const rollback = await scratch.query<{
        changed_column: number;
        request_table: string | null;
        credentials: number;
        function_has_new_column: boolean;
      }>(`
        SELECT
          (SELECT count(*)::integer
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'password_credential'
             AND column_name = 'changed_operation_id') AS changed_column,
          pg_catalog.to_regclass('public.password_recovery_request')::text
            AS request_table,
          (SELECT count(*)::integer FROM public.password_credential)
            AS credentials,
          pg_catalog.pg_get_functiondef(
            'public.bootstrap_initial_admin(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)'::regprocedure
          ) LIKE '%changed_operation_id%' AS function_has_new_column
      `);
      expect(rollback.rows[0]).toEqual({
        changed_column: 0,
        request_table: null,
        credentials: 1,
        function_has_new_column: false,
      });
    } finally {
      if (scratch) await scratch.end();
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
  });

  it('creates the four constrained relations and required indexes', async () => {
    const graph = await createValidRecoveryGraph();
    await migrator.query(
      `INSERT INTO public.password_reset_operation (
         reset_operation_id, account_id, password_reset_token_id,
         expected_changed_operation_id, state, started_at, updated_at, terminal_at
       ) VALUES ($1, $2, $3, $4, 'STARTED', $5, $5, NULL)`,
      [
        randomUUID(),
        accountId,
        graph.tokenId,
        bootstrapOperationId,
        new Date('2026-11-04T12:10:00.000Z'),
      ],
    );

    const indexes = await migrator.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (
          'password_credential',
          'password_recovery_request',
          'password_recovery_delivery_attempt',
          'password_reset_token',
          'password_reset_operation'
        )
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'password_credential_changed_operation_id_key',
        'password_recovery_request_account_received_idx',
        'password_recovery_delivery_attempt_request_number_key',
        'password_recovery_delivery_attempt_expired_lease_idx',
        'password_reset_token_hash_key',
        'password_reset_token_active_account_expiration_idx',
        'password_reset_operation_state_updated_idx',
      ]),
    );
  });

  it('enforces non-null, UUID v4, and uniqueness on credential correlation', async () => {
    await expectDatabaseError(
      migrator.query(
        `UPDATE public.password_credential
         SET changed_operation_id = NULL
         WHERE account_id = $1`,
        [accountId],
      ),
      '23502',
    );
    await expectDatabaseError(
      migrator.query(
        `UPDATE public.password_credential
         SET changed_operation_id = '11111111-1111-3111-8111-111111111111'
         WHERE account_id = $1`,
        [accountId],
      ),
      '23514',
    );

    const otherAccountId = randomUUID();
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES ($1, 'Other', 'Account', 'other@example.com',
                 'other@example.com', pg_catalog.clock_timestamp(),
                 'ACTIVE', pg_catalog.clock_timestamp(), NULL)`,
      [otherAccountId],
    );
    await expectDatabaseError(
      migrator.query(
        `INSERT INTO public.password_credential (
           account_id, password_hash, changed_at, changed_operation_id
         ) VALUES ($1, $2, pg_catalog.clock_timestamp(), $3)`,
        [otherAccountId, validPasswordHash, bootstrapOperationId],
      ),
      '23505',
    );
  });

  it('rejects invalid states, ordinals, hashes, terminal states, and restricted deletes', async () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    await expectDatabaseError(
      migrator.query(
        `INSERT INTO public.password_recovery_request (
           recovery_request_id, account_id, state, received_at, updated_at,
           terminal_at, current_attempt_number, cancelled_operation_id
         ) VALUES ($1, $2, 'INVALID', $3, $3, NULL, 0, NULL)`,
        [randomUUID(), accountId, now],
      ),
      '23514',
    );

    const graph = await createValidRecoveryGraph();
    await expectDatabaseError(
      migrator.query(
        `INSERT INTO public.password_recovery_delivery_attempt (
           delivery_attempt_id, recovery_request_id, attempt_number, state,
           scheduled_at, lease_id, lease_expires_at
         ) VALUES ($1, $2, 4, 'PREPARING', $3, $4, $5)`,
        [
          randomUUID(),
          graph.requestId,
          now,
          randomUUID(),
          new Date('2026-11-04T12:05:00.000Z'),
        ],
      ),
      '23514',
    );
    await expectDatabaseError(
      migrator.query(
        `INSERT INTO public.password_reset_token (
           password_reset_token_id, delivery_attempt_id, account_id, token_hash,
           created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5::timestamptz,
                   $5::timestamptz + INTERVAL '30 minutes')`,
        [randomUUID(), randomUUID(), accountId, Buffer.alloc(31), now],
      ),
      '23514',
    );
    await expectDatabaseError(
      migrator.query(
        `INSERT INTO public.password_reset_operation (
           reset_operation_id, account_id, password_reset_token_id,
           expected_changed_operation_id, state, started_at, updated_at,
           terminal_at
         ) VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $5, NULL)`,
        [randomUUID(), accountId, graph.tokenId, bootstrapOperationId, now],
      ),
      '23514',
    );
    await expectDatabaseError(
      migrator.query(
        'DELETE FROM public.password_recovery_request WHERE recovery_request_id = $1',
        [graph.requestId],
      ),
      '23001',
    );
  });

  it('preserves runtime denial and grants bootstrap only credential correlation reads', async () => {
    const tables = [
      'password_recovery_request',
      'password_recovery_delivery_attempt',
      'password_reset_token',
      'password_reset_operation',
    ];
    const privileges = await migrator.query<{
      role_name: string;
      table_name: string;
      select_privilege: boolean;
      insert_privilege: boolean;
      update_privilege: boolean;
      delete_privilege: boolean;
    }>(
      `
      SELECT
        role_name,
        table_name,
        pg_catalog.has_table_privilege(role_name, 'public.' || table_name, 'SELECT')
          AS select_privilege,
        pg_catalog.has_table_privilege(role_name, 'public.' || table_name, 'INSERT')
          AS insert_privilege,
        pg_catalog.has_table_privilege(role_name, 'public.' || table_name, 'UPDATE')
          AS update_privilege,
        pg_catalog.has_table_privilege(role_name, 'public.' || table_name, 'DELETE')
          AS delete_privilege
      FROM unnest(ARRAY[
        'bello_runtime',
        'bello_bootstrap_executor',
        'bello_audit_maintenance',
        'public'
      ]) AS role_name
      CROSS JOIN unnest($1::text[]) AS table_name
      ORDER BY role_name, table_name
    `,
      [tables],
    );
    expect(privileges.rows).toHaveLength(16);
    expect(privileges.rows).toEqual(
      privileges.rows.map(({ role_name, table_name }) => ({
        role_name,
        table_name,
        select_privilege: false,
        insert_privilege: false,
        update_privilege: false,
        delete_privilege: false,
      })),
    );

    const credentialPrivileges = await migrator.query<{
      runtime_changed_select: boolean;
      runtime_changed_update: boolean;
      bootstrap_changed_select: boolean;
      bootstrap_hash_select: boolean;
    }>(`
      SELECT
        pg_catalog.has_column_privilege(
          'bello_runtime', 'public.password_credential',
          'changed_operation_id', 'SELECT'
        ) AS runtime_changed_select,
        pg_catalog.has_column_privilege(
          'bello_runtime', 'public.password_credential',
          'changed_operation_id', 'UPDATE'
        ) AS runtime_changed_update,
        pg_catalog.has_column_privilege(
          'bello_bootstrap_executor', 'public.password_credential',
          'changed_operation_id', 'SELECT'
        ) AS bootstrap_changed_select,
        pg_catalog.has_column_privilege(
          'bello_bootstrap_executor', 'public.password_credential',
          'password_hash', 'SELECT'
        ) AS bootstrap_hash_select
    `);
    expect(credentialPrivileges.rows[0]).toEqual({
      runtime_changed_select: false,
      runtime_changed_update: false,
      bootstrap_changed_select: true,
      bootstrap_hash_select: false,
    });

    await expectDatabaseError(
      runtime.query(
        `UPDATE public.password_credential
         SET changed_operation_id = $1
         WHERE account_id = $2`,
        [randomUUID(), accountId],
      ),
      '42501',
    );
    await expectDatabaseError(
      runtime.query(
        'SELECT recovery_request_id FROM public.password_recovery_request',
      ),
      '42501',
    );
    await expectDatabaseError(
      maintenance.query('DELETE FROM public.password_reset_token'),
      '42501',
    );

    const bootstrapRead = await bootstrap.query<{
      account_id: string;
      changed_operation_id: string;
    }>(
      `SELECT account_id, changed_operation_id
       FROM public.password_credential`,
    );
    expect(bootstrapRead.rows).toEqual([
      {
        account_id: accountId,
        changed_operation_id: bootstrapOperationId,
      },
    ]);
    await expectDatabaseError(
      bootstrap.query('SELECT password_hash FROM public.password_credential'),
      '42501',
    );
  });
});
