import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, DatabaseError } from 'pg';
import { PasswordResetTerminalizerPersistence } from '../src/auth/password-reset-terminalizer.persistence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const migrations = [
  '20261102000000_f1_a_1_identity_foundation',
  '20261102010000_f1_b_2_1_auth_session',
  '20261103000000_f1_b_3_3_2_failed_login_reconciliation',
  '20261104000000_f1_b_4_5_1_password_recovery_foundation',
  '20261105000000_f1_b_4_5_2_1_physical_advisory_lock',
  '20261106000000_f1_b_4_5_2_2_start_password_reset',
  '20261107000000_f1_b_4_5_2_3_complete_password_reset',
  '20261108000000_f1_b_4_5_2_4_reconcile_password_reset',
  '20261109000000_f1_b_4_5_4_password_recovery_request',
  '20261110000000_f1_b_4_5_6_password_recovery_delivery',
  '20261111000000_f1_b_4_5_8_abandoned_reset_terminalizer',
] as const;
const passwordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';
const newPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$bmV3c2FsdG5ld3NhbHQxMg$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTM';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function urlFor(name: string, database: string): string {
  const url = new URL(required(name));
  url.pathname = `/${database}`;
  return url.toString();
}
async function migration(name: string): Promise<string> {
  return readFile(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  );
}

