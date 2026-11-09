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
    const board = {
      archived,
      members: [{ role }],
      lists: [],
      orderRevision: 0,
      syncRevision: 0,
      workspace: { timeZone: 'Etc/UTC' },
    };
    const tx = {
      $queryRaw: vi.fn(),
      board: { findFirst: vi.fn().mockResolvedValue(board), update: vi.fn() },
      boardList: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        createMany: vi.fn(),
        update: vi.fn(),
      },
      boardCard: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        createMany: vi.fn(),
        update: vi.fn(),
      },
      auditEvent: { createMany: vi.fn() },
      boardFeedEvent: {
        createMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const db = {
      $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
      auditEvent: tx.auditEvent,
      board: tx.board,
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
        orderRevision: 0,
        syncRevision: 0,
        timeZone: 'Etc/UTC',
        today: expect.any(String),
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
  const intent = {
    itemId: 'item',
    sourceId: 'board',
    destinationId: 'board',
    leftId: null,
    rightId: 'anchor',
    itemRevision: 0,
    sourceRevision: 0,
    destinationRevision: 0,
    operationId: 'move',
  };

  it('moves a list and reconciles a committed repeat from its feed receipt', async () => {
    const { service, tx, db } = setup();
    tx.boardList.findFirst.mockResolvedValue({ positionRevision: 0 });
    tx.boardList.findMany.mockResolvedValue([
      { id: 'anchor', position: 100n },
      { id: 'item', position: 200n },
    ]);
    await expect(service.move(context, 'LIST', intent)).resolves.toEqual({
      confirmed: true,
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
    expect(tx.boardList.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { position: 50n, positionRevision: { increment: 1 } },
      }),
    );
    const { requestHash } = tx.boardFeedEvent.createMany.mock.calls[0]![0].data;
    tx.boardFeedEvent.findUnique.mockResolvedValue({ requestHash });
    await expect(service.move(context, 'LIST', intent)).resolves.toEqual({
      confirmed: true,
    });
    await expect(
      service.move(context, 'LIST', { ...intent, rightId: null }),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(tx.auditEvent.createMany).toHaveBeenCalledOnce();
  });

  it('rereads a changed card source before moving it and advances both container revisions', async () => {
    const { service, tx, db } = setup();
    const current = { listId: 'actual', positionRevision: 1 };
    tx.boardCard.findFirst
      .mockResolvedValueOnce({ listId: 'old', positionRevision: 0 })
      .mockResolvedValue(current);
    tx.boardList.findFirst.mockResolvedValue({ id: 'new' });
    tx.boardList.findMany.mockResolvedValue([
      { id: 'old', cardOrderRevision: 1 },
      { id: 'new', cardOrderRevision: 0 },
    ]);
    tx.boardCard.findMany
      .mockResolvedValueOnce([{ id: 'item', position: 20n }])
      .mockResolvedValueOnce([]);
    await service.move(context, 'CARD', {
      ...intent,
      sourceId: 'old',
      destinationId: 'new',
      rightId: null,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.boardCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ listId: 'new' }),
      }),
    );
    expect(tx.boardList.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['actual', 'new'] } },
      }),
    );
  });

  it('rejects hidden containers, invalid revisions and no-op moves', async () => {
    const { service, tx } = setup();
    await expect(
      service.move(context, 'LIST', { ...intent, destinationId: 'foreign' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(service.move(context, 'CARD', intent)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    tx.boardCard.findFirst.mockResolvedValue({
      listId: 'actual',
      positionRevision: 0,
    });
    await expect(service.move(context, 'CARD', intent)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(service.move(context, 'LIST', intent)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    tx.boardList.findFirst.mockResolvedValue({ positionRevision: 0 });
    tx.boardList.findMany.mockResolvedValue([
      { id: 'item', position: 100n },
      { id: 'anchor', position: 200n },
    ]);
    for (const change of [
      { itemRevision: 1 },
      { sourceRevision: 1 },
      { destinationRevision: 1 },
      {},
    ]) {
      await expect(
        service.move(context, 'LIST', { ...intent, ...change }),
      ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    }
    expect(tx.boardFeedEvent.createMany).not.toHaveBeenCalled();
  });

  it('rechecks membership after the locks and protects revision reads', async () => {
    const { service, tx } = setup();
    tx.board.findFirst
      .mockResolvedValueOnce({ archived: false, members: [{ role: 'ADMIN' }] })
      .mockResolvedValue(null);
    await expect(service.move(context, 'LIST', intent)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(service.revision(context)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    tx.board.findFirst
      .mockResolvedValueOnce({ archived: false, members: [{ role: 'ADMIN' }] })
      .mockResolvedValue({
        archived: false,
        members: [{ role: 'OBSERVER' }],
        syncRevision: 2,
        workspace: { timeZone: 'Etc/UTC' },
      });
    await expect(service.move(context, 'LIST', intent)).rejects.toMatchObject({
      code: 'REQUEST_FORBIDDEN',
    });
    await expect(service.move(context, 'LIST', intent)).rejects.toMatchObject({
      code: 'REQUEST_FORBIDDEN',
    });
    await expect(service.revision(context)).resolves.toMatchObject({
      syncRevision: 2,
    });
  });
  const unscheduled = {
    startDate: null,
    dueDate: null,
    completedAt: null,
    completedById: null,
  };

  it('sets civil dates separately and reconciles an exact repeat', async () => {
    const { service, tx } = setup();
    tx.boardCard.findFirst.mockResolvedValue(unscheduled);
    await expect(
      service.schedule(
        context,
        'list',
        'card',
        { startDate: null, dueDate: null },
        'dates',
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    const change = {
      startDate: null,
      dueDate: new Date('2026-11-10T00:00:00.000Z'),
    };
    await service.schedule(context, 'list', 'card', change, 'dates');
    expect(tx.boardCard.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: change }),
    );
    expect(tx.auditEvent.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'CARD_DATES_CHANGED',
        afterData: { startDate: null, dueDate: '2026-11-10' },
      }),
    });
    const { requestHash } = tx.boardFeedEvent.createMany.mock.calls[0]![0].data;
    tx.boardFeedEvent.findUnique.mockResolvedValue({ requestHash });
    await service.schedule(context, 'list', 'card', change, 'dates');
    await expect(
      service.schedule(context, 'list', 'card', { completed: true }, 'dates'),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(tx.boardFeedEvent.createMany).toHaveBeenCalledOnce();
  });

  it('records the completion actor and instant and keeps them in audit on reopen', async () => {
    const { service, tx } = setup();
    tx.boardCard.findFirst.mockResolvedValue(unscheduled);
    await service.schedule(
      context,
      'list',
      'card',
      { completed: true },
      'complete',
    );
    const { completedAt } = tx.boardCard.update.mock.calls[0]![0].data;
    expect(tx.boardCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { completedAt: expect.any(Date), completedById: 'actor' },
      }),
    );
    tx.boardCard.findFirst.mockResolvedValue({
      ...unscheduled,
      completedAt,
      completedById: 'actor',
    });
    await service.schedule(
      context,
      'list',
      'card',
      { completed: false },
      'reopen',
    );
    expect(tx.auditEvent.createMany).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        operation: 'CARD_REOPENED',
        beforeData: {
          completedAt: completedAt.toISOString(),
          completedById: 'actor',
        },
        afterData: { completedAt: null, completedById: null },
      }),
    });
  });

  it('denies observers and hides cards from foreign containers', async () => {
    const { service, tx } = setup('OBSERVER');
    const write = () =>
      service.schedule(
        context,
        'list',
        'card',
        { completed: true },
        'complete',
      );
    await expect(write()).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    tx.board.findFirst.mockResolvedValue({
      archived: false,
      members: [{ role: 'ADMIN' }],
    });
    await expect(write()).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    tx.board.findFirst.mockResolvedValue(null);
    await expect(write()).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(tx.boardCard.update).not.toHaveBeenCalled();
  });
  it('uses the workspace deadline for overdue cards in the authorized snapshot', async () => {
    const { service, tx } = setup();
    tx.board.findFirst.mockResolvedValue({
      archived: false,
      members: [{ role: 'OBSERVER' }],
      orderRevision: 1,
      syncRevision: 2,
      workspace: { timeZone: 'America/Sao_Paulo' },
      lists: [
        {
          id: 'list',
          cards: [
            {
              ...unscheduled,
              id: 'card',
              dueDate: new Date('2026-11-09T00:00:00.000Z'),
            },
          ],
        },
      ],
    });
    tx.$queryRaw.mockResolvedValue([{ id: 'card' }]);
    await expect(service.read(context)).resolves.toMatchObject({
      editable: false,
      timeZone: 'America/Sao_Paulo',
      lists: [{ cards: [{ dueDate: '2026-11-09', overdue: true }] }],
    });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
  });
});
