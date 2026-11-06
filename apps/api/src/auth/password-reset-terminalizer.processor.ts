import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  PASSWORD_RESET_TERMINALIZER_CONFIG,
  type PasswordResetTerminalizerConfig,
} from './password-reset-terminalizer.config.js';
import {
  PasswordResetTerminalizerPersistence,
  type PasswordResetTerminalizerOutcome,
} from './password-reset-terminalizer.persistence.js';

export interface PasswordResetTerminalizerCycleResult {
  readonly processed: number;
  readonly noCandidate: boolean;
  readonly inconsistent: boolean;
  readonly infrastructureError: boolean;
}

@Injectable()
export class PasswordResetTerminalizerProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PasswordResetTerminalizerProcessor.name);
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private activeRun: Promise<void> | null = null;
  private stopping = false;

  constructor(
    @Inject(PASSWORD_RESET_TERMINALIZER_CONFIG)
    private readonly config: PasswordResetTerminalizerConfig,
    private readonly persistence: PasswordResetTerminalizerPersistence,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.mode === 'internal') this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.scheduled !== null) clearTimeout(this.scheduled);
    this.scheduled = null;
    await this.activeRun;
  }

  async runCycle(): Promise<PasswordResetTerminalizerCycleResult> {
    let processed = 0;
    let inconsistent = false;
    try {
      while (
        processed < this.config.maximumOperationsPerCycle &&
        !this.stopping
      ) {
        const selection = await this.persistence.find();
        if (selection.outcome === 'NO_CANDIDATE')
          return {
            processed,
            noCandidate: true,
            inconsistent,
            infrastructureError: false,
          };
        if (selection.outcome === 'INCONSISTENT') {
          this.logger.error(
            'Password reset terminalizer state is inconsistent',
          );
          return {
            processed,
            noCandidate: false,
            inconsistent: true,
            infrastructureError: false,
          };
        }
        const outcome = await this.persistence.terminalize(
          selection.resetOperationId!,
        );
        this.observe(outcome);
        processed += 1;
        if (outcome === 'INFRASTRUCTURE_ERROR' || outcome === 'INDETERMINATE')
          return {
            processed,
            noCandidate: false,
            inconsistent,
            infrastructureError: true,
          };
        if (outcome === 'INCONSISTENT') inconsistent = true;
      }
      if (
        processed === this.config.maximumOperationsPerCycle &&
        !this.stopping &&
        (await this.persistence.hasInconsistent())
      ) {
        inconsistent = true;
        this.logger.error('Password reset terminalizer state is inconsistent');
      }
      return {
        processed,
        noCandidate: false,
        inconsistent,
        infrastructureError: false,
      };
    } catch {
      this.logger.error('Password reset terminalizer cycle failed');
      return {
        processed,
        noCandidate: false,
        inconsistent,
        infrastructureError: true,
      };
    }
  }

  private observe(outcome: PasswordResetTerminalizerOutcome): void {
    const message = `Password reset terminalizer result: ${outcome}`;
    if (
      outcome === 'INCONSISTENT' ||
      outcome === 'INDETERMINATE' ||
      outcome === 'INFRASTRUCTURE_ERROR'
    )
      this.logger.error(message);
    else this.logger.log(message);
  }

  private schedule(delay: number): void {
    if (this.stopping || this.config.mode !== 'internal') return;
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      const run = this.runCycle()
        .then((result) => {
          this.schedule(
            result.processed === this.config.maximumOperationsPerCycle &&
              !result.infrastructureError
              ? 0
              : this.config.pollingMilliseconds,
          );
        })
        .finally(() => {
          if (this.activeRun === run) this.activeRun = null;
        });
      this.activeRun = run;
    }, delay);
  }
}
