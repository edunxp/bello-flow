import { createHash, randomBytes, randomUUID } from 'node:crypto';

declare const sessionIdBrand: unique symbol;
declare const operationIdBrand: unique symbol;
declare const sessionTokenBrand: unique symbol;
declare const sessionTokenHashBrand: unique symbol;

export type SessionId = string & { readonly [sessionIdBrand]: true };
export type OperationId = string & { readonly [operationIdBrand]: true };
export type SessionToken = string & { readonly [sessionTokenBrand]: true };
export type SessionTokenHash = Buffer & {
  readonly [sessionTokenHashBrand]: true;
};

export const SESSION_TOKEN_LENGTH_BYTES = 32;
export const SESSION_TOKEN_LENGTH_BASE64URL = 43;

export const SESSION_REVOCATION_REASON = Object.freeze({
  LOGOUT: 'LOGOUT',
  GLOBAL_LOGOUT: 'GLOBAL_LOGOUT',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
} as const);

export type SessionRevocationReason =
  (typeof SESSION_REVOCATION_REASON)[keyof typeof SESSION_REVOCATION_REASON];

export const AUTH_SESSION_AUDIT_OPERATION = Object.freeze({
  LOGIN_SUCCEEDED: 'AUTH_LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  SESSION_LOGOUT: 'AUTH_SESSION_LOGOUT',
  SESSIONS_REVOKED: 'AUTH_SESSIONS_REVOKED',
} as const);

export type AuthSessionAuditOperation =
  (typeof AUTH_SESSION_AUDIT_OPERATION)[keyof typeof AUTH_SESSION_AUDIT_OPERATION];

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADVISORY_LOCK_DOMAIN = 'bello:auth:account:';

export function generateSessionId(): SessionId {
  return randomUUID() as SessionId;
}

export function generateOperationId(): OperationId {
  return randomUUID() as OperationId;
}

export function generateSessionToken(): SessionToken {
  return randomBytes(SESSION_TOKEN_LENGTH_BYTES).toString(
    'base64url',
  ) as SessionToken;
}

export function decodeSessionToken(value: unknown): Buffer {
  if (typeof value !== 'string' || !SESSION_TOKEN_PATTERN.test(value)) {
    throw new TypeError('Invalid session token');
  }

  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length !== SESSION_TOKEN_LENGTH_BYTES ||
    decoded.toString('base64url') !== value
  ) {
    throw new TypeError('Invalid session token');
  }

  return decoded;
}

export function hashSessionToken(value: unknown): SessionTokenHash {
  return createHash('sha256')
    .update(decodeSessionToken(value))
    .digest() as SessionTokenHash;
}

export function readSignedBigInt64BigEndian(value: unknown): bigint {
  if (!(value instanceof Uint8Array) || value.byteLength !== 8) {
    throw new TypeError('Expected exactly 8 bytes');
  }

  return Buffer.from(value).readBigInt64BE(0);
}

export function deriveAccountAdvisoryLockKey(accountId: unknown): bigint {
  if (typeof accountId !== 'string' || !UUID_V4_PATTERN.test(accountId)) {
    throw new TypeError('Invalid account identifier');
  }

  const canonicalAccountId = accountId.toLowerCase();
  const digest = createHash('sha256')
    .update(`${ADVISORY_LOCK_DOMAIN}${canonicalAccountId}`, 'utf8')
    .digest();

  return readSignedBigInt64BigEndian(digest.subarray(0, 8));
}
