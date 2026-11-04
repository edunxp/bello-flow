import { EventEmitter } from 'node:events';
import type { Request } from 'express';
import type { Response } from 'express';
import {
  createHttpRequestCancellation,
  readLoginHttpInput,
  requestContainsBody,
} from './auth-http-request.js';

function bodyRequest(input: {
  body?: unknown;
  rawHeaders?: string[];
  readableEnded?: boolean;
  chunks?: unknown[];
}): Request {
  return {
    body: input.body,
    rawHeaders: input.rawHeaders ?? [],
    readableEnded: input.readableEnded ?? true,
    async *[Symbol.asyncIterator]() {
      for (const chunk of input.chunks ?? []) {
        yield chunk;
      }
    },
  } as unknown as Request;
}

describe('authentication HTTP request contracts', () => {
  it('accepts only an exact string login object', () => {
    expect(
      readLoginHttpInput({ email: 'user@example.com', password: 'password' }),
    ).toEqual({
      valid: true,
      input: { email: 'user@example.com', password: 'password' },
    });

    for (const value of [
      undefined,
      null,
      [],
      'value',
      {},
      { email: 'user@example.com' },
      { password: 'password' },
      { email: 1, password: 'password' },
      { email: 'user@example.com', password: 1 },
      { email: 'user@example.com', password: 'password', extra: true },
    ]) {
      expect(readLoginHttpInput(value)).toEqual({ valid: false });
    }
  });

  it('detects parsed and content-length framed bodies', async () => {
    await expect(requestContainsBody(bodyRequest({ body: {} }))).resolves.toBe(
      true,
    );
    await expect(
      requestContainsBody(bodyRequest({ rawHeaders: ['Content-Length', '4'] })),
    ).resolves.toBe(true);
    await expect(
      requestContainsBody(bodyRequest({ rawHeaders: ['Content-Length', '0'] })),
    ).resolves.toBe(false);
    await expect(
      requestContainsBody(bodyRequest({ rawHeaders: [] })),
    ).resolves.toBe(false);
  });

  it('fails closed for malformed or ambiguous content length', async () => {
    for (const rawHeaders of [
      ['orphan'],
      ['Content-Length', '-1'],
      ['Content-Length', '1.5'],
      ['Content-Length', '9007199254740992'],
      ['Content-Length', '0', 'content-length', '0'],
    ]) {
      await expect(
        requestContainsBody(bodyRequest({ rawHeaders })),
      ).resolves.toBe(true);
    }
  });

  it('accepts empty chunked framing and rejects actual streamed bytes', async () => {
    await expect(
      requestContainsBody(
        bodyRequest({
          rawHeaders: ['Transfer-Encoding', 'chunked'],
          readableEnded: false,
          chunks: [],
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      requestContainsBody(
        bodyRequest({
          rawHeaders: ['Transfer-Encoding', 'chunked'],
          readableEnded: false,
          chunks: [Buffer.alloc(0), Buffer.from('body')],
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      requestContainsBody(
        bodyRequest({
          rawHeaders: ['Transfer-Encoding', 'chunked'],
          readableEnded: false,
          chunks: ['', 'body'],
        }),
      ),
    ).resolves.toBe(true);
  });

  it('fails closed for duplicate transfer encoding and accepts ended empty framing', async () => {
    await expect(
      requestContainsBody(
        bodyRequest({
          rawHeaders: [
            'Transfer-Encoding',
            'chunked',
            'transfer-encoding',
            'chunked',
          ],
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      requestContainsBody(
        bodyRequest({
          rawHeaders: ['Transfer-Encoding', 'chunked'],
          readableEnded: true,
        }),
      ),
    ).resolves.toBe(false);
  });

  it('aborts only for premature request or response termination', () => {
    const request = Object.assign(new EventEmitter(), {
      aborted: false,
      destroyed: false,
      complete: true,
    }) as unknown as Request;
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
    }) as unknown as Response;
    const cancellation = createHttpRequestCancellation(request, response);

    request.emit('close');
    expect(cancellation.signal.aborted).toBe(false);

    response.emit('close');
    expect(cancellation.signal.aborted).toBe(true);
    cancellation.dispose();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('does not treat normal response completion as cancellation', () => {
    const request = Object.assign(new EventEmitter(), {
      aborted: false,
      destroyed: false,
      complete: true,
    }) as unknown as Request;
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: true,
    }) as unknown as Response;
    const cancellation = createHttpRequestCancellation(request, response);

    response.emit('close');
    expect(cancellation.signal.aborted).toBe(false);

    request.emit('aborted');
    expect(cancellation.signal.aborted).toBe(true);
    cancellation.dispose();
  });

  it('starts aborted when the request was destroyed before completion', () => {
    const request = Object.assign(new EventEmitter(), {
      aborted: false,
      destroyed: true,
      complete: false,
    }) as unknown as Request;
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
    }) as unknown as Response;

    const cancellation = createHttpRequestCancellation(request, response);

    expect(cancellation.signal.aborted).toBe(true);
    cancellation.dispose();
  });
});
