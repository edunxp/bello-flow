import { loadHttpSecurityConfig } from '../http/http-security.config.js';

export const PASSWORD_RECOVERY_DELIVERY_CONFIG = Symbol(
  'PASSWORD_RECOVERY_DELIVERY_CONFIG',
);

export type PasswordRecoveryDeliveryMode = 'disabled' | 'controlled';

export interface PasswordRecoveryDeliveryConfig {
  readonly mode: PasswordRecoveryDeliveryMode;
  readonly publicOrigin: string | null;
  readonly idlePollingMilliseconds: 1_000;
  readonly maximumClaimsPerCycle: 10;
  readonly adapterTimeoutMilliseconds: 10_000;
}

export class PasswordRecoveryDeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordRecoveryDeliveryConfigurationError';
  }
}

export function loadPasswordRecoveryDeliveryConfig(
  environment: Readonly<Record<string, string | undefined>>,
): PasswordRecoveryDeliveryConfig {
  const configuredMode = environment.BELLO_PASSWORD_RECOVERY_DELIVERY_MODE;
  const mode = configuredMode === undefined ? 'disabled' : configuredMode;

  if (mode !== 'disabled' && mode !== 'controlled') {
    throw new PasswordRecoveryDeliveryConfigurationError(
      'BELLO_PASSWORD_RECOVERY_DELIVERY_MODE must be disabled or controlled',
    );
  }

  if (mode === 'controlled' && environment.NODE_ENV !== 'test') {
    throw new PasswordRecoveryDeliveryConfigurationError(
      'Controlled password recovery delivery is allowed only in test',
    );
  }

  let publicOrigin: string | null = null;
  if (mode === 'controlled') {
    publicOrigin = loadHttpSecurityConfig(environment).publicOrigin;
  }

  return Object.freeze({
    mode,
    publicOrigin,
    idlePollingMilliseconds: 1_000,
    maximumClaimsPerCycle: 10,
    adapterTimeoutMilliseconds: 10_000,
  });
}
