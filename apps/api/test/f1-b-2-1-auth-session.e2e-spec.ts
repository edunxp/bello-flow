import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, DatabaseError } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const execFileAsync = promisify(execFile);
const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

type SessionInput = {
  id: string;
  accountId: string;
  tokenHash: Buffer;
  createdAt: Date;
  lastActivityAt: Date;
  absoluteExpiresAt: Date;
  createdOperationId: string;
  revokedAt: Date | null;
  revocationReason: string | null;
  revokedOperationId: string | null;
};

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function clientFor(name: string): Client {
  return new Client({ connectionString: requiredUrl(name) });
}

function sessionInput(
  accountId: string,
  overrides: Partial<SessionInput> = {},
): SessionInput {
  const createdAt = new Date('2026-03-05T12:00:00.000Z');
  return {
    id: randomUUID(),
    accountId,
    tokenHash: randomBytes(32),
    createdAt,
    lastActivityAt: createdAt,
    absoluteExpiresAt: new Date(createdAt.getTime() + 604_800_000),
    createdOperationId: randomUUID(),
    revokedAt: null,
    revocationReason: null,
    revokedOperationId: null,
    ...overrides,
  };
}

async function insertSession(
  client: Client,
  input: SessionInput,
  returning = false,
): Promise<void> {
  await client.query(
    `INSERT INTO public.auth_session (
       id, account_id, token_hash, created_at, last_activity_at,
       absolute_expires_at, created_operation_id, revoked_at,
       revocation_reason, revoked_operation_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ${returning ? 'RETURNING *' : ''}`,
    [
      input.id,
      input.accountId,
      input.tokenHash,
      input.createdAt,
      input.lastActivityAt,
      input.absoluteExpiresAt,
      input.createdOperationId,
      input.revokedAt,
      input.revocationReason,
      input.revokedOperationId,
    ],
  );
}

