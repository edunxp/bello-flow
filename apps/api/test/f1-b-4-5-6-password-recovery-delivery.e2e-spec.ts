import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import type { PasswordRecoveryDeliveryAdapter } from '../src/auth/password-recovery-delivery.adapter.js';
import { PasswordRecoveryDeliveryPersistence } from '../src/auth/password-recovery-delivery.persistence.js';
import { PasswordRecoveryDeliveryProcessor } from '../src/auth/password-recovery-delivery.processor.js';
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
  '20261110000000_f1_b_4_5_6_password_recovery_delivery',
] as const;

const passwordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';
const tokenDomain = Buffer.from('bello-flow/password-reset/v1\0');

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

function tokenFixture() {
  const raw = randomBytes(32);
  return {
    raw,
    hash: createHash('sha256').update(tokenDomain).update(raw).digest(),
  };
}

describe('F1-B.4.5.6 protected password recovery delivery', () => {
  const admin = new Client({
    connectionString: requiredUrl('ADMIN_TEST_DATABASE_URL'),
  });
  const database = `bello_f1b456_${randomUUID().replaceAll('-', '')}`;
  let migrator: Client;
  let runtime: Client;
  let secondRuntime: Client;
  let databaseCreated = false;

  async function createPendingFixture() {
    const accountId = randomUUID();
    const requestId = randomUUID();
    const receivedAt = new Date(Date.now() - 10 * 60_000);
    const email = `${accountId.replaceAll('-', '')}@example.test`;
    await migrator.query(
      `INSERT INTO public.account (
         id, first_name, last_name, email, email_key, email_verified_at,
         status, created_at, deactivated_at
       ) VALUES ($1, 'Synthetic', 'Account', $2, $2, $3, 'ACTIVE', $3, NULL)`,
      [accountId, email, receivedAt],
    );
    await migrator.query(
      `INSERT INTO public.password_credential (
         account_id, password_hash, changed_at, changed_operation_id
       ) VALUES ($1, $2, $3, $4)`,
      [accountId, passwordHash, receivedAt, randomUUID()],
    );
    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, 'PENDING', $3, $3, NULL, 0, NULL)`,
      [requestId, accountId, receivedAt],
    );
    await migrator.query(
      `INSERT INTO public.audit_event (
         id, occurred_at, actor_account_id, origin, scope, operation, result,
         entity_type, entity_id, before_data, after_data, context,
         correlation_id, operation_id, sequence
       ) VALUES (
         $1, $3, NULL, 'HTTP_API', 'SECURITY',
         'AUTH_PASSWORD_RECOVERY_REQUESTED', 'SUCCESS', 'ACCOUNT', $2,
         NULL, NULL, NULL, $4, $4, 1
       )`,
      [randomUUID(), accountId, receivedAt, requestId],
    );
    return { accountId, requestId, email };
  }

  async function createAdditionalPendingRequest(accountId: string) {
    const requestId = randomUUID();
    const receivedAt = new Date();
    await migrator.query(
      `INSERT INTO public.password_recovery_request (
         recovery_request_id, account_id, state, received_at, updated_at,
         terminal_at, current_attempt_number, cancelled_operation_id
       ) VALUES ($1, $2, 'PENDING', $3, $3, NULL, 0, NULL)`,
      [requestId, accountId, receivedAt],
    );
    await migrator.query(
      `INSERT INTO public.audit_event (
         id, occurred_at, actor_account_id, origin, scope, operation, result,
         entity_type, entity_id, before_data, after_data, context,
         correlation_id, operation_id, sequence
       ) VALUES (
         $1, $3, NULL, 'HTTP_API', 'SECURITY',
         'AUTH_PASSWORD_RECOVERY_REQUESTED', 'SUCCESS', 'ACCOUNT', $2,
         NULL, NULL, NULL, $4, $4, 1
       )`,
      [randomUUID(), accountId, receivedAt, requestId],
    );
    return requestId;
  }

  async function claim(
    client: Client,
    attemptId: string = randomUUID(),
    leaseId: string = randomUUID(),
  ) {
    const result = await client.query<{
      outcome: string;
      recovery_request_id: string | null;
      delivery_attempt_id: string | null;
      attempt_number: number | null;
      lease_id: string | null;
      lease_expires_at: Date | null;
      password_reset_token_id: string | null;
    }>(`SELECT * FROM public.claim_password_recovery_delivery($1, $2)`, [
      attemptId,
      leaseId,
    ]);
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  }

  async function claimWithSelectionRetry(
    client: Client,
    attemptId: string,
    leaseId: string,
  ) {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await claim(client, attemptId, leaseId);
      } catch (error) {
        if ((error as { code?: string }).code !== '40001' || retry === 2) {
          throw error;
        }
      }
    }
    throw new Error('selection retry exhausted');
  }

  async function prepare(
    client: Client,
    attemptId: string,
    leaseId: string,
    tokenId: string,
    hash: Buffer,
    expiresAt = new Date(Date.now() + 30 * 60_000),
  ) {
    const result = await client.query<{
      outcome: string;
      expires_at: Date | null;
    }>(
      `SELECT * FROM public.prepare_password_recovery_delivery(
         $1, $2, $3, $4, $5
       )`,
      [attemptId, leaseId, tokenId, hash, expiresAt],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  }

  async function confirm(client: Client, attemptId: string, leaseId: string) {
    const result = await client.query<{
      outcome: string;
      recipient_email: string | null;
      token_expires_at: Date | null;
    }>(`SELECT * FROM public.confirm_password_recovery_sending($1, $2)`, [
      attemptId,
      leaseId,
    ]);
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  }

  async function complete(
    client: Client,
    attemptId: string,
    leaseId: string,
    externalResult: 'ACCEPTED' | 'NOT_ACCEPTED' | 'INDETERMINATE',
  ) {
    const result = await client.query<{
      outcome: string;
      request_state: string;
      attempt_state: string;
      next_eligible_at: Date | null;
    }>(
      `SELECT * FROM public.complete_password_recovery_delivery(
         $1, $2, $3, $4
       )`,
      [
        attemptId,
        leaseId,
        externalResult,
        externalResult === 'ACCEPTED' ? randomUUID() : null,
      ],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  }

  async function reconcile(
    client: Client,
    requestId: string,
    attemptId: string,
    leaseId: string | null,
    tokenId: string | null,
  ) {
    const result = await client.query<{
      outcome: string;
      request_state: string | null;
      attempt_state: string | null;
      failure_class: string | null;
      token_invalidated_operation_id: string | null;
      accepted_audit_confirmed: boolean;
    }>(
      `SELECT * FROM public.reconcile_password_recovery_delivery(
         $1, $2, $3, $4
       )`,
      [requestId, attemptId, leaseId, tokenId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  }

  async function waitForAdvisoryWaiters(applicationNames: string[]) {
    for (let observation = 0; observation < 100; observation += 1) {
      const waiting = await admin.query<{ count: number }>(
        `SELECT pg_catalog.count(*)::integer AS count
         FROM pg_catalog.pg_stat_activity
         WHERE application_name = ANY($1::text[])
           AND wait_event_type = 'Lock'
           AND wait_event = 'advisory'`,
        [applicationNames],
      );
      if (waiting.rows[0]?.count === applicationNames.length) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error('claim sessions did not reach the advisory-lock barrier');
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
    expect(database).toMatch(/^bello_f1b456_[a-f0-9]{32}$/);

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
    runtime = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
    });
    secondRuntime = new Client({
      connectionString: urlForDatabase('DATABASE_URL', database),
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
    await Promise.all([runtime.connect(), secondRuntime.connect()]);
  });

  afterAll(async () => {
    await Promise.all([
      runtime?.end().catch(() => undefined),
      secondRuntime?.end().catch(() => undefined),
      migrator?.end().catch(() => undefined),
    ]);
    if (databaseCreated) {
      expect(database).toMatch(/^bello_f1b456_[a-f0-9]{32}$/);
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await admin.end();
  });

  it('executes the nominal flow, exposes authorization once and audits acceptance atomically', async () => {
    const fixture = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    const tokenId = randomUUID();
    const token = tokenFixture();
    const expiresAt = new Date(Date.now() + 30 * 60_000);

    await expect(claim(runtime, attemptId, leaseId)).resolves.toMatchObject({
      outcome: 'CLAIMED',
      recovery_request_id: fixture.requestId,
      delivery_attempt_id: attemptId,
      attempt_number: 1,
      lease_id: leaseId,
    });
    await expect(claim(runtime, attemptId, leaseId)).resolves.toMatchObject({
      outcome: 'CLAIMED',
      delivery_attempt_id: attemptId,
      lease_id: leaseId,
    });
    await expect(
      prepare(runtime, attemptId, leaseId, tokenId, token.hash, expiresAt),
    ).resolves.toMatchObject({ outcome: 'PREPARED' });
    await expect(
      prepare(runtime, attemptId, leaseId, tokenId, token.hash, expiresAt),
    ).resolves.toMatchObject({ outcome: 'ALREADY_PREPARED_MATCHING' });
    await expect(
      prepare(
        runtime,
        attemptId,
        leaseId,
        tokenId,
        tokenFixture().hash,
        expiresAt,
      ),
    ).resolves.toMatchObject({ outcome: 'INCONSISTENT' });
    await expect(confirm(runtime, attemptId, leaseId)).resolves.toMatchObject({
      outcome: 'SEND_AUTHORIZED',
      recipient_email: fixture.email,
      token_expires_at: expect.any(Date),
    });
    await expect(confirm(runtime, attemptId, leaseId)).resolves.toEqual(
      expect.objectContaining({
        outcome: 'ALREADY_SENDING',
        recipient_email: null,
        token_expires_at: null,
      }),
    );
    await expect(
      complete(runtime, attemptId, leaseId, 'ACCEPTED'),
    ).resolves.toMatchObject({
      outcome: 'SENT',
      request_state: 'SENT',
      attempt_state: 'SENT',
    });
    await expect(
      complete(runtime, attemptId, leaseId, 'ACCEPTED'),
    ).resolves.toMatchObject({ outcome: 'ALREADY_TERMINAL' });

    const evidence = await migrator.query<{
      request_state: string;
      attempt_state: string;
      audits: number;
      exact_audits: number;
    }>(
      `SELECT request.state AS request_state, attempt.state AS attempt_state,
         (SELECT pg_catalog.count(*)::integer FROM public.audit_event AS event
          WHERE event.operation_id = $2) AS audits,
         (SELECT pg_catalog.count(*)::integer FROM public.audit_event AS event
          WHERE event.actor_account_id IS NULL
            AND event.origin = 'INTERNAL_PROCESSOR'
            AND event.scope = 'SECURITY'
            AND event.operation = 'AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED'
            AND event.result = 'SUCCESS'
            AND event.entity_type = 'ACCOUNT'
            AND event.entity_id = $3
            AND event.operation_id = $2
            AND event.correlation_id = $1
            AND event.sequence = 1
            AND event.before_data IS NULL
            AND event.after_data IS NULL
            AND event.context IS NULL) AS exact_audits
       FROM public.password_recovery_request AS request
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.recovery_request_id = request.recovery_request_id
       WHERE request.recovery_request_id = $1 AND attempt.delivery_attempt_id = $2`,
      [fixture.requestId, attemptId, fixture.accountId],
    );
    expect(evidence.rows[0]).toEqual({
      request_state: 'SENT',
      attempt_state: 'SENT',
      audits: 1,
      exact_audits: 1,
    });
  });

  it('reselects eligible work after concurrent claims choose the same request', async () => {
    const fixture = await createPendingFixture();
    const secondRequestId = await createAdditionalPendingRequest(
      fixture.accountId,
    );
    const firstApplication = `f1b456_claim_a_${randomUUID()}`;
    const secondApplication = `f1b456_claim_b_${randomUUID()}`;
    await runtime.query(
      `SELECT pg_catalog.set_config('application_name', $1, false)`,
      [firstApplication],
    );
    await secondRuntime.query(
      `SELECT pg_catalog.set_config('application_name', $1, false)`,
      [secondApplication],
    );

    await migrator.query('BEGIN');
    try {
      await migrator.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
        [fixture.accountId],
      );
      const first = claim(runtime, randomUUID(), randomUUID());
      const second = claim(secondRuntime, randomUUID(), randomUUID());
      await waitForAdvisoryWaiters([firstApplication, secondApplication]);
      await migrator.query('COMMIT');

      const results = await Promise.all([first, second]);
      expect(results.map((row) => row.outcome)).toEqual(['CLAIMED', 'CLAIMED']);
      expect(new Set(results.map((row) => row.recovery_request_id))).toEqual(
        new Set([fixture.requestId, secondRequestId]),
      );
    } catch (error) {
      await migrator.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });

  it('preserves lock order while two accounts progress concurrently', async () => {
    const firstFixture = await createPendingFixture();
    const secondFixture = await createPendingFixture();
    const firstAttempt = randomUUID();
    const secondAttempt = randomUUID();
    const firstLease = randomUUID();
    const secondLease = randomUUID();
    const firstToken = randomUUID();
    const secondToken = randomUUID();

    const claims = await Promise.all([
      claimWithSelectionRetry(runtime, firstAttempt, firstLease),
      claimWithSelectionRetry(secondRuntime, secondAttempt, secondLease),
    ]);
    expect(new Set(claims.map((row) => row.recovery_request_id))).toEqual(
      new Set([firstFixture.requestId, secondFixture.requestId]),
    );
    const firstClaim = claims.find(
      (row) => row.recovery_request_id === firstFixture.requestId,
    )!;
    const secondClaim = claims.find(
      (row) => row.recovery_request_id === secondFixture.requestId,
    )!;
    await Promise.all([
      prepare(
        runtime,
        firstClaim.delivery_attempt_id!,
        firstClaim.lease_id!,
        firstToken,
        tokenFixture().hash,
      ),
      prepare(
        secondRuntime,
        secondClaim.delivery_attempt_id!,
        secondClaim.lease_id!,
        secondToken,
        tokenFixture().hash,
      ),
    ]);
    await Promise.all([
      confirm(runtime, firstClaim.delivery_attempt_id!, firstClaim.lease_id!),
      confirm(
        secondRuntime,
        secondClaim.delivery_attempt_id!,
        secondClaim.lease_id!,
      ),
    ]);
    const completions = await Promise.all([
      complete(
        runtime,
        firstClaim.delivery_attempt_id!,
        firstClaim.lease_id!,
        'INDETERMINATE',
      ),
      complete(
        secondRuntime,
        secondClaim.delivery_attempt_id!,
        secondClaim.lease_id!,
        'INDETERMINATE',
      ),
    ]);
    expect(completions.map((row) => row.outcome)).toEqual([
      'UNKNOWN',
      'UNKNOWN',
    ]);
  });

  it('reports malformed current attempts and required tokens as INCONSISTENT', async () => {
    const missingAttempt = await createPendingFixture();
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET current_attempt_number = 1
       WHERE recovery_request_id = $1`,
      [missingAttempt.requestId],
    );
    await expect(claim(runtime)).resolves.toMatchObject({
      outcome: 'INCONSISTENT',
      recovery_request_id: missingAttempt.requestId,
    });

    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = 'SUPPRESSED', terminal_at = pg_catalog.transaction_timestamp()
       WHERE recovery_request_id = $1`,
      [missingAttempt.requestId],
    );

    const missingToken = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    await claim(runtime, attemptId, leaseId);
    await migrator.query(
      `UPDATE public.password_recovery_delivery_attempt
       SET state = 'PREPARED'
       WHERE delivery_attempt_id = $1`,
      [attemptId],
    );
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = 'PREPARED'
       WHERE recovery_request_id = $1`,
      [missingToken.requestId],
    );
    await expect(claim(runtime)).resolves.toMatchObject({
      outcome: 'INCONSISTENT',
      recovery_request_id: missingToken.requestId,
      delivery_attempt_id: attemptId,
    });
    await migrator.query(
      `DELETE FROM public.password_recovery_delivery_attempt
       WHERE delivery_attempt_id = $1`,
      [attemptId],
    );
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = 'SUPPRESSED', terminal_at = pg_catalog.transaction_timestamp(),
           current_attempt_number = 0
       WHERE recovery_request_id = $1`,
      [missingToken.requestId],
    );
  });

  it('derives retry eligibility from terminal_at and terminates after three attempts', async () => {
    const fixture = await createPendingFixture();
    const delays = ['2 minutes', '6 minutes'] as const;
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const attemptId = randomUUID();
      const leaseId = randomUUID();
      const tokenId = randomUUID();
      const token = tokenFixture();
      const claimed = await claim(runtime, attemptId, leaseId);
      expect(claimed).toMatchObject({
        outcome: 'CLAIMED',
        recovery_request_id: fixture.requestId,
        attempt_number: ordinal,
      });
      await prepare(runtime, attemptId, leaseId, tokenId, token.hash);
      await confirm(runtime, attemptId, leaseId);
      const completion = await complete(
        runtime,
        attemptId,
        leaseId,
        'NOT_ACCEPTED',
      );
      expect(completion.outcome).toBe('FAILED');
      expect(completion.request_state).toBe(
        ordinal === 3 ? 'FAILED' : 'PENDING',
      );
      if (ordinal < 3) {
        expect(completion.next_eligible_at).toBeInstanceOf(Date);
        await expect(claim(runtime)).resolves.toMatchObject({
          outcome: 'NO_WORK',
        });
        await migrator.query(
          `UPDATE public.password_recovery_delivery_attempt
           SET scheduled_at = scheduled_at - $2::interval,
               sending_confirmed_at = sending_confirmed_at - $2::interval,
               terminal_at = terminal_at - $2::interval
           WHERE delivery_attempt_id = $1`,
          [attemptId, delays[ordinal - 1]],
        );
        await migrator.query(
          `UPDATE public.password_reset_token
           SET created_at = created_at - $2::interval,
               expires_at = expires_at - $2::interval,
               invalidated_at = invalidated_at - $2::interval
           WHERE password_reset_token_id = $1`,
          [tokenId, delays[ordinal - 1]],
        );
      }
    }

    const final = await migrator.query<{
      state: string;
      current_attempt_number: number;
      distinct_tokens: number;
      invalidation_matches: number;
    }>(
      `SELECT request.state, request.current_attempt_number,
         pg_catalog.count(DISTINCT token.password_reset_token_id)::integer AS distinct_tokens,
         pg_catalog.count(*) FILTER (
           WHERE token.invalidated_operation_id = attempt.delivery_attempt_id
         )::integer AS invalidation_matches
       FROM public.password_recovery_request AS request
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.recovery_request_id = request.recovery_request_id
       JOIN public.password_reset_token AS token
         ON token.delivery_attempt_id = attempt.delivery_attempt_id
       WHERE request.recovery_request_id = $1
       GROUP BY request.state, request.current_attempt_number`,
      [fixture.requestId],
    );
    expect(final.rows[0]).toEqual({
      state: 'FAILED',
      current_attempt_number: 3,
      distinct_tokens: 3,
      invalidation_matches: 3,
    });
  });

  it('consumes PREPARED token loss and recovers expired SENDING only to UNKNOWN', async () => {
    const preparedFixture = await createPendingFixture();
    const preparedAttempt = randomUUID();
    const preparedLease = randomUUID();
    const preparedToken = randomUUID();
    await claim(runtime, preparedAttempt, preparedLease);
    await prepare(
      runtime,
      preparedAttempt,
      preparedLease,
      preparedToken,
      tokenFixture().hash,
    );
    await migrator.query(
      `UPDATE public.password_recovery_delivery_attempt
       SET scheduled_at = scheduled_at - INTERVAL '2 minutes',
           lease_expires_at = pg_catalog.transaction_timestamp() - INTERVAL '1 second'
       WHERE delivery_attempt_id = $1`,
      [preparedAttempt],
    );
    await expect(claim(runtime)).resolves.toMatchObject({
      outcome: 'RECOVERED_PREPARED',
      delivery_attempt_id: preparedAttempt,
      password_reset_token_id: preparedToken,
    });

    const sendingFixture = await createPendingFixture();
    const sendingAttempt = randomUUID();
    const sendingLease = randomUUID();
    const sendingToken = randomUUID();
    await claim(runtime, sendingAttempt, sendingLease);
    await prepare(
      runtime,
      sendingAttempt,
      sendingLease,
      sendingToken,
      tokenFixture().hash,
    );
    await confirm(runtime, sendingAttempt, sendingLease);
    await migrator.query(
      `UPDATE public.password_recovery_delivery_attempt
       SET scheduled_at = scheduled_at - INTERVAL '2 minutes',
           lease_expires_at = pg_catalog.transaction_timestamp() - INTERVAL '1 second'
       WHERE delivery_attempt_id = $1`,
      [sendingAttempt],
    );
    await expect(claim(runtime)).resolves.toMatchObject({
      outcome: 'RECOVERED_SENDING_UNKNOWN',
      recovery_request_id: sendingFixture.requestId,
      delivery_attempt_id: sendingAttempt,
    });
    const unknown = await migrator.query<{
      request_state: string;
      attempt_state: string;
      invalidated_at: Date | null;
    }>(
      `SELECT request.state AS request_state, attempt.state AS attempt_state,
              token.invalidated_at
       FROM public.password_recovery_request AS request
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.recovery_request_id = request.recovery_request_id
       JOIN public.password_reset_token AS token
         ON token.delivery_attempt_id = attempt.delivery_attempt_id
       WHERE request.recovery_request_id = $1`,
      [sendingFixture.requestId],
    );
    expect(unknown.rows[0]).toEqual({
      request_state: 'UNKNOWN',
      attempt_state: 'UNKNOWN',
      invalidated_at: null,
    });
    await expect(
      confirm(runtime, sendingAttempt, sendingLease),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'ALREADY_TERMINAL',
        recipient_email: null,
      }),
    );
    expect(preparedFixture.requestId).not.toBe(sendingFixture.requestId);
  });

  it('rejects partial or divergent terminal effects during reconciliation', async () => {
    const sent = await createPendingFixture();
    const sentAttempt = randomUUID();
    const sentLease = randomUUID();
    const sentToken = randomUUID();
    await claim(runtime, sentAttempt, sentLease);
    await prepare(
      runtime,
      sentAttempt,
      sentLease,
      sentToken,
      tokenFixture().hash,
    );
    await confirm(runtime, sentAttempt, sentLease);
    await complete(runtime, sentAttempt, sentLease, 'ACCEPTED');
    await expect(
      reconcile(runtime, sent.requestId, sentAttempt, sentLease, sentToken),
    ).resolves.toMatchObject({
      outcome: 'OBSERVED',
      accepted_audit_confirmed: true,
    });
    await migrator.query(
      `DELETE FROM public.audit_event
       WHERE operation_id = $1 AND sequence = 1`,
      [sentAttempt],
    );
    await expect(
      reconcile(runtime, sent.requestId, sentAttempt, sentLease, sentToken),
    ).resolves.toMatchObject({
      outcome: 'INCONSISTENT',
      accepted_audit_confirmed: false,
    });

    const failed = await createPendingFixture();
    const failedAttempt = randomUUID();
    const failedLease = randomUUID();
    const failedToken = randomUUID();
    await claim(runtime, failedAttempt, failedLease);
    await migrator.query(
      `UPDATE public.password_recovery_delivery_attempt
       SET attempt_number = 3
       WHERE delivery_attempt_id = $1`,
      [failedAttempt],
    );
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET current_attempt_number = 3
       WHERE recovery_request_id = $1`,
      [failed.requestId],
    );
    await prepare(
      runtime,
      failedAttempt,
      failedLease,
      failedToken,
      tokenFixture().hash,
    );
    await confirm(runtime, failedAttempt, failedLease);
    await complete(runtime, failedAttempt, failedLease, 'NOT_ACCEPTED');
    await migrator.query(
      `UPDATE public.password_reset_token
       SET invalidated_at = NULL, invalidated_operation_id = NULL
       WHERE password_reset_token_id = $1`,
      [failedToken],
    );
    await expect(
      reconcile(
        runtime,
        failed.requestId,
        failedAttempt,
        failedLease,
        failedToken,
      ),
    ).resolves.toMatchObject({ outcome: 'INCONSISTENT' });
    await migrator.query(
      `UPDATE public.password_reset_token
       SET invalidated_at = pg_catalog.transaction_timestamp(),
           invalidated_operation_id = $2
       WHERE password_reset_token_id = $1`,
      [failedToken, randomUUID()],
    );
    await expect(
      reconcile(
        runtime,
        failed.requestId,
        failedAttempt,
        failedLease,
        failedToken,
      ),
    ).resolves.toMatchObject({ outcome: 'INCONSISTENT' });

    const unknown = await createPendingFixture();
    const unknownAttempt = randomUUID();
    const unknownLease = randomUUID();
    const unknownToken = randomUUID();
    await claim(runtime, unknownAttempt, unknownLease);
    await prepare(
      runtime,
      unknownAttempt,
      unknownLease,
      unknownToken,
      tokenFixture().hash,
    );
    await confirm(runtime, unknownAttempt, unknownLease);
    await complete(runtime, unknownAttempt, unknownLease, 'INDETERMINATE');
    await migrator.query(
      `UPDATE public.password_reset_token
       SET invalidated_at = pg_catalog.transaction_timestamp(),
           invalidated_operation_id = $2
       WHERE password_reset_token_id = $1`,
      [unknownToken, unknownAttempt],
    );
    await expect(
      reconcile(
        runtime,
        unknown.requestId,
        unknownAttempt,
        unknownLease,
        unknownToken,
      ),
    ).resolves.toMatchObject({ outcome: 'INCONSISTENT' });
  });

  it('serializes concurrent claims and blocks stale ownership and late overwrite', async () => {
    const fixture = await createPendingFixture();
    const firstAttempt = randomUUID();
    const firstLease = randomUUID();
    const secondAttempt = randomUUID();
    const secondLease = randomUUID();
    const results = await Promise.all([
      claim(runtime, firstAttempt, firstLease),
      claim(secondRuntime, secondAttempt, secondLease),
    ]);
    expect(results.map((row) => row.outcome).sort()).toEqual([
      'CLAIMED',
      'NO_WORK',
    ]);
    const winner = results.find((row) => row.outcome === 'CLAIMED')!;
    const winnerClient =
      winner.delivery_attempt_id === firstAttempt ? runtime : secondRuntime;
    const winnerLease = winner.lease_id!;
    const tokenId = randomUUID();
    await prepare(
      winnerClient,
      winner.delivery_attempt_id!,
      winnerLease,
      tokenId,
      tokenFixture().hash,
    );
    await expect(
      confirm(winnerClient, winner.delivery_attempt_id!, randomUUID()),
    ).resolves.toMatchObject({ outcome: 'STALE_OWNER' });
    await confirm(winnerClient, winner.delivery_attempt_id!, winnerLease);
    await complete(
      winnerClient,
      winner.delivery_attempt_id!,
      winnerLease,
      'INDETERMINATE',
    );
    await expect(
      complete(
        winnerClient,
        winner.delivery_attempt_id!,
        winnerLease,
        'ACCEPTED',
      ),
    ).resolves.toMatchObject({ outcome: 'ALREADY_TERMINAL' });
    const state = await migrator.query<{ state: string }>(
      `SELECT state FROM public.password_recovery_request
       WHERE recovery_request_id = $1`,
      [fixture.requestId],
    );
    expect(state.rows).toEqual([{ state: 'UNKNOWN' }]);
  });

  it.each(['completion', 'recovery'] as const)(
    'keeps the first terminal result when late completion races %s',
    async (winner) => {
      const fixture = await createPendingFixture();
      const attemptId = randomUUID();
      const leaseId = randomUUID();
      const tokenId = randomUUID();
      await claim(runtime, attemptId, leaseId);
      await prepare(runtime, attemptId, leaseId, tokenId, tokenFixture().hash);
      await confirm(runtime, attemptId, leaseId);
      await migrator.query(
        `UPDATE public.password_recovery_delivery_attempt
         SET scheduled_at = scheduled_at - INTERVAL '2 minutes',
             lease_expires_at = pg_catalog.transaction_timestamp() - INTERVAL '1 second'
         WHERE delivery_attempt_id = $1`,
        [attemptId],
      );

      const completionApplication = `f1b456_complete_${randomUUID()}`;
      const recoveryApplication = `f1b456_recover_${randomUUID()}`;
      await runtime.query(
        `SELECT pg_catalog.set_config('application_name', $1, false)`,
        [completionApplication],
      );
      await secondRuntime.query(
        `SELECT pg_catalog.set_config('application_name', $1, false)`,
        [recoveryApplication],
      );
      await migrator.query('BEGIN');
      try {
        await migrator.query(
          'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
          [fixture.accountId],
        );
        const first =
          winner === 'completion'
            ? complete(runtime, attemptId, leaseId, 'ACCEPTED')
            : claim(secondRuntime);
        await waitForAdvisoryWaiters([
          winner === 'completion' ? completionApplication : recoveryApplication,
        ]);
        const second =
          winner === 'completion'
            ? claim(secondRuntime)
            : complete(runtime, attemptId, leaseId, 'ACCEPTED');
        await waitForAdvisoryWaiters([
          completionApplication,
          recoveryApplication,
        ]);
        await migrator.query('COMMIT');
        const [firstResult, secondResult] = await Promise.all([first, second]);

        if (winner === 'completion') {
          expect(firstResult).toMatchObject({ outcome: 'SENT' });
          expect(secondResult).toMatchObject({ outcome: 'NO_WORK' });
        } else {
          expect(firstResult).toMatchObject({
            outcome: 'RECOVERED_SENDING_UNKNOWN',
          });
          expect(secondResult).toMatchObject({ outcome: 'ALREADY_TERMINAL' });
        }
      } catch (error) {
        await migrator.query('ROLLBACK').catch(() => undefined);
        throw error;
      }

      const terminal = await migrator.query<{
        request_state: string;
        attempt_state: string;
      }>(
        `SELECT request.state AS request_state, attempt.state AS attempt_state
         FROM public.password_recovery_request AS request
         JOIN public.password_recovery_delivery_attempt AS attempt
           ON attempt.recovery_request_id = request.recovery_request_id
         WHERE request.recovery_request_id = $1`,
        [fixture.requestId],
      );
      expect(terminal.rows).toEqual([
        winner === 'completion'
          ? { request_state: 'SENT', attempt_state: 'SENT' }
          : { request_state: 'UNKNOWN', attempt_state: 'UNKNOWN' },
      ]);
    },
  );

  it('revalidates account eligibility immediately before SENDING', async () => {
    const fixture = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    const tokenId = randomUUID();
    await claim(runtime, attemptId, leaseId);
    await prepare(runtime, attemptId, leaseId, tokenId, tokenFixture().hash);
    await migrator.query(
      `UPDATE public.account
       SET status = 'INACTIVE',
           deactivated_at = pg_catalog.transaction_timestamp()
       WHERE id = $1`,
      [fixture.accountId],
    );

    await expect(confirm(runtime, attemptId, leaseId)).resolves.toMatchObject({
      outcome: 'INCONSISTENT',
      recipient_email: null,
    });
    const state = await migrator.query<{
      request_state: string;
      attempt_state: string;
    }>(
      `SELECT request.state AS request_state, attempt.state AS attempt_state
       FROM public.password_recovery_request AS request
       JOIN public.password_recovery_delivery_attempt AS attempt
         ON attempt.recovery_request_id = request.recovery_request_id
       WHERE request.recovery_request_id = $1`,
      [fixture.requestId],
    );
    expect(state.rows).toEqual([
      { request_state: 'PREPARED', attempt_state: 'PREPARED' },
    ]);
    await migrator.query(
      `DELETE FROM public.password_reset_token
       WHERE password_reset_token_id = $1`,
      [tokenId],
    );
    await migrator.query(
      `DELETE FROM public.password_recovery_delivery_attempt
       WHERE delivery_attempt_id = $1`,
      [attemptId],
    );
    await migrator.query(
      `UPDATE public.password_recovery_request
       SET state = 'SUPPRESSED', terminal_at = pg_catalog.transaction_timestamp(),
           current_attempt_number = 0
       WHERE recovery_request_id = $1`,
      [fixture.requestId],
    );
  });

  it('bounds shutdown while a PostgreSQL advisory lock blocks the active claim', async () => {
    const fixture = await createPendingFixture();
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const applicationName = `f1b456_shutdown_${randomUUID()}`;
    const runtimeUrl = new URL(urlForDatabase('DATABASE_URL', database));
    runtimeUrl.searchParams.set('application_name', applicationName);
    process.env.DATABASE_URL = runtimeUrl.toString();
    const prisma = new PrismaService();
    const persistence = new PasswordRecoveryDeliveryPersistence(prisma);
    const adapter = {
      deliver: vi.fn().mockResolvedValue({ status: 'ACCEPTED' as const }),
    };
    const processor = new PasswordRecoveryDeliveryProcessor(
      {
        mode: 'controlled',
        publicOrigin: 'https://bello.example',
        resendApiKey: null,
        fromAddress: null,
        idlePollingMilliseconds: 1_000,
        maximumClaimsPerCycle: 10,
        adapterTimeoutMilliseconds: 10_000,
      },
      adapter as PasswordRecoveryDeliveryAdapter,
      persistence,
    );
    await prisma.$connect();
    await migrator.query('BEGIN');
    try {
      await migrator.query(
        'SELECT public.acquire_auth_account_advisory_xact_lock($1)',
        [fixture.accountId],
      );
      const cycle = processor.runCycle();
      await waitForAdvisoryWaiters([applicationName]);
      const shutdown = processor.onApplicationShutdown();
      await expect(
        Promise.race([
          shutdown.then(() => 'stopped'),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('watchdog'), 8_000),
          ),
        ]),
      ).resolves.toBe('stopped');
      await expect(cycle).resolves.toMatchObject({ infrastructureError: true });
      expect(adapter.deliver).not.toHaveBeenCalled();
    } finally {
      await migrator.query('ROLLBACK').catch(() => undefined);
      await migrator.query(
        `UPDATE public.password_recovery_request
         SET state = 'SUPPRESSED', terminal_at = pg_catalog.transaction_timestamp()
         WHERE recovery_request_id = $1 AND state = 'PENDING'`,
        [fixture.requestId],
      );
      await prisma.$disconnect();
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }, 10_000);

  it('shares account locking with reset while preserving existing sessions', async () => {
    const fixture = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    const tokenId = randomUUID();
    const token = tokenFixture();
    const sessionId = randomUUID();
    const now = new Date();
    await migrator.query(
      `INSERT INTO public.auth_session (
         id, account_id, token_hash, created_at, last_activity_at,
         absolute_expires_at, created_operation_id, revoked_at,
         revocation_reason, revoked_operation_id
       ) VALUES (
         $1, $2, $3, $4, $4, $4::timestamptz + INTERVAL '168 hours', $5,
         NULL, NULL, NULL
       )`,
      [sessionId, fixture.accountId, randomBytes(32), now, randomUUID()],
    );
    await claim(runtime, attemptId, leaseId);
    await prepare(runtime, attemptId, leaseId, tokenId, token.hash);

    const [sending, reset] = await Promise.all([
      confirm(runtime, attemptId, leaseId),
      secondRuntime.query<{ account_id: string; state: string }>(
        `SELECT * FROM public.start_password_reset_operation($1, $2, $3)`,
        [randomUUID(), randomUUID(), token.hash],
      ),
    ]);

    expect(sending).toMatchObject({ outcome: 'SEND_AUTHORIZED' });
    expect(reset.rows).toEqual([
      { account_id: fixture.accountId, state: 'STARTED' },
    ]);
    const session = await migrator.query<{
      revoked_at: Date | null;
      revocation_reason: string | null;
    }>(
      `SELECT revoked_at, revocation_reason
       FROM public.auth_session WHERE id = $1`,
      [sessionId],
    );
    expect(session.rows).toEqual([
      { revoked_at: null, revocation_reason: null },
    ]);
  });

  it('keeps SEND_AUTHORIZED uncommitted until the caller transaction commits', async () => {
    const fixture = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    const tokenId = randomUUID();
    await claim(runtime, attemptId, leaseId);
    await prepare(runtime, attemptId, leaseId, tokenId, tokenFixture().hash);

    await runtime.query('BEGIN');
    try {
      await expect(confirm(runtime, attemptId, leaseId)).resolves.toMatchObject(
        {
          outcome: 'SEND_AUTHORIZED',
          recipient_email: fixture.email,
        },
      );
      const beforeCommit = await secondRuntime.query<{
        outcome: string;
        request_state: string;
        attempt_state: string;
      }>(
        `SELECT * FROM public.reconcile_password_recovery_delivery(
           $1, $2, $3, $4
         )`,
        [fixture.requestId, attemptId, leaseId, tokenId],
      );
      expect(beforeCommit.rows[0]).toMatchObject({
        outcome: 'OBSERVED',
        request_state: 'PREPARED',
        attempt_state: 'PREPARED',
      });
      await runtime.query('COMMIT');
    } catch (error) {
      await runtime.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    await expect(confirm(secondRuntime, attemptId, leaseId)).resolves.toEqual(
      expect.objectContaining({
        outcome: 'ALREADY_SENDING',
        recipient_email: null,
      }),
    );
  });

  it('proves rollback and reconciliation boundaries for all five protected operations', async () => {
    const fixture = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    const tokenId = randomUUID();
    const token = tokenFixture();

    const inRolledBackTransaction = async (
      operation: () => Promise<void>,
    ): Promise<void> => {
      await runtime.query('BEGIN');
      try {
        await operation();
      } catch (error) {
        await runtime.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      await runtime.query('ROLLBACK');
    };

    await inRolledBackTransaction(async () => {
      await claim(runtime, attemptId, leaseId);
      await expect(
        reconcile(
          secondRuntime,
          fixture.requestId,
          attemptId,
          leaseId,
          tokenId,
        ),
      ).resolves.toMatchObject({ outcome: 'NOT_FOUND' });
    });
    await expect(
      reconcile(secondRuntime, fixture.requestId, attemptId, leaseId, null),
    ).resolves.toMatchObject({ outcome: 'NOT_FOUND' });

    await claim(runtime, attemptId, leaseId);
    await inRolledBackTransaction(async () => {
      const expiration = await runtime.query<{ expires_at: Date }>(
        `SELECT pg_catalog.transaction_timestamp() + INTERVAL '29 minutes'
           AS expires_at`,
      );
      await prepare(
        runtime,
        attemptId,
        leaseId,
        tokenId,
        token.hash,
        expiration.rows[0]!.expires_at,
      );
      await expect(
        reconcile(
          secondRuntime,
          fixture.requestId,
          attemptId,
          leaseId,
          tokenId,
        ),
      ).resolves.toMatchObject({
        outcome: 'OBSERVED',
        attempt_state: 'PREPARING',
      });
    });
    await prepare(runtime, attemptId, leaseId, tokenId, token.hash);

    await inRolledBackTransaction(async () => {
      await confirm(runtime, attemptId, leaseId);
      await expect(
        reconcile(
          secondRuntime,
          fixture.requestId,
          attemptId,
          leaseId,
          tokenId,
        ),
      ).resolves.toMatchObject({
        outcome: 'OBSERVED',
        attempt_state: 'PREPARED',
      });
    });
    await confirm(runtime, attemptId, leaseId);

    await inRolledBackTransaction(async () => {
      await complete(runtime, attemptId, leaseId, 'ACCEPTED');
      await expect(
        reconcile(
          secondRuntime,
          fixture.requestId,
          attemptId,
          leaseId,
          tokenId,
        ),
      ).resolves.toMatchObject({
        outcome: 'OBSERVED',
        attempt_state: 'SENDING',
      });
    });
    await complete(runtime, attemptId, leaseId, 'ACCEPTED');

    const firstObservation = await reconcile(
      secondRuntime,
      fixture.requestId,
      attemptId,
      leaseId,
      tokenId,
    );
    const repeatedObservation = await reconcile(
      secondRuntime,
      fixture.requestId,
      attemptId,
      leaseId,
      tokenId,
    );
    expect(firstObservation).toMatchObject({
      outcome: 'OBSERVED',
      request_state: 'SENT',
      attempt_state: 'SENT',
      accepted_audit_confirmed: true,
    });
    expect(repeatedObservation).toEqual(firstObservation);
  });

  it('rolls back SENT when the mandatory audit cannot be inserted', async () => {
    await migrator.query(`
      CREATE FUNCTION public.f1b456_reject_send_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.operation = 'AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED' THEN
          RAISE EXCEPTION 'synthetic audit rejection';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER f1b456_reject_send_audit
      BEFORE INSERT ON public.audit_event
      FOR EACH ROW EXECUTE FUNCTION public.f1b456_reject_send_audit();
    `);
    const fixture = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    const tokenId = randomUUID();
    try {
      await claim(runtime, attemptId, leaseId);
      await prepare(runtime, attemptId, leaseId, tokenId, tokenFixture().hash);
      await confirm(runtime, attemptId, leaseId);
      await expect(
        complete(runtime, attemptId, leaseId, 'ACCEPTED'),
      ).rejects.toThrow(/synthetic audit rejection/);
      const evidence = await migrator.query<{
        request_state: string;
        attempt_state: string;
        audit_count: number;
      }>(
        `SELECT request.state AS request_state, attempt.state AS attempt_state,
           (SELECT pg_catalog.count(*)::integer FROM public.audit_event
            WHERE operation_id = $2) AS audit_count
         FROM public.password_recovery_request AS request
         JOIN public.password_recovery_delivery_attempt AS attempt
           ON attempt.recovery_request_id = request.recovery_request_id
         WHERE request.recovery_request_id = $1
           AND attempt.delivery_attempt_id = $2`,
        [fixture.requestId, attemptId],
      );
      expect(evidence.rows[0]).toEqual({
        request_state: 'SENDING',
        attempt_state: 'SENDING',
        audit_count: 0,
      });
    } finally {
      await migrator.query(
        'DROP TRIGGER f1b456_reject_send_audit ON public.audit_event',
      );
      await migrator.query('DROP FUNCTION public.f1b456_reject_send_audit()');
    }
  });

  it('enforces the three-active-token ceiling under the account lock', async () => {
    const fixture = await createPendingFixture();
    const now = new Date();
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const requestId = randomUUID();
      const attemptId = randomUUID();
      const tokenId = randomUUID();
      const token = tokenFixture();
      await migrator.query(
        `INSERT INTO public.password_recovery_request (
           recovery_request_id, account_id, state, received_at, updated_at,
           terminal_at, current_attempt_number, cancelled_operation_id
         ) VALUES ($1, $2, 'SENT', $3, $3, $3, 1, NULL)`,
        [requestId, fixture.accountId, now],
      );
      await migrator.query(
        `INSERT INTO public.password_recovery_delivery_attempt (
           delivery_attempt_id, recovery_request_id, attempt_number, state,
           scheduled_at, lease_id, lease_expires_at, sending_confirmed_at,
           accepted_at, terminal_at, failure_class, cancelled_operation_id
         ) VALUES ($1, $2, 1, 'SENT', $3, NULL, NULL, $3, $3, $3, NULL, NULL)`,
        [attemptId, requestId, now],
      );
      await migrator.query(
        `INSERT INTO public.password_reset_token (
           password_reset_token_id, delivery_attempt_id, account_id, token_hash,
           created_at, expires_at, consumed_at, consumed_operation_id,
           invalidated_at, invalidated_operation_id
         ) VALUES ($1, $2, $3, $4, $5, $5::timestamptz + INTERVAL '30 minutes',
                   NULL, NULL, NULL, NULL)`,
        [tokenId, attemptId, fixture.accountId, token.hash, now],
      );
      expect(ordinal).toBeGreaterThan(0);
    }

    const attemptId = randomUUID();
    const leaseId = randomUUID();
    await claim(runtime, attemptId, leaseId);
    await expect(
      prepare(runtime, attemptId, leaseId, randomUUID(), tokenFixture().hash),
    ).resolves.toMatchObject({ outcome: 'INCONSISTENT' });
    const count = await migrator.query<{ active: number }>(
      `SELECT pg_catalog.count(*)::integer AS active
       FROM public.password_reset_token
       WHERE account_id = $1 AND expires_at > pg_catalog.transaction_timestamp()
         AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [fixture.accountId],
    );
    expect(count.rows).toEqual([{ active: 3 }]);
  });

  it('keeps reconciliation observational and grants only the five hardened functions', async () => {
    const fixture = await createPendingFixture();
    const attemptId = randomUUID();
    const leaseId = randomUUID();
    await claim(runtime, attemptId, leaseId);
    const observed = await runtime.query<{
      outcome: string;
      request_state: string;
      attempt_state: string;
      observed_lease_id: string;
    }>(
      `SELECT * FROM public.reconcile_password_recovery_delivery(
         $1, $2, $3, NULL
       )`,
      [fixture.requestId, attemptId, leaseId],
    );
    expect(observed.rows).toEqual([
      expect.objectContaining({
        outcome: 'OBSERVED',
        request_state: 'PREPARING',
        attempt_state: 'PREPARING',
        observed_lease_id: leaseId,
      }),
    ]);

    const functions = await migrator.query<{
      name: string;
      owner: string;
      security_definer: boolean;
      config: string[];
      runtime_execute: boolean;
      public_execute: boolean;
    }>(
      `SELECT procedure.proname AS name,
              owner.rolname AS owner,
              procedure.prosecdef AS security_definer,
              procedure.proconfig AS config,
              pg_catalog.has_function_privilege(
                'bello_runtime', procedure.oid, 'EXECUTE'
              ) AS runtime_execute,
              pg_catalog.has_function_privilege(
                'public', procedure.oid, 'EXECUTE'
              ) AS public_execute
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = procedure.pronamespace
       JOIN pg_catalog.pg_roles AS owner
         ON owner.oid = procedure.proowner
       WHERE namespace.nspname = 'public'
         AND procedure.proname = ANY($1::text[])
       ORDER BY procedure.proname`,
      [
        [
          'claim_password_recovery_delivery',
          'prepare_password_recovery_delivery',
          'confirm_password_recovery_sending',
          'complete_password_recovery_delivery',
          'reconcile_password_recovery_delivery',
        ],
      ],
    );
    expect(functions.rows).toHaveLength(5);
    for (const fn of functions.rows) {
      expect(fn).toMatchObject({
        owner: 'bello_test_migrator',
        security_definer: true,
        runtime_execute: true,
        public_execute: false,
      });
      expect(fn.config).toContain('search_path=pg_catalog, public, pg_temp');
    }

    for (const table of [
      'account',
      'password_recovery_request',
      'password_recovery_delivery_attempt',
      'password_reset_token',
      'audit_event',
    ]) {
      const privileges = await migrator.query<{
        select: boolean;
        insert: boolean;
        update: boolean;
        delete: boolean;
      }>(
        `SELECT
           pg_catalog.has_table_privilege('bello_runtime', $1, 'SELECT') AS select,
           pg_catalog.has_table_privilege('bello_runtime', $1, 'INSERT') AS insert,
           pg_catalog.has_table_privilege('bello_runtime', $1, 'UPDATE') AS update,
           pg_catalog.has_table_privilege('bello_runtime', $1, 'DELETE') AS delete`,
        [`public.${table}`],
      );
      expect(privileges.rows[0]).toEqual({
        select: false,
        insert: false,
        update: false,
        delete: false,
      });
    }
    await expect(
      runtime.query('SELECT email FROM public.account LIMIT 1'),
    ).rejects.toThrow();
    await expect(
      runtime.query(
        `UPDATE public.password_recovery_request SET state = state WHERE FALSE`,
      ),
    ).rejects.toThrow();
  });
});
