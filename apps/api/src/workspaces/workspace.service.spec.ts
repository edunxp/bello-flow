import { Prisma } from '../generated/prisma/client.js';
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
    $queryRaw: vi.fn(),
    workspaceLabel: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    cardLabel: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
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
      findFirst: vi.fn().mockResolvedValue({ role: 'ADMIN' }),
      findUnique: vi.fn().mockResolvedValue({ workspaceId, accountId: actor }),
      create: vi.fn(),
    },
    board: {
      updateMany: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count }),
      findFirstOrThrow: vi
        .fn()
        .mockResolvedValue({ id: operation, ...boardFields }),
    },
    boardMembership: { create: vi.fn() },
    boardFeedEvent: {
      createMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    auditEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
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

describe('Workspace label catalog', () => {
  const label = { id: 'label', name: 'Urgente', color: '#aabbcc' };
  it('shows only catalog fields to members and reserves writes for administrators', async () => {
    const { service, tx } = setup(1);
    tx.workspaceLabel.findMany.mockResolvedValue([label]);
    tx.workspaceMembership.findFirst.mockResolvedValue({ role: 'MEMBER' });
    await expect(service.labels(actor, workspaceId)).resolves.toEqual({
      editable: false,
      labels: [label],
    });
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'CREATE', fields: label },
        operation,
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    tx.workspaceMembership.findFirst.mockResolvedValue(null);
    await expect(service.labels(actor, workspaceId)).rejects.toMatchObject({
      code: 'REQUEST_FORBIDDEN',
    });
  });

  it('creates catalog entries and blocks replay and uniqueness conflicts', async () => {
    const { service, tx } = setup(1);
    const fields = { name: label.name, color: label.color };
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'CREATE', fields },
        operation,
      ),
    ).resolves.toMatchObject(fields);
    tx.auditEvent.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'CREATE', fields },
        operation,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(tx.workspaceLabel.create).toHaveBeenCalledOnce();
    tx.workspaceLabel.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'CREATE', fields },
        'other',
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  });

  it('propagates global edits and deletion without returning private card data', async () => {
    const { service, tx } = setup(1);
    tx.workspaceLabel.findFirst.mockResolvedValue(label);
    tx.cardLabel.findMany.mockResolvedValue([
      { card: { id: 'private', listId: 'list', list: { boardId: 'board' } } },
    ]);
    const edited = { name: 'Revisar', color: null };
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'UPDATE', id: label.id, fields: edited },
        operation,
      ),
    ).resolves.toEqual({ id: label.id, ...edited });
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'DELETE', id: label.id, fields: edited },
        operation,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'DELETE', id: label.id, fields: label },
        operation,
      ),
    ).resolves.toBeNull();
    expect(tx.cardLabel.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId, labelId: label.id },
    });
    expect(tx.boardFeedEvent.createMany).toHaveBeenLastCalledWith({
      data: [
        expect.objectContaining({
          cardId: 'private',
          labelId: label.id,
          operation: 'CARD_LABEL_REMOVED',
        }),
      ],
    });
    tx.workspaceLabel.findFirst.mockResolvedValue(null);
    await expect(
      service.changeLabel(
        actor,
        workspaceId,
        { kind: 'DELETE', id: label.id, fields: label },
        operation,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('WorkspaceService board lifecycle', () => {
  it('separates governance summaries from archived boards that the participant can open', async () => {
    const { service, tx } = setup(1);
    const archived = { id: 'archived', name: 'Arquivo', archived: true };
    const managed = { id: 'managed', name: 'Governança', archived: false };
    tx.board.findMany
      .mockResolvedValueOnce([archived])
      .mockResolvedValueOnce([managed]);
    await expect(service.boardLifecycle(actor, workspaceId)).resolves.toEqual({
      archivedBoards: [archived],
      managedBoards: [managed],
    });
    expect(tx.board.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          workspaceId,
          NOT: { members: { some: { accountId: actor } } },
        },
        select: { id: true, name: true, archived: true },
      }),
    );
    tx.workspaceMembership.findFirst.mockResolvedValue({ role: 'MEMBER' });
    await expect(service.boardLifecycle(actor, workspaceId)).resolves.toEqual({
      archivedBoards: [],
      managedBoards: [],
    });
    tx.workspaceMembership.findFirst.mockResolvedValue(null);
    await expect(
      service.boardLifecycle(actor, workspaceId),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
  });

  it('changes archive state atomically and resolves replay by receipt', async () => {
    const { service, tx } = setup(1);
    tx.board.findFirst.mockResolvedValue({ archived: false });
    await service.archiveBoard(actor, workspaceId, operation, true, 'archive');
    expect(tx.board.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: operation },
      data: { archived: true, syncRevision: { increment: 1 } },
      select: { id: true },
    });
    const { requestHash } = tx.boardFeedEvent.createMany.mock.calls[0]![0].data;
    tx.boardFeedEvent.findUnique.mockResolvedValueOnce({ requestHash });
    await service.archiveBoard(actor, workspaceId, operation, true, 'archive');
    expect(tx.board.update).toHaveBeenCalledOnce();
    tx.boardFeedEvent.findUnique.mockResolvedValueOnce({ requestHash });
    await expect(
      service.archiveBoard(actor, workspaceId, operation, false, 'archive'),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    tx.board.findFirst.mockResolvedValue({ archived: true });
    await service.archiveBoard(actor, workspaceId, operation, false, 'restore');
    expect(tx.auditEvent.createMany).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        operation: 'BOARD_RESTORED',
        beforeData: { archived: true },
        afterData: { archived: false },
      }),
    });
  });
});
