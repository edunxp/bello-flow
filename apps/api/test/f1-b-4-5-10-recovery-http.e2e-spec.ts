import { Logger, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import { PasswordRecoveryRequestService } from '../src/auth/password-recovery-request.service.js';
import {
  PasswordResetService,
  PasswordResetValidationError,
} from '../src/auth/password-reset.service.js';
import { configureHttpApplication } from '../src/http/configure-http-application.js';
import { loadHttpSecurityConfig } from '../src/http/http-security.config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const localOrigin = 'http://127.0.0.1:14200';
const validToken = 'A'.repeat(43);

describe('F1-B.4.5.10 password recovery HTTP endpoints', () => {
  let app: INestApplication<App>;
  const requestPasswordRecovery = vi.fn();
  const resetPassword = vi.fn();

  async function createApplication(): Promise<void> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthenticationService)
      .useValue({})
      .overrideProvider(PasswordRecoveryRequestService)
      .useValue({ request: requestPasswordRecovery })
      .overrideProvider(PasswordResetService)
      .useValue({ reset: resetPassword })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
    });
    configureHttpApplication(
      app as NestExpressApplication,
      loadHttpSecurityConfig({
        NODE_ENV: 'test',
        BELLO_PUBLIC_ORIGIN: localOrigin,
      }),
    );
    await app.init();
  }

  function recoveryRequest() {
    return request(app.getHttpServer())
      .post('/api/auth/password-recovery')
      .set('X-Bello-Flow-Request', '1')
      .set('Origin', localOrigin)
      .set('Content-Type', 'application/json');
  }

  function resetRequest() {
    return request(app.getHttpServer())
      .post('/api/auth/password-reset')
      .set('X-Bello-Flow-Request', '1')
      .set('Origin', localOrigin)
      .set('Content-Type', 'application/json');
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    requestPasswordRecovery.mockResolvedValue({ status: 'RECORDED' });
    resetPassword.mockResolvedValue({ status: 'COMPLETED' });
    await createApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    'eligible account',
    'nonexistent account',
    'ineligible account',
    'account in cooldown',
    'account with a pending request',
    'account at the active-token ceiling',
  ])('returns the same empty 202 for an admitted %s', async () => {
    const response = await recoveryRequest()
      .set('Cookie', 'bello_flow_session=unrelated-session')
      .set('X-Forwarded-For', '203.0.113.42')
      .send({ email: 'user@example.com' });

    expect(response.status).toBe(202);
    expect(response.text).toBe('');
    expect(response.headers).not.toHaveProperty('set-cookie');
    expect(requestPasswordRecovery).toHaveBeenCalledWith({
      email: 'user@example.com',
      trustedIp: expect.any(String),
    });
    expect(requestPasswordRecovery.mock.calls[0]![0].trustedIp).not.toBe(
      '203.0.113.42',
    );
  });

  it('accepts the approved Referer fallback for recovery', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/password-recovery')
      .set('X-Bello-Flow-Request', '1')
      .set('Referer', `${localOrigin}/forgot-password`)
      .set('Content-Type', 'application/json')
      .send({ email: 'user@example.com' });

    expect(response.status).toBe(202);
  });

  it.each([
    ['recovery', '/api/auth/password-recovery', { email: 'user@example.com' }],
    [
      'reset',
      '/api/auth/password-reset',
      { token: validToken, newPassword: 'candidate-password' },
    ],
  ])(
    'applies header, origin and media-type precedence to %s',
    async (_label, path, body) => {
      const missingHeader = await request(app.getHttpServer())
        .post(path)
        .set('Origin', localOrigin)
        .set('Content-Type', 'application/json')
        .send(body);
      expect(missingHeader.status).toBe(403);
      expect(missingHeader.body.error.code).toBe('REQUEST_FORBIDDEN');

      const foreignOrigin = await request(app.getHttpServer())
        .post(path)
        .set('X-Bello-Flow-Request', '1')
        .set('Origin', 'https://attacker.example')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(foreignOrigin.status).toBe(403);
      expect(foreignOrigin.body.error.code).toBe('REQUEST_FORBIDDEN');

      const wrongMediaType = await request(app.getHttpServer())
        .post(path)
        .set('X-Bello-Flow-Request', '1')
        .set('Origin', localOrigin)
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify(body));
      expect(wrongMediaType.status).toBe(415);
      expect(wrongMediaType.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      expect(requestPasswordRecovery).not.toHaveBeenCalled();
      expect(resetPassword).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed and non-exact recovery payloads', async () => {
    const malformed = await recoveryRequest().send('{"email":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_REQUEST');

    for (const body of [
      null as unknown as object,
      [],
      {},
      { email: 42 },
      { email: 'user@example.com', extra: true },
    ]) {
      const response = await recoveryRequest().send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    }
    expect(requestPasswordRecovery).not.toHaveBeenCalled();
  });

  it('passes a semantically invalid email to the anti-enumeration use case', async () => {
    const response = await recoveryRequest().send({ email: 'not-an-email' });

    expect(response.status).toBe(202);
    expect(requestPasswordRecovery).toHaveBeenCalledWith({
      email: 'not-an-email',
      trustedIp: expect.any(String),
    });
  });

  it('maps recovery quota and saturation without cookies or details', async () => {
    requestPasswordRecovery.mockResolvedValueOnce({
      status: 'RATE_LIMITED',
      retryAfterSeconds: 599,
    });
    const limited = await recoveryRequest().send({ email: 'user@example.com' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('599');
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers).not.toHaveProperty('set-cookie');

    requestPasswordRecovery.mockResolvedValueOnce({
      status: 'SERVICE_UNAVAILABLE',
    });
    const unavailable = await recoveryRequest().send({
      email: 'user@example.com',
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(unavailable.headers).not.toHaveProperty('set-cookie');
  });

  it('returns an empty 204 and passes cancellation only to reset', async () => {
    const response = await resetRequest()
      .set('Cookie', 'bello_flow_session=unrelated-session')
      .send({ token: validToken, newPassword: 'candidate-password' });

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(response.headers).not.toHaveProperty('set-cookie');
    expect(resetPassword).toHaveBeenCalledWith({
      token: validToken,
      newPassword: 'candidate-password',
      trustedIp: expect.any(String),
      signal: expect.any(AbortSignal),
    });
  });

  it('rejects malformed, non-exact and policy-invalid reset payloads', async () => {
    const malformed = await resetRequest().send('{"token":');
    expect(malformed.status).toBe(400);

    for (const body of [
      null as unknown as object,
      [],
      {},
      { token: validToken },
      { token: validToken, newPassword: 42 },
      { token: validToken, newPassword: 'candidate-password', extra: true },
    ]) {
      const response = await resetRequest().send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    }

    resetPassword.mockRejectedValueOnce(new PasswordResetValidationError());
    const invalidPassword = await resetRequest().send({
      token: validToken,
      newPassword: 'short',
    });
    expect(invalidPassword.status).toBe(400);
    expect(invalidPassword.body.error.code).toBe('INVALID_REQUEST');
  });

  it.each([
    'noncanonical token',
    'unknown token',
    'expired token',
    'consumed token',
    'invalidated token',
    'ineligible account',
    'concurrent loser',
  ])('maps a determined %s to the same opaque 401', async () => {
    resetPassword.mockResolvedValue({ status: 'AUTHENTICATION_FAILED' });

    const response = await resetRequest().send({
      token: validToken,
      newPassword: 'candidate-password',
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

  it('maps reset quota and operational failures conservatively', async () => {
    resetPassword.mockResolvedValueOnce({
      status: 'RATE_LIMITED',
      retryAfterSeconds: 5,
    });
    const limited = await resetRequest().send({
      token: validToken,
      newPassword: 'candidate-password',
    });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('5');
    expect(limited.body.error.code).toBe('RATE_LIMITED');

    resetPassword.mockResolvedValueOnce({ status: 'SERVICE_UNAVAILABLE' });
    const unavailable = await resetRequest().send({
      token: validToken,
      newPassword: 'candidate-password',
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(unavailable.headers).not.toHaveProperty('set-cookie');
  });

  it('fails closed for malformed service results and unexpected errors', async () => {
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((_message: unknown) => undefined);
    requestPasswordRecovery.mockResolvedValueOnce({
      status: 'RATE_LIMITED',
      retryAfterSeconds: 0,
    });
    const malformedResult = await recoveryRequest().send({
      email: 'user@example.com',
    });
    expect(malformedResult.status).toBe(500);
    expect(malformedResult.body.error.code).toBe('INTERNAL_ERROR');

    resetPassword.mockRejectedValueOnce(new Error('sensitive token detail'));
    const unexpected = await resetRequest().send({
      token: validToken,
      newPassword: 'candidate-password',
    });
    expect(unexpected.status).toBe(500);
    expect(unexpected.body.error.code).toBe('INTERNAL_ERROR');
    expect(unexpected.text).not.toContain('sensitive');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('token detail');
    errorLog.mockRestore();
  });
});
