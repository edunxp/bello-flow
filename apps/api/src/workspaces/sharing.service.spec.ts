import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SharingService } from './sharing.service.js';

const workspaceId = 'workspace';
const boardId = 'board';
const workspace = { workspaceId };
const board = { workspaceId, boardId };
const actor = 'actor';
const email = 'target@example.test';

function setup() {
  const tx = {
    $queryRaw: vi.fn(),
    account: { findFirst: vi.fn().mockResolvedValue({ id: 'recipient' }) },
    workspaceMembership: {
      findFirst: vi.fn().mockResolvedValue({ role: 'ADMIN' }),
      findUnique: vi.fn().mockResolvedValue({ accountId: 'recipient' }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ role: 'MEMBER' }),
      findMany: vi
        .fn()
        .mockResolvedValue([{ role: 'ADMIN', account: { emailKey: email } }]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    board: {
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({ id: boardId }),
      findMany: vi.fn().mockResolvedValue([{ id: boardId, name: 'Privado' }]),
    },
    boardMembership: {
      findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }),
      findFirst: vi.fn().mockResolvedValue({ accountId: 'another' }),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        {
          accountId: 'recipient',
          role: 'MEMBER',
          workspaceMember: { account: { emailKey: email } },
        },
      ]),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ role: 'MEMBER' }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    accessNotification: { createMany: vi.fn(), findMany: vi.fn() },
    accessNotificationDelivery: { createMany: vi.fn() },
    auditEvent: { createMany: vi.fn() },
    boardFeedEvent: {
      createMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
  const db = {
    ...tx,
    $transaction: (run: (value: typeof tx) => unknown) => run(tx),
  };
  return { tx, sharing: new SharingService(db as unknown as PrismaService) };
}

