import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AuditArea = 'GLOBAL' | 'GOVERNANCE' | 'CONTENT';
type AuditFilters = {
  from: string | null;
  until: string | null;
  entityType: string | null;
  entityId: string | null;
  operation: string | null;
  result: string | null;
  actor: string | null;
  cursorAt: string | null;
  cursorId: string | null;
};

type AuditRecord = {
  id?: string;
  denied?: true;
  occurredAt: string;
} & Record<string, unknown>;

@Injectable()
export class AuditQueryService {
  constructor(private readonly db: PrismaService) {}

  async query(
    accountId: string,
    area: AuditArea,
    workspaceId: string | null,
    boardId: string | null,
    filters: AuditFilters,
    history?: { cardId: string; offset: number; before: string },
  ) {
    const limit = 30;
    const rows = await this.db.$queryRaw<{ event: AuditRecord }[]>`
        SELECT event FROM public.query_audit_events(
          ${accountId}::uuid, ${area}::text, ${workspaceId}::uuid, ${boardId}::uuid,
          ${history?.cardId ?? null}::uuid,
          ${filters.from}::timestamptz, ${filters.until}::timestamptz,
          ${filters.entityType}::text, ${filters.entityId}::uuid,
          ${filters.operation}::text, ${filters.result}::text, ${filters.actor}::uuid,
          ${history?.before ?? filters.cursorAt}::timestamptz, ${filters.cursorId}::uuid,
          ${limit + 1}::integer, ${history?.offset ?? 0}::integer
        ) AS results(event)
      `;
    if (rows[0]?.event.denied) {
      const operationId = randomUUID();
      await this.db.auditEvent.createMany({
        data: {
          id: randomUUID(),
          occurredAt: new Date(),
          actorAccountId: accountId,
          origin: 'HTTP',
          scope: 'SECURITY',
          operation: 'READ_AUDIT_EVENTS',
          result: 'DENIED',
          entityType: 'AUDIT_QUERY',
          operationId,
          correlationId: operationId,
          sequence: 1,
        },
      });
      throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
    }
    const events = rows.slice(0, limit).map(({ event }) => event);
    const last = events.at(-1);
    const next =
      rows.length > limit && last
        ? history
          ? { before: history.before, offset: history.offset + limit }
          : { cursorAt: last.occurredAt, cursorId: last.id }
        : null;
    return { events, next };
  }
}
