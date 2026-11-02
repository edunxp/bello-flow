import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const testPassword = 'valid bootstrap password 🚀';

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function cliEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.MIGRATION_DATABASE_URL;
  delete environment.MAINTENANCE_DATABASE_URL;
  return environment;
}

function runInteractiveCli(email: string): Promise<{
  code: number | null;
  output: string;
}> {
  const interactions = [
    ['Nome: ', 'Ada\r'],
    ['Sobrenome: ', 'Lovelace\r'],
    ['E-mail: ', `${email}\r`],
    ['Referência do operador: ', 'operator-cli-e2e\r'],
    ['Referência da autorização: ', 'authorization-cli-e2e\r'],
    ['Referência da instalação: ', 'installation-cli-e2e\r'],
    ['Senha: ', `${testPassword}\r`],
    ['Confirme a senha: ', `${testPassword}\r`],
    ['Digite CONFIRMAR para executar a operação: ', 'CONFIRMAR\r'],
  ] as const;

  return new Promise((resolve, reject) => {
    const command = 'node dist/bootstrap/bootstrap-cli.main.js';
    const child = spawn('script', ['-qfec', command, '/dev/null'], {
      cwd: process.cwd(),
      env: cliEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let interactionIndex = 0;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(
        new Error(
          `CLI did not finish after interaction ${interactionIndex} of ${interactions.length}`,
        ),
      );
    }, 15_000);
    const receive = (chunk: Buffer) => {
      output += chunk.toString();
      const interaction = interactions[interactionIndex];
      if (interaction && output.includes(interaction[0])) {
        interactionIndex += 1;
        if (interactionIndex === interactions.length) {
          child.stdin.end(interaction[1]);
        } else {
          child.stdin.write(interaction[1]);
        }
      }
    };

    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

function runReconciliationCli(operationId: string): Promise<{
  code: number | null;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['dist/bootstrap/bootstrap-cli.main.js', 'reconcile', operationId],
      {
        cwd: process.cwd(),
        env: cliEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

describe('F1-A.2 administrative bootstrap CLI', () => {
  const migrator = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
    }),
  });

  async function resetTestData(): Promise<void> {
    if (process.env.BELLO_EPHEMERAL_TEST_DATABASE !== 'true') {
      throw new Error('CLI tests require an explicitly ephemeral database');
    }
    const [identity] = await migrator.$queryRaw<
      { database: string; user: string }[]
    >`
      SELECT current_database() AS database, current_user AS "user"
    `;
    if (
      identity?.database !== 'bello_test' ||
      identity.user !== 'bello_test_migrator'
    ) {
      throw new Error('CLI cleanup is restricted to bello_test_migrator');
    }

    await migrator.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM public.audit_event`;
      await tx.$executeRaw`DELETE FROM public.global_role_assignment`;
      await tx.$executeRaw`DELETE FROM public.password_credential`;
      await tx.$executeRaw`
        UPDATE public.bootstrap_state
        SET status = 'PENDING',
            initial_account_id = NULL,
            operation_id = NULL,
            completed_at = NULL
        WHERE singleton_id = 1
      `;
      await tx.$executeRaw`DELETE FROM public.account`;
    });
  }

  beforeAll(async () => {
    await migrator.$connect();
    await resetTestData();
  });

  afterAll(async () => {
    await resetTestData();
    await migrator.$disconnect();
  });

  it('runs the complete interactive CLI and rejects reexecution', async () => {
    const pendingOperationId = randomUUID();
    const pendingReconciliation =
      await runReconciliationCli(pendingOperationId);
    expect(pendingReconciliation.code).toBe(2);
    expect(pendingReconciliation.output).toContain('Reconciliação: UNKNOWN.');
    expect(pendingReconciliation.output).not.toContain('Senha:');
    expect(await migrator.account.count()).toBe(0);

    const first = await runInteractiveCli('admin.cli@example.com');

    expect(first.code).toBe(0);
    expect(first.output).toContain(
      'Primeiro Administrador Global criado com sucesso.',
    );
    expect(first.output).toMatch(/operation_id: [0-9a-f-]{36}/);
    expect(first.output).not.toContain(testPassword);
    expect(await migrator.account.count()).toBe(1);
    expect(await migrator.passwordCredential.count()).toBe(1);
    expect(await migrator.globalRoleAssignment.count()).toBe(1);
    expect(await migrator.auditEvent.count()).toBe(2);

    const operationId = first.output.match(
      /operation_id: ([0-9a-f-]{36})/,
    )?.[1];
    expect(operationId).toBeDefined();

    const reconciliation = await runReconciliationCli(operationId!);
    expect(reconciliation.code).toBe(0);
    expect(reconciliation.output).toContain('Reconciliação: COMPLETED.');
    expect(reconciliation.output).toContain(`account_id inicial:`);
    expect(reconciliation.output).not.toContain('Senha:');
    expect(reconciliation.output).not.toContain(testPassword);

    const otherOperationId = randomUUID();
    const otherReconciliation = await runReconciliationCli(otherOperationId);
    expect(otherReconciliation.code).toBe(0);
    expect(otherReconciliation.output).toContain(
      'Reconciliação: ALREADY_COMPLETED.',
    );
    expect(otherReconciliation.output).toContain(
      'a tentativa consultada não criou o administrador',
    );

    const invalidReconciliation = await runReconciliationCli('invalid');
    expect(invalidReconciliation.code).not.toBe(0);
    expect(invalidReconciliation.output).toContain('operation_id inválido');

    const second = await runInteractiveCli('second.cli@example.com');

    expect(second.code).not.toBe(0);
    expect(second.output).toContain('O bootstrap já foi concluído.');
    expect(second.output).not.toContain(testPassword);
    expect(await migrator.account.count()).toBe(1);
    expect(await migrator.auditEvent.count()).toBe(2);
  }, 30_000);
});
