import type { ArgumentsHost } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  HTTP_ERROR_CODE,
  HTTP_ERROR_DEFINITION,
  HttpContractError,
  HttpContractErrorFilter,
  bodyParserErrorHandler,
  buildHttpErrorResponse,
} from './http-errors.js';

describe('HTTP error contracts', () => {
  it('builds the approved external envelope', () => {
    expect(buildHttpErrorResponse(HTTP_ERROR_CODE.INVALID_REQUEST)).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Invalid request' },
    });
  });

  it('serializes only the public contract of an explicit error', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    const filter = new HttpContractErrorFilter();

    filter.catch(
      new HttpContractError(HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE),
      host,
    );

    expect(status).toHaveBeenCalledWith(415);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported media type',
      },
    });
  });

  it('derives status and message only from immutable approved definitions', () => {
    expect(Object.isFrozen(HTTP_ERROR_DEFINITION)).toBe(true);
    expect(
      Object.values(HTTP_ERROR_DEFINITION).every((definition) =>
        Object.isFrozen(definition),
      ),
    ).toBe(true);
    expect(buildHttpErrorResponse(HTTP_ERROR_CODE.INTERNAL_ERROR)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(HttpContractError).toHaveLength(1);
  });

  it('maps only malformed JSON parser errors to a generic 400', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const next = vi.fn() as NextFunction;

    bodyParserErrorHandler(
      {
        status: 400,
        type: 'entity.parse.failed',
        body: '{"password":"do not reflect"',
        message: 'parser detail',
      },
      {} as Request,
      { status } as unknown as Response,
      next,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INVALID_REQUEST', message: 'Invalid request' },
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('password');
    expect(JSON.stringify(json.mock.calls)).not.toContain('parser detail');
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['charset.unsupported', 'encoding.unsupported'])(
    'maps %s parser errors to a generic 415',
    (type) => {
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      const next = vi.fn() as NextFunction;

      bodyParserErrorHandler(
        { status: 415, type, message: 'parser detail' },
        {} as Request,
        { status } as unknown as Response,
        next,
      );

      expect(status).toHaveBeenCalledWith(415);
      expect(json).toHaveBeenCalledWith({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Unsupported media type',
        },
      });
      expect(JSON.stringify(json.mock.calls)).not.toContain('parser detail');
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('delegates errors that are not malformed JSON', () => {
    const next = vi.fn() as NextFunction;
    const error = new Error('unrelated');

    bodyParserErrorHandler(error, {} as Request, {} as Response, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
