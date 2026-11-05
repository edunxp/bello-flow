import { Injectable } from '@nestjs/common';
import { hasApprovedPasswordHashProfile } from '../credentials/password-credential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01', '55P03']);
const MAX_ATTEMPTS = 3;

export const PASSWORD_RESET_PERSISTENCE_ERROR_CODE = Object.freeze({
  NOT_SENT: 'NOT_SENT',
  ROLLBACK_CONFIRMED: 'ROLLBACK_CONFIRMED',
  OPERATION_INDETERMINATE: 'OPERATION_INDETERMINATE',
} as const);

export type PasswordResetPersistenceErrorCode =
  (typeof PASSWORD_RESET_PERSISTENCE_ERROR_CODE)[keyof typeof PASSWORD_RESET_PERSISTENCE_ERROR_CODE];

export class PasswordResetPersistenceError extends Error {
  constructor(
    public readonly code: PasswordResetPersistenceErrorCode,
    public readonly resetOperationId?: string,
  ) {
    super(code);
    this.name = 'PasswordResetPersistenceError';
  }
}

export interface StartPasswordResetInput {
  readonly resetOperationId: string;
  readonly auditEventId: string;
  readonly presentedTokenHash: Uint8Array;
}

export interface CompletePasswordResetInput {
  readonly resetOperationId: string;
  readonly auditEventId: string;
  readonly newPasswordHash: string;
}

export type PasswordResetStartOutcome = 'STARTED' | 'REJECTED' | 'NOT_RESOLVED';
export type PasswordResetCompleteOutcome = 'COMPLETED' | 'REJECTED';
export type PasswordResetReconciliationOutcome =
  'COMPLETED' | 'REJECTED' | 'NOT_FOUND' | 'INCONSISTENT' | 'UNKNOWN';

type StartRow = { accountId: string; state: string };
type CompleteRow = StartRow & {
  revokedSessionCount: bigint;
  invalidatedTokenCount: bigint;
  cancelledRequestCount: bigint;
  cancelledAttemptCount: bigint;
};
type ReconciliationRow = { outcome: string };

function assertUuidV4(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new PasswordResetPersistenceError(
      PASSWORD_RESET_PERSISTENCE_ERROR_CODE.NOT_SENT,
    );
  }
}

function assertTokenHash(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throw new PasswordResetPersistenceError(
      PASSWORD_RESET_PERSISTENCE_ERROR_CODE.NOT_SENT,
    );
  }
}

function assertPasswordHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !hasApprovedPasswordHashProfile(value)) {
    throw new PasswordResetPersistenceError(
      PASSWORD_RESET_PERSISTENCE_ERROR_CODE.NOT_SENT,
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
      if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) {
        if (!/^P\d{4}$/.test(value)) return value;
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
    if (typeof message === 'string' && /lock timeout/i.test(message))
      return true;
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

function hasValidAccountId(row: StartRow): boolean {
  return UUID_V4_PATTERN.test(row.accountId);
}

function hasValidCounts(row: CompleteRow): boolean {
  return [
    row.revokedSessionCount,
    row.invalidatedTokenCount,
    row.cancelledRequestCount,
    row.cancelledAttemptCount,
  ].every((value) => typeof value === 'bigint' && value >= 0n);
}

@Injectable()
export class PasswordResetPersistence {
  constructor(private readonly prisma: PrismaService) {}

  async start(
    input: StartPasswordResetInput,
  ): Promise<PasswordResetStartOutcome> {
    assertUuidV4(input?.resetOperationId);
    assertUuidV4(input?.auditEventId);
    assertTokenHash(input?.presentedTokenHash);

    const rows = await this.executeMutation(
      input.resetOperationId,
      () =>
        this.prisma.$queryRaw<StartRow[]>`
        SELECT
          account_id AS "accountId",
          state
        FROM public.start_password_reset_operation(
          ${input.resetOperationId}::uuid,
          ${input.auditEventId}::uuid,
          ${Buffer.from(input.presentedTokenHash)}::bytea
        )
      `,
    );
    if (rows.length === 0) return 'NOT_RESOLVED';
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row ||
      !hasValidAccountId(row) ||
      (row.state !== 'STARTED' && row.state !== 'REJECTED')
    ) {
      throw new PasswordResetPersistenceError(
        PASSWORD_RESET_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        input.resetOperationId,
      );
    }
    return row.state;
  }

  async complete(
    input: CompletePasswordResetInput,
  ): Promise<PasswordResetCompleteOutcome> {
    assertUuidV4(input?.resetOperationId);
    assertUuidV4(input?.auditEventId);
    assertPasswordHash(input?.newPasswordHash);

    const rows = await this.executeMutation(
      input.resetOperationId,
      () =>
        this.prisma.$queryRaw<CompleteRow[]>`
        SELECT
          account_id AS "accountId",
          state,
          revoked_session_count AS "revokedSessionCount",
          invalidated_token_count AS "invalidatedTokenCount",
          cancelled_request_count AS "cancelledRequestCount",
          cancelled_attempt_count AS "cancelledAttemptCount"
        FROM public.complete_password_reset_operation(
          ${input.resetOperationId}::uuid,
          ${input.auditEventId}::uuid,
          ${input.newPasswordHash}::text
        )
      `,
    );
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row ||
      !hasValidAccountId(row) ||
      !hasValidCounts(row) ||
      (row.state !== 'COMPLETED' && row.state !== 'REJECTED')
    ) {
      throw new PasswordResetPersistenceError(
        PASSWORD_RESET_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        input.resetOperationId,
      );
    }
    return row.state;
  }

  async reconcile(
    resetOperationId: string,
  ): Promise<PasswordResetReconciliationOutcome> {
    assertUuidV4(resetOperationId);
    try {
      const rows = await this.prisma.$queryRaw<ReconciliationRow[]>`
        SELECT public.reconcile_password_reset_operation(
          ${resetOperationId}::uuid
        ) AS outcome
      `;
      const outcome = rows.length === 1 ? rows[0]?.outcome : undefined;
      return outcome === 'COMPLETED' ||
        outcome === 'REJECTED' ||
        outcome === 'NOT_FOUND' ||
        outcome === 'INCONSISTENT' ||
        outcome === 'UNKNOWN'
        ? outcome
        : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  private async executeMutation<T>(
    resetOperationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const sqlState = readSqlState(error);
        if (
          sqlState &&
          isRetryableSqlState(error, sqlState) &&
          attempt < MAX_ATTEMPTS
        ) {
          continue;
        }
        throw new PasswordResetPersistenceError(
          sqlState && isConfirmedRollbackSqlState(sqlState)
            ? PASSWORD_RESET_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED
            : PASSWORD_RESET_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
          resetOperationId,
        );
      }
    }
    throw new PasswordResetPersistenceError(
      PASSWORD_RESET_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
      resetOperationId,
    );
  }
}
