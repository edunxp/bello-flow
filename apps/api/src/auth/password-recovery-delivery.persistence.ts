import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01', '55P03']);
const MAX_ATTEMPTS = 3;

export const PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE = Object.freeze({
  NOT_SENT: 'NOT_SENT',
  ROLLBACK_CONFIRMED: 'ROLLBACK_CONFIRMED',
  OPERATION_INDETERMINATE: 'OPERATION_INDETERMINATE',
} as const);

export type PasswordRecoveryDeliveryPersistenceErrorCode =
  (typeof PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE)[keyof typeof PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE];

export class PasswordRecoveryDeliveryPersistenceError extends Error {
  constructor(
    public readonly code: PasswordRecoveryDeliveryPersistenceErrorCode,
    public readonly deliveryAttemptId?: string,
  ) {
    super(code);
    this.name = 'PasswordRecoveryDeliveryPersistenceError';
  }
}

export type PasswordRecoveryDeliveryClaimOutcome =
  | 'CLAIMED'
  | 'RESUMED_PREPARING'
  | 'RECOVERED_PREPARED'
  | 'RECOVERED_SENDING_UNKNOWN'
  | 'NO_WORK'
  | 'INCONSISTENT';

export interface PasswordRecoveryDeliveryClaim {
  readonly outcome: PasswordRecoveryDeliveryClaimOutcome;
  readonly recoveryRequestId: string | null;
  readonly deliveryAttemptId: string | null;
  readonly attemptNumber: number | null;
  readonly leaseId: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly passwordResetTokenId: string | null;
}

export type PasswordRecoveryDeliveryPreparationOutcome =
  | 'PREPARED'
  | 'ALREADY_PREPARED_MATCHING'
  | 'STALE_OWNER'
  | 'ALREADY_TERMINAL'
  | 'INCONSISTENT';

export interface PasswordRecoveryDeliveryPreparation {
  readonly outcome: PasswordRecoveryDeliveryPreparationOutcome;
  readonly recoveryRequestId: string | null;
  readonly deliveryAttemptId: string;
  readonly passwordResetTokenId: string | null;
  readonly expiresAt: Date | null;
}

export type PasswordRecoverySendingOutcome =
  | 'SEND_AUTHORIZED'
  | 'ALREADY_SENDING'
  | 'STALE_OWNER'
  | 'ALREADY_TERMINAL'
  | 'INCONSISTENT';

export interface PasswordRecoverySendingConfirmation {
  readonly outcome: PasswordRecoverySendingOutcome;
  readonly recoveryRequestId: string | null;
  readonly deliveryAttemptId: string;
  readonly leaseId: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly recipientEmail: string | null;
  readonly tokenExpiresAt: Date | null;
}

export type PasswordRecoveryCompletionOutcome =
  | 'SENT'
  | 'FAILED'
  | 'UNKNOWN'
  | 'ALREADY_TERMINAL'
  | 'STALE_OWNER'
  | 'INCONSISTENT';

export interface PasswordRecoveryDeliveryCompletion {
  readonly outcome: PasswordRecoveryCompletionOutcome;
  readonly recoveryRequestId: string | null;
  readonly deliveryAttemptId: string;
  readonly requestState: string | null;
  readonly attemptState: string | null;
  readonly nextEligibleAt: Date | null;
}

export type PasswordRecoveryDeliveryExternalResult =
  'ACCEPTED' | 'NOT_ACCEPTED' | 'INDETERMINATE';

export type PasswordRecoveryDeliveryReconciliationOutcome =
  'OBSERVED' | 'NOT_FOUND' | 'INCONSISTENT' | 'UNKNOWN';

export interface PasswordRecoveryDeliveryReconciliation {
  readonly outcome: PasswordRecoveryDeliveryReconciliationOutcome;
  readonly recoveryRequestId: string | null;
  readonly deliveryAttemptId: string | null;
  readonly requestState: string | null;
  readonly attemptState: string | null;
  readonly observedLeaseId: string | null;
  readonly passwordResetTokenId: string | null;
  readonly tokenExpiresAt: Date | null;
  readonly attemptNumber?: number | null;
  readonly failureClass?: string | null;
  readonly attemptTerminalAt?: Date | null;
  readonly tokenConsumedAt?: Date | null;
  readonly tokenInvalidatedAt?: Date | null;
  readonly tokenInvalidatedOperationId?: string | null;
  readonly acceptedAuditConfirmed?: boolean;
}

interface ClaimRow {
  outcome: string;
  recoveryRequestId: string | null;
  deliveryAttemptId: string | null;
  attemptNumber: number | null;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  passwordResetTokenId: string | null;
}

