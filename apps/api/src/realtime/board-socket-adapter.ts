import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { VerifyClientCallbackAsync } from 'ws';
import type { HttpSecurityConfig } from '../http/http-security.config.js';
import {
  BOARD_SOCKET_PATH,
  BoardRealtimeGateway,
} from './board-realtime.gateway.js';

export class BoardSocketAdapter extends WsAdapter {
  constructor(
    private readonly app: INestApplication,
    private readonly config: HttpSecurityConfig,
  ) {
    super(app, { maxConcurrentMessages: 1, maxSendBufferSize: 4096 });
  }

  override create(port: number, options?: Parameters<WsAdapter['create']>[1]) {
    if (options?.path !== BOARD_SOCKET_PATH) return super.create(port, options);
    const verifyClient: VerifyClientCallbackAsync = ({ req }, done) => {
      const gateway = this.app.get(BoardRealtimeGateway);
      void gateway.admit(req, this.config).then(
        (accepted) => (accepted ? done(true) : done(false, 403)),
        () => done(false, 403),
      );
    };
    return super.create(port, { ...options, verifyClient });
  }
}
