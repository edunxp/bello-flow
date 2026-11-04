const pgMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      pgMocks.constructor(config);
    }

    connect = pgMocks.connect;
    query = pgMocks.query;
    end = pgMocks.end;
  },
}));

import {
  BootstrapInitialAdminParameters,
  BootstrapPostgresCloseError,
  BootstrapPostgresProvider,
  BootstrapReconciliationCloseError,
} from './bootstrap-postgres.provider.js';

const bootstrapUrl = 'postgresql://bootstrap.example.invalid/bello';
const parameters: BootstrapInitialAdminParameters = {
  operationId: 'operation-id',
  accountId: 'account-id',
  accountEventId: 'account-event-id',
  roleEventId: 'role-event-id',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  passwordHash: 'encoded-password-hash',
  operatorReference: 'operator-reference',
  authorizationReference: 'authorization-reference',
  installationReference: 'installation-reference',
};
const expectedResult = {
  outcome: 'COMPLETED',
  createdAccountId: parameters.accountId,
  completedOperationId: parameters.operationId,
};
const reconciliationOperationId = '11111111-1111-4111-8111-111111111111';
const reconciliationAccountId = '22222222-2222-4222-8222-222222222222';
const reconciliationEvidence = {
  stateStatus: 'COMPLETED',
  accountId: reconciliationAccountId,
  completedOperationId: reconciliationOperationId,
  accountCount: 1,
  roleCount: 1,
  credentialCount: 1,
  validCredentialCount: 1,
  completedAuditCount: 2,
  sequenceOneCount: 1,
  sequenceTwoCount: 1,
  validAuditCount: 2,
  requestedAuditCount: 2,
};

