import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { BootstrapCliModule } from './bootstrap-cli.module.js';
import { BootstrapCliRunner } from './bootstrap-cli.runner.js';
import { BootstrapReconciliationRunner } from './bootstrap-reconciliation.runner.js';

export async function runBootstrapCli(
  arguments_: string[] = process.argv.slice(2),
): Promise<number> {
  let context: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;

  try {
    context = await NestFactory.createApplicationContext(BootstrapCliModule, {
      logger: false,
    });
  } catch {
    process.stderr.write(
      'Não foi possível inicializar o contexto administrativo de bootstrap.\n',
    );
    return 1;
  }

  let exitCode = 1;
  try {
    if (arguments_.length === 0) {
      exitCode = await context.get(BootstrapCliRunner).run();
    } else if (arguments_.length === 2 && arguments_[0] === 'reconcile') {
      exitCode = await context
        .get(BootstrapReconciliationRunner)
        .run(arguments_[1]!);
    } else {
      process.stderr.write(
        'Uso: bootstrap:admin ou bootstrap:admin -- reconcile <operation_id>\n',
      );
    }
  } catch {
    process.stderr.write('Falha interna na execução administrativa.\n');
  } finally {
    try {
      await context.close();
    } catch {
      process.stderr.write('Falha ao encerrar o contexto administrativo.\n');
      exitCode = 1;
    }
  }

  return exitCode;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = await runBootstrapCli();
}
