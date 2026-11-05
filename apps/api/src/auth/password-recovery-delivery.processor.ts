import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  PASSWORD_RECOVERY_DELIVERY_ADAPTER,
  type PasswordRecoveryDeliveryAdapter,
  type PasswordRecoveryDeliveryResult,
} from './password-recovery-delivery.adapter.js';
import {
  PASSWORD_RECOVERY_DELIVERY_CONFIG,
  type PasswordRecoveryDeliveryConfig,
} from './password-recovery-delivery.config.js';
import {
  PasswordRecoveryDeliveryPersistence,
  type PasswordRecoveryDeliveryClaim,
  type PasswordRecoveryDeliveryExternalResult,
  type PasswordRecoveryDeliveryReconciliation,
} from './password-recovery-delivery.persistence.js';

const TOKEN_HASH_DOMAIN = Buffer.from('bello-flow/password-reset/v1\0', 'utf8');
const TOKEN_VALIDITY_MILLISECONDS = 30 * 60_000;

type WorkResult = 'WORK' | 'NO_WORK' | 'ERROR';

export interface PasswordRecoveryDeliveryCycleResult {
  readonly processed: number;
  readonly noWork: boolean;
  readonly infrastructureError: boolean;
}

export function createPasswordRecoveryToken(): {
  readonly rawToken: string;
  readonly tokenHash: Uint8Array;
} {
  const bytes = randomBytes(32);
  return {
    rawToken: bytes.toString('base64url'),
    tokenHash: createHash('sha256')
      .update(TOKEN_HASH_DOMAIN)
      .update(bytes)
      .digest(),
  };
}

export function buildPasswordRecoveryUrl(
  publicOrigin: string,
  rawToken: string,
): string {
  return `${publicOrigin}/reset-password#token=${encodeURIComponent(rawToken)}`;
}

