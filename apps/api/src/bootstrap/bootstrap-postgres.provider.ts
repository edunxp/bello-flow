import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Client, QueryResult } from 'pg';
import {
  BootstrapReconciliationEvidence,
  BootstrapReconciliationResult,
  classifyBootstrapReconciliation,
} from './bootstrap-reconciliation.js';

const CONNECTION_TIMEOUT_MILLISECONDS = 5_000;
const RECONCILIATION_STATEMENT_TIMEOUT_MILLISECONDS = 5_000;

const BOOTSTRAP_SQL = `
  SELECT
    outcome,
    created_account_id AS "createdAccountId",
    completed_operation_id AS "completedOperationId"
  FROM public.bootstrap_initial_admin(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::uuid,
    $5::text,
    $6::text,
    $7::text,
    $8::text,
    $9::text,
    $10::text,
    $11::text
  )
`;

const RECONCILIATION_SQL = `
  WITH state AS MATERIALIZED (
    SELECT
      status AS "stateStatus",
      initial_account_id AS "accountId",
      operation_id AS "completedOperationId"
    FROM public.bootstrap_state
    WHERE singleton_id = 1
  )
  SELECT
    state."stateStatus",
    state."accountId",
    state."completedOperationId",
    (
      SELECT COUNT(id)::integer
      FROM public.account
      WHERE id = state."accountId"
    ) AS "accountCount",
    (
      SELECT COUNT(account_id)::integer
      FROM public.global_role_assignment
      WHERE account_id = state."accountId"
        AND role = 'GLOBAL_ADMIN'
    ) AS "roleCount",
    (
      SELECT COUNT(id)::integer
      FROM public.audit_event
      WHERE operation_id = state."completedOperationId"
    ) AS "completedAuditCount",
    (
      SELECT COUNT(id)::integer
      FROM public.audit_event
      WHERE operation_id = state."completedOperationId"
        AND sequence = 1
    ) AS "sequenceOneCount",
    (
      SELECT COUNT(id)::integer
      FROM public.audit_event
      WHERE operation_id = state."completedOperationId"
        AND sequence = 2
    ) AS "sequenceTwoCount",
    (
      SELECT COUNT(id)::integer
      FROM public.audit_event
      WHERE operation_id = state."completedOperationId"
        AND result = 'SUCCESS'
        AND entity_type = 'ACCOUNT'
        AND entity_id = state."accountId"
    ) AS "validAuditCount",
    (
      SELECT COUNT(id)::integer
      FROM public.audit_event
      WHERE operation_id = $1::uuid
    ) AS "requestedAuditCount"
  FROM state
`;

export interface BootstrapInitialAdminParameters {
  operationId: string;
  accountId: string;
  accountEventId: string;
  roleEventId: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  operatorReference: string;
  authorizationReference: string;
  installationReference: string;
}

export interface BootstrapInitialAdminResult {
  outcome: string;
  createdAccountId: string;
  completedOperationId: string;
}

export class BootstrapPostgresCloseError extends Error {
  constructor(
    readonly confirmedResult: BootstrapInitialAdminResult,
    options: ErrorOptions,
  ) {
    super(
      'Bootstrap completed but the PostgreSQL connection did not close',
      options,
    );
    this.name = 'BootstrapPostgresCloseError';
  }
}

export class BootstrapReconciliationCloseError extends Error {
  constructor(
    readonly confirmedResult: BootstrapReconciliationResult,
    options: ErrorOptions,
  ) {
    super(
      'Bootstrap reconciliation completed but the PostgreSQL connection did not close',
      options,
    );
    this.name = 'BootstrapReconciliationCloseError';
  }
}

@Injectable()
export class BootstrapPostgresProvider implements OnModuleDestroy {
  private readonly connectionString: string;
  private client: Client | undefined;

  constructor() {
    const connectionString = process.env.BOOTSTRAP_DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error('BOOTSTRAP_DATABASE_URL is required');
    }

    this.connectionString = connectionString;
  }

  async connect(): Promise<void> {
    await this.openClient(false);
  }

  async reconcileBootstrap(
    operationId: string,
  ): Promise<BootstrapReconciliationResult> {
    if (!this.client) {
      try {
        await this.openClient(true);
      } catch {
        return { status: 'UNKNOWN', operationId };
      }
    }

    const client = this.client!;
    let reconciliationResult: BootstrapReconciliationResult;
    try {
      const result = await client.query<BootstrapReconciliationEvidence>({
        text: RECONCILIATION_SQL,
        values: [operationId],
      });
      reconciliationResult = classifyBootstrapReconciliation(
        operationId,
        result.rows[0],
      );
    } catch {
      await this.closeAfterFailure(client);
      return { status: 'UNKNOWN', operationId };
    }

    try {
      await this.closeClient(client);
    } catch (error) {
      throw new BootstrapReconciliationCloseError(reconciliationResult, {
        cause: error,
      });
    }
    return reconciliationResult;
  }

  private async openClient(reconciliation: boolean): Promise<void> {
    if (this.client) {
      throw new Error('Bootstrap PostgreSQL connection is already open');
    }

    const client = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLISECONDS,
      ...(reconciliation
        ? {
            statement_timeout: RECONCILIATION_STATEMENT_TIMEOUT_MILLISECONDS,
          }
        : {}),
    });
    this.client = client;

    try {
      await client.connect();
    } catch (error) {
      await this.closeAfterFailure(client);
      throw error;
    }
  }

  async executeBootstrap(
    parameters: BootstrapInitialAdminParameters,
  ): Promise<BootstrapInitialAdminResult> {
    if (!this.client) {
      await this.connect();
    }

    const client = this.client!;

    let bootstrapResult: BootstrapInitialAdminResult;
    try {
      const result = await client.query<BootstrapInitialAdminResult>({
        text: BOOTSTRAP_SQL,
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

      bootstrapResult = this.singleResult(result);
    } catch (error) {
      await this.closeAfterFailure(client);
      throw error;
    }

    try {
      await this.closeClient(client);
    } catch (error) {
      throw new BootstrapPostgresCloseError(bootstrapResult, { cause: error });
    }
    return bootstrapResult;
  }

  async close(): Promise<void> {
    const client = this.client;
    if (client) {
      await this.closeClient(client);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private singleResult(
    result: QueryResult<BootstrapInitialAdminResult>,
  ): BootstrapInitialAdminResult {
    if (result.rows.length !== 1) {
      throw new Error('Bootstrap function returned an unexpected result');
    }

    return result.rows[0];
  }

  private async closeAfterFailure(client: Client): Promise<void> {
    try {
      await this.closeClient(client);
    } catch {
      // The connection error remains the primary result.
    }
  }

  private async closeClient(client: Client): Promise<void> {
    this.client = undefined;
    await client.end();
  }
}
