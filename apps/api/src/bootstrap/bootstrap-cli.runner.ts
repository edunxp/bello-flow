import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PasswordPolicyError } from '../credentials/password-policy.js';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import {
  BootstrapInputValidationError,
  validateAuthorizationReference,
  validateEmail,
  validateFirstName,
  validateInstallationReference,
  validateLastName,
  validateOperatorReference,
} from './bootstrap-admin-input.js';
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

interface CollectedBootstrapInput {
  firstName: string;
  lastName: string;
  email: string;
  operatorReference: string;
  authorizationReference: string;
  installationReference: string;
  password: string;
}

@Injectable()
export class BootstrapCliRunner {
  constructor(
    private readonly terminal: BootstrapTerminal,
    private readonly credentials: PasswordCredentialService,
    private readonly postgres: BootstrapPostgresProvider,
  ) {}

  async run(): Promise<number> {
    let input: CollectedBootstrapInput;
    try {
      this.terminal.assertInteractive();
      input = await this.collectInput();
    } catch (error) {
      return this.handleInputError(error);
    }

    this.showSummary(input);
    let confirmation: string;
    try {
      confirmation = await this.terminal.promptText(
        'Digite CONFIRMAR para executar a operação: ',
      );
    } catch (error) {
      return this.handleInputError(error);
    }
    if (confirmation !== 'CONFIRMAR') {
      this.terminal.writeError('Operação cancelada pelo operador.');
      return 1;
    }

    const identifiers = {
      operationId: randomUUID(),
      accountId: randomUUID(),
      accountEventId: randomUUID(),
      roleEventId: randomUUID(),
    };

    let passwordHash: string;
    try {
      passwordHash = await this.credentials.hashPassword(input.password);
    } catch {
      this.terminal.writeError(
        'Não foi possível preparar a credencial. A operação não foi enviada.',
      );
      return 1;
    }

    const parameters: BootstrapInitialAdminParameters = {
      ...identifiers,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash,
      operatorReference: input.operatorReference,
      authorizationReference: input.authorizationReference,
      installationReference: input.installationReference,
    };

    try {
      await this.postgres.connect();
    } catch {
      this.terminal.writeError(
        'Não foi possível conectar ao banco de bootstrap. A operação não foi enviada.',
      );
      return 1;
    }

    try {
      const result = await this.postgres.executeBootstrap(parameters);
      if (
        result.outcome !== 'COMPLETED' ||
        result.createdAccountId !== identifiers.accountId ||
        result.completedOperationId !== identifiers.operationId
      ) {
        return this.reportIndeterminate(identifiers.operationId);
      }

      this.terminal.writeLine(
        'Primeiro Administrador Global criado com sucesso.',
      );
      this.terminal.writeLine(`operation_id: ${identifiers.operationId}`);
      return 0;
    } catch (error) {
      return this.handleExecutionError(error, identifiers);
    }
  }

  private async collectInput(): Promise<CollectedBootstrapInput> {
    const firstName = validateFirstName(
      await this.terminal.promptText('Nome: '),
    );
    const lastName = validateLastName(
      await this.terminal.promptText('Sobrenome: '),
    );
    const email = validateEmail(await this.terminal.promptText('E-mail: '));
    const operatorReference = validateOperatorReference(
      await this.terminal.promptText('Referência do operador: '),
    );
    const authorizationReference = validateAuthorizationReference(
      await this.terminal.promptText('Referência da autorização: '),
    );
    const installationReference = validateInstallationReference(
      await this.terminal.promptText('Referência da instalação: '),
    );
    const password = await this.terminal.promptSecret('Senha: ');
    const confirmation = await this.terminal.promptSecret('Confirme a senha: ');

    this.credentials.validatePassword(password);
    if (confirmation !== password) {
      throw new BootstrapInputValidationError('passwordConfirmation');
    }

    return {
      firstName,
      lastName,
      email,
      operatorReference,
      authorizationReference,
      installationReference,
      password,
    };
  }

  private showSummary(input: CollectedBootstrapInput): void {
    this.terminal.writeLine('');
    this.terminal.writeLine(
      'A operação criará o primeiro Administrador Global.',
    );
    this.terminal.writeLine(`Nome: ${input.firstName} ${input.lastName}`);
    this.terminal.writeLine(`E-mail: ${input.email}`);
    this.terminal.writeLine(
      `Referência do operador: ${input.operatorReference}`,
    );
    this.terminal.writeLine(
      `Referência da autorização: ${input.authorizationReference}`,
    );
    this.terminal.writeLine(
      `Referência da instalação: ${input.installationReference}`,
    );
    this.terminal.writeLine('');
  }

  private handleInputError(error: unknown): number {
    if (error instanceof BootstrapTerminalInterruptedError) {
      this.terminal.writeError('Operação interrompida pelo operador.');
    } else if (
      error instanceof BootstrapInputValidationError ||
      error instanceof PasswordPolicyError
    ) {
      this.terminal.writeError('Dados administrativos inválidos.');
    } else if (error instanceof BootstrapTerminalError) {
      this.terminal.writeError(error.message);
    } else {
      this.terminal.writeError('Falha ao ler os dados administrativos.');
    }
    return 1;
  }

  private handleExecutionError(
    error: unknown,
    identifiers: { operationId: string; accountId: string },
  ): number {
    if (error instanceof BootstrapPostgresCloseError) {
      const result = error.confirmedResult;
      if (
        result.outcome === 'COMPLETED' &&
        result.createdAccountId === identifiers.accountId &&
        result.completedOperationId === identifiers.operationId
      ) {
        this.terminal.writeError(
          'O banco retornou COMPLETED, mas houve falha ao encerrar a conexão.',
        );
        this.terminal.writeError(
          `operation_id confirmado: ${result.completedOperationId}`,
        );
        this.terminal.writeError(
          'Verifique o estado antes de qualquer nova tentativa.',
        );
        return 1;
      }

      return this.reportIndeterminate(identifiers.operationId);
    }

    const message = this.postgresMessage(error);
    const knownMessages: Record<string, string> = {
      BF_BOOTSTRAP_INVALID_IDENTIFIERS:
        'Os identificadores administrativos foram rejeitados.',
      BF_BOOTSTRAP_STATE_MISSING: 'O estado de bootstrap não foi encontrado.',
      BF_BOOTSTRAP_ALREADY_COMPLETED: 'O bootstrap já foi concluído.',
      BF_BOOTSTRAP_STATE_INCONSISTENT:
        'O estado de bootstrap está inconsistente.',
      BF_BOOTSTRAP_INVALID_REFERENCES:
        'As referências operacionais foram rejeitadas.',
      BF_BOOTSTRAP_FAILED: 'A função de bootstrap falhou.',
    };
    if (message && knownMessages[message]) {
      this.terminal.writeError(knownMessages[message]);
      return 1;
    }

    return this.reportIndeterminate(identifiers.operationId);
  }

  private postgresMessage(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P0001' &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }
    return undefined;
  }

  private reportIndeterminate(operationId: string): number {
    this.terminal.writeError(
      'O resultado da operação é indeterminado; não presuma sucesso ou rollback.',
    );
    this.terminal.writeError(`operation_id: ${operationId}`);
    this.terminal.writeError(
      'Verifique o estado antes de qualquer nova tentativa. Não repita automaticamente.',
    );
    this.terminal.writeError(
      `Execute a reconciliação: bootstrap:admin -- reconcile ${operationId}`,
    );
    return 2;
  }
}
