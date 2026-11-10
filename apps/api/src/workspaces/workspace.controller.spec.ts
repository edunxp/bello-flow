import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationService } from '../auth/authentication.service.js';
import { HTTP_ERROR_CODE } from '../http/http-errors.js';
import { loadHttpSecurityConfig } from '../http/http-security.config.js';
import type { BoardContentService } from './board-content.service.js';
import type { SharingService } from './sharing.service.js';
import { WorkspaceController } from './workspace.controller.js';
import type { WorkspaceService } from './workspace.service.js';

const id = '40000000-0000-4000-8000-000000000001';
const origin = 'https://127.0.0.1:15444';

function setup() {
  const config = loadHttpSecurityConfig({
    NODE_ENV: 'test',
    BELLO_PUBLIC_ORIGIN: origin,
  });
  const identity = vi.fn().mockResolvedValue({ accountId: id });
  const workspaces = {
    list: vi.fn(),
    labels: vi.fn(),
    changeLabel: vi.fn(),
    create: vi.fn(),
    listBoards: vi.fn(),
    board: vi.fn(),
    createBoard: vi.fn(),
  };
  const content = {
    read: vi.fn(),
    write: vi.fn(),
    revision: vi.fn(),
    schedule: vi.fn(),
    changeAssignee: vi.fn(),
    changeCardLabel: vi.fn(),
    comments: vi.fn(),
    changeComment: vi.fn(),
    move: vi.fn(),
  };
  const sharing = { changeBoardMember: vi.fn(), boardMemberImpact: vi.fn() };
  const controller = new WorkspaceController(
    workspaces as unknown as WorkspaceService,
    {
      resolveAuthenticatedSession: identity,
    } as unknown as AuthenticationService,
    sharing as unknown as SharingService,
    content as unknown as BoardContentService,
  );
  const headers = [
    'X-Bello-Flow-Request',
    '1',
    'Origin',
    origin,
    'Content-Type',
    'application/json',
    'Cookie',
    config.sessionCookie.name + '=' + 'A'.repeat(43),
  ];
  function request(body?: unknown, rawHeaders = headers) {
    return {
      app: { get: () => config },
      res: { setHeader: vi.fn() },
      rawHeaders,
      body,
    } as unknown as Request;
  }
  return {
    controller,
    workspaces,
    content,
    identity,
    request,
    headers,
    sharing,
  };
}