interface PreparationRow {
  outcome: string;
  recoveryRequestId: string | null;
  deliveryAttemptId: string;
  passwordResetTokenId: string | null;
  expiresAt: Date | null;
}

interface SendingRow {
  outcome: string;
  recoveryRequestId: string | null;
  deliveryAttemptId: string;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  recipientEmail: string | null;
  tokenExpiresAt: Date | null;
}

interface CompletionRow {
  outcome: string;
  recoveryRequestId: string | null;
  deliveryAttemptId: string;
  requestState: string | null;
  attemptState: string | null;
  nextEligibleAt: Date | null;
}

interface ReconciliationRow {
  outcome: string;
  recoveryRequestId: string | null;
  deliveryAttemptId: string | null;
  requestState: string | null;
  attemptState: string | null;
  observedLeaseId: string | null;
  passwordResetTokenId: string | null;
  tokenExpiresAt: Date | null;
  attemptNumber: number | null;
  failureClass: string | null;
  attemptTerminalAt: Date | null;
  tokenConsumedAt: Date | null;
  tokenInvalidatedAt: Date | null;
  tokenInvalidatedOperationId: string | null;
  acceptedAuditConfirmed: boolean;
}

function assertUuidV4(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new PasswordRecoveryDeliveryPersistenceError(
      PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    );
  }
}

function assertOptionalUuidV4(value: unknown): asserts value is string | null {
  if (value !== null) assertUuidV4(value);
}

function assertHash(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throw new PasswordRecoveryDeliveryPersistenceError(
      PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    );
  }
}

function assertDate(value: unknown): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PasswordRecoveryDeliveryPersistenceError(
      PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    );
  }
}

function readSqlState(error: unknown): string | null {
  const candidates: unknown[] = [error];
  const visited = new Set<unknown>();
  while (candidates.length > 0) {
    const candidate = candidates.shift();
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      visited.has(candidate)
    ) {
      continue;
    }
    visited.add(candidate);
    const record = candidate as Record<string, unknown>;
    for (const key of ['sqlState', 'sqlstate', 'originalCode', 'code']) {
      const value = record[key];
      if (
        typeof value === 'string' &&
        /^[0-9A-Z]{5}$/.test(value) &&
        !/^P\d{4}$/.test(value)
      ) {
        return value;
      }
    }
    for (const key of [
      'cause',
      'meta',
      'database_error',
      'driverAdapterError',
    ]) {
      if (record[key] !== undefined) candidates.push(record[key]);
    }
  }
  return null;
}

function isConfirmedRollbackSqlState(sqlState: string): boolean {
  return (
    !sqlState.startsWith('08') &&
    !['57P01', '57P02', '57P03'].includes(sqlState)
  );
}

function isRetryableSqlState(error: unknown, sqlState: string): boolean {
  if (!RETRYABLE_SQLSTATES.has(sqlState)) return false;
  if (sqlState !== '55P03') return true;
  const candidates: unknown[] = [error];
  const visited = new Set<unknown>();
  while (candidates.length > 0) {
    const candidate = candidates.shift();
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      visited.has(candidate)
    ) {
      continue;
    }
    visited.add(candidate);
    const record = candidate as Record<string, unknown>;
    const message = record.message ?? record.originalMessage;
    if (typeof message === 'string' && /lock timeout/i.test(message)) {
      return true;
    }
    for (const key of [
      'cause',
      'meta',
      'database_error',
      'driverAdapterError',
    ]) {
      if (record[key] !== undefined) candidates.push(record[key]);
    }
  }
  return false;
}

function oneRow<T>(rows: T[], deliveryAttemptId?: string): NonNullable<T> {
  const row = rows.length === 1 ? rows[0] : undefined;
  if (!row) {
    throw new PasswordRecoveryDeliveryPersistenceError(
      PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      deliveryAttemptId,
    );
  }
  return row;
}

@Injectable()
export class PasswordRecoveryDeliveryPersistence {
  constructor(private readonly prisma: PrismaService) {}

  async claim(
    deliveryAttemptId: string,
    leaseId: string,
  ): Promise<PasswordRecoveryDeliveryClaim> {
    assertUuidV4(deliveryAttemptId);
    assertUuidV4(leaseId);
    const rows = await this.executeMutation(
      deliveryAttemptId,
      (tx) =>
        tx.$queryRaw<ClaimRow[]>`
        SELECT
          outcome,
          recovery_request_id AS "recoveryRequestId",
          delivery_attempt_id AS "deliveryAttemptId",
          attempt_number AS "attemptNumber",
          lease_id AS "leaseId",
          lease_expires_at AS "leaseExpiresAt",
          password_reset_token_id AS "passwordResetTokenId"
        FROM public.claim_password_recovery_delivery(
          ${deliveryAttemptId}::uuid,
          ${leaseId}::uuid
        )
      `,
    );
    const row = oneRow(rows, deliveryAttemptId);
    if (
      ![
        'CLAIMED',
        'RESUMED_PREPARING',
        'RECOVERED_PREPARED',
        'RECOVERED_SENDING_UNKNOWN',
        'NO_WORK',
        'INCONSISTENT',
      ].includes(row.outcome)
    ) {
      throw new PasswordRecoveryDeliveryPersistenceError(
        PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        deliveryAttemptId,
      );
    }
    return row as PasswordRecoveryDeliveryClaim;
  }

