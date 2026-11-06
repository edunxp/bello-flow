import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import {
  RESEND_EMAIL_ENDPOINT,
  RESEND_MAX_RESPONSE_BODY_BYTES,
  RESEND_NOT_ACCEPTED_RESPONSES,
  ResendPasswordRecoveryDeliveryAdapter,
  type ResendDeliveryObservation,
  type ResendFetch,
} from './password-recovery-resend.adapter.js';

const input = {
  recipientEmail: 'synthetic@example.test',
  recoveryUrl:
    'https://bello.example/reset-password#token=synthetic_a-b&proof="safe"',
  expiresAt: new Date('2030-01-01T00:30:00Z'),
  signal: new AbortController().signal,
};

function jsonResponse(status: number, value: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers });
}

function createHarness(response: Response) {
  const http = vi.fn<ResendFetch>().mockResolvedValue(response);
  const observations: ResendDeliveryObservation[] = [];
  const logger = { log: vi.fn((value) => observations.push(value)) };
  let now = 100;
  const adapter = new ResendPasswordRecoveryDeliveryAdapter(
    'synthetic_api_key',
    'mail@auth.bello.example',
    http,
    logger,
    () => (now += 5),
  );
  return { adapter, http, logger, observations };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function withLoopbackServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void | Promise<void>,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : undefined);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function nativeLoopbackTransport(
  url: string,
  requestedEndpoints: string[],
): ResendFetch {
  return async (input, init) => {
    requestedEndpoints.push(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return fetch(url, init);
  };
}

describe('ResendPasswordRecoveryDeliveryAdapter', () => {
  it('sends the approved UTF-8 payload and preserves the recovery URL', async () => {
    const harness = createHarness(
      jsonResponse(200, { id: 'provider-id-must-be-discarded' }),
    );

    await expect(harness.adapter.deliver(input)).resolves.toEqual({
      status: 'ACCEPTED',
    });

    expect(harness.http).toHaveBeenCalledOnce();
    const [endpoint, request] = harness.http.mock.calls[0]!;
    expect(endpoint).toBe(RESEND_EMAIL_ENDPOINT);
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      signal: input.signal,
      headers: {
        accept: 'application/json',
        authorization: 'Bearer synthetic_api_key',
        'content-type': 'application/json; charset=utf-8',
      },
    });
    expect(typeof request?.body).toBe('string');
    if (typeof request?.body !== 'string') {
      throw new Error('expected a string request body');
    }
    const payload = JSON.parse(request.body) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'from',
      'html',
      'subject',
      'text',
      'to',
    ]);
    expect(payload).toMatchObject({
      from: 'Bello Flow <mail@auth.bello.example>',
      to: ['synthetic@example.test'],
      subject: 'Redefina sua senha no Bello Flow',
    });
    expect(payload.text).toContain(input.recoveryUrl);
    expect(payload.text).toContain('válido por 30 minutos');
    expect(payload.text).toContain('ignore esta mensagem');
    expect(payload.html).toContain(
      'href="https://bello.example/reset-password#token=synthetic_a-b&amp;proof=&quot;safe&quot;"',
    );
    expect(payload.html).toContain('válido por 30 minutos');
    expect(payload.text).not.toContain(input.recipientEmail);
    expect(payload.html).not.toContain(input.recipientEmail);
    expect(request.body).not.toContain('provider-id-must-be-discarded');
    expect(JSON.stringify(harness.observations)).not.toContain(
      'provider-id-must-be-discarded',
    );
  });

  it.each(RESEND_NOT_ACCEPTED_RESPONSES)(
    'classifies %i + %s as NOT_ACCEPTED',
    async (status, name) => {
      const harness = createHarness(
        jsonResponse(status, {
          name,
          message: 'documented rejection',
          statusCode: status,
        }),
      );
      await expect(harness.adapter.deliver(input)).resolves.toEqual({
        status: 'NOT_ACCEPTED',
      });
      expect(harness.http).toHaveBeenCalledOnce();
    },
  );

  it('keeps the normative NOT_ACCEPTED whitelist closed', () => {
    expect(RESEND_NOT_ACCEPTED_RESPONSES).toEqual([
      [400, 'validation_error'],
      [400, 'invalid_idempotency_key'],
      [401, 'missing_api_key'],
      [401, 'validation_error'],
      [403, 'restricted_api_key'],
      [403, 'suspended_api_key'],
      [404, 'not_found'],
      [405, 'method_not_allowed'],
      [422, 'invalid_attachment'],
      [422, 'missing_required_field'],
      [429, 'daily_quota_exceeded'],
      [429, 'monthly_quota_exceeded'],
      [429, 'rate_limit_exceeded'],
    ]);
  });

  it.each([
    [403, 'invalid_permission'],
    [403, 'validation_error'],
    [422, 'invalid_parameter'],
    [422, 'missing_required_parameter'],
  ] as const)('classifies %i + %s conservatively', async (status, name) => {
    const harness = createHarness(
      jsonResponse(status, {
        name,
        message: 'ambiguous rejection',
        statusCode: status,
      }),
    );
    await expect(harness.adapter.deliver(input)).resolves.toEqual({
      status: 'INDETERMINATE',
    });
  });

  it.each([
    [200, {}],
    [200, { id: '' }],
    [200, { id: 42 }],
    [201, { id: 'unexpected-success' }],
    [409, { name: 'conflict', message: 'ambiguous', statusCode: 409 }],
    [500, { name: 'internal_error', message: 'ambiguous', statusCode: 500 }],
    [418, { name: 'unknown', message: 'unknown', statusCode: 418 }],
    [400, { name: 'validation_error', message: 'mismatch', statusCode: 401 }],
    [400, { name: 'validation_error', statusCode: 400 }],
    [400, null],
    [400, []],
  ] as const)(
    'classifies an unproven HTTP %# response conservatively',
    async (status, body) => {
      const harness = createHarness(jsonResponse(status, body));
      await expect(harness.adapter.deliver(input)).resolves.toEqual({
        status: 'INDETERMINATE',
      });
    },
  );

  it.each(['', 'not-json', '{"id":'])(
    'classifies invalid JSON %# conservatively',
    async (body) => {
      const harness = createHarness(new Response(body, { status: 200 }));
      await expect(harness.adapter.deliver(input)).resolves.toEqual({
        status: 'INDETERMINATE',
      });
    },
  );

  it('rejects redirects without following them', async () => {
    const harness = createHarness(
      new Response(null, {
        status: 302,
        headers: { location: 'https://unapproved.example/message' },
      }),
    );
    await expect(harness.adapter.deliver(input)).resolves.toEqual({
      status: 'INDETERMINATE',
    });
    expect(harness.http).toHaveBeenCalledOnce();
    expect(harness.http.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it.each(['DNS', 'TLS', 'connection', 'response loss'])(
    'classifies simulated %s failure without retry',
    async (failure) => {
      const harness = createHarness(jsonResponse(200, { id: 'unused' }));
      harness.http.mockRejectedValueOnce(new Error(failure));
      await expect(harness.adapter.deliver(input)).resolves.toEqual({
        status: 'INDETERMINATE',
      });
      expect(harness.http).toHaveBeenCalledOnce();
    },
  );

  it('classifies a partial response without retry', async () => {
    const partial = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"partial'));
          controller.error(new Error('response truncated'));
        },
      }),
      { status: 500 },
    );
    const harness = createHarness(partial);
    await expect(harness.adapter.deliver(input)).resolves.toEqual({
      status: 'INDETERMINATE',
    });
    expect(harness.http).toHaveBeenCalledOnce();
  });

  it('does not call the provider when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = createHarness(jsonResponse(200, { id: 'unused' }));
    await expect(
      harness.adapter.deliver({ ...input, signal: controller.signal }),
    ).resolves.toEqual({ status: 'INDETERMINATE' });
    expect(harness.http).not.toHaveBeenCalled();
  });

  it('classifies cancellation during the request without retry', async () => {
    const controller = new AbortController();
    const harness = createHarness(jsonResponse(200, { id: 'unused' }));
    harness.http.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    });
    await expect(
      harness.adapter.deliver({ ...input, signal: controller.signal }),
    ).resolves.toEqual({ status: 'INDETERMINATE' });
    expect(harness.http).toHaveBeenCalledOnce();
  });

  it('classifies cancellation received with headers', async () => {
    const controller = new AbortController();
    const harness = createHarness(jsonResponse(200, { id: 'unused' }));
    harness.http.mockImplementationOnce(async () => {
      controller.abort();
      return jsonResponse(200, { id: 'potentially-accepted' });
    });
    await expect(
      harness.adapter.deliver({ ...input, signal: controller.signal }),
    ).resolves.toEqual({ status: 'INDETERMINATE' });
  });

  it('classifies cancellation while reading the response', async () => {
    const controller = new AbortController();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ id: 'potentially-accepted' }),
            ),
          );
          controller.abort();
          stream.close();
        },
      }),
      { status: 200 },
    );
    const harness = createHarness(response);
    await expect(
      harness.adapter.deliver({ ...input, signal: controller.signal }),
    ).resolves.toEqual({ status: 'INDETERMINATE' });
  });

  it('rejects a response body above the byte limit without logging it', async () => {
    const harness = createHarness(
      new Response(new Uint8Array(RESEND_MAX_RESPONSE_BODY_BYTES + 1), {
        status: 200,
      }),
    );
    await expect(harness.adapter.deliver(input)).resolves.toEqual({
      status: 'INDETERMINATE',
    });
    expect(harness.observations[0]).toMatchObject({
      errorType: 'RESPONSE_TOO_LARGE',
      result: 'INDETERMINATE',
    });
    expect(JSON.stringify(harness.observations)).not.toContain('\u0000');
  });

  it('classifies invalid UTF-8 as an unreadable response', async () => {
    const harness = createHarness(
      new Response(Uint8Array.of(0xff), { status: 200 }),
    );
    await expect(harness.adapter.deliver(input)).resolves.toEqual({
      status: 'INDETERMINATE',
    });
    expect(harness.observations[0]).toMatchObject({
      errorType: 'RESPONSE_READ',
    });
  });

  it('uses the native defaults without exposing the provider identifier', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const http = vi
      .fn<ResendFetch>()
      .mockResolvedValue(jsonResponse(200, { id: 'provider-id-secret' }));
    const adapter = new ResendPasswordRecoveryDeliveryAdapter(
      'synthetic_api_key',
      'mail@auth.bello.example',
      http,
    );
    await expect(adapter.deliver(input)).resolves.toEqual({
      status: 'ACCEPTED',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('provider-id-secret');
    log.mockRestore();
  });

  it('observes only the approved sanitized fields', async () => {
    const harness = createHarness(
      jsonResponse(
        429,
        {
          name: 'rate_limit_exceeded',
          message: 'external-secret-message',
          statusCode: 429,
        },
        { 'retry-after': 'external-secret-retry-value' },
      ),
    );
    await harness.adapter.deliver(input);
    expect(harness.logger.log).toHaveBeenCalledOnce();
    expect(Object.keys(harness.observations[0]!).sort()).toEqual([
      'durationMilliseconds',
      'errorType',
      'httpStatus',
      'provider',
      'rateLimited',
      'result',
    ]);
    expect(harness.observations[0]).toEqual({
      provider: 'resend',
      result: 'NOT_ACCEPTED',
      durationMilliseconds: 5,
      httpStatus: 429,
      errorType: 'PROVIDER_REJECTED',
      rateLimited: true,
    });
    const rendered = JSON.stringify(harness.logger.log.mock.calls);
    for (const prohibited of [
      'synthetic_api_key',
      input.recipientEmail,
      input.recoveryUrl,
      'external-secret-message',
      'external-secret-retry-value',
    ]) {
      expect(rendered).not.toContain(prohibited);
    }
  });
});

