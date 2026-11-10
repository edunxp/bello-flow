import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma/prisma.service.js';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  let appController: AppController;
  const query = vi.fn();

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: query } }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('liveness', () => {
    it('should report that the API is live', () => {
      expect(appController.getLiveness()).toEqual({ status: 'ok' });
    });
  });

  it('reports readiness when PostgreSQL responds', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }]);
    await expect(appController.getReadiness()).resolves.toEqual({
      status: 'ok',
    });
  });

  it('returns a sanitized 503 when PostgreSQL fails while liveness stays healthy', async () => {
    query.mockRejectedValueOnce(new Error('internal database failure'));
    await expect(appController.getReadiness()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(appController.getLiveness()).toEqual({ status: 'ok' });
  });
});