describe('BootstrapPostgresProvider', () => {
  const originalBootstrapUrl = process.env.BOOTSTRAP_DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalMigrationUrl = process.env.MIGRATION_DATABASE_URL;

  beforeEach(() => {
    process.env.BOOTSTRAP_DATABASE_URL = bootstrapUrl;
    process.env.DATABASE_URL = 'postgresql://runtime.example.invalid/bello';
    process.env.MIGRATION_DATABASE_URL =
      'postgresql://migrator.example.invalid/bello';
    pgMocks.constructor.mockReset();
    pgMocks.connect.mockReset().mockResolvedValue(undefined);
    pgMocks.query.mockReset().mockResolvedValue({ rows: [expectedResult] });
    pgMocks.end.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnvironment('BOOTSTRAP_DATABASE_URL', originalBootstrapUrl);
    restoreEnvironment('DATABASE_URL', originalDatabaseUrl);
    restoreEnvironment('MIGRATION_DATABASE_URL', originalMigrationUrl);
  });

  it.each([undefined, '', '   '])(
    'requires a non-empty BOOTSTRAP_DATABASE_URL (%#)',
    (value) => {
      if (value === undefined) {
        delete process.env.BOOTSTRAP_DATABASE_URL;
      } else {
        process.env.BOOTSTRAP_DATABASE_URL = value;
      }

      expect(() => new BootstrapPostgresProvider()).toThrow(
        'BOOTSTRAP_DATABASE_URL is required',
      );
      expect(pgMocks.constructor).not.toHaveBeenCalled();
    },
  );

  it('does not fall back when only DATABASE_URL is present', () => {
    delete process.env.BOOTSTRAP_DATABASE_URL;

    expect(() => new BootstrapPostgresProvider()).toThrow(
      'BOOTSTRAP_DATABASE_URL is required',
    );
    expect(pgMocks.constructor).not.toHaveBeenCalled();
  });

  it('uses only the bootstrap URL and an explicit connection timeout', async () => {
    const provider = new BootstrapPostgresProvider();

    await provider.executeBootstrap(parameters);

    expect(pgMocks.constructor).toHaveBeenCalledWith({
      connectionString: bootstrapUrl,
      connectionTimeoutMillis: 5_000,
    });
    expect(pgMocks.constructor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: process.env.DATABASE_URL,
      }),
    );
    expect(pgMocks.constructor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      }),
    );
  });

  it('sends all eleven parameters in contract order with placeholders', async () => {
    const provider = new BootstrapPostgresProvider();

    await provider.executeBootstrap(parameters);

    expect(pgMocks.query).toHaveBeenCalledOnce();
    expect(pgMocks.query).toHaveBeenCalledWith({
      text: expect.stringMatching(
        /bootstrap_initial_admin\([\s\S]*\$1::uuid[\s\S]*\$11::text/,
      ),
      values: [
        parameters.operationId,
        parameters.accountId,
        parameters.accountEventId,
        parameters.roleEventId,
        parameters.firstName,
        parameters.lastName,
        parameters.email,
        parameters.passwordHash,
        parameters.operatorReference,
        parameters.authorizationReference,
        parameters.installationReference,
      ],
    });
  });

  it('preserves the function result and closes the connection', async () => {
    const provider = new BootstrapPostgresProvider();

    await expect(provider.executeBootstrap(parameters)).resolves.toEqual(
      expectedResult,
    );
    expect(pgMocks.connect).toHaveBeenCalledOnce();
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it.each([
    'BF_BOOTSTRAP_INVALID_IDENTIFIERS',
    'BF_BOOTSTRAP_STATE_MISSING',
    'BF_BOOTSTRAP_ALREADY_COMPLETED',
    'BF_BOOTSTRAP_STATE_INCONSISTENT',
    'BF_BOOTSTRAP_INVALID_REFERENCES',
    'BF_BOOTSTRAP_FAILED',
  ])('preserves known PostgreSQL error %s', async (message) => {
    const provider = new BootstrapPostgresProvider();
    const databaseError = Object.assign(new Error(message), { code: 'P0001' });
    pgMocks.query.mockRejectedValue(databaseError);

    await expect(provider.executeBootstrap(parameters)).rejects.toBe(
      databaseError,
    );
    expect(pgMocks.query).toHaveBeenCalledOnce();
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('preserves a connection error, cleans up and does not query or retry', async () => {
    const provider = new BootstrapPostgresProvider();
    const connectionError = Object.assign(new Error('connection lost'), {
      code: 'ECONNRESET',
    });
    pgMocks.connect.mockRejectedValue(connectionError);

    await expect(provider.executeBootstrap(parameters)).rejects.toBe(
      connectionError,
    );
    expect(pgMocks.constructor).toHaveBeenCalledOnce();
    expect(pgMocks.connect).toHaveBeenCalledOnce();
    expect(pgMocks.query).not.toHaveBeenCalled();
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('preserves a communication error after sending without retrying', async () => {
    const provider = new BootstrapPostgresProvider();
    const communicationError = Object.assign(
      new Error('connection terminated unexpectedly'),
      { code: 'ECONNRESET' },
    );
    pgMocks.query.mockRejectedValue(communicationError);

    await expect(provider.executeBootstrap(parameters)).rejects.toBe(
      communicationError,
    );
    expect(pgMocks.query).toHaveBeenCalledOnce();
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('does not let a cleanup failure replace the operation error', async () => {
    const provider = new BootstrapPostgresProvider();
    const operationError = new Error('operation failed');
    pgMocks.query.mockRejectedValue(operationError);
    pgMocks.end.mockRejectedValue(new Error('cleanup failed'));

    await expect(provider.executeBootstrap(parameters)).rejects.toBe(
      operationError,
    );
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('preserves the confirmed result when cleanup fails after success', async () => {
    const provider = new BootstrapPostgresProvider();
    const cleanupError = new Error('cleanup failed');
    pgMocks.end.mockRejectedValue(cleanupError);

    await expect(provider.executeBootstrap(parameters)).rejects.toMatchObject({
      name: 'BootstrapPostgresCloseError',
      confirmedResult: expectedResult,
      cause: cleanupError,
    } satisfies Partial<BootstrapPostgresCloseError>);
  });

  it('preserves a connection error when its cleanup also fails', async () => {
    const provider = new BootstrapPostgresProvider();
    const connectionError = new Error('connection failed');
    pgMocks.connect.mockRejectedValue(connectionError);
    pgMocks.end.mockRejectedValue(new Error('cleanup failed'));

    await expect(provider.executeBootstrap(parameters)).rejects.toBe(
      connectionError,
    );
  });

  it('rejects an unexpected function result and closes the connection', async () => {
    const provider = new BootstrapPostgresProvider();
    pgMocks.query.mockResolvedValue({ rows: [] });

    await expect(provider.executeBootstrap(parameters)).rejects.toThrow(
      'Bootstrap function returned an unexpected result',
    );
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('prevents a second active connection', async () => {
    const provider = new BootstrapPostgresProvider();

    await provider.connect();
    await expect(provider.connect()).rejects.toThrow(
      'Bootstrap PostgreSQL connection is already open',
    );
    await provider.close();
  });

  it('reuses an explicitly opened connection for one bootstrap call', async () => {
    const provider = new BootstrapPostgresProvider();

    await provider.connect();
    await provider.executeBootstrap(parameters);

    expect(pgMocks.connect).toHaveBeenCalledOnce();
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('allows explicit and Nest lifecycle cleanup to be idempotent', async () => {
    const provider = new BootstrapPostgresProvider();

    await provider.close();
    await provider.connect();
    await provider.onModuleDestroy();
    await provider.onModuleDestroy();

    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('reconciles through one bounded parameterized snapshot SELECT without writes or function execution', async () => {
    const provider = new BootstrapPostgresProvider();
    pgMocks.query.mockResolvedValue({ rows: [reconciliationEvidence] });

    await expect(
      provider.reconcileBootstrap(reconciliationOperationId),
    ).resolves.toEqual({
      status: 'COMPLETED',
      operationId: reconciliationOperationId,
      completedOperationId: reconciliationOperationId,
      accountId: reconciliationAccountId,
    });

    expect(pgMocks.constructor).toHaveBeenCalledWith({
      connectionString: bootstrapUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
    });
    expect(pgMocks.query).toHaveBeenCalledOnce();
    expect(pgMocks.query).toHaveBeenCalledWith({
      text: expect.stringMatching(/WITH state AS MATERIALIZED[\s\S]*SELECT/),
      values: [reconciliationOperationId],
    });
    const query = pgMocks.query.mock.calls[0]![0] as { text: string };
    expect(query.text).not.toMatch(
      /\bFOR\s+(?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)\b/i,
    );
    expect(query.text).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(query.text).not.toContain('bootstrap_initial_admin');
    expect(query.text).toContain('password_credential');
    expect(query.text).toContain('changed_operation_id');
    expect(query.text).not.toContain('password_hash');
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('returns UNKNOWN for connection and query failures without retrying', async () => {
    const connectionProvider = new BootstrapPostgresProvider();
    pgMocks.connect.mockRejectedValueOnce(new Error('connection failed'));

    await expect(
      connectionProvider.reconcileBootstrap(reconciliationOperationId),
    ).resolves.toEqual({
      status: 'UNKNOWN',
      operationId: reconciliationOperationId,
    });
    expect(pgMocks.connect).toHaveBeenCalledOnce();
    expect(pgMocks.query).not.toHaveBeenCalled();

    pgMocks.connect.mockResolvedValue(undefined);
    pgMocks.query.mockRejectedValueOnce(new Error('query failed'));
    const queryProvider = new BootstrapPostgresProvider();
    await expect(
      queryProvider.reconcileBootstrap(reconciliationOperationId),
    ).resolves.toEqual({
      status: 'UNKNOWN',
      operationId: reconciliationOperationId,
    });
    expect(pgMocks.query).toHaveBeenCalledOnce();
    expect(pgMocks.end).toHaveBeenCalledTimes(2);
  });

  it('classifies missing state as inconsistent and PENDING as unknown', async () => {
    const missingState = new BootstrapPostgresProvider();
    pgMocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      missingState.reconcileBootstrap(reconciliationOperationId),
    ).resolves.toEqual({
      status: 'INCONSISTENT',
      operationId: reconciliationOperationId,
    });

    const pendingState = new BootstrapPostgresProvider();
    pgMocks.query.mockResolvedValueOnce({
      rows: [
        {
          ...reconciliationEvidence,
          stateStatus: 'PENDING',
          accountId: null,
          completedOperationId: null,
          accountCount: 0,
          roleCount: 0,
          credentialCount: 0,
          validCredentialCount: 0,
          completedAuditCount: 0,
          sequenceOneCount: 0,
          sequenceTwoCount: 0,
          validAuditCount: 0,
          requestedAuditCount: 0,
        },
      ],
    });
    await expect(
      pendingState.reconcileBootstrap(reconciliationOperationId),
    ).resolves.toEqual({
      status: 'UNKNOWN',
      operationId: reconciliationOperationId,
    });
  });

  it('preserves reconciliation evidence when cleanup fails', async () => {
    const provider = new BootstrapPostgresProvider();
    const cleanupError = new Error('cleanup failed');
    pgMocks.query.mockResolvedValue({ rows: [reconciliationEvidence] });
    pgMocks.end.mockRejectedValue(cleanupError);

    await expect(
      provider.reconcileBootstrap(reconciliationOperationId),
    ).rejects.toMatchObject({
      name: 'BootstrapReconciliationCloseError',
      confirmedResult: {
        status: 'COMPLETED',
        operationId: reconciliationOperationId,
      },
      cause: cleanupError,
    } satisfies Partial<BootstrapReconciliationCloseError>);
  });

  it('can reconcile through an explicitly opened connection', async () => {
    const provider = new BootstrapPostgresProvider();
    pgMocks.query.mockResolvedValue({ rows: [reconciliationEvidence] });

    await provider.connect();
    await expect(
      provider.reconcileBootstrap(reconciliationOperationId),
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(pgMocks.connect).toHaveBeenCalledOnce();
    expect(pgMocks.query).toHaveBeenCalledOnce();
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
