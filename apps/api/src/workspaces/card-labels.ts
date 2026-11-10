import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';

export const labelFields = { id: true, name: true, color: true } as const;
export type LabelFields = { name: string; color: string | null };
export const labelOrder = [
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.WorkspaceLabelOrderByWithRelationInput[];

export async function lockWorkspaceLabels(
  tx: Prisma.TransactionClient,
  workspaceId: string,
) {
  await tx.$queryRaw`
    SELECT count(*) FROM (
      SELECT pg_advisory_xact_lock(hashtextextended('bello-labels:' || ${workspaceId}, 0))
    ) locked
  `;
}

export async function recordCardLabels(
  tx: Prisma.TransactionClient,
  context: { workspaceId: string; actorId: string; labelId: string },
  cards: { id: string; boardId: string; listId: string }[],
  operation: 'CARD_LABEL_ADDED' | 'CARD_LABEL_REMOVED' | 'CARD_LABEL_UPDATED',
  event: { id: string; now: Date; requestHash?: string; catalog?: true },
) {
  if (!cards.length) return;
  const { workspaceId, actorId, labelId } = context;
  await tx.auditEvent.createMany({
    data: cards.map(({ id, boardId, listId }, index) => ({
      id: randomUUID(),
      occurredAt: event.now,
      actorAccountId: actorId,
      origin: 'HTTP',
      scope: 'BOARD',
      operation,
      result: 'SUCCESS',
      entityType: 'CARD',
      entityId: id,
      context: { workspaceId, boardId, listId },
      operationId: event.id,
      correlationId: event.id,
      sequence: index + (event.catalog ? 2 : 1),
      ...(operation === 'CARD_LABEL_REMOVED'
        ? { beforeData: { labelId } }
        : { afterData: { labelId } }),
    })),
  });
  await tx.boardFeedEvent.createMany({
    data: cards.map(({ id, boardId, listId }) => ({
      id: event.catalog ? randomUUID() : event.id,
      boardId,
      listId,
      cardId: id,
      labelId,
      actorId,
      occurredAt: event.now,
      operation,
      requestHash: event.requestHash,
    })),
  });
}
