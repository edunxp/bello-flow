import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WorkspaceService } from './workspace.service.js';

const actor = '40000000-0000-4000-8000-000000000001';
const operation = '40000000-0000-4000-8000-000000000002';
const workspaceId = '40000000-0000-4000-8000-000000000003';
const workspaceFields = { name: 'Trabalho', timeZone: 'America/Sao_Paulo' };
const boardFields = { name: 'ERP', description: 'Privado' };

function setup(count: number) {
  const tx = {
    account: { findFirst: vi.fn().mockResolvedValue({ id: actor }) },
    workspace: {
      createMany: vi.fn().mockResolvedValue({ count }),
      findFirstOrThrow: vi.fn().mockResolvedValue({
        id: workspaceId,
        description: null,
        ...workspaceFields,
      }),
    },
    workspaceMembership: {
      findUnique: vi.fn().mockResolvedValue({ workspaceId, accountId: actor }),
      create: vi.fn(),
    },
    board: {
      createMany: vi.fn().mockResolvedValue({ count }),
      findFirstOrThrow: vi
        .fn()
        .mockResolvedValue({ id: operation, ...boardFields }),
    },
    boardMembership: { create: vi.fn() },
    boardFeedEvent: { createMany: vi.fn() },
    auditEvent: { createMany: vi.fn() },
  };
  const db = {
    ...tx,
    $transaction: (run: (value: typeof tx) => unknown) => run(tx),
  };
  return { service: new WorkspaceService(db as unknown as PrismaService), tx };
}

describe('WorkspaceService creation reconciliation', () => {
  it('writes the initial grant, audit and feed on the first execution', async () => {
    const { service, tx } = setup(1);
    await service.create(actor, operation, workspaceFields);
    await service.createBoard(actor, workspaceId, operation, boardFields);
    expect(tx.workspaceMembership.create).toHaveBeenCalledOnce();
    expect(tx.boardMembership.create).toHaveBeenCalledOnce();
    expect(tx.auditEvent.createMany).toHaveBeenCalledTimes(2);
    expect(tx.boardFeedEvent.createMany).toHaveBeenCalledOnce();
  });

  it('returns the authorized existing resources without repeating effects', async () => {
    const { service, tx } = setup(0);
    await expect(
      service.create(actor, operation, workspaceFields),
    ).resolves.toMatchObject(workspaceFields);
    await expect(
      service.createBoard(actor, workspaceId, operation, boardFields),
    ).resolves.toMatchObject(boardFields);
    expect(tx.workspace.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: expect.any(String),
        members: { some: { accountId: actor } },
      },
    });
    expect(tx.workspaceMembership.create).not.toHaveBeenCalled();
    expect(tx.boardMembership.create).not.toHaveBeenCalled();
    expect(tx.auditEvent.createMany).not.toHaveBeenCalled();
    expect(tx.boardFeedEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects changes to data associated with a completed operation', async () => {
    const { service } = setup(0);
    await expect(
      service.create(actor, operation, {
        ...workspaceFields,
        timeZone: 'Etc/UTC',
      }),
    ).rejects.toMatchObject({
      code: 'OPERATION_CONFLICT',
    });
    await expect(
      service.createBoard(actor, workspaceId, operation, {
        ...boardFields,
        description: 'Outro',
      }),
    ).rejects.toMatchObject({
      code: 'OPERATION_CONFLICT',
    });
  });

  it('checks current eligibility before attempting a write', async () => {
    const { service, tx } = setup(0);
    tx.account.findFirst.mockResolvedValue(null);
    await expect(
      service.create(actor, operation, workspaceFields),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    await expect(
      service.createBoard(actor, workspaceId, operation, boardFields),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    expect(tx.workspace.createMany).not.toHaveBeenCalled();
    expect(tx.board.createMany).not.toHaveBeenCalled();
  });
});
