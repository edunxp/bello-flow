import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL =
      'postgresql://bello_test_app@127.0.0.1:15432/bello_test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('requires DATABASE_URL', () => {
    delete process.env.DATABASE_URL;

    expect(() => new PrismaService()).toThrow('DATABASE_URL is required');
  });

  it('connects and verifies the database during module initialization', async () => {
    const service = new PrismaService();
    const connect = vi.spyOn(service, '$connect').mockResolvedValue();
    const query = vi.spyOn(service, '$queryRaw').mockResolvedValue([]);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });

  it('disconnects when the verification query fails', async () => {
    const service = new PrismaService();
    const error = new Error('verification failed');
    vi.spyOn(service, '$connect').mockResolvedValue();
    vi.spyOn(service, '$queryRaw').mockRejectedValue(error);
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();

    await expect(service.onModuleInit()).rejects.toBe(error);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects during module destruction', async () => {
    const service = new PrismaService();
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
