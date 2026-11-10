import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { tap } from 'rxjs';
import { BoardRealtimeGateway } from './board-realtime.gateway.js';

@Injectable()
export class RevisionNotificationInterceptor implements NestInterceptor {
  constructor(private readonly gateway: BoardRealtimeGateway) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>) {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== 'POST' && request.method !== 'PATCH')
      return next.handle();
    const { workspaceId, boardId } = request.params;
    if (typeof workspaceId === 'string') {
      return next
        .handle()
        .pipe(
          tap(() =>
            this.gateway.invalidate(
              workspaceId,
              typeof boardId === 'string' ? boardId : undefined,
            ),
          ),
        );
    }
    if (
      [
        '/api/auth/logout',
        '/api/auth/logout-all',
        '/api/auth/password-reset',
      ].includes(request.path)
    )
      return next.handle().pipe(tap(() => this.gateway.invalidate()));
    return next.handle();
  }
}
