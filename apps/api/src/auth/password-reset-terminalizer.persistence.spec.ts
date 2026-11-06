import type { PrismaService } from '../prisma/prisma.service.js';
import { PasswordResetTerminalizerPersistence } from './password-reset-terminalizer.persistence.js';

const operationId = '00000000-0000-4000-8000-000000000081';
function harness(results: unknown[][]) {
  const queryRaw = vi.fn();
  for (const result of results) queryRaw.mockResolvedValueOnce(result);
  const executeRaw = vi.fn().mockResolvedValue(0);
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  );
  return {
    persistence: new PasswordResetTerminalizerPersistence({
      $queryRaw: queryRaw,
      $transaction: transaction,
    } as unknown as PrismaService),
    queryRaw,
    executeRaw,
    transaction,
  };
}

describe('PasswordResetTerminalizerPersistence', () => {
  it.each(['CANDIDATE', 'INCONSISTENT'] as const)(
    'maps %s selection with UUID',
    async (outcome) => {
      await expect(
        harness([
          [{ outcome, resetOperationId: operationId }],
        ]).persistence.find(),
      ).resolves.toEqual({ outcome, resetOperationId: operationId });
    },
  );
  it('maps the only valid idle row', async () => {
    await expect(
      harness([
        [{ outcome: 'NO_CANDIDATE', resetOperationId: null }],
      ]).persistence.find(),
    ).resolves.toEqual({ outcome: 'NO_CANDIDATE', resetOperationId: null });
  });
  it.each([
    [{ outcome: 'NO_CANDIDATE', resetOperationId: operationId }],
    [{ outcome: 'CANDIDATE', resetOperationId: null }],
    [{ outcome: 'OTHER', resetOperationId: null }],
  ])('rejects an expanded or malformed selection', async (row) => {
    await expect(harness([[row]]).persistence.find()).rejects.toThrow(
      'INVALID_TERMINALIZER_SELECTION',
    );
  });
  it('maps the boolean inconsistency probe', async () => {
    const subject = harness([[{ result: true }]]);
    await expect(subject.persistence.hasInconsistent()).resolves.toBe(true);
    expect(subject.executeRaw).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['TERMINALIZED', 'TERMINALIZED'],
    ['NOT_ELIGIBLE', 'LOST_RACE'],
    ['ALREADY_TERMINAL', 'ALREADY_TERMINAL'],
    ['NOT_OBSERVED', 'INDETERMINATE'],
    ['INCONSISTENT', 'INCONSISTENT'],
    ['OTHER', 'INDETERMINATE'],
  ] as const)('maps database outcome %s to %s', async (database, expected) => {
    const subject = harness([[{ outcome: database }]]);
    await expect(subject.persistence.terminalize(operationId)).resolves.toBe(
      expected,
    );
    expect(subject.executeRaw).toHaveBeenCalledTimes(2);
  });
  it('does not send malformed identifiers', async () => {
    const subject = harness([]);
    await expect(subject.persistence.terminalize('bad')).resolves.toBe(
      'INDETERMINATE',
    );
    expect(subject.transaction).not.toHaveBeenCalled();
  });
  it.each([
    ['NOT_FOUND', 'TERMINALIZED'],
    ['COMPLETED', 'LOST_RACE'],
    ['REJECTED', 'LOST_RACE'],
    ['INCONSISTENT', 'INCONSISTENT'],
    ['UNKNOWN', 'INDETERMINATE'],
  ] as const)(
    'reconciles an indeterminate connection as %s',
    async (observed, expected) => {
      const subject = harness([[{ outcome: observed }]]);
      subject.transaction.mockRejectedValueOnce(
        Object.assign(new Error('lost'), { code: '08006' }),
      );
      await expect(subject.persistence.terminalize(operationId)).resolves.toBe(
        expected,
      );
      expect(subject.transaction).toHaveBeenCalledTimes(2);
      expect(subject.executeRaw).toHaveBeenCalledTimes(2);
    },
  );

  it('applies both timeouts to observational selection', async () => {
    const subject = harness([
      [{ outcome: 'NO_CANDIDATE', resetOperationId: null }],
    ]);
    await subject.persistence.find();
    expect(subject.transaction).toHaveBeenCalledOnce();
    expect(subject.executeRaw).toHaveBeenCalledTimes(2);
  });

  it('retries a serialization rollback within the approved bound', async () => {
    const subject = harness([[{ outcome: 'TERMINALIZED' }]]);
    subject.transaction.mockRejectedValueOnce(
      Object.assign(new Error('serialization'), { sqlState: '40001' }),
    );
    await expect(subject.persistence.terminalize(operationId)).resolves.toBe(
      'TERMINALIZED',
    );
    expect(subject.transaction).toHaveBeenCalledTimes(2);
  });

  it('classifies a confirmed PostgreSQL rollback as infrastructure failure', async () => {
    const subject = harness([]);
    subject.transaction.mockRejectedValue(
      Object.assign(new Error('raised'), { originalCode: 'P0001' }),
    );
    await expect(subject.persistence.terminalize(operationId)).resolves.toBe(
      'INFRASTRUCTURE_ERROR',
    );
    expect(subject.transaction).toHaveBeenCalledOnce();
  });
});
