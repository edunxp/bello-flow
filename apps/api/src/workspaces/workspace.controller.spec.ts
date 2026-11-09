import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationService } from '../auth/authentication.service.js';
import { HTTP_ERROR_CODE } from '../http/http-errors.js';
import { loadHttpSecurityConfig } from '../http/http-security.config.js';
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
    create: vi.fn(),
    listBoards: vi.fn(),
    board: vi.fn(),
    createBoard: vi.fn(),
  };
  const controller = new WorkspaceController(
    workspaces as unknown as WorkspaceService,
    {
      resolveAuthenticatedSession: identity,
    } as unknown as AuthenticationService,
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
  return { controller, workspaces, identity, request, headers };
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
