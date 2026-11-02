import { Test } from '@nestjs/testing';
import { BootstrapCliModule } from './bootstrap-cli.module.js';
import { BootstrapCliRunner } from './bootstrap-cli.runner.js';
import { BootstrapPostgresProvider } from './bootstrap-postgres.provider.js';
import { BootstrapReconciliationRunner } from './bootstrap-reconciliation.runner.js';
import { BootstrapTerminal } from './bootstrap-terminal.js';

describe('BootstrapCliModule', () => {
  const originalBootstrapUrl = process.env.BOOTSTRAP_DATABASE_URL;

  afterEach(() => {
    if (originalBootstrapUrl === undefined) {
      delete process.env.BOOTSTRAP_DATABASE_URL;
    } else {
      process.env.BOOTSTRAP_DATABASE_URL = originalBootstrapUrl;
    }
  });

  it('builds an isolated non-HTTP application context', async () => {
    process.env.BOOTSTRAP_DATABASE_URL =
      'postgresql://bootstrap.example.invalid/bello';
    const context = await Test.createTestingModule({
      imports: [BootstrapCliModule],
    }).compile();

    expect(context.get(BootstrapCliRunner)).toBeInstanceOf(BootstrapCliRunner);
    expect(context.get(BootstrapReconciliationRunner)).toBeInstanceOf(
      BootstrapReconciliationRunner,
    );
    expect(context.get(BootstrapPostgresProvider)).toBeInstanceOf(
      BootstrapPostgresProvider,
    );
    expect(context.get(BootstrapTerminal)).toBeInstanceOf(BootstrapTerminal);

    await context.close();
  });
});