  async prepare(input: {
    readonly deliveryAttemptId: string;
    readonly leaseId: string;
    readonly passwordResetTokenId: string;
    readonly tokenHash: Uint8Array;
    readonly expiresAt: Date;
  }): Promise<PasswordRecoveryDeliveryPreparation> {
    assertUuidV4(input?.deliveryAttemptId);
    assertUuidV4(input?.leaseId);
    assertUuidV4(input?.passwordResetTokenId);
    assertHash(input?.tokenHash);
    assertDate(input?.expiresAt);
    const rows = await this.executeMutation(
      input.deliveryAttemptId,
      (tx) =>
        tx.$queryRaw<PreparationRow[]>`
        SELECT
          outcome,
          recovery_request_id AS "recoveryRequestId",
          delivery_attempt_id AS "deliveryAttemptId",
          password_reset_token_id AS "passwordResetTokenId",
          expires_at AS "expiresAt"
        FROM public.prepare_password_recovery_delivery(
          ${input.deliveryAttemptId}::uuid,
          ${input.leaseId}::uuid,
          ${input.passwordResetTokenId}::uuid,
          ${Buffer.from(input.tokenHash)}::bytea,
          ${input.expiresAt}::timestamptz
        )
      `,
    );
    const row = oneRow(rows, input.deliveryAttemptId);
    if (
      ![
        'PREPARED',
        'ALREADY_PREPARED_MATCHING',
        'STALE_OWNER',
        'ALREADY_TERMINAL',
        'INCONSISTENT',
      ].includes(row.outcome)
    ) {
      throw new PasswordRecoveryDeliveryPersistenceError(
        PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        input.deliveryAttemptId,
      );
    }
    return row as PasswordRecoveryDeliveryPreparation;
  }

  async confirmSending(
    deliveryAttemptId: string,
    leaseId: string,
  ): Promise<PasswordRecoverySendingConfirmation> {
    assertUuidV4(deliveryAttemptId);
    assertUuidV4(leaseId);
    const rows = await this.executeMutation(
      deliveryAttemptId,
      (tx) =>
        tx.$queryRaw<SendingRow[]>`
        SELECT
          outcome,
          recovery_request_id AS "recoveryRequestId",
          delivery_attempt_id AS "deliveryAttemptId",
          lease_id AS "leaseId",
          lease_expires_at AS "leaseExpiresAt",
          recipient_email AS "recipientEmail",
          token_expires_at AS "tokenExpiresAt"
        FROM public.confirm_password_recovery_sending(
          ${deliveryAttemptId}::uuid,
          ${leaseId}::uuid
        )
      `,
    );
    const row = oneRow(rows, deliveryAttemptId);
    if (
      ![
        'SEND_AUTHORIZED',
        'ALREADY_SENDING',
        'STALE_OWNER',
        'ALREADY_TERMINAL',
        'INCONSISTENT',
      ].includes(row.outcome)
    ) {
      throw new PasswordRecoveryDeliveryPersistenceError(
        PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        deliveryAttemptId,
      );
    }
    return row as PasswordRecoverySendingConfirmation;
  }