@Injectable()
export class PasswordRecoveryDeliveryProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PasswordRecoveryDeliveryProcessor.name);
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private activeRun: Promise<void> | null = null;
  private activeDeliveryAbort: AbortController | null = null;
  private stopping = false;

  constructor(
    @Inject(PASSWORD_RECOVERY_DELIVERY_CONFIG)
    private readonly config: PasswordRecoveryDeliveryConfig,
    @Inject(PASSWORD_RECOVERY_DELIVERY_ADAPTER)
    private readonly deliveryAdapter: PasswordRecoveryDeliveryAdapter,
    private readonly persistence: PasswordRecoveryDeliveryPersistence,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.mode === 'controlled') this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.scheduled !== null) {
      clearTimeout(this.scheduled);
      this.scheduled = null;
    }
    this.activeDeliveryAbort?.abort();
    await this.activeRun;
  }

  async runCycle(): Promise<PasswordRecoveryDeliveryCycleResult> {
    let processed = 0;
    for (
      let claim = 0;
      claim < this.config.maximumClaimsPerCycle && !this.stopping;
      claim += 1
    ) {
      const result = await this.processOne();
      if (result === 'NO_WORK') {
        return { processed, noWork: true, infrastructureError: false };
      }
      if (result === 'ERROR') {
        return { processed, noWork: false, infrastructureError: true };
      }
      processed += 1;
    }
    return { processed, noWork: false, infrastructureError: false };
  }

  private schedule(delayMilliseconds: number): void {
    if (this.stopping || this.config.mode !== 'controlled') return;
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      const run = this.runCycle()
        .then((result) => {
          const delay =
            result.noWork || result.infrastructureError
              ? this.config.idlePollingMilliseconds
              : 0;
          this.schedule(delay);
        })
        .catch(() => {
          this.logger.error('Password recovery delivery cycle failed');
          this.schedule(this.config.idlePollingMilliseconds);
        })
        .finally(() => {
          if (this.activeRun === run) this.activeRun = null;
        });
      this.activeRun = run;
    }, delayMilliseconds);
  }

  private async processOne(): Promise<WorkResult> {
    const proposedAttemptId = randomUUID();
    const proposedLeaseId = randomUUID();
    let claim: PasswordRecoveryDeliveryClaim;
    try {
      claim = await this.persistence.claim(proposedAttemptId, proposedLeaseId);
    } catch {
      const observed = await this.observe({
        recoveryRequestId: null,
        deliveryAttemptId: proposedAttemptId,
        leaseId: proposedLeaseId,
        passwordResetTokenId: null,
      });
      if (
        observed.outcome !== 'OBSERVED' ||
        observed.attemptState !== 'PREPARING' ||
        observed.observedLeaseId !== proposedLeaseId
      ) {
        this.logger.error('Password recovery delivery claim was indeterminate');
        return 'ERROR';
      }
      claim = {
        outcome: 'CLAIMED',
        recoveryRequestId: observed.recoveryRequestId,
        deliveryAttemptId: observed.deliveryAttemptId,
        attemptNumber: null,
        leaseId: observed.observedLeaseId,
        leaseExpiresAt: null,
        passwordResetTokenId: null,
      };
    }

    if (claim.outcome === 'NO_WORK') return 'NO_WORK';
    if (claim.outcome === 'INCONSISTENT') {
      this.logger.error('Password recovery delivery state is inconsistent');
      return 'ERROR';
    }
    if (
      claim.outcome === 'RECOVERED_PREPARED' ||
      claim.outcome === 'RECOVERED_SENDING_UNKNOWN'
    ) {
      this.logger.log('Password recovery delivery lease recovery completed');
      return 'WORK';
    }
    if (
      !claim.deliveryAttemptId ||
      !claim.recoveryRequestId ||
      !claim.leaseId
    ) {
      this.logger.error('Password recovery delivery claim was incomplete');
      return 'ERROR';
    }

    this.logger.log('Password recovery delivery lease acquired');
    if (this.stopping) return 'WORK';

    let generated: ReturnType<typeof createPasswordRecoveryToken>;
    let tokenId: string;
    let expiresAt: Date;
    try {
      generated = createPasswordRecoveryToken();
      tokenId = randomUUID();
      expiresAt = new Date(Date.now() + TOKEN_VALIDITY_MILLISECONDS);
    } catch {
      this.logger.error('Password recovery delivery token generation failed');
      return 'ERROR';
    }

    const preparationInput = {
      deliveryAttemptId: claim.deliveryAttemptId,
      leaseId: claim.leaseId,
      passwordResetTokenId: tokenId,
      tokenHash: generated.tokenHash,
      expiresAt,
    };
    let preparation;
    try {
      preparation = await this.persistence.prepare(preparationInput);
    } catch {
      const observed = await this.observe({
        recoveryRequestId: claim.recoveryRequestId,
        deliveryAttemptId: claim.deliveryAttemptId,
        leaseId: claim.leaseId,
        passwordResetTokenId: tokenId,
      });
      if (
        observed.outcome !== 'OBSERVED' ||
        observed.observedLeaseId !== claim.leaseId ||
        !(
          (observed.attemptState === 'PREPARED' &&
            observed.passwordResetTokenId === tokenId) ||
          (observed.attemptState === 'PREPARING' &&
            observed.passwordResetTokenId === null)
        )
      ) {
        return 'ERROR';
      }
      try {
        preparation = await this.persistence.prepare(preparationInput);
      } catch {
        return 'ERROR';
      }
    }
    if (
      preparation.outcome !== 'PREPARED' &&
      preparation.outcome !== 'ALREADY_PREPARED_MATCHING'
    ) {
      return 'WORK';
    }
    expiresAt = preparation.expiresAt ?? expiresAt;

    if (this.stopping) return 'WORK';

    let confirmation;
    try {
      confirmation = await this.persistence.confirmSending(
        claim.deliveryAttemptId,
        claim.leaseId,
      );
    } catch {
      const observed = await this.observe({
        recoveryRequestId: claim.recoveryRequestId,
        deliveryAttemptId: claim.deliveryAttemptId,
        leaseId: claim.leaseId,
        passwordResetTokenId: tokenId,
      });
      if (
        observed.outcome !== 'OBSERVED' ||
        observed.attemptState !== 'PREPARED' ||
        observed.observedLeaseId !== claim.leaseId ||
        observed.passwordResetTokenId !== tokenId
      ) {
        return 'ERROR';
      }
      try {
        confirmation = await this.persistence.confirmSending(
          claim.deliveryAttemptId,
          claim.leaseId,
        );
      } catch {
        return 'ERROR';
      }
    }

    if (
      confirmation.outcome !== 'SEND_AUTHORIZED' ||
      !confirmation.recipientEmail ||
      !confirmation.tokenExpiresAt
    ) {
      return 'WORK';
    }

    if (this.stopping || !this.config.publicOrigin) return 'WORK';

    const externalResult = await this.deliverWithTimeout({
      recipientEmail: confirmation.recipientEmail,
      recoveryUrl: buildPasswordRecoveryUrl(
        this.config.publicOrigin,
        generated.rawToken,
      ),
      expiresAt: confirmation.tokenExpiresAt ?? expiresAt,
    });

    const completionInput = {
      deliveryAttemptId: claim.deliveryAttemptId,
      leaseId: claim.leaseId,
      externalResult,
      auditEventId: externalResult === 'ACCEPTED' ? randomUUID() : null,
    };
    try {
      await this.persistence.complete(completionInput);
    } catch {
      const observed = await this.observe({
        recoveryRequestId: claim.recoveryRequestId,
        deliveryAttemptId: claim.deliveryAttemptId,
        leaseId: claim.leaseId,
        passwordResetTokenId: tokenId,
      });
      if (
        observed.outcome === 'OBSERVED' &&
        observed.attemptState === 'SENDING' &&
        observed.observedLeaseId === claim.leaseId
      ) {
        try {
          await this.persistence.complete(completionInput);
        } catch {
          return 'ERROR';
        }
      } else if (!this.isExpectedTerminal(observed, externalResult)) {
        return 'ERROR';
      }
    }
    return 'WORK';
  }

  private async deliverWithTimeout(input: {
    readonly recipientEmail: string;
    readonly recoveryUrl: string;
    readonly expiresAt: Date;
  }): Promise<PasswordRecoveryDeliveryExternalResult> {
    const controller = new AbortController();
    this.activeDeliveryAbort = controller;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<PasswordRecoveryDeliveryResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: 'INDETERMINATE' });
      }, this.config.adapterTimeoutMilliseconds);
    });
    try {
      const delivery = Promise.resolve().then(() =>
        this.deliveryAdapter.deliver({ ...input, signal: controller.signal }),
      );
      const result = await Promise.race([delivery, timeout]);
      return result.status === 'ACCEPTED' || result.status === 'NOT_ACCEPTED'
        ? result.status
        : 'INDETERMINATE';
    } catch {
      return 'INDETERMINATE';
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (this.activeDeliveryAbort === controller) {
        this.activeDeliveryAbort = null;
      }
    }
  }

  private async observe(input: {
    readonly recoveryRequestId: string | null;
    readonly deliveryAttemptId: string | null;
    readonly leaseId: string | null;
    readonly passwordResetTokenId: string | null;
  }): Promise<PasswordRecoveryDeliveryReconciliation> {
    try {
      return await this.persistence.reconcile(input);
    } catch {
      return {
        outcome: 'UNKNOWN',
        recoveryRequestId: input.recoveryRequestId,
        deliveryAttemptId: input.deliveryAttemptId,
        requestState: null,
        attemptState: null,
        observedLeaseId: null,
        passwordResetTokenId: null,
        tokenExpiresAt: null,
      };
    }
  }

  private isExpectedTerminal(
    observed: PasswordRecoveryDeliveryReconciliation,
    externalResult: PasswordRecoveryDeliveryExternalResult,
  ): boolean {
    if (observed.outcome !== 'OBSERVED') return false;
    if (externalResult === 'ACCEPTED') {
      return (
        observed.requestState === 'SENT' &&
        observed.attemptState === 'SENT' &&
        observed.acceptedAuditConfirmed === true
      );
    }
    if (externalResult === 'NOT_ACCEPTED') {
      return (
        (observed.requestState === 'PENDING' ||
          observed.requestState === 'FAILED') &&
        observed.attemptState === 'FAILED' &&
        observed.failureClass === 'DELIVERY_FAILURE' &&
        observed.attemptTerminalAt instanceof Date &&
        observed.tokenConsumedAt === null &&
        observed.tokenInvalidatedAt instanceof Date &&
        observed.tokenInvalidatedOperationId === observed.deliveryAttemptId
      );
    }
    return (
      observed.requestState === 'UNKNOWN' &&
      observed.attemptState === 'UNKNOWN' &&
      observed.attemptTerminalAt instanceof Date &&
      observed.tokenInvalidatedOperationId !== observed.deliveryAttemptId
    );
  }
}
