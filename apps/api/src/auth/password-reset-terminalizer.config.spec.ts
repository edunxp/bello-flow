import {
  loadPasswordResetTerminalizerConfig,
  PasswordResetTerminalizerConfigurationError,
} from './password-reset-terminalizer.config.js';

describe('password reset terminalizer config', () => {
  it('is disabled by default with the normative fixed limits', () => {
    expect(loadPasswordResetTerminalizerConfig({})).toEqual({
      mode: 'disabled',
      pollingMilliseconds: 60_000,
      maximumOperationsPerCycle: 10,
      lockTimeoutMilliseconds: 2_000,
      statementTimeoutMilliseconds: 5_000,
    });
  });
  it('accepts explicit internal mode', () => {
    expect(
      loadPasswordResetTerminalizerConfig({
        BELLO_PASSWORD_RESET_TERMINALIZER_MODE: 'internal',
      }).mode,
    ).toBe('internal');
  });
  it('fails closed for an unknown mode', () => {
    expect(() =>
      loadPasswordResetTerminalizerConfig({
        BELLO_PASSWORD_RESET_TERMINALIZER_MODE: 'enabled',
      }),
    ).toThrow(PasswordResetTerminalizerConfigurationError);
  });
});
