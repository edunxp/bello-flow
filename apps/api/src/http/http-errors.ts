import { ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const HTTP_ERROR_CODE = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  REQUEST_FORBIDDEN: 'REQUEST_FORBIDDEN',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const);

export type HttpErrorCode =
  (typeof HTTP_ERROR_CODE)[keyof typeof HTTP_ERROR_CODE];

interface HttpErrorDefinition {
  readonly code: HttpErrorCode;
  readonly status: number;
  readonly message: string;
}

export const HTTP_ERROR_DEFINITION = Object.freeze({
  [HTTP_ERROR_CODE.INVALID_REQUEST]: Object.freeze({
    code: HTTP_ERROR_CODE.INVALID_REQUEST,
    status: 400,
    message: 'Invalid request',
  }),
  [HTTP_ERROR_CODE.AUTHENTICATION_FAILED]: Object.freeze({
    code: HTTP_ERROR_CODE.AUTHENTICATION_FAILED,
    status: 401,
    message: 'Authentication failed',
  }),
  [HTTP_ERROR_CODE.UNAUTHENTICATED]: Object.freeze({
    code: HTTP_ERROR_CODE.UNAUTHENTICATED,
    status: 401,
    message: 'Authentication required',
  }),
  [HTTP_ERROR_CODE.REQUEST_FORBIDDEN]: Object.freeze({
    code: HTTP_ERROR_CODE.REQUEST_FORBIDDEN,
    status: 403,
    message: 'Request forbidden',
  }),
  [HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE]: Object.freeze({
    code: HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
    status: 415,
    message: 'Unsupported media type',
  }),
  [HTTP_ERROR_CODE.RATE_LIMITED]: Object.freeze({
    code: HTTP_ERROR_CODE.RATE_LIMITED,
    status: 429,
    message: 'Too many requests',
  }),
  [HTTP_ERROR_CODE.SERVICE_UNAVAILABLE]: Object.freeze({
    code: HTTP_ERROR_CODE.SERVICE_UNAVAILABLE,
    status: 503,
    message: 'Service unavailable',
  }),
  [HTTP_ERROR_CODE.INTERNAL_ERROR]: Object.freeze({
    code: HTTP_ERROR_CODE.INTERNAL_ERROR,
    status: 500,
    message: 'Internal server error',
  }),
} satisfies Readonly<Record<HttpErrorCode, HttpErrorDefinition>>);

export interface HttpErrorResponse {
  readonly error: {
    readonly code: HttpErrorCode;
    readonly message: string;
  };
}

export function buildHttpErrorResponse(code: HttpErrorCode): HttpErrorResponse {
  const definition = HTTP_ERROR_DEFINITION[code];
  return {
    error: { code: definition.code, message: definition.message },
  };
}

export class HttpContractError extends Error {
  constructor(public readonly code: HttpErrorCode) {
    super(code);
    this.name = 'HttpContractError';
  }
}

@Catch(HttpContractError)
export class HttpContractErrorFilter implements ExceptionFilter {
  catch(exception: HttpContractError, host: ArgumentsHost): void {
    const definition = HTTP_ERROR_DEFINITION[exception.code];
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(definition.status)
      .json(buildHttpErrorResponse(exception.code));
  }
}

type JsonParseError = {
  readonly status?: unknown;
  readonly type?: unknown;
};

function readBodyParserError(error: unknown): JsonParseError | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return error as JsonParseError;
}

export function bodyParserErrorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  const parserError = readBodyParserError(error);
  let code: HttpErrorCode | null = null;
  if (
    parserError?.status === 400 &&
    parserError.type === 'entity.parse.failed'
  ) {
    code = HTTP_ERROR_CODE.INVALID_REQUEST;
  } else if (
    parserError?.status === 415 &&
    (parserError.type === 'charset.unsupported' ||
      parserError.type === 'encoding.unsupported')
  ) {
    code = HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE;
  }
  if (code === null) {
    next(error);
    return;
  }
  const definition = HTTP_ERROR_DEFINITION[code];
  response.status(definition.status).json(buildHttpErrorResponse(code));
}
