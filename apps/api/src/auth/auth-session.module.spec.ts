import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthSessionModule } from './auth-session.module.js';
import { AuthSessionPersistence } from './auth-session.persistence.js';
import { AuthController } from './auth.controller.js';
import { AuthenticationService } from './authentication.service.js';
import { Argon2ExecutionService } from './argon2-execution.service.js';
import { LoginAdmissionConfigurationError } from './login-admission.config.js';
import { LoginAdmissionService } from './login-admission.service.js';
import { PasswordRecoveryAdmissionService } from './password-recovery-admission.service.js';
import { PasswordRecoveryRequestPersistence } from './password-recovery-request.persistence.js';
import { PasswordRecoveryRequestService } from './password-recovery-request.service.js';
import { PasswordResetPersistence } from './password-reset.persistence.js';
import { PasswordResetService } from './password-reset.service.js';

@Injectable()
class ConsumerProbe {
  constructor(readonly sessions: AuthSessionPersistence) {}
}

@Module({
  imports: [AuthSessionModule],
  providers: [ConsumerProbe],
})
class ConsumerModule {}

@Injectable()
class AuthenticationConsumerProbe {
  constructor(readonly authentication: AuthenticationService) {}
}

@Module({
  imports: [AuthSessionModule],
  providers: [AuthenticationConsumerProbe],
})
class AuthenticationConsumerModule {}

@Injectable()
class AdmissionConsumerProbe {
  constructor(readonly admission: LoginAdmissionService) {}
}

@Module({
  imports: [AuthSessionModule],
  providers: [AdmissionConsumerProbe],
})
class AdmissionConsumerModule {}

@Injectable()
class RecoveryRequestConsumerProbe {
  constructor(readonly recovery: PasswordRecoveryRequestService) {}
}

@Module({
  imports: [AuthSessionModule],
  providers: [RecoveryRequestConsumerProbe],
})
class RecoveryRequestConsumerModule {}

@Injectable()
class PasswordResetConsumerProbe {
  constructor(readonly reset: PasswordResetService) {}
}

@Module({
  imports: [AuthSessionModule],
  providers: [PasswordResetConsumerProbe],
})
class PasswordResetConsumerModule {}

describe('AuthSessionModule', () => {
  it('keeps the persistence component resolvable inside the module', async () => {
    const context = await Test.createTestingModule({
      imports: [AuthSessionModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    const internalModule = context.select(AuthSessionModule);
    expect(
      internalModule.get(AuthSessionPersistence, { strict: true }),
    ).toBeInstanceOf(AuthSessionPersistence);
    await context.close();
  });

  it('does not export persistence to a consumer module', async () => {
    await expect(
      Test.createTestingModule({ imports: [ConsumerModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile(),
    ).rejects.toThrow(/ConsumerProbe/);
  });

  it('exports only the authentication service to consumers', async () => {
    const context = await Test.createTestingModule({
      imports: [AuthenticationConsumerModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(
      context.get(AuthenticationConsumerProbe).authentication,
    ).toBeInstanceOf(AuthenticationService);
    await context.close();
  });

  it('keeps login admission internal to the authentication module', async () => {
    await expect(
      Test.createTestingModule({ imports: [AdmissionConsumerModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile(),
    ).rejects.toThrow(/AdmissionConsumerProbe/);
  });

  it('keeps the password recovery request use case internal', async () => {
    await expect(
      Test.createTestingModule({ imports: [RecoveryRequestConsumerModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile(),
    ).rejects.toThrow(/RecoveryRequestConsumerProbe/);
  });

  it('keeps the password reset use case internal', async () => {
    await expect(
      Test.createTestingModule({ imports: [PasswordResetConsumerModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile(),
    ).rejects.toThrow(/PasswordResetConsumerProbe/);
  });

  it('rejects invalid admission configuration during module startup', async () => {
    const original = process.env.BELLO_LOGIN_IDENTITY_BUCKETS_MAX;
    process.env.BELLO_LOGIN_IDENTITY_BUCKETS_MAX = '0';
    try {
      await expect(
        Test.createTestingModule({ imports: [AuthSessionModule] })
          .overrideProvider(PrismaService)
          .useValue({})
          .compile(),
      ).rejects.toThrow(LoginAdmissionConfigurationError);
    } finally {
      if (original === undefined) {
        delete process.env.BELLO_LOGIN_IDENTITY_BUCKETS_MAX;
      } else {
        process.env.BELLO_LOGIN_IDENTITY_BUCKETS_MAX = original;
      }
    }
  });

  it('initializes AppModule with one Prisma lifecycle', async () => {
    const onModuleInit = vi.fn();
    const onModuleDestroy = vi.fn();
    const prisma = { onModuleInit, onModuleDestroy };
    const context = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    await context.init();
    expect(onModuleInit).toHaveBeenCalledOnce();
    expect(context.get(PrismaService)).toBe(prisma);
    const internalPersistence = context
      .select(AuthSessionModule)
      .get(AuthSessionPersistence, { strict: true });
    expect(internalPersistence).toBeInstanceOf(AuthSessionPersistence);
    expect(context.get(AuthSessionPersistence)).toBe(internalPersistence);
    expect(
      context
        .select(AuthSessionModule)
        .get(LoginAdmissionService, { strict: true }),
    ).toBeInstanceOf(LoginAdmissionService);
    expect(
      context
        .select(AuthSessionModule)
        .get(PasswordRecoveryAdmissionService, { strict: true }),
    ).toBeInstanceOf(PasswordRecoveryAdmissionService);
    expect(
      context
        .select(AuthSessionModule)
        .get(PasswordRecoveryRequestPersistence, { strict: true }),
    ).toBeInstanceOf(PasswordRecoveryRequestPersistence);
    expect(
      context
        .select(AuthSessionModule)
        .get(PasswordRecoveryRequestService, { strict: true }),
    ).toBeInstanceOf(PasswordRecoveryRequestService);
    expect(
      context
        .select(AuthSessionModule)
        .get(PasswordResetPersistence, { strict: true }),
    ).toBeInstanceOf(PasswordResetPersistence);
    expect(
      context
        .select(AuthSessionModule)
        .get(PasswordResetService, { strict: true }),
    ).toBeInstanceOf(PasswordResetService);
    expect(
      context
        .select(AuthSessionModule)
        .get(Argon2ExecutionService, { strict: true }),
    ).toBeInstanceOf(Argon2ExecutionService);
    const loginAdmission = context
      .select(AuthSessionModule)
      .get(LoginAdmissionService, { strict: true }) as unknown as {
      readonly argon2Execution: Argon2ExecutionService;
    };
    expect(loginAdmission.argon2Execution).toBe(
      context
        .select(AuthSessionModule)
        .get(Argon2ExecutionService, { strict: true }),
    );
    const passwordReset = context
      .select(AuthSessionModule)
      .get(PasswordResetService, { strict: true }) as unknown as {
      readonly argon2Execution: Argon2ExecutionService;
    };
    expect(passwordReset.argon2Execution).toBe(
      context
        .select(AuthSessionModule)
        .get(Argon2ExecutionService, { strict: true }),
    );
    expect(
      context.select(AuthSessionModule).get(AuthController, { strict: true }),
    ).toBeInstanceOf(AuthController);

    await context.close();
    expect(onModuleDestroy).toHaveBeenCalledOnce();
  });
});
