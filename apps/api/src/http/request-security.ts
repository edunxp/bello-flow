export const REQUEST_SECURITY_FAILURE = Object.freeze({
  MISSING: 'MISSING',
  DUPLICATE: 'DUPLICATE',
  INVALID: 'INVALID',
  MISMATCH: 'MISMATCH',
} as const);

export type RequestSecurityFailure =
  (typeof REQUEST_SECURITY_FAILURE)[keyof typeof REQUEST_SECURITY_FAILURE];

export type RequestSecurityResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: RequestSecurityFailure };

const VALID_RESULT = Object.freeze({ valid: true }) as RequestSecurityResult;
const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function invalid(reason: RequestSecurityFailure): RequestSecurityResult {
  return { valid: false, reason };
}

function readRawHeader(
  rawHeaders: readonly string[],
  name: string,
): { readonly malformed: boolean; readonly values: readonly string[] } {
  if (rawHeaders.length % 2 !== 0) {
    return { malformed: true, values: [] };
  }
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]!.toLowerCase() === name.toLowerCase()) {
      values.push(rawHeaders[index + 1]!);
    }
  }
  return { malformed: false, values };
}

export function validateApplicationRequestHeader(
  rawHeaders: readonly string[],
): RequestSecurityResult {
  const header = readRawHeader(rawHeaders, 'X-Bello-Flow-Request');
  if (header.malformed) {
    return invalid(REQUEST_SECURITY_FAILURE.INVALID);
  }
  if (header.values.length === 0) {
    return invalid(REQUEST_SECURITY_FAILURE.MISSING);
  }
  if (header.values.length !== 1 || header.values[0]!.includes(',')) {
    return invalid(REQUEST_SECURITY_FAILURE.DUPLICATE);
  }
  return header.values[0] === '1'
    ? VALID_RESULT
    : invalid(REQUEST_SECURITY_FAILURE.INVALID);
}

function parseOriginHeader(value: string): string | null {
  if (value === 'null') {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      value !== url.origin
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function parseRefererOrigin(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code <= 31 ||
      code === 127 ||
      character === ',' ||
      character === '\\' ||
      character.trim().length === 0
    ) {
      return null;
    }
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function validateMutatingRequestOrigin(
  rawHeaders: readonly string[],
  publicOrigin: string,
): RequestSecurityResult {
  const origins = readRawHeader(rawHeaders, 'Origin');
  if (origins.malformed) {
    return invalid(REQUEST_SECURITY_FAILURE.INVALID);
  }
  if (origins.values.length > 1) {
    return invalid(REQUEST_SECURITY_FAILURE.DUPLICATE);
  }
  if (origins.values.length === 1) {
    const origin = parseOriginHeader(origins.values[0]!);
    if (origin === null) {
      return invalid(REQUEST_SECURITY_FAILURE.INVALID);
    }
    return origin === publicOrigin
      ? VALID_RESULT
      : invalid(REQUEST_SECURITY_FAILURE.MISMATCH);
  }

  const referers = readRawHeader(rawHeaders, 'Referer');
  if (referers.malformed) {
    return invalid(REQUEST_SECURITY_FAILURE.INVALID);
  }
  if (referers.values.length === 0) {
    return invalid(REQUEST_SECURITY_FAILURE.MISSING);
  }
  if (referers.values.length !== 1) {
    return invalid(REQUEST_SECURITY_FAILURE.DUPLICATE);
  }
  const refererOrigin = parseRefererOrigin(referers.values[0]!);
  if (refererOrigin === null) {
    return invalid(REQUEST_SECURITY_FAILURE.INVALID);
  }
  return refererOrigin === publicOrigin
    ? VALID_RESULT
    : invalid(REQUEST_SECURITY_FAILURE.MISMATCH);
}

function splitContentType(value: string): readonly string[] | null {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      current += character;
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ',') {
      return null;
    }
    if (!quoted && character === ';') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (quoted || escaped) {
    return null;
  }
  parts.push(current.trim());
  return parts;
}

function isValidParameter(value: string): boolean {
  const separator = value.indexOf('=');
  if (separator <= 0) {
    return false;
  }
  const name = value.slice(0, separator).trim();
  const parameterValue = value.slice(separator + 1).trim();
  if (!TOKEN_PATTERN.test(name) || parameterValue.length === 0) {
    return false;
  }
  if (TOKEN_PATTERN.test(parameterValue)) {
    return true;
  }
  return isValidQuotedParameterValue(parameterValue);
}

function isValidQuotedParameterValue(value: string): boolean {
  if (value.length < 2 || value[0] !== '"' || value.at(-1) !== '"') {
    return false;
  }
  for (let index = 1; index < value.length - 1; index += 1) {
    const code = value.charCodeAt(index);
    if (value[index] === '\\') {
      index += 1;
      if (index >= value.length - 1) {
        return false;
      }
      const escapedCode = value.charCodeAt(index);
      if (escapedCode !== 9 && (escapedCode < 32 || escapedCode > 126)) {
        return false;
      }
      continue;
    }
    if (
      code !== 9 &&
      code !== 32 &&
      code !== 33 &&
      (code < 35 || code > 91) &&
      (code < 93 || code > 126)
    ) {
      return false;
    }
  }
  return true;
}

export function validateJsonContentType(
  rawHeaders: readonly string[],
): RequestSecurityResult {
  const header = readRawHeader(rawHeaders, 'Content-Type');
  if (header.malformed) {
    return invalid(REQUEST_SECURITY_FAILURE.INVALID);
  }
  if (header.values.length === 0) {
    return invalid(REQUEST_SECURITY_FAILURE.MISSING);
  }
  if (header.values.length !== 1) {
    return invalid(REQUEST_SECURITY_FAILURE.DUPLICATE);
  }

  const parts = splitContentType(header.values[0]!);
  if (
    !parts ||
    parts.length === 0 ||
    parts[0]!.toLowerCase() !== 'application/json' ||
    parts.slice(1).some((part) => !isValidParameter(part))
  ) {
    return invalid(REQUEST_SECURITY_FAILURE.INVALID);
  }
  return VALID_RESULT;
}
