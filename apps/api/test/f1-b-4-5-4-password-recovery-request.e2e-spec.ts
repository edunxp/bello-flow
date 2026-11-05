import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, DatabaseError } from 'pg';
import { PasswordRecoveryAdmissionService } from '../src/auth/password-recovery-admission.service.js';
import { PasswordRecoveryRequestPersistence } from '../src/auth/password-recovery-request.persistence.js';
import { PasswordRecoveryRequestService } from '../src/auth/password-recovery-request.service.js';
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

const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

type AccountOptions = {
  credential?: boolean;
  emailVerified?: boolean;
  status?: 'ACTIVE' | 'INACTIVE';
  deactivated?: boolean;
};

type RequestRow = {
  account_id: string | null;
  cancelled_operation_id: string | null;
  current_attempt_number: number;
  received_at: Date;
  recovery_request_id: string;
  state: string;
  terminal_at: Date | null;
};

type ProgressState =
  | 'PREPARING'
  | 'PREPARED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'UNKNOWN'
  | 'CANCELLED';

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

describe('F1-B.4.5.4 password recovery request and classification', () => {
  const admin = new Client({
    connectionString: requiredUrl('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b454_main_${randomUUID().replaceAll('-', '')}`;
  let migrator: Client;
  let runtime: Client;
  let bootstrap: Client;
  let maintenance: Client;
  let databaseCreated = false;

  async function createAccount(
    options: AccountOptions = {},
  ): Promise<{ accountId: string; emailKey: string }> {
    const accountId = randomUUID();
    const emailKey = `${accountId.replaceAll('-', '')}@example.test`;
    const now = new Date();
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
        emailKey,
        options.emailVerified !== false,
        now,
        options.status ?? 'ACTIVE',
        options.deactivated === true,
      ],
    );
    if (options.credential !== false) {
      await migrator.query(
        `INSERT INTO public.password_credential (
           account_id, password_hash, changed_at, changed_operation_id
         ) VALUES ($1, $2, $3, $4)`,
        [accountId, validPasswordHash, now, randomUUID()],
      );
    }
    return { accountId, emailKey };
  }

  async function requestRecovery(
    client: Client,
    recoveryRequestId: string | null,
    auditEventId: string | null,
    emailKey: string | null,
  ): Promise<string> {
    const result = await client.query<{ outcome: string }>(
      `SELECT outcome
       FROM public.request_password_recovery($1, $2, $3)`,
      [recoveryRequestId, auditEventId, emailKey],
    );
    return result.rows[0]!.outcome;
  }

  async function reconcile(
    client: Client,
    recoveryRequestId: string | null,
  ): Promise<string> {
    const result = await client.query<{ outcome: string }>(
      `SELECT outcome
       FROM public.reconcile_password_recovery_request($1)`,
      [recoveryRequestId],
    );
    return result.rows[0]!.outcome;
  }

  async function readRequest(recoveryRequestId: string): Promise<RequestRow> {
    const result = await migrator.query<RequestRow>(
      `SELECT recovery_request_id, account_id, state, received_at, terminal_at,
              current_attempt_number, cancelled_operation_id
       FROM public.password_recovery_request
       WHERE recovery_request_id = $1`,
      [recoveryRequestId],
    );
    return result.rows[0]!;
  }

  async function countAudit(recoveryRequestId: string): Promise<number> {
    const result = await migrator.query<{ count: number }>(
      `SELECT pg_catalog.count(*)::integer AS count
       FROM public.audit_event
       WHERE operation_id = $1 OR correlation_id = $1`,
      [recoveryRequestId],
    );
    return result.rows[0]!.count;
  }

  async function insertAuditEvidence(input: {
    auditEventId?: string;
    correlationId: string;
    entityId: string;
    occurredAt?: Date;
    operationId: string;
  }): Promise<string> {
    const auditEventId = input.auditEventId ?? randomUUID();
    await migrator.query(
      `INSERT INTO public.audit_event (
         id, occurred_at, actor_account_id, origin, scope, operation, result,
         entity_type, entity_id, before_data, after_data, context,
         correlation_id, operation_id, sequence
       ) VALUES (
         $1, $2, NULL, 'HTTP_API', 'SECURITY',
         'AUTH_PASSWORD_RECOVERY_REQUESTED', 'SUCCESS', 'ACCOUNT', $3,
         NULL, NULL, NULL, $4, $5, 1
       )`,
      [
        auditEventId,
        input.occurredAt ?? new Date(),
        input.entityId,
        input.correlationId,
        input.operationId,
      ],
    );
    return auditEventId;
  }

  async function insertRecordedRequest(
    client: Client,
    accountId: string,
    receivedAt: Date,
    state: 'PENDING' | 'SENT' = 'PENDING',
  ): Promise<string> {
    const requestId = randomUUID();
    await client.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES (
         $1, $2, $3::varchar(20), $4, $4,
         CASE WHEN $3::varchar(20) = 'SENT' THEN $4::timestamptz ELSE NULL END,
         0, NULL
       )`,
      [requestId, accountId, state, receivedAt],
    );
    await client.query(
      `INSERT INTO public.audit_event (
         id, occurred_at, actor_account_id, origin, scope, operation, result,
         entity_type, entity_id, before_data, after_data, context,
         correlation_id, operation_id, sequence
       ) VALUES (
         $1, $2, NULL, 'HTTP_API', 'SECURITY',
         'AUTH_PASSWORD_RECOVERY_REQUESTED', 'SUCCESS', 'ACCOUNT', $3,
         NULL, NULL, NULL, $4, $4, 1
       )`,
      [randomUUID(), receivedAt, accountId, requestId],
    );
    return requestId;
  }

  async function createActiveTokens(
    accountId: string,
    count: number,
    disposition: 'ACTIVE' | 'EXPIRED' | 'CONSUMED' | 'INVALIDATED' = 'ACTIVE',
  ): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const requestId = randomUUID();
      const attemptId = randomUUID();
      const tokenId = randomUUID();
      const createdAt = new Date(
        Date.now() - (disposition === 'EXPIRED' ? 31 * 60_000 : 60_000),
      );
      const terminalOperationId = randomUUID();
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
         ) VALUES ($1, $2, $3, $4, $5,
                   $5::timestamptz + INTERVAL '30 minutes',
                   CASE WHEN $6 = 'CONSUMED' THEN $5::timestamptz + INTERVAL '1 minute' ELSE NULL END,
                   CASE WHEN $6 = 'CONSUMED' THEN $7::uuid ELSE NULL END,
                   CASE WHEN $6 = 'INVALIDATED' THEN $5::timestamptz + INTERVAL '1 minute' ELSE NULL END,
                   CASE WHEN $6 = 'INVALIDATED' THEN $7::uuid ELSE NULL END)`,
        [
          tokenId,
          attemptId,
          accountId,
          randomBytes(32),
          createdAt,
          disposition,
          terminalOperationId,
        ],
      );
    }
  }

  async function waitForAdvisoryBlock(
    waitingPid: number,
    blockingPid: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const blocked = await migrator.query<{ blocked: boolean }>(
        `SELECT $2::integer = ANY(pg_catalog.pg_blocking_pids($1::integer)) AS blocked`,
        [waitingPid, blockingPid],
      );
      if (blocked.rows[0]?.blocked) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error('expected advisory lock wait was not observed');
  }

  async function advanceRecordedRequest(
    requestId: string,
    state: ProgressState,
  ): Promise<void> {
    const request = await readRequest(requestId);
    if (!request.account_id) throw new Error('known account request required');

    const attemptId = randomUUID();
    const scheduledAt = new Date(request.received_at.getTime() + 1);
    const leaseId = ['PREPARING', 'PREPARED', 'SENDING'].includes(state)
      ? randomUUID()
      : null;
    const leaseExpiresAt = leaseId
      ? new Date(scheduledAt.getTime() + 60_000)
      : null;
    const sendingConfirmedAt = [
      'SENDING',
      'SENT',
      'UNKNOWN',
      'FAILED',
    ].includes(state)
      ? scheduledAt
      : null;
    const terminalAt = ['SENT', 'FAILED', 'UNKNOWN', 'CANCELLED'].includes(
      state,
    )
      ? scheduledAt
      : null;
    const failureClass = state === 'FAILED' ? 'DELIVERY_FAILURE' : null;
    const cancelledOperationId = state === 'CANCELLED' ? randomUUID() : null;

    await migrator.query(
      `INSERT INTO public.password_recovery_delivery_attempt (
         delivery_attempt_id, recovery_request_id, attempt_number, state,
         scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
         accepted_at, terminal_at, failure_class, cancelled_operation_id
       ) VALUES (
         $1, $2, 1, $3::varchar(20), $4, $5, $6, $7,
         CASE WHEN $3::varchar(20) = 'SENT' THEN $4::timestamptz ELSE NULL END,
         $8, $9, $10
       )`,
      [
        attemptId,
        requestId,
        state,
        scheduledAt,
        leaseId,
        leaseExpiresAt,
        sendingConfirmedAt,
        terminalAt,
        failureClass,
        cancelledOperationId,
      ],
    );

    if (state !== 'PREPARING') {
      const invalidatedAt = state === 'CANCELLED' ? scheduledAt : null;
      await migrator.query(
        `INSERT INTO public.password_reset_token (
           password_reset_token_id, delivery_attempt_id, account_id, token_hash,
           created_at, expires_at, consumed_at, consumed_operation_id,
           invalidated_at, invalidated_operation_id
         ) VALUES (
           $1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '30 minutes',
           NULL, NULL, $6, $7
         )`,
        [
          randomUUID(),
          attemptId,
          request.account_id,
          randomBytes(32),
          scheduledAt,
          invalidatedAt,
          invalidatedAt ? cancelledOperationId : null,
        ],
      );
    }

    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = $2, updated_at = $3, terminal_at = $4,
           current_attempt_number = 1, cancelled_operation_id = $5
       WHERE recovery_request_id = $1`,
      [requestId, state, scheduledAt, terminalAt, cancelledOperationId],
    );
  }

  async function insertAttemptEvidence(input: {
    attemptNumber: number;
    failureClass?: 'PREPARATION_FAILURE' | 'DELIVERY_FAILURE';
    requestId: string;
    scheduledAt: Date;
    state: 'PREPARING' | 'PREPARED' | 'FAILED';
  }): Promise<string> {
    const attemptId = randomUUID();
    const active = input.state !== 'FAILED';
    const failureClass =
      input.state === 'FAILED'
        ? (input.failureClass ?? 'DELIVERY_FAILURE')
        : null;
    const deliveryFailure = failureClass === 'DELIVERY_FAILURE';
    await migrator.query(
      `INSERT INTO public.password_recovery_delivery_attempt (
         delivery_attempt_id, recovery_request_id, attempt_number, state,
         scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
         accepted_at, terminal_at, failure_class, cancelled_operation_id
       ) VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $6 THEN $7::uuid ELSE NULL END,
         CASE WHEN $6 THEN $5::timestamptz + INTERVAL '1 minute' ELSE NULL END,
         CASE WHEN $8 THEN $5::timestamptz ELSE NULL END,
         NULL,
         CASE WHEN $6 THEN NULL ELSE $5::timestamptz + INTERVAL '1 second' END,
         $9,
         NULL
       )`,
      [
        attemptId,
        input.requestId,
        input.attemptNumber,
        input.state,
        input.scheduledAt,
        active,
        active ? randomUUID() : null,
        deliveryFailure,
        failureClass,
      ],
    );
    return attemptId;
  }

  async function insertTokenEvidence(input: {
    accountId: string;
    attemptId: string;
    consumedAt?: Date;
    createdAt: Date;
    invalidatedAt?: Date;
    invalidatedOperationId?: string;
  }): Promise<void> {
    await migrator.query(
      `INSERT INTO public.password_reset_token (
         password_reset_token_id, delivery_attempt_id, account_id, token_hash,
         created_at, expires_at, consumed_at, consumed_operation_id,
         invalidated_at, invalidated_operation_id
       ) VALUES (
         $1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '30 minutes',
         $6, CASE WHEN $6::timestamptz IS NULL THEN NULL ELSE $7::uuid END,
         $8, CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE $9::uuid END
       )`,
      [
        randomUUID(),
        input.attemptId,
        input.accountId,
        randomBytes(32),
        input.createdAt,
        input.consumedAt ?? null,
        input.consumedAt ? randomUUID() : null,
        input.invalidatedAt ?? null,
        input.invalidatedAt
          ? (input.invalidatedOperationId ?? randomUUID())
          : null,
      ],
    );
  }

  async function setRequestProgress(input: {
    attemptNumber: number;
    cancelledOperationId?: string;
    requestId: string;
    state: 'PREPARING' | 'PREPARED' | 'FAILED' | 'CANCELLED';
    terminalAt?: Date;
    updatedAt: Date;
  }): Promise<void> {
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = $2, updated_at = $3, current_attempt_number = $4,
           terminal_at = $5, cancelled_operation_id = $6
       WHERE recovery_request_id = $1`,
      [
        input.requestId,
        input.state,
        input.updatedAt,
        input.attemptNumber,
        input.terminalAt ?? null,
        input.cancelledOperationId ?? null,
      ],
    );
  }

  async function evidenceSnapshot(requestIds: readonly string[]) {
    const requests = await migrator.query(
      `SELECT * FROM public.password_recovery_request
       WHERE recovery_request_id = ANY($1::uuid[])
       ORDER BY recovery_request_id`,
      [requestIds],
    );
    const attempts = await migrator.query(
      `SELECT * FROM public.password_recovery_delivery_attempt
       WHERE recovery_request_id = ANY($1::uuid[])
       ORDER BY recovery_request_id, attempt_number`,
      [requestIds],
    );
    const tokens = await migrator.query(
      `SELECT token.*
       FROM public.password_reset_token AS token
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.delivery_attempt_id = token.delivery_attempt_id
       WHERE attempt.recovery_request_id = ANY($1::uuid[])
       ORDER BY token.password_reset_token_id`,
      [requestIds],
    );
    const audits = await migrator.query(
      `SELECT * FROM public.audit_event
       WHERE operation_id = ANY($1::uuid[]) OR correlation_id = ANY($1::uuid[])
       ORDER BY id`,
      [requestIds],
    );
    return {
      requests: requests.rows,
      attempts: attempts.rows,
      tokens: tokens.rows,
      audits: audits.rows,
    };
  }

  async function expectObservationalReconciliation(
    requestId: string,
    outcome: 'RECORDED' | 'INCONSISTENT',
  ): Promise<void> {
    const unrelatedId = randomUUID();
    await requestRecovery(runtime, unrelatedId, randomUUID(), null);
    const ids = [requestId, unrelatedId];
    const before = await evidenceSnapshot(ids);
    await expect(reconcile(runtime, requestId)).resolves.toBe(outcome);
    expect(await evidenceSnapshot(ids)).toEqual(before);
  }

  async function createPreparationFailureEvidence(input: {
    tokenCreatedOffsetMs?: number;
    tokenInvalidatedOffsetMs?: number;
    withToken: boolean;
  }): Promise<{ requestId: string; scheduledAt: Date; terminalAt: Date }> {
    const { accountId, emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    const request = await readRequest(requestId);
    const scheduledAt = new Date(request.received_at.getTime() + 1_000);
    const terminalAt = new Date(scheduledAt.getTime() + 1_000);
    const attemptId = await insertAttemptEvidence({
      attemptNumber: 1,
      failureClass: 'PREPARATION_FAILURE',
      requestId,
      scheduledAt,
      state: 'FAILED',
    });
    if (input.withToken) {
      await insertTokenEvidence({
        accountId,
        attemptId,
        createdAt: new Date(
          scheduledAt.getTime() + (input.tokenCreatedOffsetMs ?? 0),
        ),
        invalidatedAt: new Date(
          scheduledAt.getTime() + (input.tokenInvalidatedOffsetMs ?? 1_000),
        ),
      });
    }
    await setRequestProgress({
      attemptNumber: 1,
      requestId,
      state: 'FAILED',
      terminalAt,
      updatedAt: terminalAt,
    });
    return { requestId, scheduledAt, terminalAt };
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
    expect(database).toMatch(/^bello_f1b454_[a-z]+_[a-f0-9]{32}$/);

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
      expect(database).toMatch(/^bello_f1b454_[a-z]+_[a-f0-9]{32}$/);
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await admin.end();
  });

  it('P01 records an eligible account as PENDING with one minimal audit event', async () => {
    const { accountId, emailKey } = await createAccount();
    const requestId = randomUUID();
    const auditId = randomUUID();
    await expect(
      requestRecovery(runtime, requestId, auditId, emailKey),
    ).resolves.toBe('RECORDED');
    expect(await readRequest(requestId)).toMatchObject({
      account_id: accountId,
      state: 'PENDING',
      terminal_at: null,
    });
    const audit = await migrator.query(
      `SELECT * FROM public.audit_event WHERE id = $1`,
      [auditId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_account_id: null,
      operation: 'AUTH_PASSWORD_RECOVERY_REQUESTED',
      result: 'SUCCESS',
      entity_id: accountId,
      correlation_id: requestId,
      operation_id: requestId,
      sequence: 1,
      context: null,
      before_data: null,
      after_data: null,
    });
  });

  it('P02 records a nonexistent account opaquely as SUPPRESSED', async () => {
    const requestId = randomUUID();
    await expect(
      requestRecovery(
        runtime,
        requestId,
        randomUUID(),
        `${randomUUID().replaceAll('-', '')}@example.test`,
      ),
    ).resolves.toBe('RECORDED');
    expect(await readRequest(requestId)).toMatchObject({
      account_id: null,
      state: 'SUPPRESSED',
    });
    expect(await countAudit(requestId)).toBe(0);
  });

  it('P03 records a non-normalizable identity as an anonymous suppression', async () => {
    const requestId = randomUUID();
    await expect(
      requestRecovery(runtime, requestId, randomUUID(), null),
    ).resolves.toBe('RECORDED');
    expect(await readRequest(requestId)).toMatchObject({
      account_id: null,
      state: 'SUPPRESSED',
    });
  });

  it.each([
    { status: 'INACTIVE' as const },
    { emailVerified: false },
    { deactivated: true },
    { credential: false },
  ])(
    'P04 suppresses an ineligible account without eligible audit',
    async (options) => {
      const { accountId, emailKey } = await createAccount(options);
      const requestId = randomUUID();
      await expect(
        requestRecovery(runtime, requestId, randomUUID(), emailKey),
      ).resolves.toBe('RECORDED');
      expect(await readRequest(requestId)).toMatchObject({
        account_id: accountId,
        state: 'SUPPRESSED',
      });
      expect(await countAudit(requestId)).toBe(0);
    },
  );

  it('P05 preserves cooldown after a PENDING request becomes terminal', async () => {
    const { accountId, emailKey } = await createAccount();
    await migrator.query('BEGIN');
    try {
      const clock = await migrator.query<{ now: Date }>(
        `SELECT pg_catalog.transaction_timestamp() AS now`,
      );
      await insertRecordedRequest(
        migrator,
        accountId,
        new Date(clock.rows[0]!.now.getTime() - 599_000),
        'SENT',
      );
      const requestId = randomUUID();
      expect(
        await requestRecovery(migrator, requestId, randomUUID(), emailKey),
      ).toBe('RECORDED');
      expect(await readRequest(requestId)).toMatchObject({
        state: 'SUPPRESSED',
      });
      await migrator.query('COMMIT');
    } catch (error) {
      await migrator.query('ROLLBACK');
      throw error;
    }
  });

  it('P06 expires cooldown exactly at received_at plus ten minutes', async () => {
    const { accountId, emailKey } = await createAccount();
    await migrator.query('BEGIN');
    try {
      const clock = await migrator.query<{ now: Date }>(
        `SELECT pg_catalog.transaction_timestamp() AS now`,
      );
      await insertRecordedRequest(
        migrator,
        accountId,
        new Date(clock.rows[0]!.now.getTime() - 600_000),
        'SENT',
      );
      const requestId = randomUUID();
      expect(
        await requestRecovery(migrator, requestId, randomUUID(), emailKey),
      ).toBe('RECORDED');
      expect(await readRequest(requestId)).toMatchObject({ state: 'PENDING' });
      await migrator.query('COMMIT');
    } catch (error) {
      await migrator.query('ROLLBACK');
      throw error;
    }
  });

  it('P07 suppresses a request while an older request remains pending', async () => {
    const { accountId, emailKey } = await createAccount();
    await insertRecordedRequest(
      migrator,
      accountId,
      new Date(Date.now() - 11 * 60_000),
    );
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    expect(await readRequest(requestId)).toMatchObject({ state: 'SUPPRESSED' });
  });

  it('P08 permits two active tokens and suppresses at exactly three', async () => {
    const { accountId, emailKey } = await createAccount();
    await createActiveTokens(accountId, 2);
    const permittedId = randomUUID();
    await requestRecovery(runtime, permittedId, randomUUID(), emailKey);
    expect(await readRequest(permittedId)).toMatchObject({ state: 'PENDING' });

    const next = await createAccount();
    await createActiveTokens(next.accountId, 3);
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), next.emailKey);
    expect(await readRequest(requestId)).toMatchObject({ state: 'SUPPRESSED' });
  });

  it.each(['EXPIRED', 'CONSUMED', 'INVALIDATED'] as const)(
    'P08 excludes %s tokens from the active ceiling',
    async (disposition) => {
      const { accountId, emailKey } = await createAccount();
      await createActiveTokens(accountId, 3, disposition);
      const requestId = randomUUID();
      await requestRecovery(runtime, requestId, randomUUID(), emailKey);
      expect(await readRequest(requestId)).toMatchObject({ state: 'PENDING' });
    },
  );

  it('P09 proves an advisory wait and serializes requests for one account', async () => {
    const { accountId, emailKey } = await createAccount();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const blocker = await migrator.query<{ pid: number }>(
      'SELECT pg_catalog.pg_backend_pid() AS pid',
    );
    const waiter = await runtime.query<{ pid: number }>(
      'SELECT pg_catalog.pg_backend_pid() AS pid',
    );
    await migrator.query('BEGIN');
    try {
      await migrator.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
        [accountId],
      );
      const waitingRequest = requestRecovery(
        runtime,
        secondId,
        randomUUID(),
        emailKey,
      );
      await waitForAdvisoryBlock(waiter.rows[0]!.pid, blocker.rows[0]!.pid);
      await requestRecovery(migrator, firstId, randomUUID(), emailKey);
      await migrator.query('COMMIT');
      await expect(waitingRequest).resolves.toBe('RECORDED');
    } catch (error) {
      await migrator.query('ROLLBACK');
      throw error;
    }
    const states = await migrator.query<{ state: string }>(
      `SELECT state FROM public.password_recovery_request
       WHERE account_id = $1 AND recovery_request_id = ANY($2::uuid[])
       ORDER BY state`,
      [accountId, [firstId, secondId]],
    );
    expect(states.rows.map((row) => row.state).sort()).toEqual([
      'PENDING',
      'SUPPRESSED',
    ]);
    expect(await countAudit(firstId)).toBe(1);
    expect(await countAudit(secondId)).toBe(0);
  });

  it('P10 proves that a distinct account advances while another lock is held', async () => {
    const first = await createAccount();
    const second = await createAccount();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const peer = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    await peer.connect();
    const blocker = await migrator.query<{ pid: number }>(
      'SELECT pg_catalog.pg_backend_pid() AS pid',
    );
    const waiter = await runtime.query<{ pid: number }>(
      'SELECT pg_catalog.pg_backend_pid() AS pid',
    );
    await migrator.query('BEGIN');
    try {
      await migrator.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
        [first.accountId],
      );
      const blockedRequest = requestRecovery(
        runtime,
        firstId,
        randomUUID(),
        first.emailKey,
      );
      await waitForAdvisoryBlock(waiter.rows[0]!.pid, blocker.rows[0]!.pid);

      await expect(
        requestRecovery(peer, secondId, randomUUID(), second.emailKey),
      ).resolves.toBe('RECORDED');
      expect(await readRequest(secondId)).toMatchObject({ state: 'PENDING' });

      await migrator.query('COMMIT');
      await expect(blockedRequest).resolves.toBe('RECORDED');
    } catch (error) {
      await migrator.query('ROLLBACK');
      throw error;
    } finally {
      await peer.end();
    }
    expect(await readRequest(firstId)).toMatchObject({ state: 'PENDING' });
    expect(await readRequest(secondId)).toMatchObject({ state: 'PENDING' });
  });

  it('P11 repeats the same operation without duplicate effects', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    const auditId = randomUUID();
    await requestRecovery(runtime, requestId, auditId, emailKey);
    await expect(
      requestRecovery(runtime, requestId, auditId, emailKey),
    ).resolves.toBe('RECORDED');
    const count = await migrator.query<{ requests: number; audits: number }>(
      `SELECT
         (SELECT pg_catalog.count(*)::integer
          FROM public.password_recovery_request WHERE recovery_request_id = $1) AS requests,
         (SELECT pg_catalog.count(*)::integer
          FROM public.audit_event WHERE operation_id = $1) AS audits`,
      [requestId],
    );
    expect(count.rows[0]).toEqual({ requests: 1, audits: 1 });
  });

  it.each(['CORRELATION', 'OPERATION'] as const)(
    'rejects an incompatible pre-existing audit %s binding without partial effects',
    async (binding) => {
      const { accountId, emailKey } = await createAccount();
      const requestId = randomUUID();
      await insertAuditEvidence({
        correlationId: binding === 'CORRELATION' ? requestId : randomUUID(),
        entityId: accountId,
        operationId: binding === 'OPERATION' ? requestId : randomUUID(),
      });

      await expectDatabaseError(
        requestRecovery(runtime, requestId, randomUUID(), emailKey),
        '22023',
        'BF_PASSWORD_RECOVERY_REQUEST_AUDIT_BINDING_MISMATCH',
      );
      const requestCount = await migrator.query<{ count: number }>(
        `SELECT pg_catalog.count(*)::integer AS count
         FROM public.password_recovery_request WHERE recovery_request_id = $1`,
        [requestId],
      );
      expect(requestCount.rows[0]!.count).toBe(0);
      expect(await countAudit(requestId)).toBe(1);
    },
  );

  it('rejects idempotent repetition when an additional correlated audit exists', async () => {
    const { accountId, emailKey } = await createAccount();
    const requestId = randomUUID();
    const auditId = randomUUID();
    await requestRecovery(runtime, requestId, auditId, emailKey);
    await insertAuditEvidence({
      correlationId: requestId,
      entityId: accountId,
      operationId: randomUUID(),
    });

    await expect(reconcile(runtime, requestId)).resolves.toBe('INCONSISTENT');
    await expectDatabaseError(
      requestRecovery(runtime, requestId, auditId, emailKey),
      'P0001',
      'BF_PASSWORD_RECOVERY_REQUEST_RECONCILIATION_REQUIRED',
    );
    expect(await readRequest(requestId)).toMatchObject({ state: 'PENDING' });
    expect(await countAudit(requestId)).toBe(2);
  });

  it('rejects idempotent repetition after the audit is rebound cross-account', async () => {
    const first = await createAccount();
    const second = await createAccount();
    const requestId = randomUUID();
    const auditId = randomUUID();
    await requestRecovery(runtime, requestId, auditId, first.emailKey);
    await migrator.query(
      `UPDATE public.audit_event SET entity_id = $2 WHERE id = $1`,
      [auditId, second.accountId],
    );

    await expect(reconcile(runtime, requestId)).resolves.toBe('INCONSISTENT');
    await expectDatabaseError(
      requestRecovery(runtime, requestId, auditId, first.emailKey),
      'P0001',
      'BF_PASSWORD_RECOVERY_REQUEST_RECONCILIATION_REQUIRED',
    );
    expect(await countAudit(requestId)).toBe(1);
  });

  it('P12 leaves no effects when the initial request insert fails', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await migrator.query(
      `CREATE FUNCTION public.f1b454_reject_request_insert() RETURNS trigger
       LANGUAGE plpgsql AS $body$
       BEGIN
         RAISE EXCEPTION USING MESSAGE = 'F1B454_FORCED_INSERT_FAILURE', ERRCODE = 'P0001';
       END
       $body$`,
    );
    await migrator.query(
      `CREATE TRIGGER f1b454_reject_request_insert
       BEFORE INSERT ON public.password_recovery_request
       FOR EACH ROW EXECUTE FUNCTION public.f1b454_reject_request_insert()`,
    );
    try {
      await expectDatabaseError(
        requestRecovery(runtime, requestId, randomUUID(), emailKey),
        'P0001',
        'F1B454_FORCED_INSERT_FAILURE',
      );
      const effects = await migrator.query<{ count: number }>(
        `SELECT pg_catalog.count(*)::integer AS count
         FROM public.password_recovery_request WHERE recovery_request_id = $1`,
        [requestId],
      );
      expect(effects.rows[0]!.count).toBe(0);
      expect(await countAudit(requestId)).toBe(0);
    } finally {
      await migrator.query(
        'DROP TRIGGER f1b454_reject_request_insert ON public.password_recovery_request',
      );
      await migrator.query(
        'DROP FUNCTION public.f1b454_reject_request_insert()',
      );
    }
  });

  it('P12 rolls back the initial request when classification fails', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await migrator.query(
      `CREATE FUNCTION public.f1b454_reject_classification() RETURNS trigger
       LANGUAGE plpgsql AS $body$
       BEGIN
         IF OLD.state = 'RECEIVED' THEN
           RAISE EXCEPTION USING MESSAGE = 'F1B454_FORCED_CLASSIFICATION_FAILURE', ERRCODE = 'P0001';
         END IF;
         RETURN NEW;
       END
       $body$`,
    );
    await migrator.query(
      `CREATE TRIGGER f1b454_reject_classification
       BEFORE UPDATE ON public.password_recovery_request
       FOR EACH ROW EXECUTE FUNCTION public.f1b454_reject_classification()`,
    );
    try {
      await expectDatabaseError(
        requestRecovery(runtime, requestId, randomUUID(), emailKey),
        'P0001',
        'F1B454_FORCED_CLASSIFICATION_FAILURE',
      );
      const effects = await migrator.query<{ count: number }>(
        `SELECT pg_catalog.count(*)::integer AS count
         FROM public.password_recovery_request WHERE recovery_request_id = $1`,
        [requestId],
      );
      expect(effects.rows[0]!.count).toBe(0);
      expect(await countAudit(requestId)).toBe(0);
    } finally {
      await migrator.query(
        'DROP TRIGGER f1b454_reject_classification ON public.password_recovery_request',
      );
      await migrator.query(
        'DROP FUNCTION public.f1b454_reject_classification()',
      );
    }
  });

  it('P12 rolls back request and audit when the final audit write fails', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await migrator.query(
      `CREATE FUNCTION public.f1b454_reject_audit() RETURNS trigger
       LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.operation = 'AUTH_PASSWORD_RECOVERY_REQUESTED' THEN
           RAISE EXCEPTION USING MESSAGE = 'F1B454_FORCED_AUDIT_FAILURE', ERRCODE = 'P0001';
         END IF;
         RETURN NEW;
       END
       $body$`,
    );
    await migrator.query(
      `CREATE TRIGGER f1b454_reject_audit
       BEFORE INSERT ON public.audit_event
       FOR EACH ROW EXECUTE FUNCTION public.f1b454_reject_audit()`,
    );
    try {
      await expectDatabaseError(
        requestRecovery(runtime, requestId, randomUUID(), emailKey),
        'P0001',
        'F1B454_FORCED_AUDIT_FAILURE',
      );
      const effects = await migrator.query<{ count: number }>(
        `SELECT pg_catalog.count(*)::integer AS count
         FROM public.password_recovery_request WHERE recovery_request_id = $1`,
        [requestId],
      );
      expect(effects.rows[0]!.count).toBe(0);
      expect(await countAudit(requestId)).toBe(0);
    } finally {
      await migrator.query(
        'DROP TRIGGER f1b454_reject_audit ON public.audit_event',
      );
      await migrator.query('DROP FUNCTION public.f1b454_reject_audit()');
    }
  });

  it('P13 reconciles coherent PENDING and SUPPRESSED requests as RECORDED', async () => {
    const { emailKey } = await createAccount();
    const pendingId = randomUUID();
    const suppressedId = randomUUID();
    await requestRecovery(runtime, pendingId, randomUUID(), emailKey);
    await requestRecovery(runtime, suppressedId, randomUUID(), null);
    await expect(reconcile(runtime, pendingId)).resolves.toBe('RECORDED');
    await expect(reconcile(runtime, suppressedId)).resolves.toBe('RECORDED');
  });

  it.each([
    'PREPARING',
    'PREPARED',
    'SENDING',
    'SENT',
    'FAILED',
    'UNKNOWN',
    'CANCELLED',
  ] as const)(
    'P13 reconciles coherent progress to %s and preserves cooldown history',
    async (state) => {
      const { emailKey } = await createAccount();
      const requestId = randomUUID();
      await requestRecovery(runtime, requestId, randomUUID(), emailKey);
      await advanceRecordedRequest(requestId, state);

      await expect(reconcile(runtime, requestId)).resolves.toBe('RECORDED');
      const nextId = randomUUID();
      await requestRecovery(runtime, nextId, randomUUID(), emailKey);
      expect(await readRequest(nextId)).toMatchObject({ state: 'SUPPRESSED' });
    },
  );

  it('P14 rejects a progressed request without its required token evidence', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    await advanceRecordedRequest(requestId, 'PREPARED');
    await migrator.query(
      `DELETE FROM public.password_reset_token
       WHERE delivery_attempt_id = (
         SELECT delivery_attempt_id
         FROM public.password_recovery_delivery_attempt
         WHERE recovery_request_id = $1 AND attempt_number = 1
       )`,
      [requestId],
    );

    await expect(reconcile(runtime, requestId)).resolves.toBe('INCONSISTENT');
  });

  it('P14 rejects an audit whose chronology contradicts the request', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    await migrator.query(
      `UPDATE public.audit_event
       SET occurred_at = occurred_at + INTERVAL '1 second'
       WHERE operation_id = $1`,
      [requestId],
    );
    await expect(reconcile(runtime, requestId)).resolves.toBe('INCONSISTENT');
  });

  it('T01 rejects attempt two when attempt one is absent', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    const request = await readRequest(requestId);
    const scheduledAt = new Date(request.received_at.getTime() + 2_000);
    await insertAttemptEvidence({
      attemptNumber: 2,
      requestId,
      scheduledAt,
      state: 'PREPARING',
    });
    await setRequestProgress({
      attemptNumber: 2,
      requestId,
      state: 'PREPARING',
      updatedAt: scheduledAt,
    });

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it('T02 rejects an active earlier attempt before attempt two', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    const request = await readRequest(requestId);
    await insertAttemptEvidence({
      attemptNumber: 1,
      requestId,
      scheduledAt: new Date(request.received_at.getTime() + 1_000),
      state: 'PREPARING',
    });
    const secondScheduledAt = new Date(request.received_at.getTime() + 2_000);
    await insertAttemptEvidence({
      attemptNumber: 2,
      requestId,
      scheduledAt: secondScheduledAt,
      state: 'PREPARING',
    });
    await setRequestProgress({
      attemptNumber: 2,
      requestId,
      state: 'PREPARING',
      updatedAt: secondScheduledAt,
    });

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it('T03 rejects a cross-account token hidden behind PREPARING', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), owner.emailKey);
    const request = await readRequest(requestId);
    const scheduledAt = new Date(request.received_at.getTime() + 1_000);
    const attemptId = await insertAttemptEvidence({
      attemptNumber: 1,
      requestId,
      scheduledAt,
      state: 'PREPARING',
    });
    await insertTokenEvidence({
      accountId: other.accountId,
      attemptId,
      createdAt: scheduledAt,
    });
    await setRequestProgress({
      attemptNumber: 1,
      requestId,
      state: 'PREPARING',
      updatedAt: scheduledAt,
    });

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it('T04 rejects a token created before its delivery attempt', async () => {
    const { accountId, emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    const request = await readRequest(requestId);
    const scheduledAt = new Date(request.received_at.getTime() + 2_000);
    const attemptId = await insertAttemptEvidence({
      attemptNumber: 1,
      requestId,
      scheduledAt,
      state: 'PREPARED',
    });
    await insertTokenEvidence({
      accountId,
      attemptId,
      createdAt: new Date(scheduledAt.getTime() - 1_000),
    });
    await setRequestProgress({
      attemptNumber: 1,
      requestId,
      state: 'PREPARED',
      updatedAt: scheduledAt,
    });

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it.each(['DELIVERY_FAILURE', 'PREPARATION_FAILURE'] as const)(
    'T05 records a complete two-attempt history after %s',
    async (failureClass) => {
      const { accountId, emailKey } = await createAccount();
      const requestId = randomUUID();
      await requestRecovery(runtime, requestId, randomUUID(), emailKey);
      const request = await readRequest(requestId);
      const firstScheduledAt = new Date(request.received_at.getTime() + 1_000);
      const firstAttemptId = await insertAttemptEvidence({
        attemptNumber: 1,
        failureClass,
        requestId,
        scheduledAt: firstScheduledAt,
        state: 'FAILED',
      });
      await insertTokenEvidence({
        accountId,
        attemptId: firstAttemptId,
        createdAt: firstScheduledAt,
        invalidatedAt:
          failureClass === 'PREPARATION_FAILURE'
            ? new Date(firstScheduledAt.getTime() + 1_000)
            : undefined,
      });
      const secondScheduledAt = new Date(request.received_at.getTime() + 3_000);
      const secondAttemptId = await insertAttemptEvidence({
        attemptNumber: 2,
        requestId,
        scheduledAt: secondScheduledAt,
        state: 'PREPARED',
      });
      await insertTokenEvidence({
        accountId,
        attemptId: secondAttemptId,
        createdAt: secondScheduledAt,
      });
      await setRequestProgress({
        attemptNumber: 2,
        requestId,
        state: 'PREPARED',
        updatedAt: secondScheduledAt,
      });

      await expectObservationalReconciliation(requestId, 'RECORDED');
    },
  );

  it('T06 rejects an attempt beyond the declared current ordinal', async () => {
    const { accountId, emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    const request = await readRequest(requestId);
    const firstScheduledAt = new Date(request.received_at.getTime() + 1_000);
    const firstAttemptId = await insertAttemptEvidence({
      attemptNumber: 1,
      requestId,
      scheduledAt: firstScheduledAt,
      state: 'PREPARED',
    });
    await insertTokenEvidence({
      accountId,
      attemptId: firstAttemptId,
      createdAt: firstScheduledAt,
    });
    await insertAttemptEvidence({
      attemptNumber: 2,
      requestId,
      scheduledAt: new Date(request.received_at.getTime() + 2_000),
      state: 'PREPARING',
    });
    await setRequestProgress({
      attemptNumber: 1,
      requestId,
      state: 'PREPARED',
      updatedAt: firstScheduledAt,
    });

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it.each(['CONSUMED', 'INVALIDATED'] as const)(
    'rejects PREPARED with a %s token',
    async (disposition) => {
      const { emailKey } = await createAccount();
      const requestId = randomUUID();
      await requestRecovery(runtime, requestId, randomUUID(), emailKey);
      await advanceRecordedRequest(requestId, 'PREPARED');
      const request = await readRequest(requestId);
      if (disposition === 'CONSUMED') {
        await migrator.query(
          `UPDATE public.password_reset_token AS token
           SET consumed_at = $2, consumed_operation_id = $3
           FROM public.password_recovery_delivery_attempt AS attempt
           WHERE token.delivery_attempt_id = attempt.delivery_attempt_id
             AND attempt.recovery_request_id = $1`,
          [
            requestId,
            new Date(request.received_at.getTime() + 1_000),
            randomUUID(),
          ],
        );
      } else {
        await migrator.query(
          `UPDATE public.password_reset_token AS token
           SET invalidated_at = $2, invalidated_operation_id = $3
           FROM public.password_recovery_delivery_attempt AS attempt
           WHERE token.delivery_attempt_id = attempt.delivery_attempt_id
             AND attempt.recovery_request_id = $1`,
          [
            requestId,
            new Date(request.received_at.getTime() + 1_000),
            randomUUID(),
          ],
        );
      }

      await expectObservationalReconciliation(requestId, 'INCONSISTENT');
    },
  );

  it('records PREPARED with its active token', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    await advanceRecordedRequest(requestId, 'PREPARED');

    await expectObservationalReconciliation(requestId, 'RECORDED');
  });

  it.each(['SENDING', 'SENT', 'UNKNOWN'] as const)(
    'preserves %s after a later legitimate token consumption',
    async (state) => {
      const { emailKey } = await createAccount();
      const requestId = randomUUID();
      await requestRecovery(runtime, requestId, randomUUID(), emailKey);
      await advanceRecordedRequest(requestId, state);
      const request = await readRequest(requestId);
      await migrator.query(
        `UPDATE public.password_reset_token AS token
         SET consumed_at = $2, consumed_operation_id = $3
         FROM public.password_recovery_delivery_attempt AS attempt
         WHERE token.delivery_attempt_id = attempt.delivery_attempt_id
           AND attempt.recovery_request_id = $1`,
        [
          requestId,
          new Date(request.received_at.getTime() + 1_000),
          randomUUID(),
        ],
      );

      await expectObservationalReconciliation(requestId, 'RECORDED');
    },
  );

  it.each(['SENDING', 'SENT', 'UNKNOWN', 'FAILED'] as const)(
    'preserves %s after a later legitimate token invalidation',
    async (state) => {
      const { emailKey } = await createAccount();
      const requestId = randomUUID();
      await requestRecovery(runtime, requestId, randomUUID(), emailKey);
      await advanceRecordedRequest(requestId, state);
      const request = await readRequest(requestId);
      await migrator.query(
        `UPDATE public.password_reset_token AS token
         SET invalidated_at = $2, invalidated_operation_id = $3
         FROM public.password_recovery_delivery_attempt AS attempt
         WHERE token.delivery_attempt_id = attempt.delivery_attempt_id
           AND attempt.recovery_request_id = $1`,
        [
          requestId,
          new Date(request.received_at.getTime() + 1_000),
          randomUUID(),
        ],
      );

      await expectObservationalReconciliation(requestId, 'RECORDED');
    },
  );

  it('rejects a preparation token created after attempt terminalization', async () => {
    const evidence = await createPreparationFailureEvidence({
      tokenCreatedOffsetMs: 2_000,
      tokenInvalidatedOffsetMs: 2_000,
      withToken: true,
    });

    await expectObservationalReconciliation(evidence.requestId, 'INCONSISTENT');
  });

  it('rejects a preparation token invalidated after attempt terminalization', async () => {
    const evidence = await createPreparationFailureEvidence({
      tokenInvalidatedOffsetMs: 2_000,
      withToken: true,
    });

    await expectObservationalReconciliation(evidence.requestId, 'INCONSISTENT');
  });

  it('rejects a prior preparation token invalidated after the next attempt starts', async () => {
    const { accountId, emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    const request = await readRequest(requestId);
    const firstScheduledAt = new Date(request.received_at.getTime() + 1_000);
    const firstAttemptId = await insertAttemptEvidence({
      attemptNumber: 1,
      failureClass: 'PREPARATION_FAILURE',
      requestId,
      scheduledAt: firstScheduledAt,
      state: 'FAILED',
    });
    const secondScheduledAt = new Date(request.received_at.getTime() + 3_000);
    await insertTokenEvidence({
      accountId,
      attemptId: firstAttemptId,
      createdAt: firstScheduledAt,
      invalidatedAt: new Date(secondScheduledAt.getTime() + 1_000),
    });
    const secondAttemptId = await insertAttemptEvidence({
      attemptNumber: 2,
      requestId,
      scheduledAt: secondScheduledAt,
      state: 'PREPARED',
    });
    await insertTokenEvidence({
      accountId,
      attemptId: secondAttemptId,
      createdAt: secondScheduledAt,
    });
    await setRequestProgress({
      attemptNumber: 2,
      requestId,
      state: 'PREPARED',
      updatedAt: secondScheduledAt,
    });

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it('records a legitimate preparation failure without a token', async () => {
    const evidence = await createPreparationFailureEvidence({
      withToken: false,
    });

    await expectObservationalReconciliation(evidence.requestId, 'RECORDED');
  });

  it('records a legitimate preparation failure with timely invalidation', async () => {
    const evidence = await createPreparationFailureEvidence({
      withToken: true,
    });

    await expectObservationalReconciliation(evidence.requestId, 'RECORDED');
  });

  it('rejects CANCELLED when token invalidation uses another operation', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    await advanceRecordedRequest(requestId, 'CANCELLED');
    await migrator.query(
      `UPDATE public.password_reset_token AS token
       SET invalidated_operation_id = $2
       FROM public.password_recovery_delivery_attempt AS attempt
       WHERE token.delivery_attempt_id = attempt.delivery_attempt_id
         AND attempt.recovery_request_id = $1`,
      [requestId, randomUUID()],
    );

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it('rejects CANCELLED when token invalidation is later than terminalization', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    await advanceRecordedRequest(requestId, 'CANCELLED');
    const request = await readRequest(requestId);
    if (!request.terminal_at) throw new Error('terminal request required');
    await migrator.query(
      `UPDATE public.password_reset_token AS token
       SET invalidated_at = $2
       FROM public.password_recovery_delivery_attempt AS attempt
       WHERE token.delivery_attempt_id = attempt.delivery_attempt_id
         AND attempt.recovery_request_id = $1`,
      [requestId, new Date(request.terminal_at.getTime() + 1_000)],
    );

    await expectObservationalReconciliation(requestId, 'INCONSISTENT');
  });

  it('records CANCELLED with a correctly invalidated token', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    await advanceRecordedRequest(requestId, 'CANCELLED');

    await expectObservationalReconciliation(requestId, 'RECORDED');
  });

  it('records CANCELLED before any delivery attempt or token', async () => {
    const { emailKey } = await createAccount();
    const requestId = randomUUID();
    await requestRecovery(runtime, requestId, randomUUID(), emailKey);
    const request = await readRequest(requestId);
    const terminalAt = new Date(request.received_at.getTime() + 1_000);
    await setRequestProgress({
      attemptNumber: 0,
      cancelledOperationId: randomUUID(),
      requestId,
      state: 'CANCELLED',
      terminalAt,
      updatedAt: terminalAt,
    });

    await expectObservationalReconciliation(requestId, 'RECORDED');
  });

  it('P14 reports a partial RECEIVED request as INCONSISTENT without mutation', async () => {
    const requestId = randomUUID();
    const now = new Date();
    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, NULL, 'RECEIVED', $2, $2, NULL, 0, NULL)`,
      [requestId, now],
    );
    await expect(reconcile(runtime, requestId)).resolves.toBe('INCONSISTENT');
    expect(await readRequest(requestId)).toMatchObject({ state: 'RECEIVED' });
  });

  it('P14 reports positive contradictory evidence as INCONSISTENT', async () => {
    const { accountId } = await createAccount();
    const requestId = randomUUID();
    const now = new Date();
    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, 'PENDING', $3, $3, NULL, 0, NULL)`,
      [requestId, accountId, now],
    );
    await expect(reconcile(runtime, requestId)).resolves.toBe('INCONSISTENT');
  });

  it('P15 reports absent evidence as UNKNOWN without mutation', async () => {
    const requestId = randomUUID();
    await expect(reconcile(runtime, requestId)).resolves.toBe('UNKNOWN');
    await expect(reconcile(runtime, requestId)).resolves.toBe('UNKNOWN');
    expect(await countAudit(requestId)).toBe(0);
  });

  it('P16 grants only protected execution and no sensitive DML', async () => {
    const acl = await migrator.query<{
      name: string;
      arguments: string;
      owner: string;
      runtime: boolean;
      bootstrap: boolean;
      maintenance: boolean;
      public_execute: boolean;
      security_definer: boolean;
      settings: string[];
    }>(
      `SELECT procedure.proname AS name,
              pg_catalog.pg_get_function_arguments(procedure.oid) AS arguments,
              procedure.proowner::regrole::text AS owner,
              has_function_privilege('bello_runtime', procedure.oid, 'EXECUTE') AS runtime,
              has_function_privilege('bello_bootstrap_executor', procedure.oid, 'EXECUTE') AS bootstrap,
              has_function_privilege('bello_audit_maintenance', procedure.oid, 'EXECUTE') AS maintenance,
              has_function_privilege('public', procedure.oid, 'EXECUTE') AS public_execute,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS settings
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid IN (
         'public.request_password_recovery(uuid,uuid,text)'::regprocedure,
         'public.reconcile_password_recovery_request(uuid)'::regprocedure
       )
       ORDER BY procedure.proname`,
    );
    expect(acl.rows).toEqual([
      {
        name: 'reconcile_password_recovery_request',
        arguments: 'recovery_request_id uuid',
        owner: 'bello_test_migrator',
        runtime: true,
        bootstrap: false,
        maintenance: false,
        public_execute: false,
        security_definer: true,
        settings: ['search_path=pg_catalog, public, pg_temp'],
      },
      {
        name: 'request_password_recovery',
        arguments:
          'recovery_request_id uuid, audit_event_id uuid, normalized_email_key text',
        owner: 'bello_test_migrator',
        runtime: true,
        bootstrap: false,
        maintenance: false,
        public_execute: false,
        security_definer: true,
        settings: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
    await expectDatabaseError(
      requestRecovery(bootstrap, randomUUID(), randomUUID(), null),
      '42501',
    );
    await expectDatabaseError(reconcile(maintenance, randomUUID()), '42501');
    const protectedRecoveryTables = [
      ['password_recovery_request', 'recovery_request_id'],
      ['password_recovery_delivery_attempt', 'delivery_attempt_id'],
      ['password_reset_token', 'password_reset_token_id'],
    ] as const;
    const preexistingSensitiveTables = [
      ['account', 'id'],
      ['password_credential', 'account_id'],
      ['audit_event', 'id'],
    ] as const;
    for (const [table, key] of [
      ...protectedRecoveryTables,
      ...preexistingSensitiveTables,
    ]) {
      const privileges = await migrator.query<{
        delete: boolean;
        insert: boolean;
        select: boolean;
        update: boolean;
      }>(
        `SELECT
           has_table_privilege('bello_runtime', $1, 'SELECT') AS select,
           has_table_privilege('bello_runtime', $1, 'INSERT') AS insert,
           has_table_privilege('bello_runtime', $1, 'UPDATE') AS update,
           has_table_privilege('bello_runtime', $1, 'DELETE') AS delete`,
        [`public.${table}`],
      );
      expect(privileges.rows[0]).toEqual({
        select: false,
        insert: false,
        update: false,
        delete: false,
      });
      await expectDatabaseError(
        runtime.query(`SELECT * FROM public.${table} LIMIT 0`),
        '42501',
      );
      if (table !== 'audit_event') {
        await expectDatabaseError(
          runtime.query(`INSERT INTO public.${table} DEFAULT VALUES`),
          '42501',
        );
      }
      await expectDatabaseError(
        runtime.query(`UPDATE public.${table} SET ${key} = ${key} WHERE FALSE`),
        '42501',
      );
      await expectDatabaseError(
        runtime.query(`DELETE FROM public.${table} WHERE FALSE`),
        '42501',
      );
    }
    const historicalColumns = await migrator.query<{
      account_id_select: boolean;
      audit_id_insert: boolean;
      credential_account_select: boolean;
    }>(
      `SELECT
         has_column_privilege('bello_runtime', 'public.account', 'id', 'SELECT')
           AS account_id_select,
         has_column_privilege(
           'bello_runtime', 'public.password_credential', 'account_id', 'SELECT'
         ) AS credential_account_select,
         has_column_privilege('bello_runtime', 'public.audit_event', 'id', 'INSERT')
           AS audit_id_insert`,
    );
    expect(historicalColumns.rows[0]).toEqual({
      account_id_select: true,
      credential_account_select: true,
      audit_id_insert: true,
    });
  });

  it('rejects invalid UUIDs and noncanonical keys before effects', async () => {
    const cases: Array<[string | null, string | null, string | null]> = [
      [null, randomUUID(), null],
      ['00000000-0000-3000-8000-000000000001', randomUUID(), null],
      [randomUUID(), null, null],
      [randomUUID(), randomUUID(), 'User@example.test'],
    ];
    for (const [requestId, auditId, key] of cases) {
      await expectDatabaseError(
        requestRecovery(runtime, requestId, auditId, key),
        '22023',
        'BF_PASSWORD_RECOVERY_REQUEST_INVALID_ARGUMENTS',
      );
    }
  });

  it('integrates NestJS admission, persistence and classification without exposing state', async () => {
    const { emailKey } = await createAccount();
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urlForDatabase('DATABASE_URL', database);
    const prisma = new PrismaService();
    try {
      await prisma.onModuleInit();
      const service = new PasswordRecoveryRequestService(
        new PasswordRecoveryAdmissionService({
          now: () => Date.now(),
          schedule: () => () => undefined,
        }),
        new PasswordRecoveryRequestPersistence(prisma),
      );
      await expect(
        service.request({ email: emailKey, trustedIp: '192.0.2.200' }),
      ).resolves.toEqual({ status: 'RECORDED' });
      const persisted = await migrator.query<{ state: string }>(
        `SELECT state FROM public.password_recovery_request
         WHERE account_id = (SELECT id FROM public.account WHERE email_key = $1)
         ORDER BY received_at DESC LIMIT 1`,
        [emailKey],
      );
      expect(persisted.rows[0]?.state).toBe('PENDING');
    } finally {
      await prisma.onModuleDestroy();
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });
});
