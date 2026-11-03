import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureHttpApplication } from '../src/http/configure-http-application.js';
import { loadHttpSecurityConfig } from '../src/http/http-security.config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttpApplication(
      app as unknown as NestExpressApplication,
      loadHttpSecurityConfig({
        NODE_ENV: 'test',
        BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
      }),
    );
    await app.init();
  });

  it('/health/live (GET)', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('does not expose authentication routes', () => {
    return request(app.getHttpServer()).post('/api/auth/login').expect(404);
  });

  afterEach(async () => {
    await app.close();
  });
});
