import { Injectable } from '@nestjs/common';
import {
  BootstrapReconciliationInputError,
  BootstrapReconciliationResult,
  validateBootstrapOperationId,
} from './bootstrap-reconciliation.js';
import {
  BootstrapPostgresProvider,
  BootstrapReconciliationCloseError,
} from './bootstrap-postgres.provider.js';
import { BootstrapTerminal } from './bootstrap-terminal.js';

@Injectable()
export class BootstrapReconciliationRunner {
  constructor(
    private readonly terminal: BootstrapTerminal,
    private readonly postgres: BootstrapPostgresProvider,
  ) {}

  async run(rawOperationId: string): Promise<number> {
    let operationId: string;
    try {
      operationId = validateBootstrapOperationId(rawOperationId);
    } catch (error) {
      if (error instanceof BootstrapReconciliationInputError) {
        this.terminal.writeError('operation_id inválido: informe um UUID v4.');
        return 1;
      }
      this.terminal.writeError('Não foi possível validar o operation_id.');
      return 1;
    }

    try {
      const result = await this.postgres.reconcileBootstrap(operationId);
      return this.report(result);
    } catch (error) {
      if (error instanceof BootstrapReconciliationCloseError) {
        this.report(error.confirmedResult);
        this.terminal.writeError(
          'A reconciliação foi concluída, mas houve falha ao encerrar a conexão.',
        );
        return 2;
      }

      this.terminal.writeError(
        'Reconciliação UNKNOWN: ocorreu uma falha operacional não classificada.',
      );
      this.terminal.writeError(`operation_id consultado: ${operationId}`);
      return 2;
    }
  }

  private report(result: BootstrapReconciliationResult): number {
    switch (result.status) {
      case 'COMPLETED':
        this.terminal.writeLine('Reconciliação: COMPLETED.');
        this.writeIdentifiers(result);
        return 0;
      case 'ALREADY_COMPLETED':
        this.terminal.writeLine('Reconciliação: ALREADY_COMPLETED.');
        this.terminal.writeLine(
          'O bootstrap foi concluído por outro operation_id; a tentativa consultada não criou o administrador.',
        );
        this.writeIdentifiers(result);
        return 0;
      case 'INCONSISTENT':
        this.terminal.writeError('Reconciliação: INCONSISTENT.');
        this.writeIdentifiers(result, true);
        return 2;
      case 'UNKNOWN':
        this.terminal.writeError('Reconciliação: UNKNOWN.');
        this.terminal.writeError(
          `operation_id consultado: ${result.operationId}`,
        );
        this.terminal.writeError(
          'Não presuma sucesso, rollback ou autorização para repetir o bootstrap.',
        );
        return 2;
    }
  }

  private writeIdentifiers(
    result: BootstrapReconciliationResult,
    error = false,
  ): void {
    const write = error
      ? this.terminal.writeError.bind(this.terminal)
      : this.terminal.writeLine.bind(this.terminal);
    write(`operation_id consultado: ${result.operationId}`);
    if (result.completedOperationId) {
      write(`operation_id concluído: ${result.completedOperationId}`);
    }
    if (result.accountId) {
      write(`account_id inicial: ${result.accountId}`);
    }
  }
}
