import type { RawBodyRequest } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import {
  bodyParserErrorHandler,
  HttpContractErrorFilter,
} from './http-errors.js';
import type { HttpSecurityConfig } from './http-security.config.js';

export const HTTP_SECURITY_CONFIG_SETTING = 'bello.httpSecurityConfig';
const parsedJsonBodyByteLengths = new WeakMap<Request, number>();

export function readParsedJsonBodyByteLength(
  request: Request,
): number | undefined {
  return parsedJsonBodyByteLengths.get(request);
}

function retainParsedJsonBodyByteLength(
  request: RawBodyRequest<Request>,
  _response: Response,
  next: NextFunction,
): void {
  if (Buffer.isBuffer(request.rawBody)) {
    parsedJsonBodyByteLengths.set(request, request.rawBody.byteLength);
    delete request.rawBody;
  }
  next();
}

export function configureHttpApplication(
  app: NestExpressApplication,
  config: HttpSecurityConfig,
): void {
  app.set(HTTP_SECURITY_CONFIG_SETTING, config);
  app.set(
    'trust proxy',
    config.trustedProxies.length === 0 ? false : [...config.trustedProxies],
  );
  app.useBodyParser('json');
  app.use(retainParsedJsonBodyByteLength);
  app.use(bodyParserErrorHandler);
  app.useGlobalFilters(new HttpContractErrorFilter());
}