describe('Resend adapter with native Node fetch', () => {
  it('sends one approved request and accepts a complete response', async () => {
    let requestCount = 0;
    let requestMethod: string | undefined;
    let authorization: string | undefined;
    let contentType: string | undefined;
    let requestBody = '';
    await withLoopbackServer(
      async (request, response) => {
        requestCount += 1;
        requestMethod = request.method;
        authorization = request.headers.authorization;
        contentType = request.headers['content-type'];
        requestBody = await readRequestBody(request);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'discarded-provider-id' }));
      },
      async (origin) => {
        const endpoints: string[] = [];
        const observations: ResendDeliveryObservation[] = [];
        const adapter = new ResendPasswordRecoveryDeliveryAdapter(
          'synthetic_api_key',
          'mail@auth.bello.example',
          nativeLoopbackTransport(`${origin}/emails`, endpoints),
          { log: (observation) => observations.push(observation) },
        );
        await expect(adapter.deliver(input)).resolves.toEqual({
          status: 'ACCEPTED',
        });
        expect(endpoints).toEqual([RESEND_EMAIL_ENDPOINT]);
        expect(observations).toHaveLength(1);
        expect(JSON.stringify(observations)).not.toContain(
          'discarded-provider-id',
        );
      },
    );
    expect(requestCount).toBe(1);
    expect(requestMethod).toBe('POST');
    expect(authorization).toBe('Bearer synthetic_api_key');
    expect(contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(requestBody)).toMatchObject({
      from: 'Bello Flow <mail@auth.bello.example>',
      to: [input.recipientEmail],
      subject: 'Redefina sua senha no Bello Flow',
    });
  });

  it('does not follow a redirect or issue a second request', async () => {
    let requestCount = 0;
    let redirectedCount = 0;
    await withLoopbackServer(
      (request, response) => {
        requestCount += 1;
        if (request.url === '/redirected') {
          redirectedCount += 1;
          response.end(JSON.stringify({ id: 'must-not-be-reached' }));
          return;
        }
        response.writeHead(302, { location: '/redirected' });
        response.end();
      },
      async (origin) => {
        const endpoints: string[] = [];
        const observations: ResendDeliveryObservation[] = [];
        const adapter = new ResendPasswordRecoveryDeliveryAdapter(
          'synthetic_api_key',
          'mail@auth.bello.example',
          nativeLoopbackTransport(`${origin}/emails`, endpoints),
          { log: (observation) => observations.push(observation) },
        );
        await expect(adapter.deliver(input)).resolves.toEqual({
          status: 'INDETERMINATE',
        });
        expect(endpoints).toEqual([RESEND_EMAIL_ENDPOINT]);
        expect(observations[0]).toMatchObject({ errorType: 'REDIRECT' });
      },
    );
    expect(requestCount).toBe(1);
    expect(redirectedCount).toBe(0);
  });

  it('does not contact the server when aborted before delivery', async () => {
    let requestCount = 0;
    await withLoopbackServer(
      (_request, response) => {
        requestCount += 1;
        response.end();
      },
      async (origin) => {
        const controller = new AbortController();
        controller.abort();
        const endpoints: string[] = [];
        const adapter = new ResendPasswordRecoveryDeliveryAdapter(
          'synthetic_api_key',
          'mail@auth.bello.example',
          nativeLoopbackTransport(`${origin}/emails`, endpoints),
          { log: vi.fn() },
        );
        await expect(
          adapter.deliver({ ...input, signal: controller.signal }),
        ).resolves.toEqual({ status: 'INDETERMINATE' });
        expect(endpoints).toEqual([]);
      },
    );
    expect(requestCount).toBe(0);
  });

  it('aborts native fetch during response body reading', async () => {
    let bodyStartedResolve!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      bodyStartedResolve = resolve;
    });
    await withLoopbackServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"id":"potentially-accepted');
        bodyStartedResolve();
      },
      async (origin) => {
        const controller = new AbortController();
        const observations: ResendDeliveryObservation[] = [];
        const adapter = new ResendPasswordRecoveryDeliveryAdapter(
          'synthetic_api_key',
          'mail@auth.bello.example',
          nativeLoopbackTransport(`${origin}/emails`, []),
          { log: (observation) => observations.push(observation) },
        );
        const delivery = adapter.deliver({
          ...input,
          signal: controller.signal,
        });
        await bodyStarted;
        controller.abort();
        await expect(delivery).resolves.toEqual({ status: 'INDETERMINATE' });
        expect(observations[0]).toMatchObject({ errorType: 'CANCELLED' });
      },
    );
  });

  it.each([
    ['declared length', true],
    ['chunked stream', false],
  ] as const)(
    'classifies an interrupted %s response conservatively',
    async (_description, declaredLength) => {
      await withLoopbackServer(
        (_request, response) => {
          const partial = '{"id":"partial';
          response.writeHead(
            200,
            declaredLength
              ? { 'content-length': String(Buffer.byteLength(partial) + 20) }
              : {},
          );
          response.write(partial);
          setImmediate(() => response.destroy());
        },
        async (origin) => {
          const observations: ResendDeliveryObservation[] = [];
          const adapter = new ResendPasswordRecoveryDeliveryAdapter(
            'synthetic_api_key',
            'mail@auth.bello.example',
            nativeLoopbackTransport(`${origin}/emails`, []),
            { log: (observation) => observations.push(observation) },
          );
          await expect(adapter.deliver(input)).resolves.toEqual({
            status: 'INDETERMINATE',
          });
          expect(observations[0]).toMatchObject({
            errorType: 'RESPONSE_READ',
          });
        },
      );
    },
  );

  it.each([
    ['fixed length', false],
    ['chunked', true],
  ] as const)(
    'rejects a native %s body above 64 KiB',
    async (_description, chunked) => {
      const externalMarker = 'external-body-must-not-be-logged';
      const observations: ResendDeliveryObservation[] = [];
      await withLoopbackServer(
        (_request, response) => {
          response.writeHead(
            200,
            chunked
              ? {}
              : {
                  'content-length': String(
                    RESEND_MAX_RESPONSE_BODY_BYTES + externalMarker.length,
                  ),
                },
          );
          const first = Buffer.alloc(32 * 1024, 0x61);
          response.write(first);
          response.write(first);
          response.end(externalMarker);
        },
        async (origin) => {
          const adapter = new ResendPasswordRecoveryDeliveryAdapter(
            'synthetic_api_key',
            'mail@auth.bello.example',
            nativeLoopbackTransport(`${origin}/emails`, []),
            { log: (observation) => observations.push(observation) },
          );
          await expect(adapter.deliver(input)).resolves.toEqual({
            status: 'INDETERMINATE',
          });
        },
      );
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({
        errorType: 'RESPONSE_TOO_LARGE',
        result: 'INDETERMINATE',
      });
      expect(JSON.stringify(observations)).not.toContain(externalMarker);
      expect(JSON.stringify(observations)).not.toContain('synthetic_api_key');
    },
  );
});
