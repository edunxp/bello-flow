import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  bodyParserErrorHandler,
  HttpContractErrorFilter,
} from './http-errors.js';
import type { HttpSecurityConfig } from './http-security.config.js';

export function configureHttpApplication(
  app: NestExpressApplication,
  config: HttpSecurityConfig,
): void {
  app.set(
    'trust proxy',
    config.trustedProxies.length === 0 ? false : [...config.trustedProxies],
  );
  app.useBodyParser('json');
  app.use(bodyParserErrorHandler);
  app.useGlobalFilters(new HttpContractErrorFilter());
}
