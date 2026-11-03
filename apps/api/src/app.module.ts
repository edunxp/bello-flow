import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthSessionModule } from './auth/auth-session.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, AuthSessionModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
