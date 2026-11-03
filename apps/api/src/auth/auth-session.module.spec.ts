import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthSessionModule } from './auth-session.module.js';
import { AuthSessionPersistence } from './auth-session.persistence.js';
import { AuthenticationService } from './authentication.service.js';

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

    await context.close();
    expect(onModuleDestroy).toHaveBeenCalledOnce();
  });
});
