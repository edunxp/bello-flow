import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Post,
  Req,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureHttpApplication } from '../src/http/configure-http-application.js';
import { loadHttpSecurityConfig } from '../src/http/http-security.config.js';

@Controller('__test/http-foundation')
class HttpFoundationProbeController {
  @Post('json')
  receiveJson(@Body() body: unknown): unknown {
    return body;
  }

  @Get('ip')
  readIp(@Req() requestValue: Request): { ip: string | undefined } {
    return { ip: requestValue.ip };
  }
}

describe('F1-B.4.1 HTTP foundation', () => {
  let app: INestApplication<App>;

  async function createProbeApplication(
    trustedProxies?: string,
  ): Promise<INestApplication<App>> {
    const moduleFixture = await Test.createTestingModule({
      controllers: [HttpFoundationProbeController],
    }).compile();

    const probeApp =
      moduleFixture.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
    configureHttpApplication(
      probeApp,
      loadHttpSecurityConfig({
        NODE_ENV: 'test',
        BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
        BELLO_TRUSTED_PROXIES: trustedProxies,
      }),
    );
    await probeApp.init();
    return probeApp;
  }

  beforeEach(async () => {
    app = await createProbeApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a generic contract for malformed JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/http-foundation/json')
      .set('Content-Type', 'application/json')
      .send('{"password":"must not be reflected"');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Invalid request' },
    });
    expect(response.text).not.toContain('password');
    expect(response.text).not.toContain('Unexpected');
  });

  it('returns the generic 415 contract for an unsupported JSON charset', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/http-foundation/json')
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .send('{}');

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported media type',
      },
    });
    expect(response.text).not.toContain('charset');
  });

  it('returns the generic 415 contract for an unsupported content encoding', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/http-foundation/json')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send('{}');

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported media type',
      },
    });
    expect(response.text).not.toContain('encoding');
  });

  it('does not enable CORS or authorize an external preflight', async () => {
    const response = await request(app.getHttpServer())
      .options('/__test/http-foundation/json')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
    expect(response.headers).not.toHaveProperty(
      'access-control-allow-credentials',
    );
  });

  it('ignores forwarded client data from an untrusted direct connection', async () => {
    const response = await request(app.getHttpServer())
      .get('/__test/http-foundation/ip')
      .set('X-Forwarded-For', '203.0.113.42')
      .set('X-Forwarded-Host', 'attacker.example')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
    expect(response.body.ip).not.toBe('203.0.113.42');
  });

  it('stops a trusted proxy chain at the first untrusted address', async () => {
    const trustedProxyApp = await createProbeApplication('127.0.0.1/8,::1/128');
    try {
      const response = await request(trustedProxyApp.getHttpServer())
        .get('/__test/http-foundation/ip')
        .set('X-Forwarded-For', '198.51.100.20, 10.0.0.7, 203.0.113.99');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ip: '203.0.113.99' });
      expect(response.body.ip).not.toBe('198.51.100.20');
    } finally {
      await trustedProxyApp.close();
    }
  });
});
