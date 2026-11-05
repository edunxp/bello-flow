import { Injectable } from '@nestjs/common';
import {
  normalizeAccountEmail,
  type EmailKey,
} from '../identity/account-email.js';
import { PrismaService } from '../prisma/prisma.service.js';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE = Object.freeze({
  NOT_SENT: 'NOT_SENT',
  ROLLBACK_CONFIRMED: 'ROLLBACK_CONFIRMED',
  OPERATION_INDETERMINATE: 'OPERATION_INDETERMINATE',
} as const);

export type PasswordRecoveryPersistenceErrorCode =
  (typeof PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE)[keyof typeof PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE];

export class PasswordRecoveryPersistenceError extends Error {
  constructor(
    public readonly code: PasswordRecoveryPersistenceErrorCode,
    public readonly recoveryRequestId?: string,
  ) {
    super(code);
    this.name = 'PasswordRecoveryPersistenceError';
  }
}

export interface RecordPasswordRecoveryRequestInput {
  readonly recoveryRequestId: string;
  readonly auditEventId: string;
  readonly normalizedEmailKey: EmailKey | null;
}

export type PasswordRecoveryReconciliationOutcome =
  'RECORDED' | 'INCONSISTENT' | 'UNKNOWN';

type OutcomeRow = { outcome: string };

function assertUuidV4(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new PasswordRecoveryPersistenceError(
      PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    );
  }
}

function assertCanonicalEmailKey(value: EmailKey | null): void {
  if (value === null) return;
  const normalized = normalizeAccountEmail(value);
  if (normalized.status !== 'VALID' || normalized.emailKey !== value) {
    throw new PasswordRecoveryPersistenceError(
      PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.NOT_SENT,
    );
  }
}

@Injectable()
export class PasswordRecoveryRequestPersistence {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordPasswordRecoveryRequestInput): Promise<'RECORDED'> {
    assertUuidV4(input?.recoveryRequestId);
    assertUuidV4(input?.auditEventId);
    assertCanonicalEmailKey(input?.normalizedEmailKey);

    let rows: OutcomeRow[];
    try {
      rows = await this.prisma.$queryRaw<OutcomeRow[]>`
        SELECT outcome
        FROM public.request_password_recovery(
          ${input.recoveryRequestId}::uuid,
          ${input.auditEventId}::uuid,
          ${input.normalizedEmailKey}::text
        )
      `;
    } catch {
      throw new PasswordRecoveryPersistenceError(
        PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        input.recoveryRequestId,
      );
    }

    if (rows.length !== 1 || rows[0]?.outcome !== 'RECORDED') {
      throw new PasswordRecoveryPersistenceError(
        PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE,
        input.recoveryRequestId,
      );
    }
    return 'RECORDED';
  }

  async reconcile(
    recoveryRequestId: string,
  ): Promise<PasswordRecoveryReconciliationOutcome> {
    assertUuidV4(recoveryRequestId);
    try {
      const rows = await this.prisma.$queryRaw<OutcomeRow[]>`
        SELECT outcome
        FROM public.reconcile_password_recovery_request(
          ${recoveryRequestId}::uuid
        )
      `;
      const outcome = rows.length === 1 ? rows[0]?.outcome : undefined;
      return outcome === 'RECORDED' ||
        outcome === 'INCONSISTENT' ||
        outcome === 'UNKNOWN'
        ? outcome
        : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }
}
