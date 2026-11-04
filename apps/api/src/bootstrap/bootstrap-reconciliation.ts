const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BootstrapReconciliationStatus =
  'COMPLETED' | 'ALREADY_COMPLETED' | 'INCONSISTENT' | 'UNKNOWN';

export interface BootstrapReconciliationResult {
  status: BootstrapReconciliationStatus;
  operationId: string;
  completedOperationId?: string;
  accountId?: string;
}

export interface BootstrapReconciliationEvidence {
  stateStatus: string;
  accountId: string | null;
  completedOperationId: string | null;
  accountCount: number;
  roleCount: number;
  credentialCount: number;
  validCredentialCount: number;
  completedAuditCount: number;
  sequenceOneCount: number;
  sequenceTwoCount: number;
  validAuditCount: number;
  requestedAuditCount: number;
}

export class BootstrapReconciliationInputError extends Error {
  constructor() {
    super('operation_id must be a valid UUID v4');
    this.name = 'BootstrapReconciliationInputError';
  }
}

export function validateBootstrapOperationId(operationId: string): string {
  if (!UUID_V4_PATTERN.test(operationId)) {
    throw new BootstrapReconciliationInputError();
  }
  return operationId.toLowerCase();
}

export function classifyBootstrapReconciliation(
  operationId: string,
  evidence: BootstrapReconciliationEvidence | undefined,
): BootstrapReconciliationResult {
  if (!evidence) {
    return { status: 'INCONSISTENT', operationId };
  }

  const persistedIdentifiers = {
    ...(evidence.completedOperationId
      ? { completedOperationId: evidence.completedOperationId }
      : {}),
    ...(evidence.accountId ? { accountId: evidence.accountId } : {}),
  };

  if (evidence.stateStatus === 'PENDING') {
    const pendingIsClean =
      evidence.accountId === null &&
      evidence.completedOperationId === null &&
      evidence.accountCount === 0 &&
      evidence.roleCount === 0 &&
      evidence.credentialCount === 0 &&
      evidence.validCredentialCount === 0 &&
      evidence.completedAuditCount === 0 &&
      evidence.sequenceOneCount === 0 &&
      evidence.sequenceTwoCount === 0 &&
      evidence.validAuditCount === 0 &&
      evidence.requestedAuditCount === 0;

    return {
      status: pendingIsClean ? 'UNKNOWN' : 'INCONSISTENT',
      operationId,
      ...persistedIdentifiers,
    };
  }

  const sameOperation = evidence.completedOperationId === operationId;
  const completedIsConsistent =
    evidence.stateStatus === 'COMPLETED' &&
    evidence.accountId !== null &&
    evidence.completedOperationId !== null &&
    UUID_V4_PATTERN.test(evidence.accountId) &&
    UUID_V4_PATTERN.test(evidence.completedOperationId) &&
    evidence.accountCount === 1 &&
    evidence.roleCount === 1 &&
    evidence.credentialCount === 1 &&
    evidence.validCredentialCount === 1 &&
    evidence.completedAuditCount === 2 &&
    evidence.sequenceOneCount === 1 &&
    evidence.sequenceTwoCount === 1 &&
    evidence.validAuditCount === 2 &&
    evidence.requestedAuditCount === (sameOperation ? 2 : 0);

  if (!completedIsConsistent) {
    return {
      status: 'INCONSISTENT',
      operationId,
      ...persistedIdentifiers,
    };
  }

  return {
    status: sameOperation ? 'COMPLETED' : 'ALREADY_COMPLETED',
    operationId,
    completedOperationId: evidence.completedOperationId!,
    accountId: evidence.accountId!,
  };
}
