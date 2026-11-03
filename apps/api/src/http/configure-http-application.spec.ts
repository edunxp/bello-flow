import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttpApplication } from './configure-http-application.js';
import { loadHttpSecurityConfig } from './http-security.config.js';

describe('configureHttpApplication', () => {
  function applicationMock() {
    return {
      set: vi.fn(),
      useBodyParser: vi.fn(),
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
    expect(app.useBodyParser).toHaveBeenCalledWith('json');
    expect(app.use).toHaveBeenCalledOnce();
    expect(app.useGlobalFilters).toHaveBeenCalledOnce();
    expect(app.enableCors).not.toHaveBeenCalled();
    expect(app.setGlobalPrefix).not.toHaveBeenCalled();
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
