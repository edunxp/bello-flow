import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { Argon2ExecutionService } from '../src/auth/argon2-execution.service.js';
import { PasswordRecoveryAdmissionService } from '../src/auth/password-recovery-admission.service.js';
import { PasswordResetPersistence } from '../src/auth/password-reset.persistence.js';
import {
  hashCanonicalPasswordResetToken,
  PasswordResetService,
} from '../src/auth/password-reset.service.js';
import { PasswordCredentialService } from '../src/credentials/password-credential.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const migrationNames = [
  '20261102000000_f1_a_1_identity_foundation',
  '20261102010000_f1_b_2_1_auth_session',
  '20261103000000_f1_b_3_3_2_failed_login_reconciliation',
  '20261104000000_f1_b_4_5_1_password_recovery_foundation',
  '20261105000000_f1_b_4_5_2_1_physical_advisory_lock',
  '20261106000000_f1_b_4_5_2_2_start_password_reset',
  '20261107000000_f1_b_4_5_2_3_complete_password_reset',
  '20261108000000_f1_b_4_5_2_4_reconcile_password_reset',
  '20261109000000_f1_b_4_5_4_password_recovery_request',
] as const;

const oldPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';
const newPassword = 'new synthetic password';

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

describe('F1-B.4.5.5 password reset NestJS use case', () => {
  const admin = new Client({
    connectionString: requiredUrl('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b455_main_${randomUUID().replaceAll('-', '')}`;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let migrator: Client;
  let prisma: PrismaService;
  let persistence: PasswordResetPersistence;
  let credentials: PasswordCredentialService;
  let executor: Argon2ExecutionService;
  let databaseCreated = false;

  async function createFixture(options: { expired?: boolean } = {}) {
    const accountId = randomUUID();
    const changedOperationId = randomUUID();
    const requestId = randomUUID();
    const attemptId = randomUUID();
    const tokenId = randomUUID();
    const sessionId = randomUUID();
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashCanonicalPasswordResetToken(rawToken);
    if (!tokenHash) throw new Error('generated token must be canonical');
    const createdAt = new Date(
      Date.now() - (options.expired === true ? 31 * 60_000 : 60_000),
    );
    const email = `${accountId.replaceAll('-', '')}@example.test`;

    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES ($1, 'Test', 'Account', $2, $2, $3, 'ACTIVE', $3, NULL)`,
      [accountId, email, createdAt],
    );
    await migrator.query(
      `INSERT INTO public.password_credential (
         account_id, password_hash, changed_at, changed_operation_id
       ) VALUES ($1, $2, $3, $4)`,
      [accountId, oldPasswordHash, createdAt, changedOperationId],
    );
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
         created_at, expires_at, consumed_at, consumed_operation_id,
         invalidated_at, invalidated_operation_id
       ) VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '30 minutes',
                 NULL, NULL, NULL, NULL)`,
      [tokenId, attemptId, accountId, Buffer.from(tokenHash), createdAt],
    );
    await migrator.query(
      `INSERT INTO public.auth_session (
         id, account_id, token_hash, created_at, last_activity_at,
         absolute_expires_at, created_operation_id, revoked_at,
         revocation_reason, revoked_operation_id
       ) VALUES ($1, $2, $3, $4, $4, $4::timestamptz + INTERVAL '168 hours',
                 $5, NULL, NULL, NULL)`,
      [sessionId, accountId, randomBytes(32), createdAt, randomUUID()],
    );
    return { accountId, rawToken, requestId, sessionId, tokenId };
  }

  function createService(
    adapter: PasswordResetPersistence = persistence,
  ): PasswordResetService {
    return new PasswordResetService(
      new PasswordRecoveryAdmissionService({
        now: () => Date.now(),
        schedule: () => () => undefined,
      }),
      adapter,
      executor,
      credentials,
    );
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
    expect(database).toMatch(/^bello_f1b455_[a-z]+_[a-f0-9]{32}$/);

    await admin.query(
      `CREATE DATABASE "${database}" OWNER bello_test_migrator`,
    );
    databaseCreated = true;
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE "${database}"
       TO bello_test_app, bello_test_migrator`,
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

    process.env.DATABASE_URL = urlForDatabase('DATABASE_URL', database);
    prisma = new PrismaService();
    await prisma.onModuleInit();
    persistence = new PasswordResetPersistence(prisma);
    credentials = new PasswordCredentialService();
    executor = new Argon2ExecutionService(
      {
        identityBucketsMax: 100,
        ipBucketsMax: 100,
        concurrency: 2,
        queueMax: 4,
        waitTimeoutMs: 1_000,
      },
      {
        now: () => Date.now(),
        schedule: (callback, delayMs) => {
          const timer = setTimeout(callback, delayMs);
          return () => clearTimeout(timer);
        },
      },
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy().catch(() => undefined);
    await migrator?.end().catch(() => undefined);
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (databaseCreated) {
      expect(database).toMatch(/^bello_f1b455_[a-z]+_[a-f0-9]{32}$/);
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await admin.end();
  });

  it('chains STARTED, shared Argon2id and atomic completion with session revocation', async () => {
    const fixture = await createFixture();
    await expect(
      createService().reset({
        token: fixture.rawToken,
        newPassword,
        trustedIp: '192.0.2.101',
      }),
    ).resolves.toEqual({ status: 'COMPLETED' });

    const state = await migrator.query<{
      password_hash: string;
      consumed_operation_id: string;
      operation_state: string;
      revoked_operation_id: string;
      revocation_reason: string;
    }>(
      `SELECT credential.password_hash, token.consumed_operation_id,
              operation.state AS operation_state,
              session.revoked_operation_id, session.revocation_reason
       FROM public.password_credential AS credential
       JOIN public.password_reset_token AS token ON token.account_id = credential.account_id
       JOIN public.password_reset_operation AS operation
         ON operation.reset_operation_id = token.consumed_operation_id
       JOIN public.auth_session AS session ON session.account_id = credential.account_id
       WHERE credential.account_id = $1 AND token.password_reset_token_id = $2
         AND session.id = $3`,
      [fixture.accountId, fixture.tokenId, fixture.sessionId],
    );
    expect(state.rows[0]).toMatchObject({
      operation_state: 'COMPLETED',
      revocation_reason: 'PASSWORD_RESET',
    });
    expect(state.rows[0]?.consumed_operation_id).toBe(
      state.rows[0]?.revoked_operation_id,
    );
    await expect(
      credentials.verifyPassword(newPassword, state.rows[0]?.password_hash),
    ).resolves.toEqual({ status: 'MATCH' });
    const audit = await migrator.query<{ count: number }>(
      `SELECT pg_catalog.count(*)::integer AS count
       FROM public.audit_event
       WHERE operation_id = $1 AND operation = 'AUTH_PASSWORD_RESET_SUCCEEDED'`,
      [state.rows[0]?.consumed_operation_id],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('rejects unresolved and expired tokens before Argon2id without exposing the cause', async () => {
    const hashSpy = vi.spyOn(credentials, 'hashPassword');
    const expired = await createFixture({ expired: true });
    try {
      await expect(
        createService().reset({
          token: randomBytes(32).toString('base64url'),
          newPassword,
          trustedIp: '192.0.2.102',
        }),
      ).resolves.toEqual({ status: 'AUTHENTICATION_FAILED' });
      await expect(
        createService().reset({
          token: expired.rawToken,
          newPassword,
          trustedIp: '192.0.2.103',
        }),
      ).resolves.toEqual({ status: 'AUTHENTICATION_FAILED' });
      expect(hashSpy).not.toHaveBeenCalled();
    } finally {
      hashSpy.mockRestore();
    }
  });

  it('reconciles a possibly committed completion without repeating the mutation', async () => {
    const fixture = await createFixture();
    const complete = vi.fn(async (input) => {
      await persistence.complete(input);
      throw new Error('connection lost after possible commit');
    });
    const adapter = {
      start: persistence.start.bind(persistence),
      complete,
      reconcile: persistence.reconcile.bind(persistence),
    } as unknown as PasswordResetPersistence;
    await expect(
      createService(adapter).reset({
        token: fixture.rawToken,
        newPassword,
        trustedIp: '192.0.2.104',
      }),
    ).resolves.toEqual({ status: 'COMPLETED' });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('does not hash or repeat after an indeterminate start persisted STARTED', async () => {
    const fixture = await createFixture();
    const hashSpy = vi.spyOn(credentials, 'hashPassword');
    const start = vi.fn(async (input) => {
      await persistence.start(input);
      throw new Error('connection lost after possible start commit');
    });
    const adapter = {
      start,
      complete: persistence.complete.bind(persistence),
      reconcile: persistence.reconcile.bind(persistence),
    } as unknown as PasswordResetPersistence;
    try {
      await expect(
        createService(adapter).reset({
          token: fixture.rawToken,
          newPassword,
          trustedIp: '192.0.2.105',
        }),
      ).resolves.toEqual({ status: 'SERVICE_UNAVAILABLE' });
      expect(start).toHaveBeenCalledOnce();
      expect(hashSpy).not.toHaveBeenCalled();
      const marker = await migrator.query<{ state: string }>(
        `SELECT state FROM public.password_reset_operation
         WHERE password_reset_token_id = $1`,
        [fixture.tokenId],
      );
      expect(marker.rows).toEqual([{ state: 'STARTED' }]);
    } finally {
      hashSpy.mockRestore();
    }
  });

  it('serializes concurrent use of the same token and permits exactly one completion', async () => {
    const fixture = await createFixture();
    const service = createService();
    const results = await Promise.all([
      service.reset({
        token: fixture.rawToken,
        newPassword,
        trustedIp: '192.0.2.106',
      }),
      service.reset({
        token: fixture.rawToken,
        newPassword: 'another synthetic password',
        trustedIp: '192.0.2.107',
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'AUTHENTICATION_FAILED',
      'COMPLETED',
    ]);
    const effects = await migrator.query<{
      completed: number;
      consumed: number;
      success_audits: number;
    }>(
      `SELECT
         (SELECT pg_catalog.count(*)::integer
          FROM public.password_reset_operation
          WHERE password_reset_token_id = $1 AND state = 'COMPLETED') AS completed,
         (SELECT pg_catalog.count(*)::integer
          FROM public.password_reset_token
          WHERE password_reset_token_id = $1 AND consumed_at IS NOT NULL) AS consumed,
         (SELECT pg_catalog.count(*)::integer
          FROM public.audit_event
          WHERE entity_id = $2 AND operation = 'AUTH_PASSWORD_RESET_SUCCEEDED') AS success_audits`,
      [fixture.tokenId, fixture.accountId],
    );
    expect(effects.rows[0]).toEqual({
      completed: 1,
      consumed: 1,
      success_audits: 1,
    });
  });
});
