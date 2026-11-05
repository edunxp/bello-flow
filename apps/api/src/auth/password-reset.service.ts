import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { Argon2ExecutionService } from './argon2-execution.service.js';
import { PasswordRecoveryAdmissionService } from './password-recovery-admission.service.js';
import {
  PASSWORD_RESET_PERSISTENCE_ERROR_CODE,
  PasswordResetPersistence,
  PasswordResetPersistenceError,
  type PasswordResetReconciliationOutcome,
  type StartPasswordResetInput,
} from './password-reset.persistence.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_DOMAIN = Buffer.from('bello-flow/password-reset/v1\0', 'utf8');

export class PasswordResetValidationError extends Error {
  constructor() {
    super('INVALID_INPUT');
    this.name = 'PasswordResetValidationError';
  }
}

export interface PasswordResetInput {
  readonly token: unknown;
  readonly newPassword: unknown;
  readonly trustedIp: unknown;
  readonly signal?: AbortSignal;
}

export type PasswordResetResult =
  | { readonly status: 'COMPLETED' }
  | { readonly status: 'AUTHENTICATION_FAILED' }
  | { readonly status: 'RATE_LIMITED'; readonly retryAfterSeconds: number }
  | { readonly status: 'SERVICE_UNAVAILABLE' };

export function hashCanonicalPasswordResetToken(
  token: unknown,
): Uint8Array | null {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.byteLength !== 32 || bytes.toString('base64url') !== token) {
    return null;
  }
  return createHash('sha256').update(TOKEN_HASH_DOMAIN).update(bytes).digest();
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly admission: PasswordRecoveryAdmissionService,
    private readonly persistence: PasswordResetPersistence,
    private readonly argon2Execution: Argon2ExecutionService,
    private readonly credentials: PasswordCredentialService,
  ) {}

  async reset(input: PasswordResetInput): Promise<PasswordResetResult> {
    const token = input?.token;
    const newPassword = input?.newPassword;
    if (typeof token !== 'string') throw new PasswordResetValidationError();
    try {
      this.credentials.validatePassword(newPassword);
    } catch {
      throw new PasswordResetValidationError();
    }

    const admission = this.admission.admitReset(input?.trustedIp);
    if (admission.status === 'RATE_LIMITED') {
      return {
        status: 'RATE_LIMITED',
        retryAfterSeconds: admission.retryAfterSeconds,
      };
    }
    if (admission.status === 'SERVICE_UNAVAILABLE') {
      return { status: 'SERVICE_UNAVAILABLE' };
    }

    let tokenHash: Uint8Array | null;
    try {
      tokenHash = hashCanonicalPasswordResetToken(token);
    } catch {
      admission.reservation.refund();
      return { status: 'SERVICE_UNAVAILABLE' };
    }
    if (tokenHash === null) {
      admission.reservation.commit();
      return { status: 'AUTHENTICATION_FAILED' };
    }

    let resetOperationId: string;
    let startAuditEventId: string;
    let completeAuditEventId: string;
    let startInput: StartPasswordResetInput;
    try {
      resetOperationId = randomUUID();
      startAuditEventId = randomUUID();
      completeAuditEventId = randomUUID();
      startInput = {
        resetOperationId,
        auditEventId: startAuditEventId,
        presentedTokenHash: tokenHash,
      };
    } catch {
      admission.reservation.refund();
      return { status: 'SERVICE_UNAVAILABLE' };
    }
    let startOutcome: 'STARTED' | 'REJECTED' | 'NOT_RESOLVED';
    try {
      startOutcome = await this.persistence.start(startInput);
    } catch (error) {
      if (this.isConfirmedWithoutEffect(error)) {
        admission.reservation.refund();
        return { status: 'SERVICE_UNAVAILABLE' };
      }
      admission.reservation.commit();
      return this.reconcile(resetOperationId);
    }

    admission.reservation.commit();
    if (startOutcome !== 'STARTED') {
      return { status: 'AUTHENTICATION_FAILED' };
    }

    let newPasswordHash: string;
    try {
      newPasswordHash = await this.argon2Execution.execute(
        () => this.credentials.hashPassword(newPassword),
        input.signal,
      );
    } catch {
      return { status: 'SERVICE_UNAVAILABLE' };
    }

    try {
      const outcome = await this.persistence.complete({
        resetOperationId,
        auditEventId: completeAuditEventId,
        newPasswordHash,
      });
      return outcome === 'COMPLETED'
        ? { status: 'COMPLETED' }
        : { status: 'AUTHENTICATION_FAILED' };
    } catch {
      return this.reconcile(resetOperationId);
    }
  }

  private isConfirmedWithoutEffect(error: unknown): boolean {
    return (
      error instanceof PasswordResetPersistenceError &&
      (error.code === PASSWORD_RESET_PERSISTENCE_ERROR_CODE.NOT_SENT ||
        error.code === PASSWORD_RESET_PERSISTENCE_ERROR_CODE.ROLLBACK_CONFIRMED)
    );
  }

  private async reconcile(
    resetOperationId: string,
  ): Promise<PasswordResetResult> {
    let outcome: PasswordResetReconciliationOutcome = 'UNKNOWN';
    try {
      outcome = await this.persistence.reconcile(resetOperationId);
    } catch {
      // Failure to observe never proves rollback and never authorizes repetition.
    }
    if (outcome === 'COMPLETED') return { status: 'COMPLETED' };
    if (outcome === 'REJECTED') {
      return { status: 'AUTHENTICATION_FAILED' };
    }
    return { status: 'SERVICE_UNAVAILABLE' };
  }
}