describe('F1-B.4.5.8 abandoned password reset terminalizer', () => {
  const admin = new Client({
    connectionString: required('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b458_main_${randomUUID().replaceAll('-', '')}`;
  let migrator: Client;
  let databaseAdmin: Client;
  let runtime: Client;
  let runtime2: Client;
  let bootstrap: Client;
  let maintenance: Client;
  let prisma: PrismaService;
  let persistence: PasswordResetTerminalizerPersistence;
  let created = false;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  async function createStarted(expired: boolean | 'before'): Promise<{
    accountId: string;
    attemptId: string;
    changedId: string;
    operationId: string;
    requestId: string;
    tokenId: string;
  }> {
    const accountId = randomUUID();
    const changedId = randomUUID();
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = randomUUID();
    const operationId = randomUUID();
    const now = new Date(Date.now() - (expired === 'before' ? 31 * 60_000 : 0));
    const email = `${accountId.replaceAll('-', '')}@example.test`;
    const hash = randomBytes(32);
    await migrator.query(
      `INSERT INTO public.account (id, first_name, last_name, email, email_key, email_verified_at, status, created_at, deactivated_at) VALUES ($1,'Test','Account',$2,$2,$3,'ACTIVE',$3,NULL)`,
      [accountId, email, now],
    );
    await migrator.query(
      `INSERT INTO public.password_credential (account_id,password_hash,changed_at,changed_operation_id) VALUES ($1,$2,$3,$4)`,
      [accountId, passwordHash, now, changedId],
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_request (recovery_request_id,account_id,state,received_at,updated_at,terminal_at,current_attempt_number,cancelled_operation_id) VALUES ($1,$2,'SENT',$3,$3,$3,1,NULL)`,
      [requestId, accountId, now],
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_delivery_attempt (delivery_attempt_id,recovery_request_id,attempt_number,state,scheduled_at,lease_id,lease_expires_at,sending_confirmed_at,accepted_at,terminal_at,failure_class,cancelled_operation_id) VALUES ($1,$2,1,'SENT',$3,NULL,NULL,$3,$3,$3,NULL,NULL)`,
      [attemptId, requestId, now],
    );
    await migrator.query(
      `INSERT INTO public.password_reset_token (password_reset_token_id,delivery_attempt_id,account_id,token_hash,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$5::timestamptz + interval '30 minutes')`,
      [tokenId, attemptId, accountId, hash, now],
    );
    const start = await runtime.query<{ state: string }>(
      'SELECT state FROM public.start_password_reset_operation($1,$2,$3)',
      [operationId, randomUUID(), hash],
    );
    expect(start.rows[0]?.state).toBe(
      expired === 'before' ? 'REJECTED' : 'STARTED',
    );
    if (expired === true)
      await migrator.query(
        `UPDATE public.password_reset_token SET created_at = transaction_timestamp() - interval '31 minutes', expires_at = transaction_timestamp() - interval '1 minute' WHERE password_reset_token_id = $1`,
        [tokenId],
      );
    return {
      accountId,
      attemptId,
      changedId,
      operationId,
      requestId,
      tokenId,
    };
  }
  async function select(client = runtime) {
    return (
      await client.query<{
        outcome: string;
        reset_operation_id: string | null;
      }>('SELECT * FROM public.find_abandoned_password_reset_operation()')
    ).rows[0]!;
  }
  async function terminalize(id: string, client = runtime) {
    return (
      await client.query<{ outcome: string }>(
        'SELECT public.terminalize_abandoned_password_reset_operation($1) AS outcome',
        [id],
      )
    ).rows[0]!.outcome;
  }

  async function complete(id: string, client = runtime): Promise<string> {
    return (
      await client.query<{ state: string }>(
        'SELECT state FROM public.complete_password_reset_operation($1,$2,$3)',
        [id, randomUUID(), newPasswordHash],
      )
    ).rows[0]!.state;
  }

  async function reconcile(id: string, client = runtime): Promise<string> {
    return (
      await client.query<{ outcome: string }>(
        'SELECT public.reconcile_password_reset_operation($1) AS outcome',
        [id],
      )
    ).rows[0]!.outcome;
  }

  async function waitForAdvisoryBlock(applicationName: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await admin.query<{ blocked: boolean }>(
        `SELECT COALESCE(pg_catalog.bool_or(wait_event_type='Lock' AND wait_event='advisory'),FALSE) AS blocked
         FROM pg_catalog.pg_stat_activity WHERE application_name=$1`,
        [applicationName],
      );
      if (result.rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('terminalizer did not reach the advisory lock');
  }

  async function waitForSleepingPrismaBackend(): Promise<number> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await admin.query<{ pid: number }>(
        `SELECT pid FROM pg_catalog.pg_stat_activity
         WHERE application_name='f1b458-prisma'
           AND state='active' AND wait_event='PgSleep'
         LIMIT 1`,
      );
      if (result.rows[0]) return result.rows[0].pid;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Prisma backend did not reach injected sleep');
  }

  async function businessSnapshot(item: {
    accountId: string;
    attemptId: string;
    operationId: string;
    requestId: string;
    tokenId: string;
  }): Promise<unknown> {
    const credential = await migrator.query(
      'SELECT * FROM public.password_credential WHERE account_id=$1',
      [item.accountId],
    );
    const token = await migrator.query(
      'SELECT * FROM public.password_reset_token WHERE password_reset_token_id=$1',
      [item.tokenId],
    );
    const request = await migrator.query(
      'SELECT * FROM public.password_recovery_request WHERE recovery_request_id=$1',
      [item.requestId],
    );
    const attempt = await migrator.query(
      'SELECT * FROM public.password_recovery_delivery_attempt WHERE delivery_attempt_id=$1',
      [item.attemptId],
    );
    const sessions = await migrator.query(
      'SELECT * FROM public.auth_session WHERE account_id=$1 ORDER BY id',
      [item.accountId],
    );
    const audit = await migrator.query(
      'SELECT * FROM public.audit_event WHERE operation_id=$1 ORDER BY sequence',
      [item.operationId],
    );
    return {
      credential: credential.rows,
      token: token.rows,
      request: request.rows,
      attempt: attempt.rows,
      sessions: sessions.rows,
      audit: audit.rows,
    };
  }

  beforeAll(async () => {
    await admin.connect();
    const identity = await admin.query<{
      database: string;
      user: string;
      version: string;
    }>(
      `SELECT current_database() AS database,current_user AS "user",current_setting('server_version') AS version`,
    );
    expect(identity.rows[0]).toMatchObject({
      database: 'postgres',
      user: 'bello_admin',
    });
    expect(identity.rows[0]?.version).toMatch(/^18\.6(?:\s|$)/);
    expect(process.env.BELLO_EPHEMERAL_TEST_DATABASE).toBe('true');
    await admin.query(
      `CREATE DATABASE "${database}" OWNER bello_test_migrator`,
    );
    created = true;
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE "${database}" TO bello_test_app,bello_test_migrator,bello_test_bootstrap,bello_test_audit_maintenance`,
    );
    migrator = new Client({
      connectionString: urlFor('MIGRATION_DATABASE_URL', database),
    });
    await migrator.connect();
    databaseAdmin = new Client({
      connectionString: urlFor('ADMIN_TEST_DATABASE_URL', database),
    });
    await databaseAdmin.connect();
    await migrator.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await migrator.query(
      'GRANT USAGE ON SCHEMA public TO bello_runtime,bello_bootstrap_executor,bello_audit_maintenance',
    );
    await migrator.query(
      'GRANT USAGE,CREATE ON SCHEMA public TO bello_test_migrator',
    );
    for (const name of migrations) await migrator.query(await migration(name));
    runtime = new Client({
      connectionString: urlFor('DATABASE_URL', database),
      application_name: 'f1b458-runtime-1',
    });
    runtime2 = new Client({
      connectionString: urlFor('DATABASE_URL', database),
      application_name: 'f1b458-runtime-2',
    });
    bootstrap = new Client({
      connectionString: urlFor('BOOTSTRAP_DATABASE_URL', database),
    });
    maintenance = new Client({
      connectionString: urlFor('MAINTENANCE_DATABASE_URL', database),
    });
    await Promise.all([
      runtime.connect(),
      runtime2.connect(),
      bootstrap.connect(),
      maintenance.connect(),
    ]);
    const prismaUrl = new URL(urlFor('DATABASE_URL', database));
    prismaUrl.searchParams.set('application_name', 'f1b458-prisma');
    process.env.DATABASE_URL = prismaUrl.toString();
    prisma = new PrismaService();
    await prisma.onModuleInit();
    persistence = new PasswordResetTerminalizerPersistence(prisma);
  });
  beforeEach(async () => {
    await migrator.query(`
      DELETE FROM public.audit_event;
      DELETE FROM public.auth_session;
      DELETE FROM public.password_reset_operation;
      DELETE FROM public.password_reset_token;
      DELETE FROM public.password_recovery_delivery_attempt;
      DELETE FROM public.password_recovery_request;
      DELETE FROM public.password_credential;
      DELETE FROM public.account;
    `);
  });
  afterAll(async () => {
    await prisma?.onModuleDestroy().catch(() => undefined);
    await Promise.all(
      [
        runtime?.end(),
        runtime2?.end(),
        bootstrap?.end(),
        maintenance?.end(),
        databaseAdmin?.end(),
        migrator?.end(),
      ].map((p) => p?.catch(() => undefined)),
    );
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('selects and terminalizes only a fully proven expired STARTED operation', async () => {
    const item = await createStarted(true);
    const before = await businessSnapshot(item);
    expect(await select()).toEqual({
      outcome: 'CANDIDATE',
      reset_operation_id: item.operationId,
    });
    expect(await terminalize(item.operationId)).toBe('TERMINALIZED');
    const marker = await migrator.query(
      `SELECT state,terminal_at,updated_at FROM public.password_reset_operation WHERE reset_operation_id=$1`,
      [item.operationId],
    );
    expect(marker.rows[0]).toMatchObject({ state: 'NOT_FOUND' });
    expect(marker.rows[0].terminal_at).toEqual(marker.rows[0].updated_at);
    expect(await terminalize(item.operationId)).toBe('ALREADY_TERMINAL');
    expect(
      (
        await migrator.query(
          'SELECT count(*)::int AS count FROM public.audit_event WHERE operation_id=$1',
          [item.operationId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(await businessSnapshot(item)).toEqual(before);
  });

  it('does not select or terminalize before the persisted expiration', async () => {
    const item = await createStarted(false);
    expect((await select()).reset_operation_id).not.toBe(item.operationId);
    expect(await terminalize(item.operationId)).toBe('NOT_ELIGIBLE');
  });

  it('keeps UNKNOWN untouched and distinguishes physical absence', async () => {
    const item = await createStarted(true);
    await migrator.query(
      `UPDATE public.password_reset_operation SET state='UNKNOWN' WHERE reset_operation_id=$1`,
      [item.operationId],
    );
    expect(await terminalize(item.operationId)).toBe('NOT_ELIGIBLE');
    expect(await terminalize(randomUUID())).toBe('NOT_OBSERVED');
  });

  it('surfaces contradictory effects instead of treating them as idle', async () => {
    const item = await createStarted(true);
    await migrator.query(
      `UPDATE public.password_reset_token SET consumed_at=transaction_timestamp(),consumed_operation_id=$2 WHERE password_reset_token_id=$1`,
      [item.tokenId, item.operationId],
    );
    expect(await select()).toEqual({
      outcome: 'INCONSISTENT',
      reset_operation_id: item.operationId,
    });
    expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
  });

  it('allows only one concurrent transition', async () => {
    const item = await createStarted(true);
    const outcomes = await Promise.all([
      terminalize(item.operationId),
      terminalize(item.operationId, runtime2),
    ]);
    expect(outcomes.sort()).toEqual(['ALREADY_TERMINAL', 'TERMINALIZED']);
  });

  it('grants only runtime execution and no direct table DML', async () => {
    expect(
      await terminalize((await createStarted(true)).operationId, runtime),
    ).toBe('TERMINALIZED');
    for (const client of [bootstrap, maintenance]) {
      await expect(
        client.query(
          'SELECT * FROM public.find_abandoned_password_reset_operation()',
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      runtime.query(
        `UPDATE public.password_reset_operation SET state='NOT_FOUND' WHERE false`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects non-v4 input with the stable SQLSTATE', async () => {
    await expect(
      runtime.query(
        "SELECT public.terminalize_abandoned_password_reset_operation('00000000-0000-1000-8000-000000000001')",
      ),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('uses transaction_timestamp at the exact expiration boundary', async () => {
    const item = await createStarted(false);
    await migrator.query(
      `UPDATE public.password_reset_token
       SET created_at=transaction_timestamp()-interval '30 minutes',
           expires_at=transaction_timestamp()
       WHERE password_reset_token_id=$1`,
      [item.tokenId],
    );
    expect(await terminalize(item.operationId)).toBe('TERMINALIZED');
  });

  it('preserves active hashing before expiration and rejects its completion after expiration', async () => {
    const item = await createStarted(false);
    expect(await terminalize(item.operationId)).toBe('NOT_ELIGIBLE');
    await migrator.query(
      `UPDATE public.password_reset_token
       SET created_at=transaction_timestamp()-interval '31 minutes',
           expires_at=transaction_timestamp()-interval '1 minute'
       WHERE password_reset_token_id=$1`,
      [item.tokenId],
    );
    expect(await complete(item.operationId)).toBe('REJECTED');
    expect(await terminalize(item.operationId)).toBe('ALREADY_TERMINAL');
  });

  it('prioritizes candidates and exposes a remaining inconsistency through the probe', async () => {
    const broken = await createStarted(true);
    await migrator.query(
      `UPDATE public.password_recovery_request SET current_attempt_number=0 WHERE recovery_request_id=$1`,
      [broken.requestId],
    );
    const candidate = await createStarted(true);
    expect(await select()).toEqual({
      outcome: 'CANDIDATE',
      reset_operation_id: candidate.operationId,
    });
    expect(
      (
        await runtime.query<{ result: boolean }>(
          'SELECT public.has_inconsistent_password_reset_operation() AS result',
        )
      ).rows[0]?.result,
    ).toBe(true);
    await terminalize(candidate.operationId);
    expect(await select()).toEqual({
      outcome: 'INCONSISTENT',
      reset_operation_id: broken.operationId,
    });
  });

  it('orders candidates by expiration before UUID', async () => {
    const later = await createStarted(true);
    const earlier = await createStarted(true);
    await migrator.query(
      `UPDATE public.password_reset_token
       SET created_at=transaction_timestamp()-interval '32 minutes',
           expires_at=transaction_timestamp()-interval '2 minutes'
       WHERE password_reset_token_id=$1`,
      [earlier.tokenId],
    );
    expect((await select()).reset_operation_id).toBe(earlier.operationId);
    expect((await select()).reset_operation_id).not.toBe(later.operationId);
  });

  it('allows a later legitimate credential change without attributing it to the abandoned operation', async () => {
    const item = await createStarted(true);
    await migrator.query(
      `UPDATE public.password_credential
       SET changed_at=transaction_timestamp(), changed_operation_id=$2
       WHERE account_id=$1`,
      [item.accountId, randomUUID()],
    );
    expect(await terminalize(item.operationId)).toBe('TERMINALIZED');
    expect(await terminalize(item.operationId)).toBe('ALREADY_TERMINAL');
  });

  it('rejects a missing credential as inconsistent', async () => {
    const item = await createStarted(true);
    await migrator.query(
      'DELETE FROM public.password_credential WHERE account_id=$1',
      [item.accountId],
    );
    expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
  });

  it('rejects a physically missing token instead of converting it to idle', async () => {
    const item = await createStarted(true);
    await databaseAdmin.query('BEGIN');
    try {
      await databaseAdmin.query("SET LOCAL session_replication_role='replica'");
      await databaseAdmin.query(
        'DELETE FROM public.password_reset_token WHERE password_reset_token_id=$1',
        [item.tokenId],
      );
      await databaseAdmin.query('COMMIT');
    } catch (error) {
      await databaseAdmin.query('ROLLBACK');
      throw error;
    }
    expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
  });

  it.each(['attempt', 'request'] as const)(
    'rejects a physically missing %s in the token graph',
    async (missing) => {
      const item = await createStarted(true);
      await databaseAdmin.query('BEGIN');
      try {
        await databaseAdmin.query(
          "SET LOCAL session_replication_role='replica'",
        );
        if (missing === 'attempt') {
          await databaseAdmin.query(
            'DELETE FROM public.password_recovery_delivery_attempt WHERE delivery_attempt_id=$1',
            [item.attemptId],
          );
        } else {
          await databaseAdmin.query(
            'DELETE FROM public.password_recovery_request WHERE recovery_request_id=$1',
            [item.requestId],
          );
        }
        await databaseAdmin.query('COMMIT');
      } catch (error) {
        await databaseAdmin.query('ROLLBACK');
        throw error;
      }
      expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
    },
  );

  it.each(['credential', 'invalidation'] as const)(
    'rejects a contradictory %s effect attributed to the operation',
    async (effect) => {
      const item = await createStarted(true);
      if (effect === 'credential') {
        await migrator.query(
          `UPDATE public.password_credential
           SET changed_at=transaction_timestamp(), changed_operation_id=$2
           WHERE account_id=$1`,
          [item.accountId, item.operationId],
        );
      } else {
        await migrator.query(
          `UPDATE public.password_reset_token
           SET invalidated_at=transaction_timestamp(), invalidated_operation_id=$2
           WHERE password_reset_token_id=$1`,
          [item.tokenId, item.operationId],
        );
      }
      expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
    },
  );

  it.each(['request', 'attempt', 'session', 'audit'] as const)(
    'rejects a contradictory %s effect without mutating the operation',
    async (effect) => {
      const item = await createStarted(true);
      if (effect === 'request') {
        await migrator.query(
          `UPDATE public.password_recovery_request
           SET state='CANCELLED', updated_at=transaction_timestamp(),
               terminal_at=transaction_timestamp(), cancelled_operation_id=$2
           WHERE recovery_request_id=$1`,
          [item.requestId, item.operationId],
        );
      } else if (effect === 'attempt') {
        await migrator.query(
          `UPDATE public.password_recovery_delivery_attempt
           SET state='CANCELLED', sending_confirmed_at=NULL, accepted_at=NULL,
               terminal_at=transaction_timestamp(), failure_class=NULL,
               cancelled_operation_id=$2
           WHERE delivery_attempt_id=$1`,
          [item.attemptId, item.operationId],
        );
      } else if (effect === 'session') {
        await migrator.query(
          `INSERT INTO public.auth_session (
             id,account_id,token_hash,created_at,last_activity_at,
             absolute_expires_at,created_operation_id,revoked_at,
             revocation_reason,revoked_operation_id
           ) VALUES ($1,$2,$3,transaction_timestamp()-interval '1 minute',
             transaction_timestamp()-interval '1 minute',
             transaction_timestamp()-interval '1 minute'+interval '168 hours',
             $4,transaction_timestamp(),'PASSWORD_RESET',$5)`,
          [
            randomUUID(),
            item.accountId,
            randomBytes(32),
            randomUUID(),
            item.operationId,
          ],
        );
      } else {
        await migrator.query(
          `INSERT INTO public.audit_event (
             id,occurred_at,actor_account_id,origin,scope,operation,result,
             entity_type,entity_id,before_data,after_data,context,
             correlation_id,operation_id,sequence
           ) VALUES ($1,transaction_timestamp(),$2,'INTERNAL','SECURITY',
             'INJECTED_CONTRADICTION','FAILURE','ACCOUNT',$2,NULL,NULL,NULL,
             $3,$3,1)`,
          [randomUUID(), item.accountId, item.operationId],
        );
      }
      const before = await migrator.query<{ state: string }>(
        'SELECT state FROM public.password_reset_operation WHERE reset_operation_id=$1',
        [item.operationId],
      );
      expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
      expect(
        (
          await migrator.query<{ state: string }>(
            'SELECT state FROM public.password_reset_operation WHERE reset_operation_id=$1',
            [item.operationId],
          )
        ).rows,
      ).toEqual(before.rows);
    },
  );

  it.each(['token-account', 'request-account'] as const)(
    'rejects a contradictory %s graph',
    async (kind) => {
      const item = await createStarted(true);
      const other = await createStarted(false);
      if (kind === 'token-account') {
        await migrator.query(
          'UPDATE public.password_reset_token SET account_id=$2 WHERE password_reset_token_id=$1',
          [item.tokenId, other.accountId],
        );
      } else {
        await migrator.query(
          'UPDATE public.password_recovery_request SET account_id=$2 WHERE recovery_request_id=$1',
          [item.requestId, other.accountId],
        );
      }
      expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
    },
  );

  it.each([
    ['UNKNOWN', 'NOT_ELIGIBLE'],
    ['INCONSISTENT', 'INCONSISTENT'],
  ] as const)(
    'partitions persisted %s without mutation',
    async (state, expected) => {
      const item = await createStarted(true);
      await migrator.query(
        `UPDATE public.password_reset_operation
       SET state=$2::text, terminal_at=CASE WHEN $2::text='INCONSISTENT' THEN transaction_timestamp() ELSE NULL END
       WHERE reset_operation_id=$1`,
        [item.operationId, state],
      );
      expect(await terminalize(item.operationId)).toBe(expected);
    },
  );

  it('recognizes coherent COMPLETED and REJECTED operations', async () => {
    const completed = await createStarted(false);
    expect(await complete(completed.operationId)).toBe('COMPLETED');
    expect(await terminalize(completed.operationId)).toBe('ALREADY_TERMINAL');
    const rejected = await createStarted('before');
    expect(await terminalize(rejected.operationId)).toBe('ALREADY_TERMINAL');
  });

  it('reapplies the full partition when a conditional update changes zero rows', async () => {
    const item = await createStarted(true);
    await migrator.query(`
      CREATE FUNCTION public.f1b458_skip_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER f1b458_skip_update BEFORE UPDATE ON public.password_reset_operation
      FOR EACH ROW WHEN (OLD.reset_operation_id = '${item.operationId}'::uuid)
      EXECUTE FUNCTION public.f1b458_skip_update();
    `);
    try {
      expect(await terminalize(item.operationId)).toBe('INCONSISTENT');
    } finally {
      await migrator.query(
        `DROP TRIGGER f1b458_skip_update ON public.password_reset_operation; DROP FUNCTION public.f1b458_skip_update()`,
      );
    }
  });

  it('rolls back an injected PostgreSQL failure and the real adapter reports infrastructure failure', async () => {
    const item = await createStarted(true);
    await migrator.query(`
      CREATE FUNCTION public.f1b458_raise_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING MESSAGE='injected rollback', ERRCODE='P0001'; END $$;
      CREATE TRIGGER f1b458_raise_update BEFORE UPDATE ON public.password_reset_operation
      FOR EACH ROW WHEN (OLD.reset_operation_id = '${item.operationId}'::uuid)
      EXECUTE FUNCTION public.f1b458_raise_update();
    `);
    try {
      await expect(persistence.terminalize(item.operationId)).resolves.toBe(
        'INFRASTRUCTURE_ERROR',
      );
      expect(
        (
          await migrator.query<{ state: string }>(
            'SELECT state FROM public.password_reset_operation WHERE reset_operation_id=$1',
            [item.operationId],
          )
        ).rows[0]?.state,
      ).toBe('STARTED');
    } finally {
      await migrator.query(
        `DROP TRIGGER f1b458_raise_update ON public.password_reset_operation; DROP FUNCTION public.f1b458_raise_update()`,
      );
    }
  });

  it('reconciles a fault injected after a real commit without repeating the mutation', async () => {
    const item = await createStarted(true);
    let inject = true;
    const faulting = new PasswordResetTerminalizerPersistence({
      $transaction: async (
        callback: Parameters<PrismaService['$transaction']>[0],
      ) => {
        if (inject) {
          inject = false;
          expect(await terminalize(item.operationId, runtime2)).toBe(
            'TERMINALIZED',
          );
          throw Object.assign(new Error('connection lost after commit send'), {
            code: '08006',
          });
        }
        return prisma.$transaction(callback as never);
      },
    } as unknown as PrismaService);
    await expect(faulting.terminalize(item.operationId)).resolves.toBe(
      'TERMINALIZED',
    );
    expect(await terminalize(item.operationId)).toBe('ALREADY_TERMINAL');
  });

  it('keeps STARTED after a real rollback followed by injected connection loss', async () => {
    const item = await createStarted(true);
    let inject = true;
    const faulting = new PasswordResetTerminalizerPersistence({
      $transaction: async (
        callback: Parameters<PrismaService['$transaction']>[0],
      ) => {
        if (inject) {
          inject = false;
          await runtime2.query('BEGIN');
          expect(await terminalize(item.operationId, runtime2)).toBe(
            'TERMINALIZED',
          );
          await runtime2.query('ROLLBACK');
          throw Object.assign(new Error('connection lost before commit'), {
            code: '08006',
          });
        }
        return prisma.$transaction(callback as never);
      },
    } as unknown as PrismaService);
    await expect(faulting.terminalize(item.operationId)).resolves.toBe(
      'INDETERMINATE',
    );
    expect(
      (
        await migrator.query<{ state: string }>(
          'SELECT state FROM public.password_reset_operation WHERE reset_operation_id=$1',
          [item.operationId],
        )
      ).rows[0]?.state,
    ).toBe('STARTED');
  });

  it('treats a real backend connection termination as indeterminate and preserves rollback', async () => {
    const item = await createStarted(true);
    await migrator.query(`
      CREATE FUNCTION public.f1b458_pause_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        PERFORM pg_catalog.pg_sleep(10);
        RETURN NEW;
      END $$;
      CREATE TRIGGER f1b458_pause_update BEFORE UPDATE ON public.password_reset_operation
      FOR EACH ROW WHEN (OLD.reset_operation_id = '${item.operationId}'::uuid)
      EXECUTE FUNCTION public.f1b458_pause_update();
    `);
    try {
      const terminalization = persistence.terminalize(item.operationId);
      const pid = await waitForSleepingPrismaBackend();
      expect(
        (
          await admin.query<{ terminated: boolean }>(
            'SELECT pg_catalog.pg_terminate_backend($1) AS terminated',
            [pid],
          )
        ).rows[0]?.terminated,
      ).toBe(true);
      await expect(terminalization).resolves.toBe('INDETERMINATE');
      expect(
        (
          await migrator.query<{ state: string }>(
            'SELECT state FROM public.password_reset_operation WHERE reset_operation_id=$1',
            [item.operationId],
          )
        ).rows[0]?.state,
      ).toBe('STARTED');
    } finally {
      await migrator.query(
        `DROP TRIGGER f1b458_pause_update ON public.password_reset_operation; DROP FUNCTION public.f1b458_pause_update()`,
      );
    }
  });

  it('keeps a failed post-loss reconciliation indeterminate', async () => {
    const item = await createStarted(true);
    let inject = true;
    const faulting = new PasswordResetTerminalizerPersistence({
      $transaction: async (
        callback: Parameters<PrismaService['$transaction']>[0],
      ) => {
        if (inject) {
          inject = false;
          throw Object.assign(new Error('connection lost'), { code: '08006' });
        }
        return prisma.$transaction(callback as never);
      },
    } as unknown as PrismaService);
    await runtime.query('BEGIN');
    await runtime.query(
      'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
      [item.accountId],
    );
    try {
      await expect(faulting.terminalize(item.operationId)).resolves.toBe(
        'INDETERMINATE',
      );
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('enforces the real adapter lock timeout and bounded retries', async () => {
    const item = await createStarted(true);
    await runtime.query('BEGIN');
    await runtime.query(
      'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
      [item.accountId],
    );
    try {
      await expect(persistence.terminalize(item.operationId)).resolves.toBe(
        'INFRASTRUCTURE_ERROR',
      );
    } finally {
      await runtime.query('ROLLBACK');
    }
  }, 10_000);

  it('enforces the real adapter statement timeout on observation', async () => {
    await migrator.query(`
      ALTER FUNCTION public.find_abandoned_password_reset_operation()
        RENAME TO f1b458_original_find;
      CREATE FUNCTION public.find_abandoned_password_reset_operation()
      RETURNS TABLE (outcome text, reset_operation_id uuid)
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp
      AS $$ BEGIN
        PERFORM pg_catalog.pg_sleep(10);
        RETURN QUERY SELECT 'NO_CANDIDATE'::text,NULL::uuid;
      END $$;
      REVOKE ALL ON FUNCTION public.find_abandoned_password_reset_operation()
        FROM PUBLIC,bello_bootstrap_executor,bello_audit_maintenance;
      GRANT EXECUTE ON FUNCTION public.find_abandoned_password_reset_operation()
        TO bello_runtime;
    `);
    try {
      await expect(persistence.find()).rejects.toBeDefined();
    } finally {
      await migrator.query(`
        DROP FUNCTION public.find_abandoned_password_reset_operation();
        ALTER FUNCTION public.f1b458_original_find()
          RENAME TO find_abandoned_password_reset_operation;
      `);
    }
  }, 8_000);

  it('coordinates completion first and terminalization first through the same account lock', async () => {
    const completionFirst = await createStarted(true);
    await runtime2.query('BEGIN');
    await runtime2.query(
      'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
      [completionFirst.accountId],
    );
    const waiting = terminalize(completionFirst.operationId, runtime);
    await waitForAdvisoryBlock('f1b458-runtime-1');
    expect(await complete(completionFirst.operationId, runtime2)).toBe(
      'REJECTED',
    );
    await runtime2.query('COMMIT');
    expect(await waiting).toBe('ALREADY_TERMINAL');

    const terminalFirst = await createStarted(true);
    expect(await terminalize(terminalFirst.operationId)).toBe('TERMINALIZED');
    await expect(
      complete(terminalFirst.operationId, runtime2),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('keeps independent accounts progressing while another account lock is held', async () => {
    const blocked = await createStarted(true);
    const independent = await createStarted(true);
    await runtime.query('BEGIN');
    await runtime.query(
      'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
      [blocked.accountId],
    );
    try {
      await expect(
        terminalize(independent.operationId, runtime2),
      ).resolves.toBe('TERMINALIZED');
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('keeps reconciliation observational before and after terminalization', async () => {
    const item = await createStarted(true);
    expect(await reconcile(item.operationId)).toBe('UNKNOWN');
    expect(await terminalize(item.operationId)).toBe('TERMINALIZED');
    expect(await reconcile(item.operationId)).toBe('NOT_FOUND');
  });

  it('starts the 30-day proof window at terminal_at without deleting expired evidence', async () => {
    const item = await createStarted(true);
    expect(await terminalize(item.operationId)).toBe('TERMINALIZED');
    expect(await reconcile(item.operationId)).toBe('NOT_FOUND');
    await migrator.query(
      `UPDATE public.password_reset_operation
       SET started_at=transaction_timestamp()-interval '32 days',
           updated_at=transaction_timestamp()-interval '31 days',
           terminal_at=transaction_timestamp()-interval '31 days'
       WHERE reset_operation_id=$1`,
      [item.operationId],
    );
    expect(await reconcile(item.operationId)).toBe('UNKNOWN');
    expect(
      (
        await migrator.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM public.password_reset_operation WHERE reset_operation_id=$1',
          [item.operationId],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it('serializes reconciliation and terminalization in both lock orders', async () => {
    const reconcileFirst = await createStarted(true);
    await runtime.query('BEGIN');
    await runtime.query(
      'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
      [reconcileFirst.accountId],
    );
    expect(await reconcile(reconcileFirst.operationId, runtime)).toBe(
      'UNKNOWN',
    );
    const waitingTerminal = terminalize(reconcileFirst.operationId, runtime2);
    await waitForAdvisoryBlock('f1b458-runtime-2');
    await runtime.query('COMMIT');
    expect(await waitingTerminal).toBe('TERMINALIZED');

    const terminalFirst = await createStarted(true);
    await runtime.query('BEGIN');
    expect(await terminalize(terminalFirst.operationId, runtime)).toBe(
      'TERMINALIZED',
    );
    const waitingReconcile = reconcile(terminalFirst.operationId, runtime2);
    await waitForAdvisoryBlock('f1b458-runtime-2');
    await runtime.query('COMMIT');
    expect(await waitingReconcile).toBe('NOT_FOUND');
  });

  it('owns and protects all three interfaces with the exact runtime grant', async () => {
    const metadata = await migrator.query<{
      name: string;
      oid: number;
      owner: string;
      public_execute: boolean;
      security_definer: boolean;
      settings: string[];
    }>(
      `SELECT procedure.oid::int AS oid, procedure.proname AS name, role.rolname AS owner,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS settings,
              EXISTS (
                SELECT 1
                FROM pg_catalog.aclexplode(
                  COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
                ) AS privilege
                WHERE privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
              ) AS public_execute
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_roles AS role ON role.oid=procedure.proowner
       WHERE procedure.proname IN (
         'find_abandoned_password_reset_operation',
         'has_inconsistent_password_reset_operation',
         'terminalize_abandoned_password_reset_operation'
       ) ORDER BY procedure.proname`,
    );
    expect(metadata.rows).toHaveLength(3);
    for (const row of metadata.rows) {
      expect(row).toMatchObject({
        owner: 'bello_test_migrator',
        public_execute: false,
        security_definer: true,
      });
      expect(row.settings).toContain('search_path=pg_catalog, public, pg_temp');
      expect(
        (
          await migrator.query<{ allowed: boolean }>(
            `SELECT has_function_privilege('bello_runtime',$1::oid,'EXECUTE') AS allowed`,
            [row.oid],
          )
        ).rows[0]?.allowed,
      ).toBe(true);
      for (const role of [
        'bello_test_bootstrap',
        'bello_test_audit_maintenance',
      ]) {
        expect(
          (
            await migrator.query<{ allowed: boolean }>(
              `SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS allowed`,
              [role, row.oid],
            )
          ).rows[0]?.allowed,
        ).toBe(false);
      }
    }
  });

  it('resists pg_temp shadowing through qualified objects and protected search_path', async () => {
    await admin.query(
      `GRANT TEMPORARY ON DATABASE "${database}" TO bello_test_app`,
    );
    try {
      await runtime.query(
        'CREATE TEMP TABLE password_reset_operation (reset_operation_id uuid)',
      );
      const item = await createStarted(true);
      expect(await terminalize(item.operationId)).toBe('TERMINALIZED');
      await runtime.query('DROP TABLE pg_temp.password_reset_operation');
    } finally {
      await admin.query(
        `REVOKE TEMPORARY ON DATABASE "${database}" FROM bello_test_app`,
      );
    }
  });
});
