import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthSessionModule } from './auth/auth-session.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

import { WorkspaceController } from './workspaces/workspace.controller.js';
import { WorkspaceService } from './workspaces/workspace.service.js';

@Module({
  imports: [PrismaModule, AuthSessionModule],
  controllers: [AppController, WorkspaceController],
  providers: [WorkspaceService],
})
export class AppModule {}
