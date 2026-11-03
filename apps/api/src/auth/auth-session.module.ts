import { Module } from '@nestjs/common';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthSessionPersistence } from './auth-session.persistence.js';
import { AuthenticationService } from './authentication.service.js';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthSessionPersistence,
    AuthenticationService,
    PasswordCredentialService,
  ],
  exports: [AuthenticationService],
})
export class AuthSessionModule {}
