import { PasswordPolicyError } from '../credentials/password-policy.js';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { BootstrapCliRunner } from './bootstrap-cli.runner.js';
import {
  BootstrapInitialAdminParameters,
  BootstrapPostgresCloseError,
  BootstrapPostgresProvider,
} from './bootstrap-postgres.provider.js';
import {
  BootstrapTerminal,
  BootstrapTerminalError,
  BootstrapTerminalInterruptedError,
} from './bootstrap-terminal.js';

const password = 'valid password 🚀';
const encodedHash = 'approved-encoded-hash';
const defaultTextAnswers = [
  '  Ada  ',
  '  Lovelace  ',
  '  Ada.Bootstrap@Example.COM  ',
  '  operator  ',
  '  authorization  ',
  '  installation  ',
  'CONFIRMAR',
];

function runnerFixture(
  options: {
    textAnswers?: string[];
    secretAnswers?: string[];
  } = {},
) {
  const events: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const textAnswers = [...(options.textAnswers ?? defaultTextAnswers)];
  const secretAnswers = [...(options.secretAnswers ?? [password, password])];
  const terminal = {
    assertInteractive: vi.fn(() => events.push('interactive')),
    promptText: vi.fn(async () => {
      events.push('text');
      return textAnswers.shift() ?? '';
    }),
    promptSecret: vi.fn(async () => {
      events.push('secret');
      return secretAnswers.shift() ?? '';
    }),
    writeLine: vi.fn((message = '') => stdout.push(message)),
    writeError: vi.fn((message: string) => stderr.push(message)),
  };
  const credentials = {
    validatePassword: vi.fn(() => events.push('validate-password')),
    hashPassword: vi.fn(async () => {
      events.push('hash');
      return encodedHash;
    }),
  };
  const postgres = {
    connect: vi.fn(async () => events.push('connect')),
    executeBootstrap: vi.fn(
      async (parameters: BootstrapInitialAdminParameters) => {
        events.push('execute');
        return {
          outcome: 'COMPLETED',
          createdAccountId: parameters.accountId,
          completedOperationId: parameters.operationId,
        };
      },
    ),
  };
  const runner = new BootstrapCliRunner(
    terminal as unknown as BootstrapTerminal,
    credentials as unknown as PasswordCredentialService,
    postgres as unknown as BootstrapPostgresProvider,
  );

  return {
    runner,
    terminal,
    credentials,
    postgres,
    events,
    stdout,
    stderr,
  };
}

