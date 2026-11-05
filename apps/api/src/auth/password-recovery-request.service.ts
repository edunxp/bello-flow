import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizeAccountEmail } from '../identity/account-email.js';
import { PasswordRecoveryAdmissionService } from './password-recovery-admission.service.js';
import {
  PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE,
  PasswordRecoveryPersistenceError,
  PasswordRecoveryRequestPersistence,
} from './password-recovery-request.persistence.js';

export interface PasswordRecoveryRequestInput {
  readonly email: unknown;
  readonly trustedIp: unknown;
}

export type PasswordRecoveryRequestResult =
  | { readonly status: 'RECORDED' }
  | { readonly status: 'RATE_LIMITED'; readonly retryAfterSeconds: number }
  | { readonly status: 'SERVICE_UNAVAILABLE' };

@Injectable()
export class PasswordRecoveryRequestService {
  constructor(
    private readonly admission: PasswordRecoveryAdmissionService,
    private readonly persistence: PasswordRecoveryRequestPersistence,
  ) {}

  async request(
    input: PasswordRecoveryRequestInput,
  ): Promise<PasswordRecoveryRequestResult> {
    const normalized = normalizeAccountEmail(input?.email);
    const admission = this.admission.admitRequest(
      input?.email,
      input?.trustedIp,
    );
    if (admission.status === 'RATE_LIMITED') {
      return {
        status: 'RATE_LIMITED',
        retryAfterSeconds: admission.retryAfterSeconds,
      };
    }
    if (admission.status === 'SERVICE_UNAVAILABLE') {
      return { status: 'SERVICE_UNAVAILABLE' };
    }

    const recoveryRequestId = randomUUID();
    const auditEventId = randomUUID();
    try {
      await this.persistence.record({
        recoveryRequestId,
        auditEventId,
        normalizedEmailKey:
          normalized.status === 'VALID' ? normalized.emailKey : null,
      });
      admission.reservation.commit();
      return { status: 'RECORDED' };
    } catch (error) {
      if (this.isConfirmedWithoutEffect(error)) {
        admission.reservation.refund();
        return { status: 'SERVICE_UNAVAILABLE' };
      }

      let reconciliation: 'RECORDED' | 'INCONSISTENT' | 'UNKNOWN' = 'UNKNOWN';
      try {
        reconciliation = await this.persistence.reconcile(recoveryRequestId);
      } catch {
        // A failed observation cannot prove rollback or authorize repetition.
      }
      admission.reservation.commit();
      return reconciliation === 'RECORDED'
        ? { status: 'RECORDED' }
        : { status: 'SERVICE_UNAVAILABLE' };
    }
  }

  private isConfirmedWithoutEffect(error: unknown): boolean {
    return (
      error instanceof PasswordRecoveryPersistenceError &&
      (error.code === PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.NOT_SENT ||
        error.code ===
          PASSWORD_RECOVERY_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED)
    );
  }
}
