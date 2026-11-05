import {
  loadPasswordRecoveryDeliveryConfig,
  PasswordRecoveryDeliveryConfigurationError,
} from './password-recovery-delivery.config.js';

describe('password recovery delivery configuration', () => {
  it('defaults to disabled without requiring HTTP configuration', () => {
    expect(loadPasswordRecoveryDeliveryConfig({})).toEqual({
      mode: 'disabled',
      publicOrigin: null,
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
    ).toThrow(/disabled or controlled/);
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
});