  async complete(input: {
    readonly deliveryAttemptId: string;
    readonly leaseId: string;
    readonly externalResult: PasswordRecoveryDeliveryExternalResult;
    readonly auditEventId: string | null;
  }): Promise<PasswordRecoveryDeliveryCompletion> {
    assertUuidV4(input?.deliveryAttemptId);
    assertUuidV4(input?.leaseId);
    if (
      input?.externalResult !== 'ACCEPTED' &&
      input?.externalResult !== 'NOT_ACCEPTED' &&
      input?.externalResult !== 'INDETERMINATE'
    ) {
      throw new PasswordRecoveryDeliveryPersistenceError(
        PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
      );
    }
    assertOptionalUuidV4(input?.auditEventId);
    if (
      (input.externalResult === 'ACCEPTED') !==
      (input.auditEventId !== null)
    ) {
      throw new PasswordRecoveryDeliveryPersistenceError(
        PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
      );
    }
    const rows = await this.executeMutation(
      input.deliveryAttemptId,
      (tx) =>
        tx.$queryRaw<CompletionRow[]>`
        SELECT
          outcome,
          recovery_request_id AS "recoveryRequestId",
          delivery_attempt_id AS "deliveryAttemptId",
          request_state AS "requestState",
          attempt_state AS "attemptState",
          next_eligible_at AS "nextEligibleAt"
        FROM public.complete_password_recovery_delivery(
          ${input.deliveryAttemptId}::uuid,
          ${input.leaseId}::uuid,
          ${input.externalResult}::text,
          ${input.auditEventId}::uuid
        )
      `,
    );
    const row = oneRow(rows, input.deliveryAttemptId);
    if (
      ![
        'SENT',
        'FAILED',
        'UNKNOWN',
        'ALREADY_TERMINAL',
        'STALE_OWNER',
        'INCONSISTENT',
      ].includes(row.outcome)
    ) {
      throw new PasswordRecoveryDeliveryPersistenceError(
        PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        input.deliveryAttemptId,
      );
    }
    return row as PasswordRecoveryDeliveryCompletion;
  }

  async reconcile(input: {
    readonly recoveryRequestId: string | null;
    readonly deliveryAttemptId: string | null;
    readonly leaseId: string | null;
    readonly passwordResetTokenId: string | null;
  }): Promise<PasswordRecoveryDeliveryReconciliation> {
    assertOptionalUuidV4(input?.recoveryRequestId);
    assertOptionalUuidV4(input?.deliveryAttemptId);
    assertOptionalUuidV4(input?.leaseId);
    assertOptionalUuidV4(input?.passwordResetTokenId);
    if (input.recoveryRequestId === null && input.deliveryAttemptId === null) {
      throw new PasswordRecoveryDeliveryPersistenceError(
        PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
      );
    }
    try {
      const rows = await this.prisma.$transaction(
        async (tx) => {
          await this.configureTransaction(tx);
          return tx.$queryRaw<ReconciliationRow[]>`
            SELECT
              outcome,
              recovery_request_id AS "recoveryRequestId",
              delivery_attempt_id AS "deliveryAttemptId",
              request_state AS "requestState",
              attempt_state AS "attemptState",
              observed_lease_id AS "observedLeaseId",
              password_reset_token_id AS "passwordResetTokenId",
              token_expires_at AS "tokenExpiresAt",
              attempt_number AS "attemptNumber",
              failure_class AS "failureClass",
              attempt_terminal_at AS "attemptTerminalAt",
              token_consumed_at AS "tokenConsumedAt",
              token_invalidated_at AS "tokenInvalidatedAt",
              token_invalidated_operation_id AS "tokenInvalidatedOperationId",
              accepted_audit_confirmed AS "acceptedAuditConfirmed"
            FROM public.reconcile_password_recovery_delivery(
              ${input.recoveryRequestId}::uuid,
              ${input.deliveryAttemptId}::uuid,
              ${input.leaseId}::uuid,
              ${input.passwordResetTokenId}::uuid
            )
          `;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      const row = rows.length === 1 ? rows[0] : undefined;
      if (
        row &&
        ['OBSERVED', 'NOT_FOUND', 'INCONSISTENT'].includes(row.outcome)
      ) {
        return row as PasswordRecoveryDeliveryReconciliation;
      }
    } catch {
      // Observation failure is never evidence that a mutation did not commit.
    }
    return {
      outcome: 'UNKNOWN',
      recoveryRequestId: input.recoveryRequestId,
      deliveryAttemptId: input.deliveryAttemptId,
      requestState: null,
      attemptState: null,
      observedLeaseId: null,
      passwordResetTokenId: null,
      tokenExpiresAt: null,
      attemptNumber: null,
      failureClass: null,
      attemptTerminalAt: null,
      tokenConsumedAt: null,
      tokenInvalidatedAt: null,
      tokenInvalidatedOperationId: null,
      acceptedAuditConfirmed: false,
    };
  }

  private async executeMutation<T>(
    deliveryAttemptId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.configureTransaction(tx);
            return operation(tx);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error) {
        const sqlState = readSqlState(error);
        if (
          sqlState &&
          isRetryableSqlState(error, sqlState) &&
          attempt < MAX_ATTEMPTS
        ) {
          continue;
        }
        throw new PasswordRecoveryDeliveryPersistenceError(
          sqlState && isConfirmedRollbackSqlState(sqlState)
            ? PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED
            : PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
          deliveryAttemptId,
        );
      }
    }
    throw new PasswordRecoveryDeliveryPersistenceError(
      PASSWORD_RECOVERY_DELIVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      deliveryAttemptId,
    );
  }

  private async configureTransaction(
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
  }
}
