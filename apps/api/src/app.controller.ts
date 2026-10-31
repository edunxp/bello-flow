import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health/live')
  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
