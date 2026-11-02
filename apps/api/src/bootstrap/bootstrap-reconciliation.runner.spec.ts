import {
  BootstrapPostgresProvider,
  BootstrapReconciliationCloseError,
} from './bootstrap-postgres.provider.js';
import { BootstrapReconciliationRunner } from './bootstrap-reconciliation.runner.js';
import { BootstrapTerminal } from './bootstrap-terminal.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const completedOperationId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const terminal = {
    writeLine: vi.fn((message = '') => stdout.push(message)),
    writeError: vi.fn((message: string) => stderr.push(message)),
  };
  const postgres = {
    reconcileBootstrap: vi.fn(),
  };
  return {
    runner: new BootstrapReconciliationRunner(
      terminal as unknown as BootstrapTerminal,
      postgres as unknown as BootstrapPostgresProvider,
    ),
    postgres,
    stdout,
    stderr,
  };
}

describe('BootstrapReconciliationRunner', () => {
  it.each(['invalid', '', '11111111-1111-3111-8111-111111111111'])(
    'rejects invalid operation_id %s without connecting',
    async (value) => {
      const test = fixture();

      await expect(test.runner.run(value)).resolves.toBe(1);
      expect(test.postgres.reconcileBootstrap).not.toHaveBeenCalled();
      expect(test.stderr.join('\n')).toContain('UUID v4');
    },
  );

  it.each([
    ['COMPLETED', 0],
    ['ALREADY_COMPLETED', 0],
    ['INCONSISTENT', 2],
    ['UNKNOWN', 2],
  ] as const)('reports %s with exit code %i', async (status, exitCode) => {
    const test = fixture();
    test.postgres.reconcileBootstrap.mockResolvedValue({
      status,
      operationId,
      ...(status === 'COMPLETED' || status === 'ALREADY_COMPLETED'
        ? { completedOperationId, accountId }
        : {}),
    });

    await expect(test.runner.run(operationId)).resolves.toBe(exitCode);
    expect(test.postgres.reconcileBootstrap).toHaveBeenCalledOnce();
    expect([...test.stdout, ...test.stderr].join('\n')).toContain(status);
  });

  it('preserves a conclusive result when connection cleanup fails', async () => {
    const test = fixture();
    test.postgres.reconcileBootstrap.mockRejectedValue(
      new BootstrapReconciliationCloseError(
        {
          status: 'COMPLETED',
          operationId,
          completedOperationId: operationId,
          accountId,
        },
        { cause: new Error('close failed') },
      ),
    );

    await expect(test.runner.run(operationId)).resolves.toBe(2);
    expect(test.stdout.join('\n')).toContain('COMPLETED');
    expect(test.stderr.join('\n')).toContain('encerrar a conexão');
  });

  it('handles an unexpected provider failure without exposing details', async () => {
    const test = fixture();
    test.postgres.reconcileBootstrap.mockRejectedValue(
      new Error('secret connection detail'),
    );

    await expect(test.runner.run(operationId)).resolves.toBe(2);
    expect(test.stderr.join('\n')).toContain('UNKNOWN');
    expect(test.stderr.join('\n')).not.toContain('secret connection detail');
  });

  it('handles an unexpected validation failure conservatively', async () => {
    const test = fixture();
    const value = {
      toString() {
        throw new Error('validation failed');
      },
    };

    await expect(test.runner.run(value as unknown as string)).resolves.toBe(1);
    expect(test.stderr.join('\n')).toContain('validar');
  });
});
