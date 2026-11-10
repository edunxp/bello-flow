import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  HTTP_SECURITY_CONFIG_SETTING,
  configureHttpApplication,
  readParsedJsonBodyByteLength,
} from './configure-http-application.js';
import { loadHttpSecurityConfig } from './http-security.config.js';

describe('configureHttpApplication', () => {
  function applicationMock() {
    return {
      set: vi.fn(),
      useBodyParser: vi.fn(),
      useWebSocketAdapter: vi.fn(),
      use: vi.fn(),
      useGlobalFilters: vi.fn(),
      enableCors: vi.fn(),
      setGlobalPrefix: vi.fn(),
    };
  }

  it('disables proxy trust by default and registers only the HTTP foundation', () => {
    const app = applicationMock();
    const config = loadHttpSecurityConfig({
      NODE_ENV: 'test',
      BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
    });

    configureHttpApplication(app as unknown as NestExpressApplication, config);

    expect(app.set).toHaveBeenCalledWith('trust proxy', false);
    expect(app.set).toHaveBeenCalledWith(HTTP_SECURITY_CONFIG_SETTING, config);
    expect(app.useBodyParser).toHaveBeenNthCalledWith(1, 'json', {
      limit: '256kb',
      type: expect.any(Function),
    });
    expect(app.useBodyParser).toHaveBeenNthCalledWith(2, 'json');
    const accepts = app.useBodyParser.mock.calls[0]![1].type;
    const json = { 'content-type': 'application/json; charset=utf-8' };
    const url = '/api/workspaces/work/boards/board/lists/list/cards';
    expect(accepts({ method: 'POST', headers: json, url })).toBe(true);
    expect(
      accepts({ method: 'PATCH', headers: json, url: url + '/card' }),
    ).toBe(true);
    expect(
      accepts({ method: 'POST', headers: json, url: url + '/card/comments' }),
    ).toBe(true);
    expect(accepts({ method: 'GET', headers: json, url })).toBe(false);
    expect(accepts({ method: 'POST', headers: {}, url })).toBe(false);
    expect(
      accepts({ method: 'POST', headers: json, url: '/api/auth/login' }),
    ).toBe(false);
    expect(app.use).toHaveBeenCalledTimes(2);
    expect(app.useGlobalFilters).toHaveBeenCalledOnce();
    expect(app.enableCors).not.toHaveBeenCalled();
    expect(app.setGlobalPrefix).not.toHaveBeenCalled();
  });

  it('retains only the parsed JSON byte length and discards the raw buffer', () => {
    const app = applicationMock();
    const config = loadHttpSecurityConfig({
      NODE_ENV: 'test',
      BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
    });
    configureHttpApplication(app as unknown as NestExpressApplication, config);
    const middleware = app.use.mock.calls[0]![0] as (
      request: { rawBody?: Buffer },
      response: unknown,
      next: () => void,
    ) => void;
    const request = { rawBody: Buffer.from('{}') };
    const next = vi.fn();

    middleware(request, {}, next);

    expect(readParsedJsonBodyByteLength(request as never)).toBe(2);
    expect(request.rawBody).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes only the validated proxy list to Express', () => {
    const app = applicationMock();
    const config = loadHttpSecurityConfig({
      NODE_ENV: 'production',
      BELLO_PUBLIC_ORIGIN: 'https://bello.example',
      BELLO_TRUSTED_PROXIES: '192.0.2.10,2001:db8::/64',
    });

    configureHttpApplication(app as unknown as NestExpressApplication, config);

    expect(app.set).toHaveBeenCalledWith('trust proxy', [
      '192.0.2.10',
      '2001:db8::/64',
    ]);
  });
});
