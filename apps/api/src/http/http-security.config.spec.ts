import {
  HttpSecurityConfigurationError,
  LOCAL_SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
  loadHttpSecurityConfig,
} from './http-security.config.js';

const developmentEnvironment = {
  NODE_ENV: 'development',
  BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
};

describe('loadHttpSecurityConfig', () => {
  it('builds the restricted local HTTP profile', () => {
    expect(loadHttpSecurityConfig(developmentEnvironment)).toEqual({
      environment: 'development',
      publicOrigin: 'http://127.0.0.1:14200',
      trustedProxies: [],
      sessionCookie: {
        name: LOCAL_SESSION_COOKIE_NAME,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        path: '/',
        maxAgeSeconds: 604_800,
      },
    });
  });

  it('canonicalizes HTTPS and builds the secure cookie profile', () => {
    const config = loadHttpSecurityConfig({
      NODE_ENV: 'test',
      BELLO_PUBLIC_ORIGIN: '  https://example.test:443/  ',
    });

    expect(config.publicOrigin).toBe('https://example.test');
    expect(config.sessionCookie).toMatchObject({
      name: SECURE_SESSION_COOKIE_NAME,
      secure: true,
    });
  });

  it('accepts IPv4 and IPv6 loopback origins', () => {
    expect(
      loadHttpSecurityConfig({
        NODE_ENV: 'development',
        BELLO_PUBLIC_ORIGIN: 'http://127.42.0.1',
      }).publicOrigin,
    ).toBe('http://127.42.0.1');
    expect(
      loadHttpSecurityConfig({
        NODE_ENV: 'test',
        BELLO_PUBLIC_ORIGIN: 'http://[::1]:14200',
      }).publicOrigin,
    ).toBe('http://[::1]:14200');
  });

  it('requires explicit trusted proxies in production', () => {
    const config = loadHttpSecurityConfig({
      NODE_ENV: 'production',
      BELLO_PUBLIC_ORIGIN: 'https://bello.example',
      BELLO_TRUSTED_PROXIES: '192.0.2.10, 2001:db8::/64',
    });

    expect(config.trustedProxies).toEqual(['192.0.2.10', '2001:db8::/64']);
  });

  it.each([undefined, '', 'staging', 'DEVELOPMENT'])(
    'rejects an absent or unsupported NODE_ENV: %s',
    (NODE_ENV) => {
      expect(() =>
        loadHttpSecurityConfig({
          NODE_ENV,
          BELLO_PUBLIC_ORIGIN: 'https://example.test',
        }),
      ).toThrow(HttpSecurityConfigurationError);
    },
  );

  it.each([
    undefined,
    '',
    'not a URL',
    'ftp://example.test',
    'https://user:secret@example.test',
    'https://example.test/path',
    'https://example.test?query=value',
    'https://example.test#fragment',
    'http://example.test',
    'http://localhost:14200',
  ])('rejects an unsafe public origin without echoing it: %s', (origin) => {
    let error: unknown;
    try {
      loadHttpSecurityConfig({
        NODE_ENV: 'development',
        BELLO_PUBLIC_ORIGIN: origin,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(HttpSecurityConfigurationError);
    if (origin) {
      expect((error as Error).message).not.toContain(origin);
    }
    expect((error as Error).message).not.toContain('secret');
  });

  it('rejects HTTP and a missing proxy in production', () => {
    expect(() =>
      loadHttpSecurityConfig({
        NODE_ENV: 'production',
        BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      loadHttpSecurityConfig({
        NODE_ENV: 'production',
        BELLO_PUBLIC_ORIGIN: 'https://bello.example',
      }),
    ).toThrow(/BELLO_TRUSTED_PROXIES/);
  });

  it.each([
    '*',
    'true',
    '1',
    'proxy.example',
    '0.0.0.0/0',
    '::/0',
    '192.0.2.1/33',
    '2001:db8::1/129',
    'invalid/24',
    '192.0.2.1/not-a-prefix',
    '192.0.2.1,',
    '192.0.2.1,192.0.2.1',
  ])('rejects an unsafe trusted proxy value: %s', (trustedProxies) => {
    expect(() =>
      loadHttpSecurityConfig({
        ...developmentEnvironment,
        BELLO_TRUSTED_PROXIES: trustedProxies,
      }),
    ).toThrow(HttpSecurityConfigurationError);
  });
});
