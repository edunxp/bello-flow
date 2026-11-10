import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AuthSessionModule } from './auth/auth-session.module.js';
import { BoardRealtimeGateway } from './realtime/board-realtime.gateway.js';
import { RevisionNotificationInterceptor } from './realtime/revision-notification.interceptor.js';
import { PrismaModule } from './prisma/prisma.module.js';

import {
  ACCESS_NOTIFICATION_MAIL,
  AccessNotificationDelivery,
} from './workspaces/access-notification-delivery.js';
import { AuditQueryService } from './workspaces/audit-query.service.js';
import { BoardContentService } from './workspaces/board-content.service.js';
import { SharingService } from './workspaces/sharing.service.js';
import { WorkspaceController } from './workspaces/workspace.controller.js';
import { WorkspaceService } from './workspaces/workspace.service.js';

@Module({
  imports: [PrismaModule, AuthSessionModule],
  controllers: [AppController, WorkspaceController],
  providers: [
    BoardRealtimeGateway,
    { provide: APP_INTERCEPTOR, useClass: RevisionNotificationInterceptor },
    WorkspaceService,
    BoardContentService,
    AuditQueryService,
    SharingService,
    AccessNotificationDelivery,
    { provide: ACCESS_NOTIFICATION_MAIL, useValue: null },
  ],
})
export class AppModule {}
