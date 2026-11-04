import { request as createHttpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  AUTHENTICATION_ERROR_CODE,
  AuthenticationError,
  AuthenticationService,
} from '../src/auth/authentication.service.js';
import {
  generateOperationId,
  generateSessionId,
} from '../src/auth/session-primitives.js';
import { DEFAULT_LOGIN_ADMISSION_CONFIG } from '../src/auth/login-admission.config.js';
import {
  LOGIN_ADMISSION_ERROR_CODE,
  LoginAdmissionError,
  LoginAdmissionService,
  SYSTEM_LOGIN_ADMISSION_TIME,
} from '../src/auth/login-admission.service.js';
import { configureHttpApplication } from '../src/http/configure-http-application.js';
import { loadHttpSecurityConfig } from '../src/http/http-security.config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const token = 'A'.repeat(43);
const accountId = '7ceac8d7-f290-4e48-8b42-67e83c982548';
const localOrigin = 'http://127.0.0.1:14200';
const secureOrigin = 'https://bello.example';

describe('F1-B.4.4 authentication HTTP endpoints', () => {
  let app: INestApplication<App>;
  const authenticateWithPassword = vi.fn();
  const resolveAuthenticatedSession = vi.fn();
  const logoutCurrentSession = vi.fn();
  const logoutAllSessions = vi.fn();
  const revokeUndeliveredSession = vi.fn();
  const authentication = {
    authenticateWithPassword,
    resolveAuthenticatedSession,
    logoutCurrentSession,
    logoutAllSessions,
    revokeUndeliveredSession,
  };

  async function createApplication(origin = localOrigin): Promise<void> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthenticationService)
      .useValue(authentication)
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
    });
    configureHttpApplication(
      app as NestExpressApplication,
      loadHttpSecurityConfig({
        NODE_ENV: 'test',
        BELLO_PUBLIC_ORIGIN: origin,
      }),
    );
    await app.init();
  }

  function loginRequest(origin = localOrigin) {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Bello-Flow-Request', '1')
      .set('Origin', origin)
      .set('Content-Type', 'application/json');
  }

  function protectedGet() {
    return request(app.getHttpServer())
      .get('/api/auth/session')
      .set('X-Bello-Flow-Request', '1');
  }

  function mutatingRequest(path: '/api/auth/logout' | '/api/auth/logout-all') {
    return request(app.getHttpServer())
      .post(path)
      .set('X-Bello-Flow-Request', '1')
      .set('Origin', localOrigin);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    authenticateWithPassword.mockResolvedValue({
      accountId,
      sessionId: generateSessionId(),
      operationId: generateOperationId(),
      token,
      createdAt: new Date('2026-11-04T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-11-11T00:00:00.000Z'),
    });
    resolveAuthenticatedSession.mockResolvedValue({ accountId });
    logoutCurrentSession.mockResolvedValue({ status: 'COMPLETED' });
    logoutAllSessions.mockResolvedValue({ status: 'COMPLETED' });
    revokeUndeliveredSession.mockResolvedValue(undefined);
    await createApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs in with a minimal response, local cookie, and trusted request IP', async () => {
    const response = await loginRequest()
      .set('X-Forwarded-For', '203.0.113.42')
      .send({ email: 'user@example.com', password: 'candidate-password' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ account: { id: accountId } });
    expect(response.headers['set-cookie']).toEqual([
      `bello_flow_session=${token}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`,
    ]);
    expect(response.text).not.toContain('sessionId');
    expect(response.text).not.toContain('operationId');
    expect(response.text).not.toContain(token);
    expect(authenticateWithPassword).toHaveBeenCalledWith(
      { email: 'user@example.com', password: 'candidate-password' },
      { trustedIp: expect.any(String), signal: expect.any(AbortSignal) },
    );
    expect(authenticateWithPassword.mock.calls[0]![1].trustedIp).not.toBe(
      '203.0.113.42',
    );
  });

  it('uses the approved secure cookie profile', async () => {
    await app.close();
    await createApplication(secureOrigin);

    const response = await loginRequest(secureOrigin).send({
      email: 'user@example.com',
      password: 'candidate-password',
    });

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toEqual([
      `__Host-bello_flow_session=${token}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);
    expect(response.headers['set-cookie']![0]).not.toContain('Domain');
  });

  it('accepts the valid Referer fallback for login', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Bello-Flow-Request', '1')
      .set('Referer', `${localOrigin}/login`)
      .set('Content-Type', 'application/json')
      .send({ email: 'user@example.com', password: 'candidate-password' });

    expect(response.status).toBe(200);
  });

  it.each([
    ['missing header', {}, 403, 'REQUEST_FORBIDDEN'],
    [
      'invalid header',
      { 'X-Bello-Flow-Request': '2', Origin: localOrigin },
      403,
      'REQUEST_FORBIDDEN',
    ],
    [
      'foreign origin',
      { 'X-Bello-Flow-Request': '1', Origin: 'https://attacker.example' },
      403,
      'REQUEST_FORBIDDEN',
    ],
    [
      'wrong media type',
      { 'X-Bello-Flow-Request': '1', Origin: localOrigin },
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
  ])(
    'rejects login with %s before authentication',
    async (_label, headers, status, code) => {
      let operation = request(app.getHttpServer()).post('/api/auth/login');
      for (const [name, value] of Object.entries(headers)) {
        operation = operation.set(name, value);
      }
      const response = await operation.send(
        code === 'UNSUPPORTED_MEDIA_TYPE'
          ? 'not-json'
          : { email: 'user@example.com', password: 'candidate-password' },
      );

      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe(code);
      expect(authenticateWithPassword).not.toHaveBeenCalled();
    },
  );

  it('rejects a duplicated application header and logs no sensitive values', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((_message: unknown) => undefined);
    const response = await loginRequest()
      .set('X-Bello-Flow-Request', ['1', '1'] as unknown as string)
      .send({
        email: 'sensitive@example.com',
        password: 'sensitive-password',
      });

    expect(response.status).toBe(403);
    expect(authenticateWithPassword).not.toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('AUTH_HTTP_REQUEST_REJECTED');
    expect(logged).not.toContain('sensitive@example.com');
    expect(logged).not.toContain('sensitive-password');
    expect(logged).not.toContain('203.0.113');
    warn.mockRestore();
  });

  it('maps malformed JSON and exact-body violations to INVALID_REQUEST', async () => {
    const malformed = await loginRequest().send('{"email":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_REQUEST');

    const nullBody = await loginRequest().send('null');
    expect(nullBody.status).toBe(400);
    expect(nullBody.body.error.code).toBe('INVALID_REQUEST');

    for (const body of [
      [],
      {},
      { email: 'user@example.com' },
      { email: 'user@example.com', password: 42 },
      { email: 'user@example.com', password: 'value', extra: true },
    ]) {
      const response = await loginRequest().send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    }
    expect(authenticateWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    AUTHENTICATION_ERROR_CODE.INVALID_INPUT,
    AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
  ])('maps determined login %s uniformly', async (code) => {
    authenticateWithPassword.mockRejectedValue(
      new AuthenticationError(code, generateOperationId()),
    );

    const response = await loginRequest().send({
      email: 'user@example.com',
      password: 'candidate-password',
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Authentication failed',
      },
    });
    expect(response.headers).not.toHaveProperty('set-cookie');
  });

  it('maps login admission and operational failures without details', async () => {
    authenticateWithPassword.mockRejectedValueOnce(
      new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.RATE_LIMITED,
        generateOperationId(),
        undefined,
        179,
      ),
    );
    const limited = await loginRequest().send({
      email: 'user@example.com',
      password: 'candidate-password',
    });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('179');
    expect(limited.body.error.code).toBe('RATE_LIMITED');

    authenticateWithPassword.mockRejectedValueOnce(
      new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE,
        generateOperationId(),
      ),
    );
    const unavailable = await loginRequest().send({
      email: 'user@example.com',
      password: 'candidate-password',
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(unavailable.headers).not.toHaveProperty('set-cookie');
  });

  it('maps an unexpected login error to the invariant INTERNAL_ERROR', async () => {
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((_message: unknown) => undefined);
    authenticateWithPassword.mockRejectedValue(
      new Error('SQL and credential details'),
    );

    const response = await loginRequest().send({
      email: 'user@example.com',
      password: 'candidate-password',
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(response.text).not.toContain('SQL');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('credential');
    errorLog.mockRestore();
  });

  it('resolves a valid session without requiring origin or content type', async () => {
    const response = await protectedGet().set(
      'Cookie',
      `bello_flow_session=${token}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ account: { id: accountId } });
    expect(resolveAuthenticatedSession).toHaveBeenCalledWith(token);
  });

  it('rejects absent, malformed, duplicate, expired, and revoked sessions', async () => {
    const absent = await protectedGet();
    expect(absent.status).toBe(401);
    expect(absent.body.error.code).toBe('UNAUTHENTICATED');
    expect(absent.headers).not.toHaveProperty('set-cookie');

    for (const cookie of [
      'bello_flow_session=invalid',
      `bello_flow_session=${token}; bello_flow_session=${token}`,
    ]) {
      const invalid = await protectedGet().set('Cookie', cookie);
      expect(invalid.status).toBe(401);
      expect(invalid.headers['set-cookie']![0]).toContain('Max-Age=0');
    }

    resolveAuthenticatedSession.mockResolvedValue(null);
    const inactive = await protectedGet().set(
      'Cookie',
      `bello_flow_session=${token}`,
    );
    expect(inactive.status).toBe(401);
    expect(inactive.headers['set-cookie']![0]).toContain('Max-Age=0');
  });

  it('rejects invalid session headers, bodies, and operational failures', async () => {
    const header = await request(app.getHttpServer()).get('/api/auth/session');
    expect(header.status).toBe(403);

    const body = await protectedGet().send('unexpected');
    expect(body.status).toBe(400);
    expect(resolveAuthenticatedSession).not.toHaveBeenCalled();

    resolveAuthenticatedSession.mockRejectedValue(
      new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
        generateOperationId(),
      ),
    );
    const unavailable = await protectedGet().set(
      'Cookie',
      `bello_flow_session=${token}`,
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers).not.toHaveProperty('set-cookie');
  });

  it('logs out the current session idempotently and clears the cookie', async () => {
    const completed = await mutatingRequest('/api/auth/logout')
      .set('Cookie', `bello_flow_session=${token}`)
      .send();
    expect(completed.status).toBe(204);
    expect(completed.text).toBe('');
    expect(completed.headers['set-cookie']![0]).toContain('Max-Age=0');
    expect(logoutCurrentSession).toHaveBeenCalledWith(token);

    logoutCurrentSession.mockResolvedValue({ status: 'NO_ACTIVE_SESSION' });
    const repeated = await mutatingRequest('/api/auth/logout').send();
    expect(repeated.status).toBe(204);
    expect(repeated.headers['set-cookie']![0]).toContain('Max-Age=0');
    expect(logoutCurrentSession).toHaveBeenLastCalledWith(undefined);
  });

  it('rejects logout security failures and bodies before the use case', async () => {
    const origin = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('X-Bello-Flow-Request', '1')
      .set('Origin', 'https://attacker.example');
    expect(origin.status).toBe(403);

    const body = await mutatingRequest('/api/auth/logout')
      .set('Content-Type', 'text/plain')
      .send('unexpected');
    expect(body.status).toBe(400);
    expect(logoutCurrentSession).not.toHaveBeenCalled();
  });

  it('accepts an empty chunked logout but rejects chunked bytes', async () => {
    const empty = await mutatingRequest('/api/auth/logout')
      .set('Transfer-Encoding', 'chunked')
      .set('Content-Type', 'application/json')
      .send();
    expect(empty.status).toBe(204);

    logoutCurrentSession.mockClear();
    const nonempty = await mutatingRequest('/api/auth/logout')
      .set('Transfer-Encoding', 'chunked')
      .set('Content-Type', 'text/plain')
      .send('unexpected');
    expect(nonempty.status).toBe(400);
    expect(logoutCurrentSession).not.toHaveBeenCalled();
  });

  it('preserves the current cookie on indeterminate logout', async () => {
    logoutCurrentSession.mockRejectedValue(
      new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE,
        generateOperationId(),
      ),
    );

    const response = await mutatingRequest('/api/auth/logout')
      .set('Cookie', `bello_flow_session=${token}`)
      .send();

    expect(response.status).toBe(503);
    expect(response.headers).not.toHaveProperty('set-cookie');
  });

  it('logs out all sessions only for an authenticated identity', async () => {
    const completed = await mutatingRequest('/api/auth/logout-all')
      .set('Cookie', `bello_flow_session=${token}`)
      .send();
    expect(completed.status).toBe(204);
    expect(completed.text).toBe('');
    expect(completed.headers['set-cookie']![0]).toContain('Max-Age=0');
    expect(logoutAllSessions).toHaveBeenCalledWith(token);

    logoutAllSessions.mockResolvedValue({ status: 'UNAUTHENTICATED' });
    const unauthenticated = await mutatingRequest(
      '/api/auth/logout-all',
    ).send();
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe('UNAUTHENTICATED');
    expect(unauthenticated.headers).not.toHaveProperty('set-cookie');
  });

  it('rejects malformed and duplicate cookies for logout-all', async () => {
    logoutAllSessions.mockResolvedValue({ status: 'UNAUTHENTICATED' });
    for (const cookie of [
      'bello_flow_session=invalid',
      `bello_flow_session=${token}; bello_flow_session=${token}`,
    ]) {
      const response = await mutatingRequest('/api/auth/logout-all')
        .set('Cookie', cookie)
        .send();
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      expect(response.headers).not.toHaveProperty('set-cookie');
    }
    expect(logoutAllSessions).toHaveBeenCalledTimes(2);
    expect(logoutAllSessions).toHaveBeenNthCalledWith(1, undefined);
    expect(logoutAllSessions).toHaveBeenNthCalledWith(2, undefined);
  });

  it('rejects logout-all security failures and preserves cookies on 503', async () => {
    const body = await mutatingRequest('/api/auth/logout-all')
      .set('Content-Type', 'application/json')
      .send({ unexpected: true });
    expect(body.status).toBe(400);
    expect(logoutAllSessions).not.toHaveBeenCalled();

    logoutAllSessions.mockRejectedValue(
      new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE,
        generateOperationId(),
      ),
    );
    const unavailable = await mutatingRequest('/api/auth/logout-all')
      .set('Cookie', `bello_flow_session=${token}`)
      .send();
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers).not.toHaveProperty('set-cookie');
  });

  it('cancels a disconnected login while it is waiting for admission', async () => {
    const admission = new LoginAdmissionService(
      { ...DEFAULT_LOGIN_ADMISSION_CONFIG, concurrency: 1 },
      SYSTEM_LOGIN_ADMISSION_TIME,
    );
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstOperationStarted = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let operationCount = 0;
    let authenticationInvocationCount = 0;
    let secondAuthenticationSettled = false;
    authenticateWithPassword.mockImplementation(
      async (
        input: { email: string; password: string },
        context: { trustedIp: string | undefined; signal?: AbortSignal },
      ) => {
        authenticationInvocationCount += 1;
        const invocation = authenticationInvocationCount;
        try {
          return await admission.executeProtected({
            email: input.email,
            trustedIp: context.trustedIp,
            signal: context.signal,
            operation: async () => {
              operationCount += 1;
              if (operationCount === 1) {
                firstStarted();
                await firstBlocked;
              }
              return {
                status: 'AUTHENTICATED' as const,
                value: {
                  accountId,
                  sessionId: generateSessionId(),
                  operationId: generateOperationId(),
                  token,
                  createdAt: new Date('2026-11-04T00:00:00.000Z'),
                  absoluteExpiresAt: new Date('2026-11-11T00:00:00.000Z'),
                },
              };
            },
          });
        } catch (error) {
          if (error instanceof LoginAdmissionError) {
            throw new AuthenticationError(
              error.code === LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED
                ? AUTHENTICATION_ERROR_CODE.RATE_LIMITED
                : AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
              generateOperationId(),
              undefined,
              error.retryAfterSeconds,
            );
          }
          throw error;
        } finally {
          if (invocation === 2) {
            secondAuthenticationSettled = true;
          }
        }
      },
    );
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as unknown as { address(): AddressInfo }
    ).address();
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;
    const login = (signal?: AbortSignal) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: localOrigin,
          'X-Bello-Flow-Request': '1',
        },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'candidate-password',
        }),
        signal,
      });

    const first = login();
    await firstOperationStarted;
    const second = createHttpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: localOrigin,
        'X-Bello-Flow-Request': '1',
      },
    });
    const secondClosed = new Promise<void>((resolve) => {
      second.once('error', () => resolve());
      second.once('close', () => resolve());
    });
    second.end(
      JSON.stringify({
        email: 'user@example.com',
        password: 'candidate-password',
      }),
    );
    await vi.waitFor(() => {
      expect(authenticateWithPassword).toHaveBeenCalledTimes(2);
    });
    second.destroy(new Error('controlled client disconnect'));
    await secondClosed;
    await vi.waitFor(() => {
      expect(secondAuthenticationSettled).toBe(true);
    });

    releaseFirst();
    expect((await first).status).toBe(200);
    expect((await login()).status).toBe(200);
    expect(operationCount).toBe(2);
  });

  it('keeps CORS disabled and preserves the public liveness endpoint', async () => {
    const preflight = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers).not.toHaveProperty('access-control-allow-origin');
    expect(preflight.headers).not.toHaveProperty(
      'access-control-allow-credentials',
    );

    const health = await request(app.getHttpServer()).get('/health/live');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
  });
});
