import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

type BootstrapInput = {
  operationId: string;
  accountId: string;
  accountEventId: string;
  roleEventId: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  operatorReference: string | null;
  authorizationReference: string | null;
  installationReference: string | null;
};

type BootstrapResult = {
  outcome: string;
  createdAccountId: string;
  completedOperationId: string;
};

type BooleanResult = { value: boolean };
type CountResult = { value: bigint };

const validPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function createClient(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
}

function bootstrapInput(
  overrides: Partial<BootstrapInput> = {},
): BootstrapInput {
  return {
    operationId: randomUUID(),
    accountId: randomUUID(),
    accountEventId: randomUUID(),
    roleEventId: randomUUID(),
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'Ada.Lovelace+bootstrap@Example.COM',
    passwordHash: validPasswordHash,
    operatorReference: 'operator-f1a1',
    authorizationReference: 'authorization-f1a1',
    installationReference: 'installation-f1a1',
    ...overrides,
  };
}

async function callBootstrap(
  client: PrismaClient,
  input: BootstrapInput,
): Promise<BootstrapResult[]> {
  return client.$queryRaw<BootstrapResult[]>`
    SELECT
      outcome,
      created_account_id AS "createdAccountId",
      completed_operation_id AS "completedOperationId"
    FROM public.bootstrap_initial_admin(
      ${input.operationId}::uuid,
      ${input.accountId}::uuid,
      ${input.accountEventId}::uuid,
      ${input.roleEventId}::uuid,
      ${input.firstName}::text,
      ${input.lastName}::text,
      ${input.email}::text,
      ${input.passwordHash}::text,
      ${input.operatorReference}::text,
      ${input.authorizationReference}::text,
      ${input.installationReference}::text
    )
  `;
}

