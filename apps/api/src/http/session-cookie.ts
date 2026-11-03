import {
  decodeSessionToken,
  type SessionToken,
} from '../auth/session-primitives.js';
import {
  LOCAL_SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
  type SessionCookiePolicy,
} from './http-security.config.js';

export type SessionCookieReadResult =
  | { readonly status: 'ABSENT' }
  | { readonly status: 'INVALID' }
  | { readonly status: 'VALID'; readonly token: SessionToken };

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

function readCookieHeaders(
  rawHeaders: readonly string[],
): readonly string[] | null {
  if (rawHeaders.length % 2 !== 0) {
    return null;
  }
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]!.toLowerCase() === 'cookie') {
      values.push(rawHeaders[index + 1]!);
    }
  }
  return values;
}

export function readSessionCookie(
  rawHeaders: readonly string[],
  policy: SessionCookiePolicy,
): SessionCookieReadResult {
  const cookieHeaders = readCookieHeaders(rawHeaders);
  if (cookieHeaders === null) {
    return { status: 'INVALID' };
  }
  if (cookieHeaders.length === 0) {
    return { status: 'ABSENT' };
  }

  const knownCookies = new Map<string, string[]>();
  for (const cookieHeader of cookieHeaders) {
    const segments = cookieHeader.split(';');
    for (const untrimmedSegment of segments) {
      const segment = untrimmedSegment.trim();
      const separator = segment.indexOf('=');
      if (separator <= 0) {
        return { status: 'INVALID' };
      }
      const name = segment.slice(0, separator);
      const value = segment.slice(separator + 1);
      if (
        !COOKIE_NAME_PATTERN.test(name) ||
        !COOKIE_VALUE_PATTERN.test(value)
      ) {
        return { status: 'INVALID' };
      }
      if (
        name === SECURE_SESSION_COOKIE_NAME ||
        name === LOCAL_SESSION_COOKIE_NAME
      ) {
        const values = knownCookies.get(name) ?? [];
        values.push(value);
        knownCookies.set(name, values);
      }
    }
  }

  const secureCookies = knownCookies.get(SECURE_SESSION_COOKIE_NAME) ?? [];
  const localCookies = knownCookies.get(LOCAL_SESSION_COOKIE_NAME) ?? [];
  if (
    secureCookies.length > 1 ||
    localCookies.length > 1 ||
    (secureCookies.length === 1 && localCookies.length === 1)
  ) {
    return { status: 'INVALID' };
  }

  const values = knownCookies.get(policy.name) ?? [];
  if (values.length === 0) {
    return { status: 'ABSENT' };
  }
  const token = values[0]!;
  try {
    decodeSessionToken(token);
  } catch {
    return { status: 'INVALID' };
  }
  return { status: 'VALID', token: token as SessionToken };
}

function cookieAttributes(policy: SessionCookiePolicy): string[] {
  const attributes = ['Path=/', 'HttpOnly'];
  if (policy.secure) {
    attributes.push('Secure');
  }
  attributes.push('SameSite=Lax');
  return attributes;
}

export function serializeSessionCookie(
  token: unknown,
  policy: SessionCookiePolicy,
): string {
  decodeSessionToken(token);
  return [
    `${policy.name}=${token as string}`,
    `Max-Age=${policy.maxAgeSeconds}`,
    ...cookieAttributes(policy),
  ].join('; ');
}

export function serializeClearedSessionCookie(
  policy: SessionCookiePolicy,
): string {
  return [
    `${policy.name}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ...cookieAttributes(policy),
  ].join('; ');
}
