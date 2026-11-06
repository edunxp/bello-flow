import { Module } from '@nestjs/common';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthSessionPersistence } from './auth-session.persistence.js';
import { AuthController } from './auth.controller.js';
import { AuthenticationService } from './authentication.service.js';
import { Argon2ExecutionService } from './argon2-execution.service.js';
import { ADMISSION_TIME, SYSTEM_ADMISSION_TIME } from './admission-time.js';
import {
  LOGIN_ADMISSION_CONFIG,
  loadLoginAdmissionConfig,
} from './login-admission.config.js';
import { LoginAdmissionService } from './login-admission.service.js';
import { PasswordRecoveryAdmissionService } from './password-recovery-admission.service.js';
import {
  ControlledPasswordRecoveryDeliveryAdapter,
  PASSWORD_RECOVERY_DELIVERY_ADAPTER,
  type PasswordRecoveryDeliveryAdapter,
} from './password-recovery-delivery.adapter.js';
import {
  loadPasswordRecoveryDeliveryConfig,
  PASSWORD_RECOVERY_DELIVERY_CONFIG,
  type PasswordRecoveryDeliveryConfig,
} from './password-recovery-delivery.config.js';
import { PasswordRecoveryDeliveryPersistence } from './password-recovery-delivery.persistence.js';
import { PasswordRecoveryDeliveryProcessor } from './password-recovery-delivery.processor.js';
import { ResendPasswordRecoveryDeliveryAdapter } from './password-recovery-resend.adapter.js';
import { PasswordRecoveryRequestPersistence } from './password-recovery-request.persistence.js';
import { PasswordRecoveryRequestService } from './password-recovery-request.service.js';
import { PasswordResetPersistence } from './password-reset.persistence.js';
import { PasswordResetService } from './password-reset.service.js';
import {
  loadPasswordResetTerminalizerConfig,
  PASSWORD_RESET_TERMINALIZER_CONFIG,
} from './password-reset-terminalizer.config.js';
import { PasswordResetTerminalizerPersistence } from './password-reset-terminalizer.persistence.js';
import { PasswordResetTerminalizerProcessor } from './password-reset-terminalizer.processor.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthSessionPersistence,
    AuthenticationService,
    Argon2ExecutionService,
    LoginAdmissionService,
    PasswordRecoveryAdmissionService,
    PasswordRecoveryDeliveryPersistence,
    PasswordRecoveryDeliveryProcessor,
    PasswordRecoveryRequestPersistence,
    PasswordRecoveryRequestService,
    PasswordResetPersistence,
    PasswordResetService,
    PasswordResetTerminalizerPersistence,
    PasswordResetTerminalizerProcessor,
    PasswordCredentialService,
    {
      provide: PASSWORD_RESET_TERMINALIZER_CONFIG,
      useFactory: () => loadPasswordResetTerminalizerConfig(process.env),
    },
    {
      provide: LOGIN_ADMISSION_CONFIG,
      useFactory: () => loadLoginAdmissionConfig(process.env),
    },
    {
      provide: ADMISSION_TIME,
      useValue: SYSTEM_ADMISSION_TIME,
    },
    {
      provide: PASSWORD_RECOVERY_DELIVERY_CONFIG,
      useFactory: () => loadPasswordRecoveryDeliveryConfig(process.env),
    },
    {
      provide: PASSWORD_RECOVERY_DELIVERY_ADAPTER,
      inject: [PASSWORD_RECOVERY_DELIVERY_CONFIG],
      useFactory: (
        config: PasswordRecoveryDeliveryConfig,
      ): PasswordRecoveryDeliveryAdapter =>
        config.mode === 'resend'
          ? new ResendPasswordRecoveryDeliveryAdapter(
              config.resendApiKey!,
              config.fromAddress!,
            )
          : new ControlledPasswordRecoveryDeliveryAdapter(),
    },
  ],
  exports: [AuthenticationService],
})
export class AuthSessionModule {}