describe('BootstrapCliRunner', () => {
  it('orchestrates one confirmed bootstrap with four UUID v4 identifiers', async () => {
    const fixture = runnerFixture();

    await expect(fixture.runner.run()).resolves.toBe(0);

    expect(fixture.credentials.validatePassword).toHaveBeenCalledWith(password);
    expect(fixture.credentials.hashPassword).toHaveBeenCalledOnce();
    expect(fixture.credentials.hashPassword).toHaveBeenCalledWith(password);
    expect(fixture.postgres.connect).toHaveBeenCalledOnce();
    expect(fixture.postgres.executeBootstrap).toHaveBeenCalledOnce();
    const parameters = fixture.postgres.executeBootstrap.mock.calls[0]![0];
    const identifiers = [
      parameters.operationId,
      parameters.accountId,
      parameters.accountEventId,
      parameters.roleEventId,
    ];
    expect(new Set(identifiers)).toHaveLength(4);
    for (const identifier of identifiers) {
      expect(identifier).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    expect(parameters).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada.Bootstrap@Example.COM',
      passwordHash: encodedHash,
      operatorReference: 'operator',
      authorizationReference: 'authorization',
      installationReference: 'installation',
    });
    expect(fixture.events.indexOf('hash')).toBeLessThan(
      fixture.events.indexOf('connect'),
    );
    expect(fixture.events.indexOf('connect')).toBeLessThan(
      fixture.events.indexOf('execute'),
    );
  });

  it('shows only non-secret data in the summary and output', async () => {
    const fixture = runnerFixture();

    await fixture.runner.run();

    const visibleOutput = [...fixture.stdout, ...fixture.stderr].join('\n');
    expect(visibleOutput).toContain('Ada.Bootstrap@Example.COM');
    expect(visibleOutput).toContain('primeiro Administrador Global');
    expect(visibleOutput).not.toContain(password);
    expect(visibleOutput).not.toContain(encodedHash);
  });

  it('cancels before generating a hash or connecting', async () => {
    const fixture = runnerFixture({
      textAnswers: [...defaultTextAnswers.slice(0, -1), 'cancelar'],
    });

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.credentials.hashPassword).not.toHaveBeenCalled();
    expect(fixture.postgres.connect).not.toHaveBeenCalled();
    expect(fixture.postgres.executeBootstrap).not.toHaveBeenCalled();
    expect(fixture.stderr).toContain('Operação cancelada pelo operador.');
  });

  it('rejects a password confirmation mismatch before hashing', async () => {
    const fixture = runnerFixture({
      secretAnswers: [password, 'different password'],
    });

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.credentials.hashPassword).not.toHaveBeenCalled();
    expect(fixture.stderr).toContain('Dados administrativos inválidos.');
  });

  it('reports password policy rejection without exposing the input', async () => {
    const fixture = runnerFixture();
    fixture.credentials.validatePassword.mockImplementation(() => {
      throw new PasswordPolicyError();
    });

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.postgres.connect).not.toHaveBeenCalled();
    expect(fixture.stderr.join('\n')).not.toContain(password);
  });

  it.each([
    new BootstrapTerminalError('TTY required'),
    new BootstrapTerminalInterruptedError(),
    new Error('unexpected input failure'),
  ])('handles terminal/input failure %#', async (error) => {
    const fixture = runnerFixture();
    fixture.terminal.assertInteractive.mockImplementation(() => {
      throw error;
    });

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.credentials.hashPassword).not.toHaveBeenCalled();
    expect(fixture.postgres.connect).not.toHaveBeenCalled();
  });

  it('handles interruption during administrative confirmation', async () => {
    const fixture = runnerFixture();
    let promptIndex = 0;
    fixture.terminal.promptText.mockImplementation(async () => {
      if (promptIndex === 6) {
        throw new BootstrapTerminalInterruptedError();
      }
      return defaultTextAnswers[promptIndex++]!;
    });

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.credentials.validatePassword).toHaveBeenCalledOnce();
    expect(fixture.postgres.connect).not.toHaveBeenCalled();
  });

  it('does not connect when credential hashing fails', async () => {
    const fixture = runnerFixture();
    fixture.credentials.hashPassword.mockRejectedValue(
      new Error('hash failed'),
    );

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.postgres.connect).not.toHaveBeenCalled();
    expect(fixture.stderr.join('\n')).not.toContain(password);
  });

  it('distinguishes a connection failure before sending', async () => {
    const fixture = runnerFixture();
    fixture.postgres.connect.mockRejectedValue(new Error('connection refused'));

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.postgres.executeBootstrap).not.toHaveBeenCalled();
    expect(fixture.stderr.join('\n')).toContain('não foi enviada');
  });

  it.each([
    ['BF_BOOTSTRAP_INVALID_IDENTIFIERS', 'identificadores'],
    ['BF_BOOTSTRAP_STATE_MISSING', 'não foi encontrado'],
    ['BF_BOOTSTRAP_ALREADY_COMPLETED', 'já foi concluído'],
    ['BF_BOOTSTRAP_STATE_INCONSISTENT', 'inconsistente'],
    ['BF_BOOTSTRAP_INVALID_REFERENCES', 'referências'],
    ['BF_BOOTSTRAP_FAILED', 'função de bootstrap falhou'],
  ])('maps known error %s without retry', async (message, expectedMessage) => {
    const fixture = runnerFixture();
    fixture.postgres.executeBootstrap.mockRejectedValue(
      Object.assign(new Error(message), { code: 'P0001' }),
    );

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.postgres.executeBootstrap).toHaveBeenCalledOnce();
    expect(fixture.stderr.join('\n')).toContain(expectedMessage);
  });

  it('reports communication failure after sending as indeterminate', async () => {
    const fixture = runnerFixture();
    fixture.postgres.executeBootstrap.mockRejectedValue(
      Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' }),
    );

    await expect(fixture.runner.run()).resolves.toBe(2);
    expect(fixture.postgres.executeBootstrap).toHaveBeenCalledOnce();
    expect(fixture.stderr.join('\n')).toContain('indeterminado');
    expect(fixture.stderr.join('\n')).toMatch(/operation_id: [0-9a-f-]{36}/);
    expect(fixture.stderr.join('\n')).toContain('Não repita automaticamente');
    expect(fixture.stderr.join('\n')).toContain('bootstrap:admin -- reconcile');
  });

  it.each([
    { outcome: 'UNKNOWN' },
    { createdAccountId: 'different-account' },
    { completedOperationId: 'different-operation' },
  ])('treats unexpected result as indeterminate %#', async (override) => {
    const fixture = runnerFixture();
    fixture.postgres.executeBootstrap.mockImplementation(
      async (parameters) => ({
        outcome: 'COMPLETED',
        createdAccountId: parameters.accountId,
        completedOperationId: parameters.operationId,
        ...override,
      }),
    );

    await expect(fixture.runner.run()).resolves.toBe(2);
    expect(fixture.stderr.join('\n')).toContain('indeterminado');
  });

  it('preserves COMPLETED evidence when connection closing fails', async () => {
    const fixture = runnerFixture();
    fixture.postgres.executeBootstrap.mockImplementation(async (parameters) => {
      throw new BootstrapPostgresCloseError(
        {
          outcome: 'COMPLETED',
          createdAccountId: parameters.accountId,
          completedOperationId: parameters.operationId,
        },
        { cause: new Error('close failed') },
      );
    });

    await expect(fixture.runner.run()).resolves.toBe(1);
    expect(fixture.stderr.join('\n')).toContain('retornou COMPLETED');
    expect(fixture.stderr.join('\n')).toMatch(
      /operation_id confirmado: [0-9a-f-]{36}/,
    );
    expect(fixture.stderr.join('\n')).not.toContain('rollback');
  });

  it.each([
    { outcome: 'UNKNOWN' },
    { createdAccountId: 'different-account' },
    { completedOperationId: 'different-operation' },
  ])(
    'does not claim confirmed completion for an invalid preserved result %#',
    async (override) => {
      const fixture = runnerFixture();
      fixture.postgres.executeBootstrap.mockImplementation(
        async (parameters) => {
          throw new BootstrapPostgresCloseError(
            {
              outcome: 'COMPLETED',
              createdAccountId: parameters.accountId,
              completedOperationId: parameters.operationId,
              ...override,
            },
            { cause: new Error('close failed') },
          );
        },
      );

      await expect(fixture.runner.run()).resolves.toBe(2);
      expect(fixture.stderr.join('\n')).toContain('indeterminado');
      expect(fixture.stderr.join('\n')).not.toContain('retornou COMPLETED');
    },
  );
});
