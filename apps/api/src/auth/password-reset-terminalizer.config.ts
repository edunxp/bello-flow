export const PASSWORD_RESET_TERMINALIZER_CONFIG = Symbol(
  'PASSWORD_RESET_TERMINALIZER_CONFIG',
);

export type PasswordResetTerminalizerMode = 'disabled' | 'internal';

export interface PasswordResetTerminalizerConfig {
  readonly mode: PasswordResetTerminalizerMode;
  readonly pollingMilliseconds: 60_000;
  readonly maximumOperationsPerCycle: 10;
  readonly lockTimeoutMilliseconds: 2_000;
  readonly statementTimeoutMilliseconds: 5_000;
}

export class PasswordResetTerminalizerConfigurationError extends Error {
  constructor() {
    super(
      'BELLO_PASSWORD_RESET_TERMINALIZER_MODE must be disabled or internal',
    );
    this.name = 'PasswordResetTerminalizerConfigurationError';
  }
}

export function loadPasswordResetTerminalizerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): PasswordResetTerminalizerConfig {
  const mode = environment.BELLO_PASSWORD_RESET_TERMINALIZER_MODE ?? 'disabled';
  if (mode !== 'disabled' && mode !== 'internal') {
    throw new PasswordResetTerminalizerConfigurationError();
  }
  return Object.freeze({
    mode,
    pollingMilliseconds: 60_000,
    maximumOperationsPerCycle: 10,
    lockTimeoutMilliseconds: 2_000,
    statementTimeoutMilliseconds: 5_000,
  });
}
