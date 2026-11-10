import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { AuthenticationService } from '../auth/authentication.service.js';
import { loadHttpSecurityConfig } from '../http/http-security.config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BoardRealtimeGateway } from './board-realtime.gateway.js';

const config = loadHttpSecurityConfig({
  NODE_ENV: 'test',
  BELLO_PUBLIC_ORIGIN: 'https://example.test',
});
const workspaceId = '00000000-0000-4000-8000-000000000001';
const boardId = '00000000-0000-4000-8000-000000000002';
const accountId = '00000000-0000-4000-8000-000000000003';
const token = 'A'.repeat(43);

function request(
  origin = config.publicOrigin,
  query = `workspaceId=${workspaceId}&boardId=${boardId}`,
  cookie = token,
) {
  return {
    url: '/api/realtime?' + query,
    headers: { origin },
    rawHeaders: [
      'Origin',
      origin,
      'Cookie',
      config.sessionCookie.name + '=' + cookie,
    ],
  } as IncomingMessage;
}

function setup() {
  const resolveAuthenticatedSession = vi.fn().mockResolvedValue({ accountId });
  const findFirst = vi.fn().mockResolvedValue({ syncRevision: 0 });
  const gateway = new BoardRealtimeGateway(
    { resolveAuthenticatedSession } as unknown as AuthenticationService,
    { board: { findFirst } } as unknown as PrismaService,
  );
  const socket = createSocket();
  return {
    gateway,
    socket,
    ws: socket as unknown as WebSocket,
    resolveAuthenticatedSession,
    findFirst,
  };
}

function createSocket() {
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    on: vi.fn(),
  };
  socket.close.mockImplementation(() => {
    socket.readyState = 2;
  });
  return socket;
}

describe('BoardRealtimeGateway', () => {
  it('rejects foreign origins, invalid credentials and invalid scopes before upgrade', async () => {
    const { gateway, findFirst, resolveAuthenticatedSession } = setup();
    expect(await gateway.admit(request('https://foreign.test'), config)).toBe(
      false,
    );
    expect(
      await gateway.admit(request(config.publicOrigin, '', 'bad'), config),
    ).toBe(false);
    expect(
      await gateway.admit(
        request(config.publicOrigin, 'boardId=bad&workspaceId=bad'),
        config,
      ),
    ).toBe(false);
    expect(
      await gateway.admit(request(config.publicOrigin, 'boardId=bad'), config),
    ).toBe(false);
    expect(resolveAuthenticatedSession).not.toHaveBeenCalled();
    resolveAuthenticatedSession.mockResolvedValueOnce(null);
    expect(await gateway.admit(request(), config)).toBe(false);
    findFirst.mockResolvedValueOnce(null);
    expect(await gateway.admit(request(), config)).toBe(false);
    findFirst.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await gateway.admit(request(), config)).toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: boardId, workspaceId, members: { some: { accountId } } },
      select: { syncRevision: true },
    });
  });

  it('reports only new revisions and closes when membership is lost', async () => {
    const { gateway, socket, ws, findFirst, resolveAuthenticatedSession } =
      setup();
    const req = request();
    expect(await gateway.admit(req, config)).toBe(true);
    gateway.handleConnection(ws, req);
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ boardId, revision: 0 }),
      ),
    );
    expect(resolveAuthenticatedSession).toHaveBeenLastCalledWith(token, false);
    gateway.invalidate(workspaceId, accountId);
    gateway.invalidate(accountId, boardId);
    expect(findFirst).toHaveBeenCalledTimes(2);
    gateway.invalidate(workspaceId, boardId);
    await vi.waitFor(() => expect(findFirst).toHaveBeenCalledTimes(3));
    expect(socket.send).toHaveBeenCalledTimes(1);
    findFirst.mockResolvedValueOnce({ syncRevision: 4 });
    gateway.invalidate(workspaceId, boardId);
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenLastCalledWith(
        JSON.stringify({ boardId, revision: 4 }),
      ),
    );
    findFirst.mockResolvedValueOnce(null);
    gateway.invalidate(workspaceId, boardId);
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1008));
    expect(socket.send).toHaveBeenCalledTimes(2);
    gateway.handleDisconnect(ws);
  });

  it('checks idle connections and terminates peers that stop answering', async () => {
    vi.useFakeTimers();
    const { gateway, socket, ws, findFirst } = setup();
    try {
      gateway.afterInit();
      const req = request();
      expect(await gateway.admit(req, config)).toBe(true);
      gateway.handleConnection(ws, req);
      await vi.advanceTimersByTimeAsync(5000);
      expect(socket.ping).toHaveBeenCalledTimes(1);
      expect(findFirst.mock.calls.length).toBeGreaterThanOrEqual(2);
      const pong = socket.on.mock.calls.find(
        ([event]) => event === 'pong',
      )?.[1] as () => void;
      pong();
      await vi.advanceTimersByTimeAsync(5000);
      expect(socket.ping).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5000);
      expect(socket.terminate).toHaveBeenCalledOnce();
    } finally {
      gateway.onModuleDestroy();
      vi.useRealTimers();
    }
  });

  it('keeps closing sockets in the connection limit until disconnect', async () => {
    const { gateway } = setup();
    const sockets = Array.from({ length: 128 }, createSocket);
    for (const socket of sockets) {
      const req = request();
      expect(await gateway.admit(req, config)).toBe(true);
      gateway.handleConnection(socket as unknown as WebSocket, req);
    }
    const closing = sockets[0];
    const message = closing.on.mock.calls.find(
      ([event]) => event === 'message',
    )?.[1] as () => void;
    message();
    expect(await gateway.admit(request(), config)).toBe(false);
    gateway.handleDisconnect(closing as unknown as WebSocket);
    expect(await gateway.admit(request(), config)).toBe(true);
    gateway.onModuleDestroy();
  });

  it('stops buffering for clients that do not read their frames', async () => {
    const { gateway, ws, socket, findFirst } = setup();
    const req = request();
    expect(await gateway.admit(req, config)).toBe(true);
    gateway.handleConnection(ws, req);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const ping = socket.on.mock.calls.find(
      ([event]) => event === 'ping',
    )?.[1] as () => void;
    ping();
    expect(socket.terminate).not.toHaveBeenCalled();
    socket.bufferedAmount = 4097;
    ping();
    expect(socket.terminate).toHaveBeenCalledOnce();
    findFirst.mockResolvedValueOnce({ syncRevision: 1 });
    gateway.invalidate();
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1013));
    expect(socket.send).toHaveBeenCalledOnce();
  });

  it('rejects client messages and connections without admission', async () => {
    const { gateway, ws, socket } = setup();
    gateway.handleConnection(ws, request());
    expect(socket.close).toHaveBeenCalledWith(1008);
    socket.readyState = socket.OPEN;
    const req = request();
    expect(await gateway.admit(req, config)).toBe(true);
    gateway.handleConnection(ws, req);
    const message = socket.on.mock.calls.find(
      ([event]) => event === 'message',
    )?.[1] as () => void;
    message();
    expect(socket.close).toHaveBeenCalledTimes(2);
  });
});
