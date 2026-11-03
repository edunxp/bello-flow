import { createHash } from 'node:crypto';
import {
  AUTH_SESSION_AUDIT_OPERATION,
  decodeSessionToken,
  deriveAccountAdvisoryLockKey,
  generateOperationId,
  generateSessionId,
  generateSessionToken,
  hashSessionToken,
  readSignedBigInt64BigEndian,
  SESSION_REVOCATION_REASON,
  SESSION_TOKEN_LENGTH_BASE64URL,
  SESSION_TOKEN_LENGTH_BYTES,
} from './session-primitives.js';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('session token primitives', () => {
  it('generates distinct canonical 32-byte Base64URL tokens', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(first).toHaveLength(SESSION_TOKEN_LENGTH_BASE64URL);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain('=');
    expect(first).not.toBe(second);
    expect(decodeSessionToken(first)).toHaveLength(SESSION_TOKEN_LENGTH_BYTES);
  });

  it('decodes a valid canonical token without changing its bytes', () => {
    const bytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    const token = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

    expect(decodeSessionToken(token)).toEqual(bytes);
  });

  it.each([
    ['empty input', ''],
    ['truncated input', 'A'.repeat(42)],
    ['oversized input', 'A'.repeat(44)],
    ['padding', `${'A'.repeat(43)}=`],
    ['standard Base64 character', `${'A'.repeat(42)}+`],
    ['invalid character', `${'A'.repeat(42)}*`],
    ['non-string input', Buffer.alloc(32)],
    ['null input', null],
  ])('rejects %s', (_description, value) => {
    expect(() => decodeSessionToken(value)).toThrow('Invalid session token');
  });

  it('rejects a non-canonical encoding with unused bits set', () => {
    const canonical = 'A'.repeat(43);
    const nonCanonical = `${'A'.repeat(42)}B`;

    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(
      Buffer.from(canonical, 'base64url'),
    );
    expect(() => decodeSessionToken(nonCanonical)).toThrow(
      'Invalid session token',
    );
  });

  it('hashes the original bytes with SHA-256 into exactly 32 bytes', () => {
    const token = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    const expectedDigest =
      '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd';
    const digest = hashSessionToken(token);

    expect(digest).toHaveLength(32);
    expect(digest.toString('hex')).toBe(expectedDigest);
    expect(digest).not.toEqual(createHash('sha256').update(token).digest());
  });

  it('does not log token material on validation failures', () => {
    const sensitiveToken = 'sensitive-invalid-token';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      hashSessionToken(sensitiveToken);
    } catch (error_) {
      thrown = error_;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe('Invalid session token');
    expect((thrown as Error).message).not.toContain(sensitiveToken);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('session and operation identifiers', () => {
  it('generates distinct UUID v4 identifiers that are not session tokens', () => {
    const sessionId = generateSessionId();
    const operationId = generateOperationId();
    const token = generateSessionToken();

    expect(sessionId).toMatch(UUID_V4_PATTERN);
    expect(operationId).toMatch(UUID_V4_PATTERN);
    expect(sessionId).not.toBe(operationId);
    expect(token).not.toMatch(UUID_V4_PATTERN);
    expect(sessionId).not.toHaveLength(SESSION_TOKEN_LENGTH_BASE64URL);
  });
});

describe('account advisory lock key', () => {
  it.each([
    [
      'positive vector',
      '00000000-0000-4000-8000-000000000000',
      5_305_774_703_633_831_484n,
    ],
    [
      'negative vector',
      '00000000-0000-4000-8000-000000000003',
      -9_219_222_644_233_059_831n,
    ],
  ])('derives the deterministic signed bigint for a %s', (_name, uuid, key) => {
    expect(deriveAccountAdvisoryLockKey(uuid)).toBe(key);
    expect(deriveAccountAdvisoryLockKey(uuid.toUpperCase())).toBe(key);
  });

  it.each([
    null,
    '',
    '00000000-0000-4000-8000-00000000000',
    '00000000-0000-3000-8000-000000000000',
    '00000000-0000-4000-7000-000000000000',
    '00000000000040008000000000000000',
  ])('rejects an invalid UUID v4: %p', (value) => {
    expect(() => deriveAccountAdvisoryLockKey(value)).toThrow(
      'Invalid account identifier',
    );
  });

  it.each([
    ['zero', '0000000000000000', 0n],
    ['largest positive', '7fffffffffffffff', 9_223_372_036_854_775_807n],
    ['smallest negative', '8000000000000000', -9_223_372_036_854_775_808n],
    ['negative one', 'ffffffffffffffff', -1n],
  ])('reads the %s signed 64-bit boundary', (_name, hex, expected) => {
    expect(readSignedBigInt64BigEndian(Buffer.from(hex, 'hex'))).toBe(expected);
  });

  it.each([Buffer.alloc(7), Buffer.alloc(9), '0000000000000000', null])(
    'rejects an input that is not exactly eight bytes: %p',
    (value) => {
      expect(() => readSignedBigInt64BigEndian(value)).toThrow(
        'Expected exactly 8 bytes',
      );
    },
  );
});

describe('controlled session vocabulary', () => {
  it('contains only the approved revocation reasons', () => {
    expect(Object.values(SESSION_REVOCATION_REASON)).toEqual([
      'LOGOUT',
      'GLOBAL_LOGOUT',
      'PASSWORD_RESET',
      'ACCOUNT_DEACTIVATED',
      'DELIVERY_FAILED',
    ]);
    expect(Object.isFrozen(SESSION_REVOCATION_REASON)).toBe(true);
  });

  it('contains only the approved audit operations', () => {
    expect(Object.values(AUTH_SESSION_AUDIT_OPERATION)).toEqual([
      'AUTH_LOGIN_SUCCEEDED',
      'AUTH_LOGIN_FAILED',
      'AUTH_SESSION_LOGOUT',
      'AUTH_SESSIONS_REVOKED',
    ]);
    expect(Object.isFrozen(AUTH_SESSION_AUDIT_OPERATION)).toBe(true);
  });
});
