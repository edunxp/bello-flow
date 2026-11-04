import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttpApplication } from './http/configure-http-application.js';
import { loadHttpSecurityConfig } from './http/http-security.config.js';

async function bootstrap() {
  const httpSecurity = loadHttpSecurityConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    rawBody: true,
  });
  configureHttpApplication(app, httpSecurity);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 13000, '127.0.0.1');
}
await bootstrap();
