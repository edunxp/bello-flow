import { Logger, type ArgumentsHost } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  HTTP_ERROR_CODE,
  HTTP_ERROR_DEFINITION,
  HttpBoundaryErrorFilter,
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

  it('serializes an unexpected error as the generic internal contract', () => {
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((_message: unknown) => undefined);
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ headersSent: false, status }),
      }),
    } as unknown as ArgumentsHost;

    new HttpBoundaryErrorFilter().catch(
      new Error('database and credential details'),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('database');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('credential');
    errorLog.mockRestore();
  });

  it('does not overwrite a response whose transmission has started', () => {
    const status = vi.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ headersSent: true, status }),
      }),
    } as unknown as ArgumentsHost;

    new HttpBoundaryErrorFilter().catch(new Error('late failure'), host);

    expect(status).not.toHaveBeenCalled();
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

  it.each([
    [400, 'entity.parse.failed'],
    [400, 'request.size.invalid'],
    [400, 'request.aborted'],
    [413, 'entity.too.large'],
  ])('maps parser error %s/%s to a generic 400', (parserStatus, type) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const next = vi.fn();

    bodyParserErrorHandler(
      {
        status: parserStatus,
        type,
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

  it.each(['stream.encoding.set', 'stream.not.readable'])(
    'maps internal parser error %s to the generic 500',
    (type) => {
      const errorLog = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((_message: unknown) => undefined);
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      const next = vi.fn() as NextFunction;

      bodyParserErrorHandler(
        { status: 500, type, message: 'credential detail' },
        {} as Request,
        { status } as unknown as Response,
        next,
      );

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('credential');
      expect(next).not.toHaveBeenCalled();
      errorLog.mockRestore();
    },
  );

  it('maps an unclassified parser failure to the generic 500', () => {
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((_message: unknown) => undefined);
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const next = vi.fn() as NextFunction;
    const error = new Error('credential and parser detail');

    bodyParserErrorHandler(
      error,
      {} as Request,
      { status } as unknown as Response,
      next,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('credential');
    expect(next).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('delegates after headers start and stays silent for a closed connection', () => {
    const error = new Error('late parser failure');
    const next = vi.fn();
    const status = vi.fn();

    bodyParserErrorHandler(
      error,
      {} as Request,
      { headersSent: true, status } as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith(error);
    expect(status).not.toHaveBeenCalled();

    next.mockClear();
    bodyParserErrorHandler(
      error,
      { destroyed: true } as Request,
      { status } as unknown as Response,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});
