import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('liveness', () => {
    it('should report that the API is live', () => {
      expect(appController.getLiveness()).toEqual({ status: 'ok' });
    });
  });
});