async function insertAuditEvent(
  client: Client,
  input: {
    accountId: string;
    operationId: string;
    operation: string;
    result: string;
    entityType: string;
    entityId: string | null;
    context?: Record<string, unknown> | null;
    sequence?: number;
  },
  returning = false,
): Promise<void> {
  await client.query(
    `INSERT INTO public.audit_event (
       id, occurred_at, actor_account_id, origin, scope, operation, result,
       entity_type, entity_id, before_data, after_data, context,
       correlation_id, operation_id, sequence
     ) VALUES (
       $1, pg_catalog.clock_timestamp(), $2, 'HTTP_API', 'SECURITY', $3, $4,
       $5, $6, NULL, NULL, $7, $8, $9, $10
     ) ${returning ? 'RETURNING *' : ''}`,
    [
      randomUUID(),
      input.accountId,
      input.operation,
      input.result,
      input.entityType,
      input.entityId,
      input.context ?? { authentication_type: 'PASSWORD' },
      randomUUID(),
      input.operationId,
      input.sequence ?? 1,
    ],
  );
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

describe('F1-B.2.1 auth session foundation (PostgreSQL)', () => {
  const runtime = clientFor('DATABASE_URL');
  const runtimePrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requiredUrl('DATABASE_URL') }),
  });
  const migrator = clientFor('MIGRATION_DATABASE_URL');
  const bootstrap = clientFor('BOOTSTRAP_DATABASE_URL');
  const maintenance = clientFor('MAINTENANCE_DATABASE_URL');
  let accountId: string;

  async function resetTestData(): Promise<void> {
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

    await migrator.query('BEGIN');
    try {
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

      accountId = randomUUID();
      await migrator.query(
        `INSERT INTO public.account (
           id, first_name, last_name, email, email_key, email_verified_at,
           status, created_at, deactivated_at
         ) VALUES (
           $1, 'Ada', 'Lovelace', 'ada.session@example.com',
           'ada.session@example.com', pg_catalog.clock_timestamp(),
           'ACTIVE', pg_catalog.clock_timestamp(), NULL
         )`,
        [accountId],
      );
      await migrator.query(
        `INSERT INTO public.password_credential (
           account_id, password_hash, changed_at, changed_operation_id
         ) VALUES ($1, $2, pg_catalog.clock_timestamp(), $3)`,
        [accountId, validPasswordHash, randomUUID()],
      );
      await migrator.query('COMMIT');
    } catch (error) {
      await migrator.query('ROLLBACK');
      throw error;
    }
  }

  beforeAll(async () => {
    await Promise.all([
      runtime.connect(),
      runtimePrisma.$connect(),
      migrator.connect(),
      bootstrap.connect(),
      maintenance.connect(),
    ]);
    await resetTestData();
  });

  beforeEach(resetTestData);

  afterAll(async () => {
    await resetTestData();
    await Promise.all([
      runtime.end(),
      runtimePrisma.$disconnect(),
      migrator.end(),
      bootstrap.end(),
      maintenance.end(),
    ]);
  });

  it('creates the approved columns, constraints and indexes', async () => {
    const columns = await migrator.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_session'
      ORDER BY ordinal_position
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'account_id',
      'token_hash',
      'created_at',
      'last_activity_at',
      'absolute_expires_at',
      'created_operation_id',
      'revoked_at',
      'revocation_reason',
      'revoked_operation_id',
    ]);

    const indexes = await migrator.query<{
      indexname: string;
      indexdef: string;
    }>(`
      SELECT indexname, indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public' AND tablename = 'auth_session'
    `);
    expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
      'auth_session_active_account_id_idx',
      'auth_session_created_operation_id_key',
      'auth_session_pkey',
      'auth_session_revoked_operation_id_idx',
      'auth_session_token_hash_key',
    ]);
    expect(
      indexes.rows.find(
        (row) => row.indexname === 'auth_session_active_account_id_idx',
      )?.indexdef,
    ).toContain('WHERE (revoked_at IS NULL)');
  });

  it('supports Prisma INSERT RETURNING and preserves exactly 604800 seconds across DST', async () => {
    await runtime.query(`SET TIME ZONE 'America/New_York'`);
    const input = sessionInput(accountId);
    const created = await runtimePrisma.authSession.create({
      data: {
        id: input.id,
        accountId: input.accountId,
        tokenHash: new Uint8Array(input.tokenHash),
        createdAt: input.createdAt,
        lastActivityAt: input.lastActivityAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        createdOperationId: input.createdOperationId,
      },
    });
    expect(created).toMatchObject({
      id: input.id,
      accountId,
      createdOperationId: input.createdOperationId,
    });

    const result = await runtime.query<{
      seconds: string;
      hash_length: number;
    }>(
      `SELECT
         EXTRACT(EPOCH FROM absolute_expires_at - created_at)::text AS seconds,
         pg_catalog.octet_length(token_hash) AS hash_length
       FROM public.auth_session WHERE id = $1`,
      [input.id],
    );
    expect(result.rows).toEqual([
      { seconds: '604800.000000', hash_length: 32 },
    ]);
  });

  it('enforces the account FK and unique token and operation identifiers', async () => {
    await expectDatabaseError(
      insertSession(runtime, sessionInput(randomUUID())),
      '23503',
    );

    const first = sessionInput(accountId);
    await insertSession(runtime, first);
    await expectDatabaseError(
      insertSession(
        runtime,
        sessionInput(accountId, { tokenHash: first.tokenHash }),
      ),
      '23505',
    );
    await expectDatabaseError(
      insertSession(
        runtime,
        sessionInput(accountId, {
          createdOperationId: first.createdOperationId,
        }),
      ),
      '23505',
    );
  });

  it.each([
    ['non-v4 id', { id: '00000000-0000-1000-8000-000000000001' }, '23514'],
    ['short token hash', { tokenHash: randomBytes(31) }, '23514'],
    [
      'wrong absolute expiry',
      { absoluteExpiresAt: new Date('2026-03-12T11:59:59.000Z') },
      '23514',
    ],
    [
      'activity before creation',
      { lastActivityAt: new Date('2026-03-05T11:59:59.000Z') },
      '23514',
    ],
    ['unknown revocation reason', { revocationReason: 'OTHER' }, '23514'],
    [
      'partial revocation state',
      { revokedAt: new Date('2026-03-05T12:01:00.000Z') },
      '23514',
    ],
  ])('rejects %s', async (_name, overrides, code) => {
    await expectDatabaseError(
      insertSession(runtime, sessionInput(accountId, overrides)),
      code,
    );
  });

  it('accepts every approved revocation reason and rejects immutable updates', async () => {
    for (const reason of [
      'LOGOUT',
      'GLOBAL_LOGOUT',
      'PASSWORD_RESET',
      'ACCOUNT_DEACTIVATED',
      'DELIVERY_FAILED',
    ]) {
      await insertSession(
        runtime,
        sessionInput(accountId, {
          revokedAt: new Date('2026-03-05T12:01:00.000Z'),
          revocationReason: reason,
          revokedOperationId: randomUUID(),
        }),
      );
    }

    await expectDatabaseError(
      runtime.query(
        'UPDATE public.auth_session SET account_id = $1 WHERE account_id = $1',
        [accountId],
      ),
      '42501',
    );
  });

  it('applies the exact runtime grants and no direct audit read', async () => {
    const privileges = await runtime.query<{
      account_update: boolean;
      credential_update: boolean;
      session_select: boolean;
      session_insert: boolean;
      session_mutable_update: boolean;
      session_immutable_update: boolean;
      session_delete: boolean;
      audit_insert: boolean;
      audit_select: boolean;
      audit_update: boolean;
      audit_delete: boolean;
      audit_truncate: boolean;
    }>(`
      SELECT
        has_table_privilege(current_user, 'public.account', 'UPDATE') AS account_update,
        has_table_privilege(current_user, 'public.password_credential', 'UPDATE') AS credential_update,
        has_any_column_privilege(current_user, 'public.auth_session', 'SELECT') AS session_select,
        has_any_column_privilege(current_user, 'public.auth_session', 'INSERT') AS session_insert,
        has_column_privilege(current_user, 'public.auth_session', 'revoked_at', 'UPDATE') AS session_mutable_update,
        has_column_privilege(current_user, 'public.auth_session', 'account_id', 'UPDATE') AS session_immutable_update,
        has_table_privilege(current_user, 'public.auth_session', 'DELETE') AS session_delete,
        has_any_column_privilege(current_user, 'public.audit_event', 'INSERT') AS audit_insert,
        has_table_privilege(current_user, 'public.audit_event', 'SELECT') AS audit_select,
        has_table_privilege(current_user, 'public.audit_event', 'UPDATE') AS audit_update,
        has_table_privilege(current_user, 'public.audit_event', 'DELETE') AS audit_delete,
        has_table_privilege(current_user, 'public.audit_event', 'TRUNCATE') AS audit_truncate
    `);
    expect(privileges.rows[0]).toEqual({
      account_update: false,
      credential_update: false,
      session_select: true,
      session_insert: true,
      session_mutable_update: true,
      session_immutable_update: false,
      session_delete: false,
      audit_insert: true,
      audit_select: false,
      audit_update: false,
      audit_delete: false,
      audit_truncate: false,
    });

    await expectDatabaseError(
      runtime.query('SELECT id FROM public.audit_event'),
      '42501',
    );
  });

  it('allows audit INSERT without RETURNING and rejects RETURNING', async () => {
    const operationId = randomUUID();
    await insertAuditEvent(runtime, {
      accountId,
      operationId,
      operation: 'AUTH_LOGIN_FAILED',
      result: 'DENIED',
      entityType: 'ACCOUNT',
      entityId: accountId,
    });

    const count = await migrator.query<{ value: number }>(
      'SELECT COUNT(*)::integer AS value FROM public.audit_event WHERE operation_id = $1',
      [operationId],
    );
    expect(count.rows).toEqual([{ value: 1 }]);

    await expectDatabaseError(
      insertAuditEvent(
        runtime,
        {
          accountId,
          operationId: randomUUID(),
          operation: 'AUTH_LOGIN_FAILED',
          result: 'DENIED',
          entityType: 'ACCOUNT',
          entityId: accountId,
        },
        true,
      ),
      '42501',
    );
  });

  it('restricts and hardens the SECURITY DEFINER reconciliation function', async () => {
    const metadata = await migrator.query<{
      owner: string;
      security_definer: boolean;
      volatility: string;
      configuration: string[];
    }>(`
      SELECT
        owner.rolname AS owner,
        procedure.prosecdef AS security_definer,
        procedure.provolatile AS volatility,
        procedure.proconfig AS configuration
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
      WHERE procedure.oid = 'public.reconcile_auth_session_operation(uuid,uuid,text,uuid)'::regprocedure
    `);
    expect(metadata.rows).toEqual([
      {
        owner: 'bello_test_migrator',
        security_definer: true,
        volatility: 's',
        configuration: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);

    for (const [client, allowed] of [
      [runtime, true],
      [bootstrap, false],
      [maintenance, false],
    ] as const) {
      const privilege = await client.query<{ allowed: boolean }>(`
        SELECT has_function_privilege(
          current_user,
          'public.reconcile_auth_session_operation(uuid,uuid,text,uuid)',
          'EXECUTE'
        ) AS allowed
      `);
      expect(privilege.rows).toEqual([{ allowed }]);
    }

    await expectDatabaseError(
      runtime.query('CREATE TEMP TABLE audit_event (id uuid)'),
      '42501',
    );

    for (const client of [bootstrap, maintenance]) {
      const privilege = await client.query<{
        canRead: boolean;
        canWrite: boolean;
      }>(`
        SELECT
          has_any_column_privilege(
            current_user, 'public.auth_session', 'SELECT'
          ) AS "canRead",
          (
            has_any_column_privilege(
              current_user, 'public.auth_session', 'INSERT,UPDATE'
            )
            OR has_table_privilege(
              current_user, 'public.auth_session', 'DELETE'
            )
          ) AS "canWrite"
      `);
      expect(privilege.rows).toEqual([{ canRead: false, canWrite: false }]);
    }
  });

  it('reconciles completed, inconsistent and absent session creation', async () => {
    const completed = sessionInput(accountId);
    await insertSession(runtime, completed);
    await insertAuditEvent(runtime, {
      accountId,
      operationId: completed.createdOperationId,
      operation: 'AUTH_LOGIN_SUCCEEDED',
      result: 'SUCCESS',
      entityType: 'AUTH_SESSION',
      entityId: completed.id,
    });

    const incomplete = sessionInput(accountId);
    await insertSession(runtime, incomplete);

    const reconcile = async (operationId: string, sessionId: string) =>
      runtime.query<{ status: string }>(
        `SELECT public.reconcile_auth_session_operation(
           $1, $2, 'AUTH_LOGIN_SUCCEEDED', $3
         ) AS status`,
        [operationId, accountId, sessionId],
      );

    await expect(
      reconcile(completed.createdOperationId, completed.id),
    ).resolves.toMatchObject({ rows: [{ status: 'COMPLETED' }] });
    await expect(
      reconcile(incomplete.createdOperationId, incomplete.id),
    ).resolves.toMatchObject({ rows: [{ status: 'INCONSISTENT' }] });
    await expect(reconcile(randomUUID(), randomUUID())).resolves.toMatchObject({
      rows: [{ status: 'NOT_FOUND' }],
    });
  });

  it('reconciles individual logout and rejects another account context', async () => {
    const operationId = randomUUID();
    const input = sessionInput(accountId, {
      revokedAt: new Date('2026-03-05T12:01:00.000Z'),
      revocationReason: 'LOGOUT',
      revokedOperationId: operationId,
    });
    await insertSession(runtime, input);
    await insertAuditEvent(runtime, {
      accountId,
      operationId,
      operation: 'AUTH_SESSION_LOGOUT',
      result: 'SUCCESS',
      entityType: 'AUTH_SESSION',
      entityId: input.id,
    });

    const reconcile = async (expectedAccountId: string) =>
      runtime.query<{ status: string }>(
        `SELECT public.reconcile_auth_session_operation(
           $1, $2, 'AUTH_SESSION_LOGOUT', $3
         ) AS status`,
        [operationId, expectedAccountId, input.id],
      );

    await expect(reconcile(accountId)).resolves.toMatchObject({
      rows: [{ status: 'COMPLETED' }],
    });
    await expect(reconcile(randomUUID())).resolves.toMatchObject({
      rows: [{ status: 'INCONSISTENT' }],
    });
  });

  it('reconciles global revocation with zero sessions and performs no writes', async () => {
    const operationId = randomUUID();
    await insertAuditEvent(runtime, {
      accountId,
      operationId,
      operation: 'AUTH_SESSIONS_REVOKED',
      result: 'SUCCESS',
      entityType: 'ACCOUNT',
      entityId: accountId,
      context: { reason: 'GLOBAL_LOGOUT', revoked_session_count: 0 },
    });
    const before = await migrator.query<{ sessions: number; events: number }>(`
      SELECT
        (SELECT COUNT(*)::integer FROM public.auth_session) AS sessions,
        (SELECT COUNT(*)::integer FROM public.audit_event) AS events
    `);

    const result = await runtime.query<{ status: string }>(
      `SELECT public.reconcile_auth_session_operation(
         $1, $2, 'AUTH_SESSIONS_REVOKED', NULL
       ) AS status`,
      [operationId, accountId],
    );
    expect(result.rows).toEqual([{ status: 'COMPLETED' }]);

    const after = await migrator.query<{ sessions: number; events: number }>(`
      SELECT
        (SELECT COUNT(*)::integer FROM public.auth_session) AS sessions,
        (SELECT COUNT(*)::integer FROM public.audit_event) AS events
    `);
    expect(after.rows).toEqual(before.rows);
  });

  it('rejects incomplete global revocation evidence', async () => {
    const mismatchedReasonOperationId = randomUUID();
    await insertSession(
      runtime,
      sessionInput(accountId, {
        revokedAt: new Date('2026-03-05T12:01:00.000Z'),
        revocationReason: 'PASSWORD_RESET',
        revokedOperationId: mismatchedReasonOperationId,
      }),
    );
    await insertAuditEvent(runtime, {
      accountId,
      operationId: mismatchedReasonOperationId,
      operation: 'AUTH_SESSIONS_REVOKED',
      result: 'SUCCESS',
      entityType: 'ACCOUNT',
      entityId: accountId,
      context: { reason: 'GLOBAL_LOGOUT', revoked_session_count: 1 },
    });

    const extraEventOperationId = randomUUID();
    await insertAuditEvent(runtime, {
      accountId,
      operationId: extraEventOperationId,
      operation: 'AUTH_SESSIONS_REVOKED',
      result: 'SUCCESS',
      entityType: 'ACCOUNT',
      entityId: accountId,
      context: { reason: 'GLOBAL_LOGOUT', revoked_session_count: 0 },
    });
    await insertAuditEvent(runtime, {
      accountId,
      operationId: extraEventOperationId,
      operation: 'AUTH_LOGIN_FAILED',
      result: 'DENIED',
      entityType: 'ACCOUNT',
      entityId: accountId,
      sequence: 2,
    });

    const reconcile = (operationId: string) =>
      runtime.query<{ status: string }>(
        `SELECT public.reconcile_auth_session_operation(
           $1, $2, 'AUTH_SESSIONS_REVOKED', NULL
         ) AS status`,
        [operationId, accountId],
      );

    await expect(reconcile(mismatchedReasonOperationId)).resolves.toMatchObject(
      {
        rows: [{ status: 'INCONSISTENT' }],
      },
    );
    await expect(reconcile(extraEventOperationId)).resolves.toMatchObject({
      rows: [{ status: 'INCONSISTENT' }],
    });
  });

  it('rejects invalid reconciliation input without exposing audit rows', async () => {
    await expectDatabaseError(
      runtime.query(
        `SELECT public.reconcile_auth_session_operation(
           $1, $2, 'UNKNOWN_OPERATION', NULL
         )`,
        [randomUUID(), accountId],
      ),
      'P0001',
    );
  });

  it('rolls back the new migration after a controlled failure', async () => {
    const admin = clientFor('ADMIN_TEST_DATABASE_URL');
    await admin.connect();
    const database = `bello_f1b_failure_${randomUUID().replaceAll('-', '')}`;
    expect(database).toMatch(/^bello_f1b_failure_[a-f0-9]{32}$/);
    const migrationUrl = new URL(requiredUrl('MIGRATION_DATABASE_URL'));
    migrationUrl.pathname = `/${database}`;
    let scratch: Client | undefined;

    try {
      await admin.query(
        `CREATE DATABASE "${database}" OWNER bello_test_migrator`,
      );
      scratch = new Client({ connectionString: migrationUrl.toString() });
      await scratch.connect();
      const f1a1Migration = await readFile(
        new URL(
          '../prisma/migrations/20261102000000_f1_a_1_identity_foundation/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await scratch.query(f1a1Migration);
      await execFileAsync(
        'npm',
        [
          'exec',
          '--workspace=@bello/api',
          '--',
          'prisma',
          'migrate',
          'resolve',
          '--applied',
          '20261102000000_f1_a_1_identity_foundation',
        ],
        {
          cwd: new URL('../../..', import.meta.url),
          env: {
            ...process.env,
            MIGRATION_DATABASE_URL: migrationUrl.toString(),
          },
          timeout: 30_000,
        },
      );
      await scratch.query(
        'CREATE TABLE public.migration_failure_probe (id integer)',
      );
      await scratch.query(
        'CREATE INDEX auth_session_token_hash_key ON public.migration_failure_probe (id)',
      );
      await scratch.end();
      scratch = undefined;

      await expect(
        execFileAsync(
          'npm',
          [
            'exec',
            '--workspace=@bello/api',
            '--',
            'prisma',
            'migrate',
            'deploy',
          ],
          {
            cwd: new URL('../../..', import.meta.url),
            env: {
              ...process.env,
              MIGRATION_DATABASE_URL: migrationUrl.toString(),
            },
            timeout: 30_000,
          },
        ),
      ).rejects.toThrow();

      scratch = new Client({ connectionString: migrationUrl.toString() });
      await scratch.connect();
      const state = await scratch.query<{
        account_table: string | null;
        session_table: string | null;
        reconciliation_function: string | null;
      }>(`
          SELECT
            pg_catalog.to_regclass('public.account')::text AS account_table,
            pg_catalog.to_regclass('public.auth_session')::text AS session_table,
            pg_catalog.to_regprocedure(
              'public.reconcile_auth_session_operation(uuid,uuid,text,uuid)'
            )::text AS reconciliation_function
        `);
      expect(state.rows).toEqual([
        {
          account_table: 'account',
          session_table: null,
          reconciliation_function: null,
        },
      ]);
    } finally {
      if (scratch) {
        await scratch.end();
      }
      await admin.query(
        `SELECT pg_catalog.pg_terminate_backend(pid)
           FROM pg_catalog.pg_stat_activity
           WHERE datname = $1 AND pid <> pg_catalog.pg_backend_pid()`,
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  }, 45_000);
});