describe('SharingService', () => {
  it('returns administrative board metadata and explicit participant roles', async () => {
    const { sharing, tx } = setup();
    await expect(sharing.members(actor, workspace)).resolves.toEqual({
      members: [{ role: 'ADMIN', email }],
      boards: [{ id: boardId, name: 'Privado' }],
    });
    tx.workspaceMembership.findFirst.mockResolvedValue({ role: 'MEMBER' });
    await expect(sharing.members(actor, board)).resolves.toEqual({
      members: [{ accountId: 'recipient', role: 'MEMBER', email }],
      boards: [],
    });
    expect(tx.board.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: boardId,
          workspaceId,
          members: { some: { accountId: actor, role: 'ADMIN' } },
        },
      }),
    );
  });

  it('records Central, delivery, audit and the applicable feed only on new membership', async () => {
    const { sharing, tx } = setup();
    await sharing.include(actor, workspace, email.toUpperCase(), 'MEMBER');
    await sharing.include(actor, board, email, 'OBSERVER');
    expect(tx.accessNotification.createMany).toHaveBeenCalledTimes(2);
    expect(tx.accessNotificationDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(tx.auditEvent.createMany).toHaveBeenCalledTimes(2);
    expect(tx.boardFeedEvent.createMany).toHaveBeenCalledOnce();
    expect(tx.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ emailKey: email, status: 'ACTIVE' }),
      }),
    );
  });

  it('replays an existing grant and refuses to change its role', async () => {
    const { sharing, tx } = setup();
    tx.workspaceMembership.createMany.mockResolvedValue({ count: 0 });
    tx.boardMembership.createMany.mockResolvedValue({ count: 0 });
    await sharing.include(actor, workspace, email, 'MEMBER');
    await sharing.include(actor, board, email, 'MEMBER');
    await expect(
      sharing.include(actor, board, email, 'OBSERVER'),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(tx.accessNotification.createMany).not.toHaveBeenCalled();
  });

  it('validates input, authorization and the prerequisite Workspace membership', async () => {
    const { sharing, tx } = setup();
    await expect(
      sharing.include(actor, workspace, 'invalid', 'ADMIN'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      sharing.include(actor, workspace, email, 'OBSERVER'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    tx.workspaceMembership.findUnique.mockResolvedValue(null);
    await expect(
      sharing.include(actor, board, email, 'ADMIN'),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    tx.account.findFirst.mockResolvedValue(null);
    await expect(
      sharing.include(actor, workspace, email, 'ADMIN'),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    tx.workspaceMembership.findFirst.mockResolvedValue(null);
    await expect(
      sharing.include(actor, workspace, email, 'ADMIN'),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    expect(tx.auditEvent.createMany).toHaveBeenCalledTimes(3);
    expect(tx.accessNotification.createMany).not.toHaveBeenCalled();
  });

  it('audits denied administrative queries without resource or participant data', async () => {
    const { sharing, tx } = setup();
    tx.workspaceMembership.findFirst.mockResolvedValue(null);
    await expect(sharing.members(actor, workspace)).rejects.toMatchObject({
      code: 'REQUEST_FORBIDDEN',
    });
    await expect(sharing.members(actor, board)).rejects.toMatchObject({
      code: 'REQUEST_FORBIDDEN',
    });
    for (const [index, operation] of [
      'LIST_WORKSPACE_MEMBERS',
      'LIST_BOARD_MEMBERS',
    ].entries()) {
      expect(tx.auditEvent.createMany).toHaveBeenNthCalledWith(index + 1, {
        data: expect.objectContaining({
          actorAccountId: actor,
          operation,
          result: 'DENIED',
          scope: 'SECURITY',
        }),
      });
    }
    expect(tx.workspaceMembership.findMany).not.toHaveBeenCalled();
    expect(tx.boardMembership.findMany).not.toHaveBeenCalled();
  });

  it('queries notifications only for the current recipient with current membership', () => {
    const { sharing, tx } = setup();
    void sharing.notifications(actor);
    expect(tx.accessNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recipientId: actor,
          workspace: { members: { some: { accountId: actor } } },
          OR: [
            { boardId: null },
            { board: { members: { some: { accountId: actor } } } },
          ],
        },
      }),
    );
  });
  const change = {
    accountId: 'recipient',
    expectedRole: 'MEMBER',
    role: 'OBSERVER',
    operationId: 'change',
  } as const;

  it('confirms a role change and reconciles an exact repeat', async () => {
    const { sharing, tx } = setup();
    await sharing.changeBoardMember(actor, board, change);
    expect(tx.boardMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'OBSERVER' } }),
    );
    expect(tx.accessNotification.createMany).toHaveBeenCalledOnce();
    expect(tx.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { syncRevision: { increment: 1 } } }),
    );
    const { requestHash } = tx.boardFeedEvent.createMany.mock.calls[0]![0].data;
    tx.boardFeedEvent.findUnique.mockResolvedValue({ requestHash });
    await sharing.changeBoardMember(actor, board, change);
    await expect(
      sharing.changeBoardMember(actor, board, { ...change, role: null }),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(tx.auditEvent.createMany).toHaveBeenCalledOnce();
  });

  it('removes a participant and protects a board without another active administrator', async () => {
    const { sharing, tx } = setup();
    tx.boardMembership.findUnique.mockResolvedValue({ role: 'ADMIN' });
    tx.boardMembership.findFirst.mockResolvedValueOnce(null);
    await expect(
      sharing.changeBoardMember(actor, board, {
        ...change,
        expectedRole: 'ADMIN',
        role: null,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await sharing.changeBoardMember(actor, board, {
      ...change,
      expectedRole: 'ADMIN',
      role: null,
    });
    expect(tx.boardMembership.delete).toHaveBeenCalledOnce();
    expect(tx.accessNotification.createMany).not.toHaveBeenCalled();
  });

  it('rejects stale confirmations, ineligible recipients and access lost while waiting', async () => {
    const { sharing, tx } = setup();
    for (const stale of [
      { ...change, expectedRole: 'OBSERVER' },
      { ...change, role: 'MEMBER' },
    ] as const) {
      await expect(
        sharing.changeBoardMember(actor, board, stale),
      ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    }
    tx.account.findFirst.mockResolvedValue(null);
    await expect(
      sharing.changeBoardMember(actor, board, change),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    tx.workspaceMembership.findFirst
      .mockResolvedValueOnce({ role: 'MEMBER' })
      .mockResolvedValue(null);
    await expect(
      sharing.changeBoardMember(actor, board, change),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    expect(tx.boardMembership.update).not.toHaveBeenCalled();
    expect(tx.boardFeedEvent.createMany).not.toHaveBeenCalled();
  });
});
