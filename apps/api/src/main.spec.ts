const nestMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@nestjs/core', async (importOriginal) => ({
  ...(await importOriginal()),
  NestFactory: {
    create: nestMocks.create,
  },
}));

describe('API bootstrap', () => {
  const originalPort = process.env.PORT;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalPublicOrigin = process.env.BELLO_PUBLIC_ORIGIN;
  const originalTrustedProxies = process.env.BELLO_TRUSTED_PROXIES;

  beforeEach(() => {
    vi.resetModules();
    nestMocks.create.mockReset();
    delete process.env.PORT;
    process.env.NODE_ENV = 'test';
    process.env.BELLO_PUBLIC_ORIGIN = 'http://127.0.0.1:14200';
    delete process.env.BELLO_TRUSTED_PROXIES;
  });

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
    restoreEnvironment('NODE_ENV', originalNodeEnvironment);
    restoreEnvironment('BELLO_PUBLIC_ORIGIN', originalPublicOrigin);
    restoreEnvironment('BELLO_TRUSTED_PROXIES', originalTrustedProxies);
  });

  it('enables shutdown hooks and listens on the default address', async () => {
    const app = applicationMock();
    nestMocks.create.mockResolvedValue(app);
    const { AppModule } = await import('./app.module.js');

    await import('./main.js');

    expect(nestMocks.create).toHaveBeenCalledWith(AppModule, {
      bodyParser: false,
      rawBody: true,
    });
    expect(app.set).toHaveBeenCalledWith(
      'bello.httpSecurityConfig',
      expect.objectContaining({
        publicOrigin: 'http://127.0.0.1:14200',
      }),
    );
    expect(app.set).toHaveBeenCalledWith('trust proxy', false);
    expect(app.useBodyParser).toHaveBeenCalledWith('json');
    expect(app.enableShutdownHooks).toHaveBeenCalledOnce();
    expect(app.listen).toHaveBeenCalledWith(13000, '127.0.0.1');
  });

  it('uses the configured port', async () => {
    const app = applicationMock();
    nestMocks.create.mockResolvedValue(app);
    process.env.PORT = '14000';

    await import('./main.js');

    expect(app.listen).toHaveBeenCalledWith('14000', '127.0.0.1');
  });

  it('rejects invalid HTTP configuration before creating AppModule', async () => {
    delete process.env.NODE_ENV;

    await expect(import('./main.js')).rejects.toThrow(/NODE_ENV/);

    expect(nestMocks.create).not.toHaveBeenCalled();
  });
});

function applicationMock() {
  return {
    set: vi.fn(),
    useBodyParser: vi.fn(),
    use: vi.fn(),
    useGlobalFilters: vi.fn(),
    useWebSocketAdapter: vi.fn(),
    enableShutdownHooks: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
