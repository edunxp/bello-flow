import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type ConnectionResult = {
  database: string;
  user: string;
  value: number;
};

describe('PrismaService (integration)', () => {
  let context: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    context = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await context.init();
    prisma = context.get(PrismaService);
  });

  afterAll(async () => {
    await context.close();
  });

  it('receives no administrative database credentials', () => {
    const administrativeVariables = [
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'BELLO_DEV_MIGRATOR_PASSWORD',
      'BELLO_SHADOW_MIGRATOR_PASSWORD',
      'BELLO_TEST_APP_PASSWORD',
      'BELLO_TEST_MIGRATOR_PASSWORD',
      'MIGRATION_DATABASE_URL',
      'SHADOW_DATABASE_URL',
    ];

    for (const variable of administrativeVariables) {
      expect(process.env[variable]).toBeUndefined();
    }
  });

  it('connects with the operational role and executes parameterized SQL', async () => {
    const value = 1;
    const result = await prisma.$queryRaw<ConnectionResult[]>`
      SELECT
        current_database() AS database,
        current_user AS "user",
        ${value}::integer AS value
    `;

    expect(result).toEqual([
      {
        database: 'bello_dev',
        user: 'bello_dev_app',
        value,
      },
    ]);
  });
});
