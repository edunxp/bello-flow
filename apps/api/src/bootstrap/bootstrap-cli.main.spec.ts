const nestMocks = vi.hoisted(() => ({
  createApplicationContext: vi.fn(),
}));

vi.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: nestMocks.createApplicationContext,
  },
}));

import { BootstrapCliRunner } from './bootstrap-cli.runner.js';
import { runBootstrapCli } from './bootstrap-cli.main.js';
import { BootstrapCliModule } from './bootstrap-cli.module.js';
import { BootstrapReconciliationRunner } from './bootstrap-reconciliation.runner.js';

describe('bootstrap CLI entrypoint', () => {
  const originalArgv = [...process.argv];
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    nestMocks.createApplicationContext.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv.splice(0, process.argv.length, ...originalArgv);
    process.exitCode = originalExitCode;
  });

  it('uses an application context without HTTP and always closes it', async () => {
    const runner = { run: vi.fn().mockResolvedValue(0) };
    const context = {
      get: vi.fn().mockReturnValue(runner),
      close: vi.fn().mockResolvedValue(undefined),
    };
    nestMocks.createApplicationContext.mockResolvedValue(context);

    await expect(runBootstrapCli([])).resolves.toBe(0);
    expect(nestMocks.createApplicationContext).toHaveBeenCalledWith(
      BootstrapCliModule,
      { logger: false },
    );
    expect(context.get).toHaveBeenCalledWith(BootstrapCliRunner);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('dispatches the explicit reconciliation command', async () => {
    const reconciliation = { run: vi.fn().mockResolvedValue(0) };
    const context = {
      get: vi.fn().mockReturnValue(reconciliation),
      close: vi.fn().mockResolvedValue(undefined),
    };
    nestMocks.createApplicationContext.mockResolvedValue(context);

    await expect(
      runBootstrapCli(['reconcile', '11111111-1111-4111-8111-111111111111']),
    ).resolves.toBe(0);
    expect(context.get).toHaveBeenCalledWith(BootstrapReconciliationRunner);
    expect(reconciliation.run).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('rejects unsupported arguments without running a command', async () => {
    const context = {
      get: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    nestMocks.createApplicationContext.mockResolvedValue(context);
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await expect(runBootstrapCli(['unsupported'])).resolves.toBe(1);
    expect(context.get).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Uso:'));
  });

  it('closes the context when the runner fails', async () => {
    const context = {
      get: vi.fn().mockReturnValue({
        run: vi.fn().mockRejectedValue(new Error('runner failed')),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    nestMocks.createApplicationContext.mockResolvedValue(context);
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await expect(runBootstrapCli([])).resolves.toBe(1);
    expect(context.close).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith(
      'Falha interna na execução administrativa.\n',
    );
  });

  it('returns failure when the Nest context cannot start', async () => {
    nestMocks.createApplicationContext.mockRejectedValue(
      new Error('context failed'),
    );
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await expect(runBootstrapCli([])).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      'Não foi possível inicializar o contexto administrativo de bootstrap.\n',
    );
  });

  it('returns failure when context cleanup fails', async () => {
    const context = {
      get: vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue(0) }),
      close: vi.fn().mockRejectedValue(new Error('close failed')),
    };
    nestMocks.createApplicationContext.mockResolvedValue(context);
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await expect(runBootstrapCli([])).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      'Falha ao encerrar o contexto administrativo.\n',
    );
  });

  it('runs when loaded as the process entrypoint', async () => {
    const context = {
      get: vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue(0) }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    nestMocks.createApplicationContext.mockResolvedValue(context);
    process.argv[1] = fileURLToPath(
      new URL('./bootstrap-cli.main.ts', import.meta.url),
    );
    process.argv.splice(2);
    vi.resetModules();

    await import('./bootstrap-cli.main.js');

    expect(process.exitCode).toBe(0);
    expect(context.close).toHaveBeenCalledOnce();
  });
});
import { fileURLToPath } from 'node:url';
