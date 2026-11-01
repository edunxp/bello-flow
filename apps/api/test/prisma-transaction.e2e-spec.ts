import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type ConnectionResult = {
  database: string;
  user: string;
  canCreate: boolean;
};

type ProbeRow = {
  step: number;
};

describe('PrismaService transactions (integration)', () => {
  let context: TestingModule;
  let prisma: PrismaService;
  const runIds = new Set<string>();

  beforeAll(async () => {
    context = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await context.init();
    prisma = context.get(PrismaService);

    const [connection] = await prisma.$queryRaw<ConnectionResult[]>`
      SELECT
        current_database() AS database,
        current_user AS "user",
        has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreate"
    `;

    expect(connection).toEqual({
      database: 'bello_test',
      user: 'bello_test_app',
      canCreate: false,
    });
  });

  afterEach(async () => {
    for (const runId of runIds) {
      await prisma.$executeRaw`
        DELETE FROM public._f022c_transaction_probe
        WHERE run_id = ${runId}
      `;
    }
    runIds.clear();
  });

  afterAll(async () => {
    await context.close();
  });

  it('commits both writes atomically', async () => {
    const runId = randomUUID();
    runIds.add(runId);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO public._f022c_transaction_probe (run_id, step)
        VALUES (${runId}, ${1})
      `;
      await tx.$executeRaw`
        INSERT INTO public._f022c_transaction_probe (run_id, step)
        VALUES (${runId}, ${2})
      `;
    });

    const rows = await prisma.$queryRaw<ProbeRow[]>`
      SELECT step
      FROM public._f022c_transaction_probe
      WHERE run_id = ${runId}
      ORDER BY step
    `;

    expect(rows).toEqual([{ step: 1 }, { step: 2 }]);
  });

  it('rolls back both writes after the expected error', async () => {
    const runId = randomUUID();
    const rollbackMessage = `intentional rollback ${runId}`;
    runIds.add(runId);

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO public._f022c_transaction_probe (run_id, step)
          VALUES (${runId}, ${1})
        `;
        await tx.$executeRaw`
          INSERT INTO public._f022c_transaction_probe (run_id, step)
          VALUES (${runId}, ${2})
        `;

        const rows = await tx.$queryRaw<ProbeRow[]>`
          SELECT step
          FROM public._f022c_transaction_probe
          WHERE run_id = ${runId}
          ORDER BY step
        `;
        expect(rows).toEqual([{ step: 1 }, { step: 2 }]);

        throw new Error(rollbackMessage);
      }),
    ).rejects.toThrow(rollbackMessage);

    const rows = await prisma.$queryRaw<ProbeRow[]>`
      SELECT step
      FROM public._f022c_transaction_probe
      WHERE run_id = ${runId}
    `;

    expect(rows).toEqual([]);
  });
});
