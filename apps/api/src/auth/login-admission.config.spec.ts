import {
  DEFAULT_LOGIN_ADMISSION_CONFIG,
  LoginAdmissionConfigurationError,
  loadLoginAdmissionConfig,
} from './login-admission.config.js';

describe('login admission configuration', () => {
  it('loads the approved defaults as an immutable value', () => {
    const config = loadLoginAdmissionConfig({});

    expect(config).toEqual(DEFAULT_LOGIN_ADMISSION_CONFIG);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('accepts every minimum and maximum', () => {
    expect(
      loadLoginAdmissionConfig({
        BELLO_LOGIN_IDENTITY_BUCKETS_MAX: '1',
        BELLO_LOGIN_IP_BUCKETS_MAX: '1',
        BELLO_LOGIN_ARGON2_CONCURRENCY: '1',
        BELLO_LOGIN_ARGON2_QUEUE_MAX: '0',
        BELLO_LOGIN_ARGON2_WAIT_TIMEOUT_MS: '1',
      }),
    ).toEqual({
      identityBucketsMax: 1,
      ipBucketsMax: 1,
      concurrency: 1,
      queueMax: 0,
      waitTimeoutMs: 1,
    });
    expect(
      loadLoginAdmissionConfig({
        BELLO_LOGIN_IDENTITY_BUCKETS_MAX: '16000',
        BELLO_LOGIN_IP_BUCKETS_MAX: '4000',
        BELLO_LOGIN_ARGON2_CONCURRENCY: '2',
        BELLO_LOGIN_ARGON2_QUEUE_MAX: '4',
        BELLO_LOGIN_ARGON2_WAIT_TIMEOUT_MS: '1000',
      }),
    ).toEqual(DEFAULT_LOGIN_ADMISSION_CONFIG);
  });

  it.each([
    ['BELLO_LOGIN_IDENTITY_BUCKETS_MAX', '0'],
    ['BELLO_LOGIN_IDENTITY_BUCKETS_MAX', '16001'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', '0'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', '4001'],
    ['BELLO_LOGIN_ARGON2_CONCURRENCY', '0'],
    ['BELLO_LOGIN_ARGON2_CONCURRENCY', '3'],
    ['BELLO_LOGIN_ARGON2_QUEUE_MAX', '5'],
    ['BELLO_LOGIN_ARGON2_WAIT_TIMEOUT_MS', '0'],
    ['BELLO_LOGIN_ARGON2_WAIT_TIMEOUT_MS', '1001'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', '-1'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', '1.5'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', 'not-a-number'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', ''],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', ' 1'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', '01'],
    ['BELLO_LOGIN_IP_BUCKETS_MAX', '9007199254740992'],
  ])('rejects %s=%j', (name, value) => {
    expect(() => loadLoginAdmissionConfig({ [name]: value })).toThrow(
      LoginAdmissionConfigurationError,
    );
  });
});
