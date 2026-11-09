import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const ACCESS_NOTIFICATION_MAIL = Symbol('ACCESS_NOTIFICATION_MAIL');
export interface AccessNotificationMail {
  deliver(message: {
    recipient: string;
    subject: string;
    text: string;
  }): Promise<'SENT' | 'FAILED'>;
}

@Injectable()
export class AccessNotificationDelivery
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AccessNotificationDelivery.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    private readonly db: PrismaService,
    @Inject(ACCESS_NOTIFICATION_MAIL)
    private readonly mail: AccessNotificationMail | null,
  ) {}

  onModuleInit() {
    const mail = this.mail;
    if (!mail) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.processOne(mail)
        .catch(() =>
          this.logger.error({ event: 'ACCESS_NOTIFICATION_DELIVERY_ERROR' }),
        )
        .finally(() => {
          this.running = undefined;
        });
    }, 500);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  private async processOne(mail: AccessNotificationMail) {
    const now = new Date();
    await this.db.accessNotificationDelivery.updateMany({
      where: {
        state: 'SENDING',
        updatedAt: { lt: new Date(now.getTime() - 60_000) },
      },
      data: { state: 'UNKNOWN', updatedAt: now },
    });
    const delivery = await this.db.accessNotificationDelivery.findFirst({
      where: { state: 'PENDING' },
      orderBy: [{ updatedAt: 'asc' }, { notificationId: 'asc' }],
      select: { notificationId: true },
    });
    if (!delivery) return;
    const { notificationId } = delivery;
    const claimed = await this.db.accessNotificationDelivery.updateMany({
      where: { notificationId, state: 'PENDING' },
      data: { state: 'SENDING', attemptCount: 1, updatedAt: new Date() },
    });
    if (!claimed.count) return;

    let state: 'CANCELLED' | 'SENT' | 'FAILED' | 'UNKNOWN';
    try {
      const notice = await this.db.accessNotification.findUniqueOrThrow({
        where: { id: notificationId },
        select: {
          workspaceId: true,
          boardId: true,
          grantedRole: true,
          workspace: { select: { name: true } },
          board: { select: { name: true } },
          actor: { select: { emailKey: true } },
        },
      });
      const [address] = await this.db.$queryRaw<
        Array<{ email: string | null }>
      >`
        SELECT public.access_notification_recipient(${notificationId}::uuid) AS email
      `;
      if (address?.email) {
        const target = notice.board?.name ?? notice.workspace.name;
        const subject = 'Acesso concedido no Bello Flow';
        const text = `${notice.actor.emailKey} liberou seu acesso a ${target}. Papel: ${notice.grantedRole}. Abra o Bello Flow para consultar o acesso.`;
        state = await mail.deliver({ recipient: address.email, subject, text });
      } else {
        state = 'CANCELLED';
      }
    } catch {
      state = 'UNKNOWN';
    }
    await this.db.accessNotificationDelivery.updateMany({
      where: { notificationId, state: 'SENDING' },
      data: { state, updatedAt: new Date() },
    });
  }
}
