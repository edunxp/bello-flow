import { loadHttpSecurityConfig } from './http-security.config.js';
import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from './session-cookie.js';

const token = 'A'.repeat(43);
const securePolicy = loadHttpSecurityConfig({
  NODE_ENV: 'test',
  BELLO_PUBLIC_ORIGIN: 'https://bello.example',
}).sessionCookie;
const localPolicy = loadHttpSecurityConfig({
  NODE_ENV: 'test',
  BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
}).sessionCookie;

describe('session cookies', () => {
  it('serializes the secure and local profiles without Domain', () => {
    expect(serializeSessionCookie(token, securePolicy)).toBe(
      `__Host-bello_flow_session=${token}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(serializeSessionCookie(token, localPolicy)).toBe(
      `bello_flow_session=${token}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`,
    );
    expect(serializeSessionCookie(token, securePolicy)).not.toContain('Domain');
  });

  it('clears a cookie with compatible attributes', () => {
    expect(serializeClearedSessionCookie(securePolicy)).toBe(
      '__Host-bello_flow_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    expect(serializeClearedSessionCookie(localPolicy)).toBe(
      'bello_flow_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('reads one valid active cookie without URL decoding', () => {
    expect(
      readSessionCookie(
        ['Cookie', `unrelated=value; __Host-bello_flow_session=${token}`],
        securePolicy,
      ),
    ).toEqual({ status: 'VALID', token });
    expect(
      readSessionCookie(
        ['Cookie', 'bello_flow_session=%41%41%41'],
        localPolicy,
      ),
    ).toEqual({ status: 'INVALID' });
  });

  it('distinguishes an absent active cookie', () => {
    expect(readSessionCookie([], securePolicy)).toEqual({ status: 'ABSENT' });
    expect(
      readSessionCookie(
        ['Cookie', `bello_flow_session=${token}`],
        securePolicy,
      ),
    ).toEqual({ status: 'ABSENT' });
  });

  it('rejects invalid, duplicate, simultaneous, or malformed cookies', () => {
    expect(
      readSessionCookie(
        ['Cookie', '__Host-bello_flow_session=invalid'],
        securePolicy,
      ),
    ).toEqual({ status: 'INVALID' });
    expect(
      readSessionCookie(
        [
          'Cookie',
          `__Host-bello_flow_session=${token}; __Host-bello_flow_session=${token}`,
        ],
        securePolicy,
      ),
    ).toEqual({ status: 'INVALID' });
    expect(
      readSessionCookie(
        [
          'Cookie',
          `__Host-bello_flow_session=${token}; bello_flow_session=${token}`,
        ],
        securePolicy,
      ),
    ).toEqual({ status: 'INVALID' });
    expect(
      readSessionCookie(['Cookie', 'malformed-segment'], securePolicy),
    ).toEqual({ status: 'INVALID' });
    expect(
      readSessionCookie(
        ['Cookie', `__Host-bello_flow_session =${token}`],
        securePolicy,
      ),
    ).toEqual({ status: 'INVALID' });
    expect(readSessionCookie(['Cookie'], securePolicy)).toEqual({
      status: 'INVALID',
    });
  });

  it('rejects invalid tokens during serialization', () => {
    expect(() => serializeSessionCookie('invalid', securePolicy)).toThrow(
      TypeError,
    );
  });

  it('rejects duplicate session cookies across multiple Cookie fields', () => {
    const result = readSessionCookie(
      [
        'Cookie',
        `__Host-bello_flow_session=${token}`,
        'cookie',
        `__Host-bello_flow_session=${token}`,
      ],
      securePolicy,
    );

    expect(result).toEqual({ status: 'INVALID' });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('keeps cookie names case-sensitive across multiple Cookie fields', () => {
    expect(
      readSessionCookie(
        [
          'Cookie',
          `__host-bello_flow_session=${token}`,
          'cookie',
          `__Host-bello_flow_session=${token}`,
        ],
        securePolicy,
      ),
    ).toEqual({ status: 'VALID', token });
  });
});
