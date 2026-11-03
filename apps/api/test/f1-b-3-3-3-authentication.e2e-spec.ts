import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AuthSessionPersistence } from '../src/auth/auth-session.persistence.js';
import {
  AUTHENTICATION_ERROR_CODE,
  AuthenticationError,
  AuthenticationService,
  type AuthenticateWithPasswordInput,
} from '../src/auth/authentication.service.js';
import { hashSessionToken } from '../src/auth/session-primitives.js';
import { PasswordCredentialService } from '../src/credentials/password-credential.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

describe('F1-B.3.3.3 password authentication (PostgreSQL)', () => {
  const password = 'Correct horse battery staple! 42';
  const replacementPassword = 'Replacement credential secret 73';
  const email = 'user@example.com';
  const migrator = new Client({
    connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
  });
  const prisma = new PrismaService();
  const credentials = new PasswordCredentialService();
  const sessions = new AuthSessionPersistence(prisma);
  const service = new AuthenticationService(prisma, credentials, sessions);
  let passwordHash: string;
  let replacementHash: string;

  async function resetData(): Promise<void> {
    if (process.env.BELLO_EPHEMERAL_TEST_DATABASE !== 'true') {
      throw new Error('F1-B tests require an explicitly ephemeral database');
    }
    const identity = await migrator.query<{ database: string; user: string }>(
      'SELECT current_database() AS database, current_user AS "user"',
    );
    expect(identity.rows[0]).toEqual({
      database: 'bello_test',
      user: 'bello_test_migrator',
    });

    await migrator.query(
      'DROP TRIGGER IF EXISTS _f1b333_audit_failure ON public.audit_event',
    );
    await migrator.query(
      'DROP FUNCTION IF EXISTS public._f1b333_audit_failure()',
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
  }

  async function createAccount(
    options: {
      status?: 'ACTIVE' | 'INACTIVE';
      verified?: boolean;
      deactivated?: boolean;
      credential?: boolean;
      hash?: string;
    } = {},
  ): Promise<string> {
    const accountId = randomUUID();
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES (
         $1, 'Authentication', 'Test', $2, $2,
         CASE WHEN $3 THEN pg_catalog.clock_timestamp() ELSE NULL END,
         $4, pg_catalog.clock_timestamp(),
         CASE WHEN $5 THEN pg_catalog.clock_timestamp() ELSE NULL END
       )`,
      [
        accountId,
        email,
        options.verified ?? true,
        options.status ?? 'ACTIVE',
        options.deactivated ?? false,
      ],
    );
    if (options.credential !== false) {
      await migrator.query(
        `INSERT INTO public.password_credential (
           account_id, password_hash, changed_at
         ) VALUES ($1, $2, pg_catalog.clock_timestamp())`,
        [accountId, options.hash ?? passwordHash],
      );
    }
    return accountId;
  }

  async function failure(
    input: AuthenticateWithPasswordInput,
  ): Promise<AuthenticationError> {
    try {
      await service.authenticateWithPassword(input);
      throw new Error('Expected authentication to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthenticationError);
      return error as AuthenticationError;
    }
  }

  async function counts(): Promise<{ sessions: number; events: number }> {
    const result = await migrator.query<{ sessions: number; events: number }>(`
      SELECT
        (SELECT count(*)::integer FROM public.auth_session) AS sessions,
        (SELECT count(*)::integer FROM public.audit_event) AS events
    `);
    return result.rows[0]!;
  }

  beforeAll(async () => {
    passwordHash = await credentials.hashPassword(password);
    replacementHash = await credentials.hashPassword(replacementPassword);
    await migrator.connect();
    await prisma.onModuleInit();
  });

  beforeEach(resetData);

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await migrator.query(
      'DROP TRIGGER IF EXISTS _f1b333_audit_failure ON public.audit_event',
    );
    await migrator.query(
      'DROP FUNCTION IF EXISTS public._f1b333_audit_failure()',
    );
    await prisma.onModuleDestroy();
    await migrator.end();
  });

  it('authenticates a normalized identity and persists only the token hash', async () => {
    const accountId = await createAccount();

    const result = await service.authenticateWithPassword({
      email: '  USER@Example.COM  ',
      password,
    });
    const evidence = await migrator.query<{
      token_hash: Buffer;
      operation: string;
      result: string;
      context: Record<string, unknown>;
    }>(
      `SELECT session.token_hash, event.operation, event.result, event.context
       FROM public.auth_session AS session
       JOIN public.audit_event AS event
         ON event.operation_id = session.created_operation_id
       WHERE session.id = $1`,
      [result.sessionId],
    );

    expect(result.accountId).toBe(accountId);
    expect(result.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.absoluteExpiresAt).toBeInstanceOf(Date);
    expect(evidence.rows).toEqual([
      {
        token_hash: hashSessionToken(result.token),
        operation: 'AUTH_LOGIN_SUCCEEDED',
        result: 'SUCCESS',
        context: { authentication_type: 'PASSWORD' },
      },
    ]);
    expect(JSON.stringify(evidence.rows)).not.toContain(result.token);
  });

  it('classifies malformed email and password as invalid input after auditing', async () => {
    await createAccount();

    const emailError = await failure({
      email: 'inválido@example.com',
      password,
    });
    const passwordError = await failure({ email, password: 'short' });
    const evidence = await migrator.query<{
      operation_id: string;
      actor_account_id: string | null;
    }>(
      `SELECT operation_id, actor_account_id
       FROM public.audit_event ORDER BY occurred_at`,
    );

    expect(emailError.code).toBe(AUTHENTICATION_ERROR_CODE.INVALID_INPUT);
    expect(passwordError.code).toBe(AUTHENTICATION_ERROR_CODE.INVALID_INPUT);
    expect(evidence.rows).toEqual([
      { operation_id: emailError.operationId, actor_account_id: null },
      {
        operation_id: passwordError.operationId,
        actor_account_id: expect.any(String),
      },
    ]);
    expect((await counts()).sessions).toBe(0);
  });

  it.each([
    ['wrong password', { account: {}, password: replacementPassword }],
    ['unknown account', { account: null, password }],
    ['missing credential', { account: { credential: false }, password }],
    ['inactive account', { account: { status: 'INACTIVE' }, password }],
    ['unverified account', { account: { verified: false }, password }],
    ['deactivated account', { account: { deactivated: true }, password }],
  ] as const)(
    'returns a uniform rejection and no session for %s',
    async (_name, scenario) => {
      if (scenario.account !== null) {
        await createAccount(scenario.account);
      }

      const error = await failure({ email, password: scenario.password });

      expect(error.code).toBe(
        AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
      );
      expect(await counts()).toEqual({ sessions: 0, events: 1 });
    },
  );

  it('treats an invalid stored hash profile as an unaudited operational failure', async () => {
    await createAccount({
      hash: passwordHash.replace('m=65536', 'm=32768'),
    });

    const error = await failure({ email, password });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE);
    expect(await counts()).toEqual({ sessions: 0, events: 0 });
  });

  it('preserves an audit failure as indeterminate without a session', async () => {
    await createAccount();
    await migrator.query(`
      CREATE FUNCTION public._f1b333_audit_failure()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.operation = 'AUTH_LOGIN_FAILED' THEN
          RAISE EXCEPTION 'controlled authentication audit failure';
        END IF;
        RETURN NEW;
      END
      $function$;
      CREATE TRIGGER _f1b333_audit_failure
      BEFORE INSERT ON public.audit_event
      FOR EACH ROW EXECUTE FUNCTION public._f1b333_audit_failure()
    `);

    const error = await failure({ email, password: replacementPassword });

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE);
    expect(await counts()).toEqual({ sessions: 0, events: 0 });
  });

  it('rejects and audits a credential changed after password verification', async () => {
    const accountId = await createAccount();
    const verifyPassword = credentials.verifyPassword.bind(credentials);
    vi.spyOn(credentials, 'verifyPassword').mockImplementationOnce(
      async (...parameters) => {
        const result = await verifyPassword(...parameters);
        await migrator.query(
          `UPDATE public.password_credential
           SET password_hash = $2, changed_at = pg_catalog.clock_timestamp()
           WHERE account_id = $1`,
          [accountId, replacementHash],
        );
        return result;
      },
    );

    const error = await failure({ email, password });
    const evidence = await migrator.query<{
      operation: string;
      actor_account_id: string;
    }>('SELECT operation, actor_account_id FROM public.audit_event');

    expect(error.code).toBe(AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED);
    expect(evidence.rows).toEqual([
      { operation: 'AUTH_LOGIN_FAILED', actor_account_id: accountId },
    ]);
    expect((await counts()).sessions).toBe(0);
  });

  it('keeps sensitive authentication values out of denied audit events', async () => {
    await createAccount();
    const error = await failure({ email, password: replacementPassword });
    const evidence = await migrator.query<Record<string, unknown>>(
      'SELECT * FROM public.audit_event WHERE operation_id = $1',
      [error.operationId],
    );
    const serialized = JSON.stringify(evidence.rows);

    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(replacementPassword);
    expect(serialized).not.toContain('$argon2id$');
    expect(serialized).not.toContain('token');
  });
});
