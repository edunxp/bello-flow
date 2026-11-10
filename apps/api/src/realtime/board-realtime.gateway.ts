import type { IncomingMessage } from 'node:http';
import { type OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { AuthenticationService } from '../auth/authentication.service.js';
import type { SessionToken } from '../auth/session-primitives.js';
import type { HttpSecurityConfig } from '../http/http-security.config.js';
import { validateMutatingRequestOrigin } from '../http/request-security.js';
import { readSessionCookie } from '../http/session-cookie.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const BOARD_SOCKET_PATH = '/api/realtime';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const connectionLimit = 128;
const bufferLimit = 4096;

interface Subscription {
  token: SessionToken;
  accountId: string;
  workspaceId: string;
  boardId: string;
}

interface Connection extends Subscription {
  alive: boolean;
  generation: number;
  running: boolean;
  revision?: number;
}

@WebSocketGateway({
  path: BOARD_SOCKET_PATH,
  maxPayload: 256,
  perMessageDeflate: false,
})
export class BoardRealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly admission = new WeakMap<IncomingMessage, Subscription>();
  private readonly connections = new Map<WebSocket, Connection>();
  private pending = 0;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private readonly authentication: AuthenticationService,
    private readonly db: PrismaService,
  ) {}

  async admit(request: IncomingMessage, config: HttpSecurityConfig) {
    if (
      this.stopped ||
      this.connections.size + this.pending >= connectionLimit ||
      request.headers.origin !== config.publicOrigin ||
      !validateMutatingRequestOrigin(request.rawHeaders, config.publicOrigin)
        .valid
    )
      return false;
    const cookie = readSessionCookie(request.rawHeaders, config.sessionCookie);
    if (cookie.status !== 'VALID') return false;
    const url = request.url ?? '';
    const separator = url.indexOf('?');
    if (separator < 0) return false;
    const params = new URLSearchParams(url.slice(separator + 1));
    const workspaceId = params.get('workspaceId');
    const boardId = params.get('boardId');
    if (
      params.size !== 2 ||
      !workspaceId ||
      !boardId ||
      !uuid.test(workspaceId) ||
      !uuid.test(boardId)
    )
      return false;

    this.pending++;
    try {
      const identity = await this.authentication.resolveAuthenticatedSession(
        cookie.token,
        false,
      );
      if (!identity) return false;
      const subscription = {
        token: cookie.token,
        workspaceId,
        boardId,
        accountId: identity.accountId,
      };
      if (!(await this.board(subscription)) || this.stopped) return false;
      this.admission.set(request, subscription);
      return true;
    } catch {
      return false;
    } finally {
      this.pending--;
    }
  }

  afterInit() {
    this.timer = setInterval(() => {
      for (const [socket, connection] of this.connections) {
        if (!connection.alive || socket.readyState !== socket.OPEN) {
          socket.terminate();
          continue;
        }
        connection.alive = false;
        socket.ping();
        this.queue(socket, connection);
      }
    }, 5000);
    this.timer.unref();
  }

  handleConnection(socket: WebSocket, request: IncomingMessage) {
    const subscription = this.admission.get(request);
    this.admission.delete(request);
    if (!subscription) {
      socket.close(1008);
      return;
    }
    if (this.stopped || this.connections.size >= connectionLimit) {
      socket.terminate();
      return;
    }
    const connection: Connection = {
      ...subscription,
      alive: true,
      generation: 0,
      running: false,
    };
    this.connections.set(socket, connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('ping', () => {
      if (socket.bufferedAmount > bufferLimit) socket.terminate();
    });
    socket.on('message', () => socket.close(1008));
    this.queue(socket, connection);
  }

  handleDisconnect(socket: WebSocket) {
    this.connections.delete(socket);
  }

  onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const socket of this.connections.keys()) socket.terminate();
    this.connections.clear();
  }

  invalidate(workspaceId?: string, boardId?: string) {
    for (const [socket, connection] of this.connections) {
      if (
        (!workspaceId || connection.workspaceId === workspaceId) &&
        (!boardId || connection.boardId === boardId)
      )
        this.queue(socket, connection);
    }
  }

  private board({ workspaceId, boardId, accountId }: Subscription) {
    return this.db.board.findFirst({
      where: { id: boardId, workspaceId, members: { some: { accountId } } },
      select: { syncRevision: true },
    });
  }

  private queue(socket: WebSocket, connection: Connection) {
    if (socket.readyState !== socket.OPEN) return;
    connection.generation++;
    if (connection.running) return;
    connection.running = true;
    void this.refresh(socket, connection);
  }

  private async refresh(socket: WebSocket, connection: Connection) {
    try {
      while (this.connections.get(socket) === connection) {
        const generation = connection.generation;
        const board = await this.board(connection);
        const identity = board
          ? await this.authentication.resolveAuthenticatedSession(
              connection.token,
              false,
            )
          : null;
        if (
          this.connections.get(socket) !== connection ||
          socket.readyState !== socket.OPEN
        )
          return;
        if (!board || identity?.accountId !== connection.accountId) {
          socket.close(1008);
          return;
        }
        if (generation !== connection.generation) continue;
        if (board.syncRevision !== connection.revision) {
          if (socket.bufferedAmount > bufferLimit) {
            socket.close(1013);
            return;
          }
          connection.revision = board.syncRevision;
          socket.send(
            JSON.stringify({
              boardId: connection.boardId,
              revision: board.syncRevision,
            }),
          );
        }
        return;
      }
    } catch {
      socket.close(1011);
    } finally {
      connection.running = false;
    }
  }
}
