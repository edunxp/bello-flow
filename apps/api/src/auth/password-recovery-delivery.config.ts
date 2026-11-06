import { loadHttpSecurityConfig } from '../http/http-security.config.js';

export const PASSWORD_RECOVERY_DELIVERY_CONFIG = Symbol(
  'PASSWORD_RECOVERY_DELIVERY_CONFIG',
);

export type PasswordRecoveryDeliveryMode = 'disabled' | 'controlled' | 'resend';

export interface PasswordRecoveryDeliveryConfig {
  readonly mode: PasswordRecoveryDeliveryMode;
  readonly publicOrigin: string | null;
  readonly resendApiKey: string | null;
  readonly fromAddress: string | null;
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

  if (mode !== 'disabled' && mode !== 'controlled' && mode !== 'resend') {
    throw new PasswordRecoveryDeliveryConfigurationError(
      'BELLO_PASSWORD_RECOVERY_DELIVERY_MODE must be disabled, controlled, or resend',
    );
  }

  if (mode === 'controlled' && environment.NODE_ENV !== 'test') {
    throw new PasswordRecoveryDeliveryConfigurationError(
      'Controlled password recovery delivery is allowed only in test',
    );
  }

  if (mode === 'resend' && environment.NODE_ENV === 'test') {
    throw new PasswordRecoveryDeliveryConfigurationError(
      'Resend password recovery delivery is not allowed in test',
    );
  }

  let publicOrigin: string | null = null;
  let resendApiKey: string | null = null;
  let fromAddress: string | null = null;
  if (mode === 'controlled' || mode === 'resend') {
    publicOrigin = loadHttpSecurityConfig(environment).publicOrigin;
  }
  if (mode === 'resend') {
    if (new URL(publicOrigin!).protocol !== 'https:') {
      throw new PasswordRecoveryDeliveryConfigurationError(
        'BELLO_PUBLIC_ORIGIN must use HTTPS for resend delivery',
      );
    }

    const configuredApiKey = environment.BELLO_PASSWORD_RECOVERY_RESEND_API_KEY;
    if (!configuredApiKey || hasWhitespaceOrControl(configuredApiKey)) {
      throw new PasswordRecoveryDeliveryConfigurationError(
        'BELLO_PASSWORD_RECOVERY_RESEND_API_KEY is invalid',
      );
    }
    resendApiKey = configuredApiKey;

    const configuredFromAddress =
      environment.BELLO_PASSWORD_RECOVERY_FROM_ADDRESS;
    if (!isValidEmailAddress(configuredFromAddress)) {
      throw new PasswordRecoveryDeliveryConfigurationError(
        'BELLO_PASSWORD_RECOVERY_FROM_ADDRESS is invalid',
      );
    }
    fromAddress = configuredFromAddress;
  }

  return Object.freeze({
    mode,
    publicOrigin,
    resendApiKey,
    fromAddress,
    idlePollingMilliseconds: 1_000,
    maximumClaimsPerCycle: 10,
    adapterTimeoutMilliseconds: 10_000,
  });
}

function isValidEmailAddress(value: string | undefined): value is string {
  if (!value || value !== value.trim() || hasWhitespaceOrControl(value)) {
    return false;
  }
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator === value.length - 1) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (
    local.length > 64 ||
    value.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  ) {
    return false;
  }
  const labels = domain.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
    )
  );
}

function hasWhitespaceOrControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return /\s/u.test(character) || codePoint <= 31 || codePoint === 127;
  });
}
