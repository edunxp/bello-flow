import { randomBytes, randomUUID } from 'node:crypto';
import { Client, DatabaseError } from 'pg';
import {
  AuthSessionPersistence,
  SESSION_PERSISTENCE_ERROR_CODE,
} from '../src/auth/auth-session.persistence.js';
import { generateOperationId } from '../src/auth/session-primitives.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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

describe('F1-B.3.3.2 failed login persistence (PostgreSQL)', () => {
  const migrator = new Client({
    connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
  });
  const runtime = new Client({
    connectionString: requiredUrl('DATABASE_URL'),
  });
  const prisma = new PrismaService();
  const service = new AuthSessionPersistence(prisma);
  let accountId: string;

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
      'DROP TRIGGER IF EXISTS _f1b332_audit_failure ON public.audit_event',
    );
    await migrator.query(
      'DROP FUNCTION IF EXISTS public._f1b332_audit_failure()',
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

    accountId = randomUUID();
    const email = `${accountId}@failed-login.example.com`;
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES (
         $1, 'Failed', 'Login', $2, $2, pg_catalog.clock_timestamp(),
         'ACTIVE', pg_catalog.clock_timestamp(), NULL
       )`,
      [accountId, email],
    );
  }

  async function installAuditFailure(): Promise<void> {
    await migrator.query(`
      CREATE FUNCTION public._f1b332_audit_failure()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.operation = 'AUTH_LOGIN_FAILED' THEN
          RAISE EXCEPTION 'controlled failed-login audit failure';
        END IF;
        RETURN NEW;
      END
      $function$;
      CREATE TRIGGER _f1b332_audit_failure
      BEFORE INSERT ON public.audit_event
      FOR EACH ROW EXECUTE FUNCTION public._f1b332_audit_failure()
    `);
  }

  async function insertFailedLoginEvidence(
    overrides: {
      beforeData?: Record<string, unknown> | null;
      afterData?: Record<string, unknown> | null;
      context?: Record<string, unknown> | null;
      correlationId?: string;
    } = {},
  ): Promise<ReturnType<typeof generateOperationId>> {
    const operationId = generateOperationId();
    const beforeData = overrides.beforeData ?? null;
    const afterData = overrides.afterData ?? null;
    const context =
      overrides.context === undefined
        ? { authentication_type: 'PASSWORD' }
        : overrides.context;
    await migrator.query(
      `INSERT INTO public.audit_event (
         id, occurred_at, actor_account_id, origin, scope, operation, result,
         entity_type, entity_id, before_data, after_data, context,
         correlation_id, operation_id, sequence
       ) VALUES (
         $1, pg_catalog.clock_timestamp(), NULL, 'HTTP_API', 'SECURITY',
         'AUTH_LOGIN_FAILED', 'DENIED', 'ACCOUNT', NULL,
         $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, 1
       )`,
      [
        randomUUID(),
        beforeData === null ? null : JSON.stringify(beforeData),
        afterData === null ? null : JSON.stringify(afterData),
        context === null ? null : JSON.stringify(context),
        overrides.correlationId ?? operationId,
        operationId,
      ],
    );
    return operationId;
  }

  async function insertSessionEvidence(
    operationId: ReturnType<typeof generateOperationId>,
    operationColumn: 'CREATED' | 'REVOKED',
  ): Promise<void> {
    const createdOperationId =
      operationColumn === 'CREATED' ? operationId : generateOperationId();
    const revokedOperationId =
      operationColumn === 'REVOKED' ? operationId : null;
    await migrator.query(
      `WITH database_clock AS (
         SELECT pg_catalog.clock_timestamp() AS now
       )
       INSERT INTO public.auth_session (
         id, account_id, token_hash, created_at, last_activity_at,
         absolute_expires_at, created_operation_id, revoked_at,
         revocation_reason, revoked_operation_id
       )
       SELECT
         $1, $2, $3, now, now, now + INTERVAL '168 hours', $4,
         CASE WHEN $5::uuid IS NULL THEN NULL ELSE now END,
         CASE WHEN $5::uuid IS NULL THEN NULL ELSE 'LOGOUT' END,
         $5
       FROM database_clock`,
      [
        randomUUID(),
        accountId,
        randomBytes(32),
        createdOperationId,
        revokedOperationId,
      ],
    );
  }

  beforeAll(async () => {
    await migrator.connect();
    await runtime.connect();
    await prisma.onModuleInit();
  });

  beforeEach(resetData);

  afterAll(async () => {
    await migrator.query(
      'DROP TRIGGER IF EXISTS _f1b332_audit_failure ON public.audit_event',
    );
    await migrator.query(
      'DROP FUNCTION IF EXISTS public._f1b332_audit_failure()',
    );
    await prisma.onModuleDestroy();
    await runtime.end();
    await migrator.end();
  });

  it.each([
    ['known account', () => accountId],
    ['unknown identity', () => null],
  ])('records the approved event for %s', async (_name, resolveAccount) => {
    const expectedAccountId = resolveAccount();
    const result = await service.recordFailedLogin({
      accountId: expectedAccountId,
    });
    const evidence = await migrator.query<{
      actor_account_id: string | null;
      origin: string;
      scope: string;
      operation: string;
      result: string;
      entity_type: string;
      entity_id: string | null;
      before_data: unknown;
      after_data: unknown;
      context: Record<string, unknown>;
      correlation_id: string;
      operation_id: string;
      sequence: number;
    }>(`SELECT * FROM public.audit_event WHERE operation_id = $1`, [
      result.operationId,
    ]);

    expect(result.alreadyCompleted).toBe(false);
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        actor_account_id: expectedAccountId,
        origin: 'HTTP_API',
        scope: 'SECURITY',
        operation: 'AUTH_LOGIN_FAILED',
        result: 'DENIED',
        entity_type: 'ACCOUNT',
        entity_id: expectedAccountId,
        before_data: null,
        after_data: null,
        context: { authentication_type: 'PASSWORD' },
        correlation_id: result.operationId,
        operation_id: result.operationId,
        sequence: 1,
      }),
    ]);
    expect(JSON.stringify(evidence.rows)).not.toContain('password');
    expect(JSON.stringify(evidence.rows)).not.toContain('$argon2id$');
    expect(JSON.stringify(evidence.rows)).not.toContain('@failed-login');
  });

  it('is idempotent for sequential and concurrent repetitions', async () => {
    const operationId = generateOperationId();
    const first = await service.recordFailedLogin({
      accountId: null,
      operationId,
    });
    const repeated = await service.recordFailedLogin({
      accountId: null,
      operationId,
    });
    expect(first.alreadyCompleted).toBe(false);
    expect(repeated.alreadyCompleted).toBe(true);

    const concurrentOperationId = generateOperationId();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.recordFailedLogin({
          accountId: null,
          operationId: concurrentOperationId,
        }),
      ),
    );
    expect(
      results.filter(({ alreadyCompleted }) => !alreadyCompleted),
    ).toHaveLength(1);
    const counts = await migrator.query<{
      operation_id: string;
      count: number;
    }>(
      `SELECT operation_id, count(*)::integer AS count
       FROM public.audit_event
       GROUP BY operation_id
       ORDER BY operation_id`,
    );
    expect(counts.rows).toEqual(
      expect.arrayContaining([
        { operation_id: operationId, count: 1 },
        { operation_id: concurrentOperationId, count: 1 },
      ]),
    );
  });

  it('rejects incompatible reuse of an operation identifier', async () => {
    const operationId = generateOperationId();
    await service.recordFailedLogin({ accountId: null, operationId });

    await expect(
      service.recordFailedLogin({ accountId, operationId }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
      operationId,
    });
    const count = await migrator.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.audit_event WHERE operation_id = $1`,
      [operationId],
    );
    expect(count.rows).toEqual([{ count: 1 }]);
  });

  it('rolls back and reports an indeterminate operation when auditing fails', async () => {
    await installAuditFailure();
    const operationId = generateOperationId();

    await expect(
      service.recordFailedLogin({ accountId, operationId }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      operationId,
    });
    const count = await migrator.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.audit_event WHERE operation_id = $1`,
      [operationId],
    );
    expect(count.rows).toEqual([{ count: 0 }]);
    await expect(
      service.reconcileOperation({
        accountId,
        operationId,
        operation: 'AUTH_LOGIN_FAILED',
      }),
    ).resolves.toBe('NOT_FOUND');
  });

  it('reconciles known, null, absent and incompatible identities', async () => {
    const known = await service.recordFailedLogin({ accountId });
    const unknown = await service.recordFailedLogin({ accountId: null });

    await expect(
      service.reconcileOperation({
        accountId,
        operationId: known.operationId,
        operation: 'AUTH_LOGIN_FAILED',
      }),
    ).resolves.toBe('COMPLETED');
    await expect(
      service.reconcileOperation({
        accountId: null,
        operationId: unknown.operationId,
        operation: 'AUTH_LOGIN_FAILED',
      }),
    ).resolves.toBe('COMPLETED');
    await expect(
      service.reconcileOperation({
        accountId: null,
        operationId: generateOperationId(),
        operation: 'AUTH_LOGIN_FAILED',
      }),
    ).resolves.toBe('NOT_FOUND');
    await expect(
      service.reconcileOperation({
        accountId,
        operationId: unknown.operationId,
        operation: 'AUTH_LOGIN_FAILED',
      }),
    ).resolves.toBe('INCONSISTENT');
  });

  it.each([
    ['non-null before_data', { beforeData: { unexpected: true } }],
    ['non-null after_data', { afterData: { unexpected: true } }],
    ['missing context', { context: null }],
    ['different context', { context: { authentication_type: 'OTHER' } }],
    ['different correlation', { correlationId: randomUUID() }],
  ])('rejects failed-login evidence with %s', async (_name, overrides) => {
    const operationId = await insertFailedLoginEvidence(overrides);

    await expect(
      service.reconcileOperation({
        accountId: null,
        operationId,
        operation: 'AUTH_LOGIN_FAILED',
      }),
    ).resolves.toBe('INCONSISTENT');
  });

  it.each([
    ['created_operation_id', 'CREATED'],
    ['revoked_operation_id', 'REVOKED'],
  ] as const)(
    'rejects isolated session evidence from %s',
    async (_description, operationColumn) => {
      const operationId = generateOperationId();
      await insertSessionEvidence(operationId, operationColumn);

      await expect(
        service.reconcileOperation({
          accountId: null,
          operationId,
          operation: 'AUTH_LOGIN_FAILED',
        }),
      ).resolves.toBe('INCONSISTENT');
    },
  );

  it('rejects a compatible failed-login event accompanied by a session', async () => {
    const operationId = await insertFailedLoginEvidence();
    await insertSessionEvidence(operationId, 'CREATED');

    await expect(
      service.reconcileOperation({
        accountId: null,
        operationId,
        operation: 'AUTH_LOGIN_FAILED',
      }),
    ).resolves.toBe('INCONSISTENT');
  });

  it('does not record a failed login over isolated session evidence', async () => {
    const operationId = generateOperationId();
    await insertSessionEvidence(operationId, 'CREATED');

    await expect(
      service.recordFailedLogin({ accountId: null, operationId }),
    ).rejects.toMatchObject({
      code: SESSION_PERSISTENCE_ERROR_CODE.RECONCILIATION_INCONSISTENT,
      operationId,
    });
    const events = await migrator.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.audit_event WHERE operation_id = $1`,
      [operationId],
    );
    expect(events.rows).toEqual([{ count: 0 }]);
  });

  it('preserves reconciliation security and rejects null for other operations', async () => {
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
      WHERE procedure.oid =
        'public.reconcile_auth_session_operation(uuid,uuid,text,uuid)'
          ::regprocedure
    `);
    expect(metadata.rows).toEqual([
      {
        owner: 'bello_test_migrator',
        security_definer: true,
        volatility: 's',
        configuration: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);

    const privileges = await runtime.query<{
      execute: boolean;
      audit_select: boolean;
      audit_insert: boolean;
    }>(`
      SELECT
        has_function_privilege(
          current_user,
          'public.reconcile_auth_session_operation(uuid,uuid,text,uuid)',
          'EXECUTE'
        ) AS execute,
        has_table_privilege(
          current_user, 'public.audit_event', 'SELECT'
        ) AS audit_select,
        has_any_column_privilege(
          current_user, 'public.audit_event', 'INSERT'
        ) AS audit_insert
    `);
    expect(privileges.rows).toEqual([
      { execute: true, audit_select: false, audit_insert: true },
    ]);

    await expectDatabaseError(
      runtime.query(
        `SELECT public.reconcile_auth_session_operation(
           $1, NULL, 'AUTH_LOGIN_SUCCEEDED', $2
         )`,
        [randomUUID(), randomUUID()],
      ),
      'P0001',
    );
  });
});
