import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';

export const activeAccount = {
  status: 'ACTIVE',
  emailVerifiedAt: { not: null },
  deactivatedAt: null,
};

export const assignmentRoles = ['ADMIN', 'MEMBER'];

export const participantIdentity = {
  accountId: true,
  workspaceMember: { select: { account: { select: { emailKey: true } } } },
} as const;

export function participantView(participant: {
  accountId: string;
  workspaceMember: { account: { emailKey: string } };
}) {
  return {
    accountId: participant.accountId,
    email: participant.workspaceMember.account.emailKey,
  };
}

export async function lockBoardMembers(
  tx: Prisma.TransactionClient,
  boardId: string,
) {
  await tx.$queryRaw`
    SELECT count(*) FROM (
      SELECT pg_advisory_xact_lock(hashtextextended('bello-members:' || ${boardId}, 0))
    ) locked
  `;
}

export async function assignmentImpact(
  tx: Prisma.TransactionClient,
  where: { workspaceId: string; boardId: string; accountId: string },
) {
  const assignments = await tx.cardAssignment.findMany({
    where,
    select: { id: true, cardId: true },
    orderBy: { id: 'asc' },
  });
  const token = createHash('sha256')
    .update(
      JSON.stringify([
        where.workspaceId,
        where.boardId,
        where.accountId,
        assignments.map(({ id }) => id),
      ]),
    )
    .digest('hex');
  return { assignments, token };
}

export async function recordAssignments(
  tx: Prisma.TransactionClient,
  context: {
    workspaceId: string;
    boardId: string;
    actorId: string;
    accountId: string;
  },
  cards: string[],
  added: boolean,
  event: { id: string; now: Date; requestHash?: string; automatic?: true },
) {
  if (!cards.length) return;
  const operation = added ? 'CARD_ASSIGNEE_ADDED' : 'CARD_ASSIGNEE_REMOVED';
  const { workspaceId, boardId, actorId, accountId } = context;
  await tx.auditEvent.createMany({
    data: cards.map((cardId, index) => ({
      id: randomUUID(),
      occurredAt: event.now,
      actorAccountId: actorId,
      origin: 'HTTP',
      scope: 'BOARD',
      operation,
      result: 'SUCCESS',
      entityType: 'CARD',
      entityId: cardId,
      context: { workspaceId, boardId },
      operationId: event.id,
      correlationId: event.id,
      sequence: index + (event.automatic ? 2 : 1),
      ...(added ? { afterData: { accountId } } : { beforeData: { accountId } }),
    })),
  });
  await tx.boardFeedEvent.createMany({
    data: cards.map((cardId) => ({
      id: event.automatic ? randomUUID() : event.id,
      boardId,
      actorId,
      occurredAt: event.now,
      operation,
      cardId,
      subjectAccountId: accountId,
      requestHash: event.requestHash,
    })),
  });
}
