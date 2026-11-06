import {
  loadPasswordRecoveryDeliveryConfig,
  PasswordRecoveryDeliveryConfigurationError,
} from './password-recovery-delivery.config.js';

describe('password recovery delivery configuration', () => {
  it('defaults to disabled without requiring HTTP configuration', () => {
    expect(loadPasswordRecoveryDeliveryConfig({})).toEqual({
      mode: 'disabled',
      publicOrigin: null,
      resendApiKey: null,
      fromAddress: null,
      idlePollingMilliseconds: 1_000,
      maximumClaimsPerCycle: 10,
      adapterTimeoutMilliseconds: 10_000,
    });
  });

  it('loads controlled mode only in test with the canonical origin', () => {
    expect(
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'controlled',
        NODE_ENV: 'test',
        BELLO_PUBLIC_ORIGIN: 'https://bello.example',
      }),
    ).toMatchObject({
      mode: 'controlled',
      publicOrigin: 'https://bello.example',
      resendApiKey: null,
      fromAddress: null,
    });
  });

  it.each(['development', 'production', undefined])(
    'rejects controlled mode in %s',
    (nodeEnvironment) => {
      expect(() =>
        loadPasswordRecoveryDeliveryConfig({
          BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'controlled',
          NODE_ENV: nodeEnvironment,
          BELLO_PUBLIC_ORIGIN: 'https://bello.example',
        }),
      ).toThrow(PasswordRecoveryDeliveryConfigurationError);
    },
  );

  it.each(['', 'CONTROLLED', 'provider'])('rejects unknown mode %s', (mode) => {
    expect(() =>
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: mode,
      }),
    ).toThrow(/disabled, controlled, or resend/);
  });

  it('reuses canonical origin validation in controlled mode', () => {
    expect(() =>
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'controlled',
        NODE_ENV: 'test',
        BELLO_PUBLIC_ORIGIN: 'http://example.test',
      }),
    ).toThrow(/literal loopback/);
  });

  it('loads resend mode with the approved provider configuration', () => {
    expect(
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'resend',
        BELLO_PASSWORD_RECOVERY_RESEND_API_KEY: 'synthetic_api_key',
        BELLO_PASSWORD_RECOVERY_FROM_ADDRESS: 'mail@auth.bello.example',
        BELLO_PUBLIC_ORIGIN: 'https://bello.example',
        NODE_ENV: 'production',
        BELLO_TRUSTED_PROXIES: '127.0.0.1',
      }),
    ).toMatchObject({
      mode: 'resend',
      publicOrigin: 'https://bello.example',
      resendApiKey: 'synthetic_api_key',
      fromAddress: 'mail@auth.bello.example',
    });
  });

  it('rejects resend mode in test', () => {
    expect(() =>
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'resend',
        NODE_ENV: 'test',
      }),
    ).toThrow(/not allowed in test/);
  });

  it.each([undefined, '', 'contains whitespace', 'contains\ncontrol'])(
    'rejects an invalid resend API key without exposing it',
    (apiKey) => {
      expect(() =>
        loadPasswordRecoveryDeliveryConfig({
          BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'resend',
          BELLO_PASSWORD_RECOVERY_RESEND_API_KEY: apiKey,
          BELLO_PASSWORD_RECOVERY_FROM_ADDRESS: 'mail@auth.bello.example',
          BELLO_PUBLIC_ORIGIN: 'https://bello.example',
          NODE_ENV: 'development',
        }),
      ).toThrow('BELLO_PASSWORD_RECOVERY_RESEND_API_KEY is invalid');
    },
  );

  it.each([
    undefined,
    '',
    'Bello Flow <mail@auth.bello.example>',
    'mail@example',
    'mail..box@auth.bello.example',
    'mail@-auth.bello.example',
  ])('rejects invalid resend sender address %#', (fromAddress) => {
    expect(() =>
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'resend',
        BELLO_PASSWORD_RECOVERY_RESEND_API_KEY: 'synthetic_api_key',
        BELLO_PASSWORD_RECOVERY_FROM_ADDRESS: fromAddress,
        BELLO_PUBLIC_ORIGIN: 'https://bello.example',
        NODE_ENV: 'development',
      }),
    ).toThrow('BELLO_PASSWORD_RECOVERY_FROM_ADDRESS is invalid');
  });

  it('requires HTTPS origin for resend even outside production', () => {
    expect(() =>
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: 'resend',
        BELLO_PASSWORD_RECOVERY_RESEND_API_KEY: 'synthetic_api_key',
        BELLO_PASSWORD_RECOVERY_FROM_ADDRESS: 'mail@auth.bello.example',
        BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
        NODE_ENV: 'development',
      }),
    ).toThrow('BELLO_PUBLIC_ORIGIN must use HTTPS for resend delivery');
  });

  it('does not activate provider variables while disabled', () => {
    expect(
      loadPasswordRecoveryDeliveryConfig({
        BELLO_PASSWORD_RECOVERY_RESEND_API_KEY: 'ignored value',
        BELLO_PASSWORD_RECOVERY_FROM_ADDRESS: 'invalid',
      }),
    ).toMatchObject({
      mode: 'disabled',
      resendApiKey: null,
      fromAddress: null,
    });
  });
});
