import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01', '55P03']);

export type PasswordResetTerminalizerSelectionOutcome =
  'CANDIDATE' | 'INCONSISTENT' | 'NO_CANDIDATE';
export interface PasswordResetTerminalizerSelection {
  readonly outcome: PasswordResetTerminalizerSelectionOutcome;
  readonly resetOperationId: string | null;
}
export type PasswordResetTerminalizerOutcome =
  | 'TERMINALIZED'
  | 'LOST_RACE'
  | 'ALREADY_TERMINAL'
  | 'INCONSISTENT'
  | 'INDETERMINATE'
  | 'INFRASTRUCTURE_ERROR';

type SelectionRow = { outcome: string; resetOperationId: string | null };
type OutcomeRow = { outcome: string };

function readSqlState(error: unknown): string | null {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ['sqlState', 'sqlstate', 'originalCode', 'code']) {
      const code = record[key];
      if (
        typeof code === 'string' &&
        /^[0-9A-Z]{5}$/.test(code) &&
        !(key === 'code' && /^P\d{4}$/.test(code))
      )
        return code;
    }
    for (const key of [
      'cause',
      'meta',
      'database_error',
      'driverAdapterError',
    ]) {
      if (record[key] !== undefined) pending.push(record[key]);
    }
  }
  return null;
}

function isLockTimeout(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (
      typeof record.message === 'string' &&
      /lock timeout/i.test(record.message)
    ) {
      return true;
    }
    for (const key of [
      'cause',
      'meta',
      'database_error',
      'driverAdapterError',
    ]) {
      if (record[key] !== undefined) pending.push(record[key]);
    }
  }
  return false;
}

@Injectable()
export class PasswordResetTerminalizerPersistence {
  constructor(private readonly prisma: PrismaService) {}

  async find(): Promise<PasswordResetTerminalizerSelection> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await this.setTimeouts(tx);
      return tx.$queryRaw<SelectionRow[]>`
        SELECT outcome, reset_operation_id AS "resetOperationId"
        FROM public.find_abandoned_password_reset_operation()
      `;
    });
    const row = rows.length === 1 ? rows[0] : undefined;
    if (
      !row ||
      !['CANDIDATE', 'INCONSISTENT', 'NO_CANDIDATE'].includes(row.outcome)
    )
      throw new Error('INVALID_TERMINALIZER_SELECTION');
    if (
      row.outcome === 'NO_CANDIDATE'
        ? row.resetOperationId !== null
        : !row.resetOperationId || !UUID_V4_PATTERN.test(row.resetOperationId)
    )
      throw new Error('INVALID_TERMINALIZER_SELECTION');
    return row as PasswordResetTerminalizerSelection;
  }

  async hasInconsistent(): Promise<boolean> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await this.setTimeouts(tx);
      return tx.$queryRaw<{ result: boolean }[]>`
        SELECT public.has_inconsistent_password_reset_operation() AS result
      `;
    });
    if (rows.length !== 1 || typeof rows[0]?.result !== 'boolean')
      throw new Error('INVALID_TERMINALIZER_PROBE');
    return rows[0].result;
  }

  async terminalize(
    resetOperationId: string,
  ): Promise<PasswordResetTerminalizerOutcome> {
    if (!UUID_V4_PATTERN.test(resetOperationId)) return 'INDETERMINATE';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          await this.setTimeouts(tx);
          const rows = await tx.$queryRaw<OutcomeRow[]>`
            SELECT public.terminalize_abandoned_password_reset_operation(
              ${resetOperationId}::uuid
            ) AS outcome
          `;
          return rows.length === 1 ? rows[0]?.outcome : undefined;
        });
        if (
          outcome === 'TERMINALIZED' ||
          outcome === 'ALREADY_TERMINAL' ||
          outcome === 'INCONSISTENT'
        )
          return outcome;
        if (outcome === 'NOT_ELIGIBLE') return 'LOST_RACE';
        if (outcome === 'NOT_OBSERVED') return 'INDETERMINATE';
        return 'INDETERMINATE';
      } catch (error) {
        const state = readSqlState(error);
        const retryable =
          state !== null &&
          RETRYABLE_SQLSTATES.has(state) &&
          (state !== '55P03' || isLockTimeout(error));
        if (retryable && attempt < 3) continue;
        if (
          state &&
          !state.startsWith('08') &&
          !['57014', '57P01', '57P02', '57P03'].includes(state)
        )
          return 'INFRASTRUCTURE_ERROR';
        return this.reconcile(resetOperationId);
      }
    }
    return 'INDETERMINATE';
  }

  private async reconcile(
    resetOperationId: string,
  ): Promise<PasswordResetTerminalizerOutcome> {
    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        await this.setTimeouts(tx);
        return tx.$queryRaw<OutcomeRow[]>`
          SELECT public.reconcile_password_reset_operation(${resetOperationId}::uuid) AS outcome
        `;
      });
      const outcome = rows.length === 1 ? rows[0]?.outcome : undefined;
      if (outcome === 'NOT_FOUND') return 'TERMINALIZED';
      if (outcome === 'COMPLETED' || outcome === 'REJECTED') return 'LOST_RACE';
      if (outcome === 'INCONSISTENT') return 'INCONSISTENT';
      return 'INDETERMINATE';
    } catch {
      return 'INDETERMINATE';
    }
  }

  private async setTimeouts(
    tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '2s'`);
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '5s'`);
  }
}
