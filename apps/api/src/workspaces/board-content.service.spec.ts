import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BoardContentService } from './board-content.service.js';

describe('BoardContentService', () => {
  const context = {
    accountId: 'actor',
    workspaceId: 'workspace',
    boardId: 'board',
  };

  function setup(role = 'MEMBER', archived = false) {
    const board = { archived, members: [{ role }], lists: [] };
    const tx = {
      board: { findFirst: vi.fn().mockResolvedValue(board) },
      boardList: {
        findFirst: vi.fn().mockResolvedValue(null),
        createMany: vi.fn(),
        update: vi.fn(),
      },
      boardCard: {
        findFirst: vi.fn().mockResolvedValue(null),
        createMany: vi.fn(),
        update: vi.fn(),
      },
      auditEvent: { createMany: vi.fn() },
      boardFeedEvent: { createMany: vi.fn() },
    };
    const db = {
      $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
      auditEvent: tx.auditEvent,
    };
    const service = new BoardContentService(db as unknown as PrismaService);
    return { service, tx, db };
  }

  it.each([
    ['ADMIN', false, true],
    ['MEMBER', false, true],
    ['OBSERVER', false, false],
    ['ADMIN', true, false],
  ] as const)(
    'returns readable content and the write capability for %s',
    async (role, archived, editable) => {
      const { service } = setup(role, archived);
      await expect(service.read(context)).resolves.toEqual({
        editable,
        lists: [],
      });
    },
  );

  it('hides content from nonparticipants and audits denied writes from observers', async () => {
    const { service, tx } = setup('OBSERVER');
    await expect(
      service.write(context, { name: 'Lista' }, 'operation'),
    ).rejects.toMatchObject({
      code: 'REQUEST_FORBIDDEN',
    });
    tx.board.findFirst.mockResolvedValue(null);
    await expect(service.read(context)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(
      service.write(context, { name: 'Lista' }, 'operation'),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(tx.auditEvent.createMany).toHaveBeenCalledTimes(3);
    expect(tx.boardFeedEvent.createMany).not.toHaveBeenCalled();
  });

  it('replays a creation by the original fields even after renaming', async () => {
    const { service, tx } = setup();
    const created = await service.write(
      context,
      { name: 'Original' },
      'operation',
    );
    const { data } = tx.boardList.createMany.mock.calls[0]![0];
    tx.boardList.findFirst.mockResolvedValue({ ...data, name: 'Novo' });
    await expect(
      service.write(context, { name: 'Original' }, 'operation'),
    ).resolves.toEqual({
      id: created?.id,
      name: 'Novo',
    });
    await expect(
      service.write(context, { name: 'Outro' }, 'operation'),
    ).rejects.toMatchObject({
      code: 'OPERATION_CONFLICT',
    });
    expect(tx.boardFeedEvent.createMany).toHaveBeenCalledTimes(1);
  });

  it('checks parent ownership and suppresses events for unchanged data', async () => {
    const { service, tx } = setup();
    const card = { id: 'card', title: 'Antes', description: 'Descrição' };
    const mutation = {
      listId: 'list',
      cardId: 'card',
      title: undefined,
      description: null,
    };
    await expect(service.write(context, mutation, '')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    tx.boardList.findFirst.mockResolvedValue({ id: 'list', name: 'Antes' });
    await expect(service.write(context, mutation, '')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    tx.boardCard.findFirst.mockResolvedValue(card);
    await expect(service.write(context, mutation, '')).resolves.toEqual({
      ...card,
      description: null,
    });
    expect(tx.auditEvent.createMany).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        beforeData: { id: 'card', description: 'Descrição' },
        afterData: { id: 'card', description: null },
      }),
    });
    await service.write(context, { ...mutation, description: undefined }, '');
    expect(tx.boardCard.update).toHaveBeenCalledTimes(1);
    expect(tx.boardFeedEvent.createMany).toHaveBeenCalledTimes(1);
    await service.write(context, { name: 'Depois', listId: 'list' }, '');
    expect(tx.boardList.update).toHaveBeenCalledTimes(1);
  });

  it('revalidates a proven conflict and leaves unknown outcomes for reconciliation', async () => {
    const { service, tx, db } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    db.$transaction.mockRejectedValueOnce(conflict);
    tx.boardList.findFirst.mockResolvedValue({ id: 'list' });
    await service.write(
      context,
      { listId: 'list', title: 'Cartão', description: null },
      'operation',
    );
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.boardCard.createMany).toHaveBeenCalledTimes(1);

    const disconnected = new Error('disconnected');
    db.$transaction.mockRejectedValueOnce(disconnected);
    await expect(
      service.write(context, { name: 'Lista' }, 'operation'),
    ).rejects.toBe(disconnected);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    db.$transaction.mockRejectedValue(conflict);
    await expect(service.read(context)).rejects.toBe(conflict);
    expect(db.$transaction).toHaveBeenCalledTimes(6);
  });
});
