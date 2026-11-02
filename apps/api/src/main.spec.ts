const nestMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@nestjs/core', () => ({
  NestFactory: {
    create: nestMocks.create,
  },
}));

describe('API bootstrap', () => {
  const originalPort = process.env.PORT;

  beforeEach(() => {
    vi.resetModules();
    nestMocks.create.mockReset();
    delete process.env.PORT;
  });

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it('enables shutdown hooks and listens on the default address', async () => {
    const app = {
      enableShutdownHooks: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
    };
    nestMocks.create.mockResolvedValue(app);
    const { AppModule } = await import('./app.module.js');

    await import('./main.js');

    expect(nestMocks.create).toHaveBeenCalledWith(AppModule);
    expect(app.enableShutdownHooks).toHaveBeenCalledOnce();
    expect(app.listen).toHaveBeenCalledWith(13000, '127.0.0.1');
  });

  it('uses the configured port', async () => {
    const app = {
      enableShutdownHooks: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
    };
    nestMocks.create.mockResolvedValue(app);
    process.env.PORT = '14000';

    await import('./main.js');

    expect(app.listen).toHaveBeenCalledWith('14000', '127.0.0.1');
  });
});
