import { Controller, Get } from '@nestjs/common';
import { HTTP_ERROR_CODE, HttpContractError } from './http/http-errors.js';
import { PrismaService } from './prisma/prisma.service.js';

@Controller()
export class AppController {
  constructor(private readonly db: PrismaService) {}

  @Get('health/live')
  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async getReadiness(): Promise<{ status: 'ok' }> {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new HttpContractError(HTTP_ERROR_CODE.SERVICE_UNAVAILABLE);
    }
  }
}
