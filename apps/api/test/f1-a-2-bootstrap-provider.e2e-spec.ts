import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import {
  BootstrapInitialAdminParameters,
  BootstrapPostgresProvider,
} from '../src/bootstrap/bootstrap-postgres.provider.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function createMigrator(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
    }),
  });
}

function bootstrapParameters(): BootstrapInitialAdminParameters {
  return {
    operationId: randomUUID(),
    accountId: randomUUID(),
    accountEventId: randomUUID(),
    roleEventId: randomUUID(),
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada.bootstrap@example.com',
    passwordHash: validPasswordHash,
    operatorReference: 'operator-f1a2',
    authorizationReference: 'authorization-f1a2',
    installationReference: 'installation-f1a2',
  };
}

describe('F1-A.2 bootstrap PostgreSQL provider', () => {
  const migrator = createMigrator();

  async function resetTestData(): Promise<void> {
    if (process.env.BELLO_EPHEMERAL_TEST_DATABASE !== 'true') {
      throw new Error('F1-A.2 tests require an explicitly ephemeral database');
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
      throw new Error('F1-A.2 cleanup is restricted to bello_test_migrator');
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

  async function waitForBootstrapStateLock(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [lock] = await migrator.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::integer AS count
        FROM pg_catalog.pg_locks
        WHERE relation = 'public.bootstrap_state'::regclass
          AND mode = 'RowShareLock'
          AND granted
      `;
      if ((lock?.count ?? 0) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('bootstrap did not acquire the state lock in time');
  }

  beforeAll(async () => {
    await migrator.$connect();
    await resetTestData();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await resetTestData();
    await migrator.$disconnect();
  });

  it('creates the complete initial administrator atomically through the bootstrap role', async () => {
    const parameters = bootstrapParameters();
    const provider = new BootstrapPostgresProvider();

    await expect(provider.executeBootstrap(parameters)).resolves.toEqual({
      outcome: 'COMPLETED',
      createdAccountId: parameters.accountId,
      completedOperationId: parameters.operationId,
    });

    await expect(
      migrator.account.findUnique({ where: { id: parameters.accountId } }),
    ).resolves.toMatchObject({
      id: parameters.accountId,
      email: parameters.email,
      emailVerifiedAt: expect.any(Date),
      status: 'ACTIVE',
    });
    await expect(
      migrator.passwordCredential.findUnique({
        where: { accountId: parameters.accountId },
      }),
    ).resolves.toMatchObject({
      accountId: parameters.accountId,
      passwordHash: parameters.passwordHash,
    });
    await expect(migrator.globalRoleAssignment.findMany()).resolves.toEqual([
      expect.objectContaining({
        accountId: parameters.accountId,
        role: 'GLOBAL_ADMIN',
      }),
    ]);
    await expect(
      migrator.auditEvent.findMany({ orderBy: { sequence: 'asc' } }),
    ).resolves.toMatchObject([
      { operation: 'ACCOUNT_CREATED', sequence: 1 },
      { operation: 'GLOBAL_ADMIN_GRANTED', sequence: 2 },
    ]);
    await expect(
      migrator.bootstrapState.findUnique({ where: { singletonId: 1 } }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      initialAccountId: parameters.accountId,
      operationId: parameters.operationId,
    });
  });

  it('preserves the database rejection on reexecution', async () => {
    await new BootstrapPostgresProvider().executeBootstrap(
      bootstrapParameters(),
    );

    await expect(
      new BootstrapPostgresProvider().executeBootstrap(bootstrapParameters()),
    ).rejects.toMatchObject({
      code: 'P0001',
      message: 'BF_BOOTSTRAP_ALREADY_COMPLETED',
    });
    expect(await migrator.account.count()).toBe(1);
    expect(await migrator.auditEvent.count()).toBe(2);
  });

  it('serializes two independent provider connections without retrying', async () => {
    const results = await Promise.allSettled([
      new BootstrapPostgresProvider().executeBootstrap(bootstrapParameters()),
      new BootstrapPostgresProvider().executeBootstrap(bootstrapParameters()),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(await migrator.account.count()).toBe(1);
    expect(await migrator.globalRoleAssignment.count()).toBe(1);
    expect(await migrator.auditEvent.count()).toBe(2);
  });

  it('cannot use the bootstrap credential for direct DML', async () => {
    const client = new Client({
      connectionString: requiredUrl('BOOTSTRAP_DATABASE_URL'),
      connectionTimeoutMillis: 5_000,
    });
    await client.connect();

    try {
      await expect(
        client.query(
          `UPDATE public.bootstrap_state
           SET status = 'COMPLETED'
           WHERE singleton_id = 1`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.end();
    }
  });

  it('retains only execute and reconciliation reads for the bootstrap role', async () => {
    const [functionPrivilege] = await migrator.$queryRaw<{ value: boolean }[]>`
      SELECT has_function_privilege(
        'bello_bootstrap_executor',
        'public.bootstrap_initial_admin(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) AS value
    `;
    const tablePrivileges = await migrator.$queryRaw<
      {
        tableName: string;
        insert: boolean;
        update: boolean;
        delete: boolean;
        truncate: boolean;
      }[]
    >`
      SELECT
        table_name AS "tableName",
        has_table_privilege(
          'bello_bootstrap_executor', 'public.' || table_name, 'INSERT'
        ) AS insert,
        has_table_privilege(
          'bello_bootstrap_executor', 'public.' || table_name, 'UPDATE'
        ) AS update,
        has_table_privilege(
          'bello_bootstrap_executor', 'public.' || table_name, 'DELETE'
        ) AS delete,
        has_table_privilege(
          'bello_bootstrap_executor', 'public.' || table_name, 'TRUNCATE'
        ) AS truncate
      FROM unnest(ARRAY[
        'account',
        'password_credential',
        'global_role_assignment',
        'bootstrap_state',
        'audit_event'
      ]) AS table_name
      ORDER BY table_name
    `;

    expect(functionPrivilege?.value).toBe(true);
    expect(tablePrivileges).toEqual(
      tablePrivileges.map(({ tableName }) => ({
        tableName,
        insert: false,
        update: false,
        delete: false,
        truncate: false,
      })),
    );
  });

  it('reconciles a clean pending state as UNKNOWN without creating data', async () => {
    const operationId = randomUUID();

    await expect(
      new BootstrapPostgresProvider().reconcileBootstrap(operationId),
    ).resolves.toEqual({ status: 'UNKNOWN', operationId });
    expect(await migrator.account.count()).toBe(0);
    expect(await migrator.globalRoleAssignment.count()).toBe(0);
    expect(await migrator.auditEvent.count()).toBe(0);
  });

  it('reconciles consistent completion for the same and another operation', async () => {
    const parameters = bootstrapParameters();
    await new BootstrapPostgresProvider().executeBootstrap(parameters);

    await expect(
      new BootstrapPostgresProvider().reconcileBootstrap(
        parameters.operationId,
      ),
    ).resolves.toEqual({
      status: 'COMPLETED',
      operationId: parameters.operationId,
      completedOperationId: parameters.operationId,
      accountId: parameters.accountId,
    });

    const otherOperationId = randomUUID();
    await expect(
      new BootstrapPostgresProvider().reconcileBootstrap(otherOperationId),
    ).resolves.toEqual({
      status: 'ALREADY_COMPLETED',
      operationId: otherOperationId,
      completedOperationId: parameters.operationId,
      accountId: parameters.accountId,
    });
  });

  it('detects contradictory persisted audit evidence', async () => {
    const parameters = bootstrapParameters();
    await new BootstrapPostgresProvider().executeBootstrap(parameters);
    await migrator.auditEvent.delete({
      where: {
        operationId_sequence: {
          operationId: parameters.operationId,
          sequence: 2,
        },
      },
    });

    await expect(
      new BootstrapPostgresProvider().reconcileBootstrap(
        parameters.operationId,
      ),
    ).resolves.toMatchObject({
      status: 'INCONSISTENT',
      operationId: parameters.operationId,
    });
  });

  it('returns UNKNOWN while bootstrap owns the state lock, then confirms completion', async () => {
    const blocker = new Client({
      connectionString: requiredUrl('MIGRATION_DATABASE_URL'),
      connectionTimeoutMillis: 5_000,
    });
    const parameters = bootstrapParameters();
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query(
      'LOCK TABLE public.password_credential IN ACCESS EXCLUSIVE MODE',
    );

    const bootstrap = new BootstrapPostgresProvider().executeBootstrap(
      parameters,
    );
    try {
      await waitForBootstrapStateLock();
      await expect(
        new BootstrapPostgresProvider().reconcileBootstrap(
          parameters.operationId,
        ),
      ).resolves.toEqual({
        status: 'UNKNOWN',
        operationId: parameters.operationId,
      });
    } finally {
      await blocker.query('COMMIT');
      await blocker.end();
    }

    await expect(bootstrap).resolves.toMatchObject({ outcome: 'COMPLETED' });
    await expect(
      new BootstrapPostgresProvider().reconcileBootstrap(
        parameters.operationId,
      ),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      operationId: parameters.operationId,
    });
  }, 15_000);
});
