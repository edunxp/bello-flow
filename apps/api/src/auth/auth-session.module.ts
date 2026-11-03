import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthSessionPersistence } from './auth-session.persistence.js';

@Module({
  imports: [PrismaModule],
  providers: [AuthSessionPersistence],
})
export class AuthSessionModule {}
