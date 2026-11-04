import {
  BootstrapReconciliationEvidence,
  BootstrapReconciliationInputError,
  classifyBootstrapReconciliation,
  validateBootstrapOperationId,
} from './bootstrap-reconciliation.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const otherOperationId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';

function completedEvidence(
  overrides: Partial<BootstrapReconciliationEvidence> = {},
): BootstrapReconciliationEvidence {
  return {
    stateStatus: 'COMPLETED',
    accountId,
    completedOperationId: operationId,
    accountCount: 1,
    roleCount: 1,
    credentialCount: 1,
    validCredentialCount: 1,
    completedAuditCount: 2,
    sequenceOneCount: 1,
    sequenceTwoCount: 1,
    validAuditCount: 2,
    requestedAuditCount: 2,
    ...overrides,
  };
}

describe('bootstrap reconciliation contract', () => {
  it.each([
    '',
    'not-a-uuid',
    '11111111-1111-3111-8111-111111111111',
    '11111111-1111-4111-7111-111111111111',
  ])('rejects invalid operation_id %s', (value) => {
    expect(() => validateBootstrapOperationId(value)).toThrow(
      BootstrapReconciliationInputError,
    );
  });

  it('accepts and canonicalizes a UUID v4', () => {
    expect(validateBootstrapOperationId(operationId.toUpperCase())).toBe(
      operationId,
    );
  });

  it('classifies consistent evidence for the requested operation', () => {
    expect(
      classifyBootstrapReconciliation(operationId, completedEvidence()),
    ).toEqual({
      status: 'COMPLETED',
      operationId,
      completedOperationId: operationId,
      accountId,
    });
  });

  it('distinguishes a consistent bootstrap completed by another operation', () => {
    expect(
      classifyBootstrapReconciliation(
        otherOperationId,
        completedEvidence({ requestedAuditCount: 0 }),
      ),
    ).toEqual({
      status: 'ALREADY_COMPLETED',
      operationId: otherOperationId,
      completedOperationId: operationId,
      accountId,
    });
  });

  it('classifies a clean PENDING state conservatively as unknown', () => {
    expect(
      classifyBootstrapReconciliation(operationId, {
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
      }),
    ).toEqual({ status: 'UNKNOWN', operationId });
  });

  it.each([
    { stateStatus: 'BROKEN' },
    { accountId: null },
    { completedOperationId: null },
    { accountId: 'not-a-uuid' },
    { completedOperationId: 'not-a-uuid' },
    { accountCount: 0 },
    { roleCount: 0 },
    { credentialCount: 0 },
    { validCredentialCount: 0 },
    { completedAuditCount: 1 },
    { sequenceOneCount: 0 },
    { sequenceTwoCount: 0 },
    { validAuditCount: 1 },
    { requestedAuditCount: 1 },
  ])(
    'classifies contradictory completed evidence as inconsistent %#',
    (change) => {
      expect(
        classifyBootstrapReconciliation(operationId, completedEvidence(change))
          .status,
      ).toBe('INCONSISTENT');
    },
  );

  it('classifies missing state and dirty PENDING evidence as inconsistent', () => {
    expect(classifyBootstrapReconciliation(operationId, undefined).status).toBe(
      'INCONSISTENT',
    );
    expect(
      classifyBootstrapReconciliation(
        operationId,
        completedEvidence({
          stateStatus: 'PENDING',
          accountId: null,
          completedOperationId: null,
        }),
      ).status,
    ).toBe('INCONSISTENT');
  });
});