describe('F1-A.1 physical identity foundation (PostgreSQL)', () => {
  const runtime = createClient(requiredUrl('DATABASE_URL'));
  const bootstrap = createClient(requiredUrl('BOOTSTRAP_DATABASE_URL'));
  const bootstrapConcurrent = createClient(
    requiredUrl('BOOTSTRAP_DATABASE_URL'),
  );
  const migrator = createClient(requiredUrl('MIGRATION_DATABASE_URL'));
  const maintenance = createClient(requiredUrl('MAINTENANCE_DATABASE_URL'));

  async function resetTestData(): Promise<void> {
    const [identity] = await migrator.$queryRaw<
      { database: string; user: string }[]
    >`
      SELECT current_database() AS database, current_user AS "user"
    `;

    if (
      identity?.database !== 'bello_test' ||
      identity.user !== 'bello_test_migrator'
    ) {
      throw new Error('F1-A.1 cleanup is restricted to bello_test_migrator');
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
    await Promise.all([
      runtime.$connect(),
      bootstrap.$connect(),
      bootstrapConcurrent.$connect(),
      migrator.$connect(),
      maintenance.$connect(),
    ]);
    await resetTestData();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await resetTestData();
    await Promise.all([
      runtime.$disconnect(),
      bootstrap.$disconnect(),
      bootstrapConcurrent.$disconnect(),
      migrator.$disconnect(),
      maintenance.$disconnect(),
    ]);
  });

  it('creates exactly the singleton row in the pending state', async () => {
    const rows = await migrator.bootstrapState.findMany();

    expect(rows).toEqual([
      {
        singletonId: 1,
        status: 'PENDING',
        initialAccountId: null,
        operationId: null,
        completedAt: null,
      },
    ]);
  });

  it('creates the initial account, credential, role, audit events and completion atomically', async () => {
    const input = bootstrapInput({
      firstName: '  Ada  ',
      lastName: '  Lovelace  ',
      email: '  Ada.Lovelace+bootstrap@Example.COM  ',
    });

    const result = await callBootstrap(bootstrap, input);
    expect(result).toEqual([
      {
        outcome: 'COMPLETED',
        createdAccountId: input.accountId,
        completedOperationId: input.operationId,
      },
    ]);

    const account = await migrator.account.findUniqueOrThrow({
      where: { id: input.accountId },
    });
    expect(account).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada.Lovelace+bootstrap@Example.COM',
      emailKey: 'ada.lovelace+bootstrap@example.com',
      status: 'ACTIVE',
      deactivatedAt: null,
    });
    expect(account.emailVerifiedAt).toBeInstanceOf(Date);

    const credential = await migrator.passwordCredential.findUniqueOrThrow({
      where: { accountId: input.accountId },
    });
    expect(credential.passwordHash).toBe(validPasswordHash);

    expect(await migrator.globalRoleAssignment.findMany()).toEqual([
      {
        accountId: input.accountId,
        role: 'GLOBAL_ADMIN',
        grantedAt: expect.any(Date),
      },
    ]);

    const events = await migrator.auditEvent.findMany({
      orderBy: { sequence: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(
      events.map(({ operation, sequence, actorAccountId, operationId }) => ({
        operation,
        sequence,
        actorAccountId,
        operationId,
      })),
    ).toEqual([
      {
        operation: 'ACCOUNT_CREATED',
        sequence: 1,
        actorAccountId: null,
        operationId: input.operationId,
      },
      {
        operation: 'GLOBAL_ADMIN_GRANTED',
        sequence: 2,
        actorAccountId: null,
        operationId: input.operationId,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(input.email);
    expect(JSON.stringify(events)).not.toContain(input.passwordHash);

    expect(
      await migrator.bootstrapState.findUnique({ where: { singletonId: 1 } }),
    ).toMatchObject({
      status: 'COMPLETED',
      initialAccountId: input.accountId,
      operationId: input.operationId,
    });
  });

  it('rejects a second execution without changing the completed bootstrap', async () => {
    const first = bootstrapInput();
    await callBootstrap(bootstrap, first);

    await expect(callBootstrap(bootstrap, bootstrapInput())).rejects.toThrow(
      'BF_BOOTSTRAP_ALREADY_COMPLETED',
    );

    expect(await migrator.account.count()).toBe(1);
    expect(await migrator.auditEvent.count()).toBe(2);
    expect(
      await migrator.bootstrapState.findUnique({ where: { singletonId: 1 } }),
    ).toMatchObject({
      status: 'COMPLETED',
      initialAccountId: first.accountId,
      operationId: first.operationId,
    });
  });

  it('serializes concurrent executions and persists one administrator', async () => {
    const calls = await Promise.allSettled([
      callBootstrap(bootstrap, bootstrapInput()),
      callBootstrap(bootstrapConcurrent, bootstrapInput()),
    ]);

    expect(calls.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(calls.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await migrator.account.count()).toBe(1);
    expect(await migrator.globalRoleAssignment.count()).toBe(1);
    expect(await migrator.auditEvent.count()).toBe(2);
  });

  it('rolls back every write when the audit insertion fails', async () => {
    const duplicatedEventId = randomUUID();
    const input = bootstrapInput({
      accountEventId: duplicatedEventId,
      roleEventId: duplicatedEventId,
    });

    await expect(callBootstrap(bootstrap, input)).rejects.toThrow(
      'BF_BOOTSTRAP_FAILED',
    );

    expect(await migrator.account.count()).toBe(0);
    expect(await migrator.passwordCredential.count()).toBe(0);
    expect(await migrator.globalRoleAssignment.count()).toBe(0);
    expect(await migrator.auditEvent.count()).toBe(0);
    expect(
      await migrator.bootstrapState.findUnique({ where: { singletonId: 1 } }),
    ).toMatchObject({ status: 'PENDING', operationId: null });
  });

  it('rolls back every write when the credential violates the PHC constraint', async () => {
    await expect(
      callBootstrap(bootstrap, bootstrapInput({ passwordHash: 'not-a-phc' })),
    ).rejects.toThrow('BF_BOOTSTRAP_FAILED');

    expect(await migrator.account.count()).toBe(0);
    expect(await migrator.auditEvent.count()).toBe(0);
    expect(
      await migrator.bootstrapState.findUnique({ where: { singletonId: 1 } }),
    ).toMatchObject({ status: 'PENDING' });
  });

  it.each([
    ['operator reference is null', { operatorReference: null }],
    ['authorization reference is null', { authorizationReference: null }],
    ['installation reference is null', { installationReference: null }],
    [
      'all references are null',
      {
        operatorReference: null,
        authorizationReference: null,
        installationReference: null,
      },
    ],
    ['operator reference is empty', { operatorReference: '' }],
    ['authorization reference is spaces', { authorizationReference: '   ' }],
    [
      'installation reference contains a control',
      { installationReference: 'line\nbreak' },
    ],
    ['operator reference is too long', { operatorReference: 'o'.repeat(101) }],
    [
      'authorization reference is too long',
      { authorizationReference: 'a'.repeat(201) },
    ],
    [
      'installation reference is too long',
      { installationReference: 'i'.repeat(101) },
    ],
  ] satisfies [string, Partial<BootstrapInput>][])(
    'rejects invalid operational references: %s',
    async (_description, overrides) => {
      await expect(
        callBootstrap(bootstrap, bootstrapInput(overrides)),
      ).rejects.toThrow('BF_BOOTSTRAP_INVALID_REFERENCES');

      expect(await migrator.account.count()).toBe(0);
      expect(await migrator.passwordCredential.count()).toBe(0);
      expect(await migrator.globalRoleAssignment.count()).toBe(0);
      expect(await migrator.auditEvent.count()).toBe(0);
      expect(
        await migrator.bootstrapState.findUnique({
          where: { singletonId: 1 },
        }),
      ).toMatchObject({ status: 'PENDING', operationId: null });
    },
  );

  it('accepts trimmed operational references at their maximum lengths', async () => {
    const input = bootstrapInput({
      operatorReference: ` ${'o'.repeat(100)} `,
      authorizationReference: ` ${'a'.repeat(200)} `,
      installationReference: ` ${'i'.repeat(100)} `,
    });

    await expect(callBootstrap(bootstrap, input)).resolves.toHaveLength(1);

    const events = await migrator.auditEvent.findMany({
      orderBy: { sequence: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.context).toMatchObject({
      operator_reference: 'o'.repeat(100),
      authorization_reference: 'a'.repeat(200),
      installation_reference: 'i'.repeat(100),
    });
  });

  it('rejects inconsistent pending state with an existing global administrator', async () => {
    const accountId = randomUUID();
    await migrator.account.create({
      data: {
        id: accountId,
        firstName: 'Existing',
        lastName: 'Administrator',
        email: 'existing.admin@example.com',
        emailKey: 'existing.admin@example.com',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        createdAt: new Date(),
      },
    });
    await migrator.globalRoleAssignment.create({
      data: { accountId, role: 'GLOBAL_ADMIN', grantedAt: new Date() },
    });

    await expect(callBootstrap(bootstrap, bootstrapInput())).rejects.toThrow(
      'BF_BOOTSTRAP_STATE_INCONSISTENT',
    );
    expect(await migrator.account.count()).toBe(1);
    expect(await migrator.auditEvent.count()).toBe(0);
  });

  it.each([
    ['simple@example.com', 'simple@example.com'],
    ['User.Name+tag@Example.COM', 'user.name+tag@example.com'],
    ['user@xn--bcher-kva.example', 'user@xn--bcher-kva.example'],
  ])('accepts conventional ASCII email %s', async (email, emailKey) => {
    await migrator.account.create({
      data: {
        id: randomUUID(),
        firstName: 'Email',
        lastName: 'Positive',
        email,
        emailKey,
        status: 'ACTIVE',
        createdAt: new Date(),
      },
    });
    expect(await migrator.account.count()).toBe(1);
  });

  it.each([
    ' user@example.com',
    'user@example.com ',
    'user..name@example.com',
    '.user@example.com',
    'user.@example.com',
    'user@example',
    'user@[127.0.0.1]',
    '"user"@example.com',
    'usér@example.com',
  ])('rejects unsupported email %s', async (email) => {
    await expect(
      migrator.account.create({
        data: {
          id: randomUUID(),
          firstName: 'Email',
          lastName: 'Negative',
          email,
          emailKey: email.toLowerCase(),
          status: 'ACTIVE',
          createdAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a divergent email key', async () => {
    await expect(
      migrator.account.create({
        data: {
          id: randomUUID(),
          firstName: 'Email',
          lastName: 'Mismatch',
          email: 'User@example.com',
          emailKey: 'different@example.com',
          status: 'ACTIVE',
          createdAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces normalized email uniqueness under concurrency', async () => {
    const secondMigrator = createClient(requiredUrl('MIGRATION_DATABASE_URL'));
    await secondMigrator.$connect();

    try {
      const create = (client: PrismaClient, email: string) =>
        client.account.create({
          data: {
            id: randomUUID(),
            firstName: 'Concurrent',
            lastName: 'Email',
            email,
            emailKey: 'same@example.com',
            status: 'ACTIVE',
            createdAt: new Date(),
          },
        });

      const results = await Promise.allSettled([
        create(migrator, 'Same@Example.com'),
        create(secondMigrator, 'same@example.com'),
      ]);

      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      expect(await migrator.account.count()).toBe(1);
    } finally {
      await secondMigrator.$disconnect();
    }
  });

  it('enforces account, role, audit and singleton constraints', async () => {
    await expect(
      migrator.account.create({
        data: {
          id: randomUUID(),
          firstName: ' ',
          lastName: 'Invalid',
          email: 'invalid-name@example.com',
          emailKey: 'invalid-name@example.com',
          status: 'ACTIVE',
          createdAt: new Date(),
        },
      }),
    ).rejects.toThrow();

    await expect(
      migrator.globalRoleAssignment.create({
        data: {
          accountId: randomUUID(),
          role: 'GLOBAL_ADMIN',
          grantedAt: new Date(),
        },
      }),
    ).rejects.toThrow();

    await expect(
      migrator.auditEvent.create({
        data: {
          id: randomUUID(),
          occurredAt: new Date(),
          origin: 'TEST',
          scope: 'TEST',
          operation: 'TEST',
          result: 'FAILURE',
          entityType: 'ACCOUNT',
          correlationId: randomUUID(),
          operationId: randomUUID(),
          sequence: 0,
        },
      }),
    ).rejects.toThrow();

    await expect(
      migrator.bootstrapState.create({
        data: { singletonId: 2, status: 'PENDING' },
      }),
    ).rejects.toThrow();
  });

  it.each([
    ['UUID v1', '00000000-0000-1000-8000-000000000001'],
    [
      'UUID with a v4 nibble and non-RFC variant',
      '00000000-0000-4000-0000-000000000001',
    ],
    [
      'UUID whose version extraction is null',
      '00000000-0000-0000-0000-000000000001',
    ],
  ])('rejects an account %s', async (_description, id) => {
    await expect(
      migrator.account.create({
        data: {
          id,
          firstName: 'Invalid',
          lastName: 'Uuid',
          email: `${id}@example.com`,
          emailKey: `${id}@example.com`,
          status: 'ACTIVE',
          createdAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts UUID v4 and nullable optional UUID fields', async () => {
    const accountId = randomUUID();
    await expect(
      migrator.account.create({
        data: {
          id: accountId,
          firstName: 'Valid',
          lastName: 'Uuid',
          email: 'valid.uuid@example.com',
          emailKey: 'valid.uuid@example.com',
          status: 'ACTIVE',
          createdAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ id: accountId });

    await expect(
      migrator.auditEvent.create({
        data: {
          id: randomUUID(),
          occurredAt: new Date(),
          actorAccountId: null,
          origin: 'TEST',
          scope: 'TEST',
          operation: 'UUID_VALIDATION',
          result: 'SUCCESS',
          entityType: 'ACCOUNT',
          entityId: null,
          correlationId: randomUUID(),
          operationId: randomUUID(),
          sequence: 1,
        },
      }),
    ).resolves.toMatchObject({ entityId: null, actorAccountId: null });

    expect(
      await migrator.bootstrapState.findUnique({ where: { singletonId: 1 } }),
    ).toMatchObject({ operationId: null, initialAccountId: null });
  });

  it('rejects a non-RFC operation UUID when completing the singleton', async () => {
    const accountId = randomUUID();
    await migrator.account.create({
      data: {
        id: accountId,
        firstName: 'Bootstrap',
        lastName: 'Uuid',
        email: 'bootstrap.uuid@example.com',
        emailKey: 'bootstrap.uuid@example.com',
        status: 'ACTIVE',
        createdAt: new Date(),
      },
    });

    await expect(
      migrator.bootstrapState.update({
        where: { singletonId: 1 },
        data: {
          status: 'COMPLETED',
          initialAccountId: accountId,
          operationId: '00000000-0000-4000-0000-000000000001',
          completedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    expect(
      await migrator.bootstrapState.findUnique({ where: { singletonId: 1 } }),
    ).toMatchObject({ status: 'PENDING', operationId: null });
  });

  it.each(['id', 'entityId', 'correlationId', 'operationId'] as const)(
    'rejects a non-RFC audit UUID in %s',
    async (field) => {
      const nonRfcUuid = '00000000-0000-4000-0000-000000000001';
      const uuids = {
        id: randomUUID(),
        entityId: randomUUID(),
        correlationId: randomUUID(),
        operationId: randomUUID(),
        [field]: nonRfcUuid,
      };

      await expect(
        migrator.auditEvent.create({
          data: {
            id: uuids.id,
            occurredAt: new Date(),
            origin: 'TEST',
            scope: 'TEST',
            operation: 'UUID_VALIDATION',
            result: 'FAILURE',
            entityType: 'ACCOUNT',
            entityId: uuids.entityId,
            correlationId: uuids.correlationId,
            operationId: uuids.operationId,
            sequence: 1,
          },
        }),
      ).rejects.toThrow();
    },
  );

  it('exposes the required indexes', async () => {
    const indexes = await migrator.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('account', 'bootstrap_state', 'audit_event')
    `;
    const names = indexes.map(({ indexname }) => indexname);

    expect(names).toEqual(
      expect.arrayContaining([
        'account_email_key_key',
        'bootstrap_state_operation_id_key',
        'audit_event_operation_id_sequence_key',
        'audit_event_occurred_at_id_idx',
      ]),
    );
  });

  it('denies direct DML and bootstrap execution to the runtime role', async () => {
    const input = bootstrapInput();

    await expect(callBootstrap(runtime, input)).rejects.toThrow();
    await expect(
      runtime.$executeRaw`
        INSERT INTO public.account (
          id, first_name, last_name, email, email_key, status, created_at
        ) VALUES (
          ${randomUUID()}::uuid,
          'Runtime',
          'Denied',
          'runtime.denied@example.com',
          'runtime.denied@example.com',
          'ACTIVE',
          transaction_timestamp()
        )
      `,
    ).rejects.toThrow();
    await expect(
      runtime.$executeRaw`CREATE TABLE public.runtime_must_not_create (id integer)`,
    ).rejects.toThrow();
  });

  it('denies direct DML and secret reads to the bootstrap role', async () => {
    await expect(
      bootstrap.$executeRaw`
        UPDATE public.bootstrap_state
        SET status = 'COMPLETED'
        WHERE singleton_id = 1
      `,
    ).rejects.toThrow();
    await expect(
      bootstrap.$queryRaw`SELECT password_hash FROM public.password_credential`,
    ).rejects.toThrow();
    await expect(
      bootstrap.$executeRaw`DELETE FROM public.bootstrap_state`,
    ).rejects.toThrow();
  });

  it('keeps audit append-only and singleton protected from runtime', async () => {
    await expect(
      runtime.$executeRaw`UPDATE public.audit_event SET result = 'ALTERED'`,
    ).rejects.toThrow();
    await expect(
      runtime.$executeRaw`DELETE FROM public.audit_event`,
    ).rejects.toThrow();
    await expect(
      runtime.$executeRaw`TRUNCATE public.audit_event`,
    ).rejects.toThrow();
    await expect(
      runtime.$executeRaw`DELETE FROM public.bootstrap_state`,
    ).rejects.toThrow();
  });

  it('denies bootstrap execution to PUBLIC and maintenance', async () => {
    const [publicPrivilege] = await migrator.$queryRaw<BooleanResult[]>`
      SELECT has_function_privilege(
        'public',
        'public.bootstrap_initial_admin(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) AS value
    `;
    expect(publicPrivilege?.value).toBe(false);

    await expect(
      callBootstrap(maintenance, bootstrapInput()),
    ).rejects.toThrow();
  });

  it('keeps the bootstrap role free of direct table mutation privileges', async () => {
    const privileges = await migrator.$queryRaw<
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

    expect(privileges).toHaveLength(5);
    expect(privileges).toEqual(
      privileges.map(({ tableName }) => ({
        tableName,
        insert: false,
        update: false,
        delete: false,
        truncate: false,
      })),
    );
  });

  it('uses a protected security-definer function owned by the migrator', async () => {
    const [functionSecurity] = await migrator.$queryRaw<
      {
        owner: string;
        securityDefiner: boolean;
        configuration: string[];
      }[]
    >`
      SELECT
        pg_catalog.pg_get_userbyid(proowner) AS owner,
        prosecdef AS "securityDefiner",
        proconfig AS configuration
      FROM pg_catalog.pg_proc
      WHERE oid = 'public.bootstrap_initial_admin(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)'::regprocedure
    `;

    expect(functionSecurity).toEqual({
      owner: 'bello_test_migrator',
      securityDefiner: true,
      configuration: ['search_path=pg_catalog, public, pg_temp'],
    });
  });

  it('records the migration in the isolated database', async () => {
    const [count] = await migrator.$queryRaw<CountResult[]>`
      SELECT count(*) AS value
      FROM public._prisma_migrations
      WHERE migration_name = '20261102000000_f1_a_1_identity_foundation'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    expect(count?.value).toBe(1n);
  });
});