describe('WorkspaceController', () => {
  it('passes the account resolved from the session to resource queries', async () => {
    const { controller, request, workspaces } = setup();
    const req = request();
    await controller.list(req);
    await controller.boards(req, id);
    await controller.board(req, id, id);
    expect(workspaces.list).toHaveBeenCalledWith(id);
    expect(workspaces.listBoards).toHaveBeenCalledWith(id, id);
    expect(workspaces.board).toHaveBeenCalledWith(id, id, id);
    expect(req.res?.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    await expect(controller.boards(req, 'invalid')).rejects.toMatchObject({
      code: HTTP_ERROR_CODE.INVALID_REQUEST,
    });
  });

  it('normalizes names and preserves descriptions', async () => {
    const { controller, request, workspaces } = setup();
    await controller.create(
      request({
        operationId: id,
        name: ' Trabalho ',
        timeZone: 'America/Sao_Paulo',
      }),
    );
    await controller.create(
      request({
        operationId: id,
        name: 'Pessoal',
        description: ' Texto ',
        timeZone: 'Etc/UTC',
      }),
    );
    await controller.createBoard(
      request({ operationId: id, name: ' ERP ', description: ' Descrição ' }),
      id,
    );
    expect(workspaces.create).toHaveBeenNthCalledWith(1, id, id, {
      name: 'Trabalho',
      description: undefined,
      timeZone: 'America/Sao_Paulo',
    });
    expect(workspaces.create).toHaveBeenNthCalledWith(2, id, id, {
      name: 'Pessoal',
      description: ' Texto ',
      timeZone: 'Etc/UTC',
    });
    expect(workspaces.createBoard).toHaveBeenCalledWith(id, id, id, {
      name: 'ERP',
      description: ' Descrição ',
    });
  });

  it.each([
    undefined,
    { name: ' ', timeZone: 'Etc/UTC' },
    { name: 'a'.repeat(101), timeZone: 'Etc/UTC' },
    { name: 'Pessoal', timeZone: '+01:00' },
    { name: 'Pessoal', timeZone: 'Invalid/Zone' },
    { name: 'Pessoal', timeZone: 'Etc/UTC' },
  ])('rejects invalid workspace input', async (body) => {
    const { controller, request, workspaces } = setup();
    await expect(controller.create(request(body))).rejects.toMatchObject({
      code: HTTP_ERROR_CODE.INVALID_REQUEST,
    });
    expect(workspaces.create).not.toHaveBeenCalled();
  });

  it('requires the application header, same-origin JSON mutations and a session', async () => {
    const { controller, request, headers, identity } = setup();
    await expect(controller.list(request(undefined, []))).rejects.toMatchObject(
      {
        code: HTTP_ERROR_CODE.REQUEST_FORBIDDEN,
      },
    );
    await expect(
      controller.create(
        request(undefined, headers.with(3, 'https://foreign.test')),
      ),
    ).rejects.toMatchObject({
      code: HTTP_ERROR_CODE.REQUEST_FORBIDDEN,
    });
    await expect(
      controller.create(request(undefined, headers.with(5, 'text/plain'))),
    ).rejects.toMatchObject({
      code: HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
    });
    await expect(
      controller.list(request(undefined, headers.slice(0, 6))),
    ).rejects.toMatchObject({
      code: HTTP_ERROR_CODE.UNAUTHENTICATED,
    });
    identity.mockResolvedValue(null);
    await expect(controller.list(request())).rejects.toMatchObject({
      code: HTTP_ERROR_CODE.UNAUTHENTICATED,
    });
  });
});

describe('WorkspaceController board content', () => {
  const params = { workspaceId: id, boardId: id };
  const item = { ...params, listId: id };
  const card = { ...item, cardId: id };

  it('scopes reads and writes to the authenticated board', async () => {
    const { controller, request, content } = setup();
    const context = { ...params, accountId: id };
    await controller.lists(request(), params);
    expect(content.read).toHaveBeenCalledWith(context);
    await controller.writeList(
      request({ name: ' A fazer ', operationId: id }),
      params,
    );
    expect(content.write).toHaveBeenLastCalledWith(
      context,
      { name: 'A fazer' },
      id,
    );
    await controller.editList(request({ name: 'Concluído' }), item);
    expect(content.write).toHaveBeenLastCalledWith(
      context,
      { name: 'Concluído', listId: id },
      '',
    );
    await controller.writeCard(
      request({ title: 'Título', operationId: id }),
      item,
    );
    expect(content.write).toHaveBeenLastCalledWith(
      context,
      { title: 'Título', description: null, listId: id },
      id,
    );
    const description = ' 📝 '.repeat(6666);
    await controller.editCard(request({ title: ' Novo ', description }), card);
    expect(content.write).toHaveBeenLastCalledWith(
      context,
      {
        title: 'Novo',
        description,
        listId: id,
        cardId: id,
      },
      '',
    );
  });

  it('rejects invalid fields and direct identifiers before calling the service', async () => {
    const { controller, request, content } = setup();
    await expect(
      controller.lists(request(), { ...params, boardId: 'bad' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    for (const description of [false, '\0', '\ud800', '📝'.repeat(20_001)]) {
      await expect(
        controller.editCard(request({ title: 'Título', description }), card),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await expect(
      controller.editList(request({ name: '  ' }), item),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(content.write).not.toHaveBeenCalled();
  });
});

describe('order HTTP contract', () => {
  it('validates revisions, neighbors and item identifiers before mutating', async () => {
    const { controller, request, content } = setup();
    const scope = { workspaceId: id, boardId: id };
    await controller.orderRevision(request(), scope);
    expect(content.revision).toHaveBeenCalledWith({ ...scope, accountId: id });
    const neighbor = '11111111-1111-4111-8111-111111111111';
    const move = {
      kind: 'CARD',
      itemId: id,
      sourceId: id,
      destinationId: id,
      operationId: id,
      leftId: null,
      rightId: neighbor,
      itemRevision: 0,
      sourceRevision: 1,
      destinationRevision: 1,
    };
    await controller.move(request(move), scope);
    await controller.move(
      request({ ...move, kind: 'LIST', leftId: neighbor, rightId: null }),
      scope,
    );
    expect(content.move).toHaveBeenCalledTimes(2);
    for (const change of [
      { kind: 'UNKNOWN' },
      { leftId: id },
      { rightId: id },
      { leftId: neighbor },
      { itemRevision: '0' },
      { itemRevision: 0.5 },
      { itemRevision: -1 },
      { itemRevision: 2147483648 },
    ]) {
      await expect(
        controller.move(request({ ...move, ...change }), scope),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
});

describe('board membership change HTTP contract', () => {
  it('requires valid confirmation, role and operation identity', async () => {
    const { controller, request, sharing } = setup();
    const scope = { workspaceId: id, boardId: id };
    const change = {
      accountId: id,
      expectedRole: 'MEMBER',
      role: 'OBSERVER',
      operationId: id,
    };
    await controller.changeBoardMember(request(change), scope);
    await controller.changeBoardMember(
      request({ ...change, role: null }),
      scope,
    );
    expect(sharing.changeBoardMember).toHaveBeenNthCalledWith(
      1,
      id,
      { ...scope, accountId: id },
      change,
    );
    expect(sharing.changeBoardMember).toHaveBeenCalledTimes(2);
    for (const bad of [
      { role: undefined },
      { expectedRole: null },
      { operationId: 'bad' },
    ]) {
      await expect(
        controller.changeBoardMember(request({ ...change, ...bad }), scope),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
});

describe('schedule HTTP contract', () => {
  it('accepts dates or completion, validates civil order and rejects mixed changes', async () => {
    const { controller, request, content } = setup();
    const params = { workspaceId: id, boardId: id, listId: id, cardId: id };
    const context = { workspaceId: id, boardId: id, accountId: id };
    await controller.scheduleCard(
      request({ operationId: id, completed: false }),
      params,
    );
    expect(content.schedule).toHaveBeenLastCalledWith(
      context,
      id,
      id,
      { completed: false },
      id,
    );
    await controller.scheduleCard(
      request({ operationId: id, startDate: null, dueDate: '2026-11-10' }),
      params,
    );
    expect(content.schedule).toHaveBeenLastCalledWith(
      context,
      id,
      id,
      { startDate: null, dueDate: new Date('2026-11-10') },
      id,
    );
    for (const body of [
      { completed: 'true' },
      { completed: true, dueDate: null },
      { completed: true, startDate: null },
      { startDate: '2026-11-11', dueDate: '2026-11-10' },
      { startDate: '2026-11-11', dueDate: '2026-11-11T00:00:00Z' },
    ]) {
      await expect(
        controller.scheduleCard(request({ ...body, operationId: id }), params),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
});

describe('assignee HTTP contract', () => {
  it('validates assignment flags and impact tokens', async () => {
    const { controller, request, content, sharing } = setup();
    const params = {
      workspaceId: id,
      boardId: id,
      listId: id,
      cardId: id,
      accountId: id,
    };
    const body = { accountId: id, assigned: true, operationId: id };
    await controller.changeAssignee(request(body), params);
    expect(content.changeAssignee).toHaveBeenCalledWith(
      { workspaceId: id, boardId: id, accountId: id },
      id,
      id,
      id,
      true,
      id,
    );
    await controller.assignmentImpact(request(), params);
    expect(sharing.boardMemberImpact).toHaveBeenCalledOnce();
    await expect(
      controller.changeAssignee(request({ ...body, assigned: 'yes' }), params),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const change = {
      accountId: id,
      role: null,
      expectedRole: 'MEMBER',
      operationId: id,
    };
    for (const invalid of [
      { impactToken: 4 },
      { impactToken: 'bad' },
      { confirmAssignments: 'true' },
    ]) {
      await expect(
        controller.changeBoardMember(
          request({ ...change, ...invalid }),
          params,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await controller.changeBoardMember(
      request({
        ...change,
        impactToken: 'a'.repeat(64),
        confirmAssignments: true,
      }),
      params,
    );
  });
});

describe('label HTTP contract', () => {
  it('validates Unicode names, optional colors, confirmation and association intent', async () => {
    const { controller, request, workspaces, content } = setup();
    const scope = {
      workspaceId: id,
      boardId: id,
      listId: id,
      cardId: id,
      labelId: id,
    };
    const fields = { name: '  Étapa  ', color: '#AABBCC', operationId: id };
    await controller.labels(request(), id);
    await controller.createLabel(request(fields), id);
    expect(workspaces.changeLabel).toHaveBeenLastCalledWith(
      id,
      id,
      { kind: 'CREATE', fields: { name: 'Étapa', color: '#aabbcc' } },
      id,
    );
    await controller.editLabel(request({ ...fields, color: null }), scope);
    await controller.deleteLabel(
      request({ ...fields, confirmed: true }),
      scope,
    );
    await controller.changeCardLabel(
      request({ labelId: id, applied: true, operationId: id }),
      scope,
    );
    expect(content.changeCardLabel).toHaveBeenCalledOnce();
    for (const change of [
      { name: ' ' },
      { name: '🧪'.repeat(51) },
      { color: 4 },
      { color: 'red' },
    ]) {
      await expect(
        controller.createLabel(request({ ...fields, ...change }), id),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await expect(
      controller.deleteLabel(request(fields), scope),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      controller.changeCardLabel(
        request({ labelId: id, applied: 'yes' }),
        scope,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('comment HTTP contract', () => {
  it('requires meaningful text, version and confirmation for the applicable actions', async () => {
    const { controller, request, content } = setup();
    const params = { workspaceId: id, boardId: id, listId: id, cardId: id };
    await controller.comments(request(), params);
    expect(content.comments).toHaveBeenCalledOnce();
    const send = (fields: object) =>
      controller.changeComment(request({ operationId: id, ...fields }), params);
    const current = { id, version: 'a'.repeat(64) };
    await send({ kind: 'CREATE', content: ' Linha um \n Linha dois ' });
    await send({ kind: 'EDIT', ...current, content: 'Mudança' });
    await send({ kind: 'REMOVE', ...current, confirmed: true });
    await send({
      kind: 'MODERATE',
      ...current,
      confirmed: true,
      justification: 'Motivo',
    });
    expect(content.changeComment).toHaveBeenCalledTimes(4);
    for (const bad of [
      { kind: 'CREATE', content: '\u200b' },
      { kind: 'CREATE', content: '🧪'.repeat(10001) },
      { kind: 'EDIT', ...current, version: 'stale', content: 'Mudança' },
      { kind: 'REMOVE', ...current, confirmed: false },
      { kind: 'MODERATE', ...current, confirmed: true, justification: ' ' },
      {
        kind: 'MODERATE',
        ...current,
        confirmed: true,
        justification: 'a'.repeat(2001),
      },
    ]) {
      await expect(send(bad)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    }
  });
});
