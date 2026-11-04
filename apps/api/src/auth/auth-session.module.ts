import { Module } from '@nestjs/common';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthSessionPersistence } from './auth-session.persistence.js';
import { AuthenticationService } from './authentication.service.js';
import {
  LOGIN_ADMISSION_CONFIG,
  loadLoginAdmissionConfig,
} from './login-admission.config.js';
import {
  LOGIN_ADMISSION_TIME,
  LoginAdmissionService,
  SYSTEM_LOGIN_ADMISSION_TIME,
} from './login-admission.service.js';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthSessionPersistence,
    AuthenticationService,
    LoginAdmissionService,
    PasswordCredentialService,
    {
      provide: LOGIN_ADMISSION_CONFIG,
      useFactory: () => loadLoginAdmissionConfig(process.env),
    },
    {
      provide: LOGIN_ADMISSION_TIME,
      useValue: SYSTEM_LOGIN_ADMISSION_TIME,
    },
  ],
  exports: [AuthenticationService],
})
export class AuthSessionModule {}
