export const LOGIN_ADMISSION_CONFIG = Symbol('LOGIN_ADMISSION_CONFIG');

export interface LoginAdmissionConfig {
  readonly identityBucketsMax: number;
  readonly ipBucketsMax: number;
  readonly concurrency: number;
  readonly queueMax: number;
  readonly waitTimeoutMs: number;
}

export const DEFAULT_LOGIN_ADMISSION_CONFIG = Object.freeze({
  identityBucketsMax: 16_000,
  ipBucketsMax: 4_000,
  concurrency: 2,
  queueMax: 4,
  waitTimeoutMs: 1_000,
}) satisfies LoginAdmissionConfig;

export class LoginAdmissionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginAdmissionConfigurationError';
  }
}

type ConfigEntry = {
  readonly environmentName: string;
  readonly property: keyof LoginAdmissionConfig;
  readonly minimum: number;
  readonly maximum: number;
};

const CONFIG_ENTRIES: readonly ConfigEntry[] = [
  {
    environmentName: 'BELLO_LOGIN_IDENTITY_BUCKETS_MAX',
    property: 'identityBucketsMax',
    minimum: 1,
    maximum: 16_000,
  },
  {
    environmentName: 'BELLO_LOGIN_IP_BUCKETS_MAX',
    property: 'ipBucketsMax',
    minimum: 1,
    maximum: 4_000,
  },
  {
    environmentName: 'BELLO_LOGIN_ARGON2_CONCURRENCY',
    property: 'concurrency',
    minimum: 1,
    maximum: 2,
  },
  {
    environmentName: 'BELLO_LOGIN_ARGON2_QUEUE_MAX',
    property: 'queueMax',
    minimum: 0,
    maximum: 4,
  },
  {
    environmentName: 'BELLO_LOGIN_ARGON2_WAIT_TIMEOUT_MS',
    property: 'waitTimeoutMs',
    minimum: 1,
    maximum: 1_000,
  },
];

function readInteger(
  value: string | undefined,
  entry: ConfigEntry,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new LoginAdmissionConfigurationError(
      `${entry.environmentName} must be an integer from ${entry.minimum} to ${entry.maximum}`,
    );
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < entry.minimum ||
    parsed > entry.maximum
  ) {
    throw new LoginAdmissionConfigurationError(
      `${entry.environmentName} must be an integer from ${entry.minimum} to ${entry.maximum}`,
    );
  }
  return parsed;
}

export function loadLoginAdmissionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): LoginAdmissionConfig {
  const config: Record<keyof LoginAdmissionConfig, number> = {
    ...DEFAULT_LOGIN_ADMISSION_CONFIG,
  };
  for (const entry of CONFIG_ENTRIES) {
    config[entry.property] = readInteger(
      environment[entry.environmentName],
      entry,
      DEFAULT_LOGIN_ADMISSION_CONFIG[entry.property],
    );
  }
  return Object.freeze(config);
}
