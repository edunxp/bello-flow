import { isIP } from 'node:net';

export const SESSION_COOKIE_MAX_AGE_SECONDS = 604_800;
export const SECURE_SESSION_COOKIE_NAME = '__Host-bello_flow_session';
export const LOCAL_SESSION_COOKIE_NAME = 'bello_flow_session';

export type HttpRuntimeEnvironment = 'development' | 'test' | 'production';

export interface SessionCookiePolicy {
  readonly name:
    typeof SECURE_SESSION_COOKIE_NAME | typeof LOCAL_SESSION_COOKIE_NAME;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'Lax';
  readonly path: '/';
  readonly maxAgeSeconds: typeof SESSION_COOKIE_MAX_AGE_SECONDS;
}

export interface HttpSecurityConfig {
  readonly environment: HttpRuntimeEnvironment;
  readonly publicOrigin: string;
  readonly trustedProxies: readonly string[];
  readonly sessionCookie: SessionCookiePolicy;
}

export class HttpSecurityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpSecurityConfigurationError';
  }
}

const RUNTIME_ENVIRONMENTS = new Set<HttpRuntimeEnvironment>([
  'development',
  'test',
  'production',
]);

function readRuntimeEnvironment(
  value: string | undefined,
): HttpRuntimeEnvironment {
  if (!value || !RUNTIME_ENVIRONMENTS.has(value as HttpRuntimeEnvironment)) {
    throw new HttpSecurityConfigurationError(
      'NODE_ENV must be development, test, or production',
    );
  }
  return value as HttpRuntimeEnvironment;
}

function isLiteralLoopback(hostname: string): boolean {
  if (hostname === '[::1]') {
    return true;
  }
  if (isIP(hostname) !== 4) {
    return false;
  }
  const firstOctet = Number(hostname.split('.', 1)[0]);
  return firstOctet === 127;
}

function readPublicOrigin(
  value: string | undefined,
  environment: HttpRuntimeEnvironment,
): URL {
  const candidate = value?.trim();
  if (!candidate) {
    throw new HttpSecurityConfigurationError('BELLO_PUBLIC_ORIGIN is required');
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new HttpSecurityConfigurationError('BELLO_PUBLIC_ORIGIN is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpSecurityConfigurationError(
      'BELLO_PUBLIC_ORIGIN must use HTTP or HTTPS',
    );
  }
  if (url.username || url.password) {
    throw new HttpSecurityConfigurationError(
      'BELLO_PUBLIC_ORIGIN must not contain credentials',
    );
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new HttpSecurityConfigurationError(
      'BELLO_PUBLIC_ORIGIN must not contain a path, query, or fragment',
    );
  }
  if (url.protocol === 'http:' && !isLiteralLoopback(url.hostname)) {
    throw new HttpSecurityConfigurationError(
      'HTTP is allowed only for a literal loopback origin',
    );
  }
  if (environment === 'production' && url.protocol !== 'https:') {
    throw new HttpSecurityConfigurationError(
      'Production requires an HTTPS public origin',
    );
  }
  return url;
}

function validateProxyAddress(value: string): void {
  const separator = value.lastIndexOf('/');
  if (separator === -1) {
    if (isIP(value) === 0) {
      throw new HttpSecurityConfigurationError(
        'BELLO_TRUSTED_PROXIES accepts only explicit IP addresses or CIDRs',
      );
    }
    return;
  }

  const address = value.slice(0, separator);
  const prefixText = value.slice(separator + 1);
  const addressVersion = isIP(address);
  const maximumPrefix =
    addressVersion === 4 ? 32 : addressVersion === 6 ? 128 : 0;
  if (!/^\d+$/.test(prefixText)) {
    throw new HttpSecurityConfigurationError(
      'BELLO_TRUSTED_PROXIES contains an invalid CIDR',
    );
  }
  const prefix = Number(prefixText);
  if (maximumPrefix === 0 || prefix < 1 || prefix > maximumPrefix) {
    throw new HttpSecurityConfigurationError(
      'BELLO_TRUSTED_PROXIES contains an invalid or unrestricted CIDR',
    );
  }
}

function readTrustedProxies(
  value: string | undefined,
  environment: HttpRuntimeEnvironment,
): readonly string[] {
  const candidate = value?.trim();
  if (!candidate) {
    if (environment === 'production') {
      throw new HttpSecurityConfigurationError(
        'BELLO_TRUSTED_PROXIES is required in production',
      );
    }
    return Object.freeze([]);
  }

  const proxies = candidate.split(',').map((proxy) => proxy.trim());
  if (proxies.some((proxy) => proxy.length === 0)) {
    throw new HttpSecurityConfigurationError(
      'BELLO_TRUSTED_PROXIES contains an empty entry',
    );
  }
  for (const proxy of proxies) {
    validateProxyAddress(proxy);
  }
  if (new Set(proxies).size !== proxies.length) {
    throw new HttpSecurityConfigurationError(
      'BELLO_TRUSTED_PROXIES contains a duplicate entry',
    );
  }
  return Object.freeze(proxies);
}

function sessionCookiePolicy(origin: URL): SessionCookiePolicy {
  const secure = origin.protocol === 'https:';
  return Object.freeze({
    name: secure ? SECURE_SESSION_COOKIE_NAME : LOCAL_SESSION_COOKIE_NAME,
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function loadHttpSecurityConfig(
  environment: Readonly<Record<string, string | undefined>>,
): HttpSecurityConfig {
  const runtimeEnvironment = readRuntimeEnvironment(environment.NODE_ENV);
  const publicOrigin = readPublicOrigin(
    environment.BELLO_PUBLIC_ORIGIN,
    runtimeEnvironment,
  );
  const trustedProxies = readTrustedProxies(
    environment.BELLO_TRUSTED_PROXIES,
    runtimeEnvironment,
  );

  return Object.freeze({
    environment: runtimeEnvironment,
    publicOrigin: publicOrigin.origin,
    trustedProxies,
    sessionCookie: sessionCookiePolicy(publicOrigin),
  });
}
