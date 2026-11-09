import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';
import { normalizeAccountEmail } from '../identity/account-email.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type SharingScope = { workspaceId: string; boardId?: string };
const eligible = {
  status: 'ACTIVE',
  emailVerifiedAt: { not: null },
  deactivatedAt: null,
};

@Injectable()
export class SharingService {
  constructor(private readonly db: PrismaService) {}

  async members(actorId: string, scope: SharingScope) {
    await this.authorize(this.db, actorId, scope);
    const { workspaceId, boardId } = scope;
    if (boardId) {
      const members = await this.db.boardMembership.findMany({
        where: { workspaceId, boardId },
        select: {
          role: true,
          workspaceMember: {
            select: { account: { select: { emailKey: true } } },
          },
        },
        orderBy: { accountId: 'asc' },
      });
      return {
        members: members.map((member) => ({
          role: member.role,
          email: member.workspaceMember.account.emailKey,
        })),
        boards: [],
      };
    }

    const [members, boards] = await Promise.all([
      this.db.workspaceMembership.findMany({
        where: { workspaceId },
        select: { role: true, account: { select: { emailKey: true } } },
        orderBy: { accountId: 'asc' },
      }),
      this.db.board.findMany({
        where: { workspaceId },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      members: members.map((member) => ({
        role: member.role,
        email: member.account.emailKey,
      })),
      boards,
    };
  }

  async include(
    actorId: string,
    scope: SharingScope,
    email: unknown,
    role: unknown,
  ) {
    const normalized = normalizeAccountEmail(email);
    if (
      normalized.status !== 'VALID' ||
      (role !== 'ADMIN' &&
        role !== 'MEMBER' &&
        !(scope.boardId && role === 'OBSERVER'))
    ) {
      throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
    }
    const { workspaceId, boardId } = scope;
    try {
      await this.db.$transaction(async (tx) => {
        await this.authorize(tx, actorId, scope);
        const recipient = await tx.account.findFirst({
          where: { ...eligible, emailKey: normalized.emailKey },
          select: { id: true },
        });
        if (!recipient)
          throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
        const membership = { workspaceId, accountId: recipient.id };
        if (
          boardId &&
          !(await tx.workspaceMembership.findUnique({
            where: { workspaceId_accountId: membership },
            select: { accountId: true },
          }))
        ) {
          throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
        }

        const inserted = boardId
          ? await tx.boardMembership.createMany({
              data: { ...membership, boardId, role },
              skipDuplicates: true,
            })
          : await tx.workspaceMembership.createMany({
              data: { ...membership, role },
              skipDuplicates: true,
            });
        if (inserted.count === 0) {
          const existing = boardId
            ? await tx.boardMembership.findUniqueOrThrow({
                where: {
                  workspaceId_boardId_accountId: { ...membership, boardId },
                },
                select: { role: true },
              })
            : await tx.workspaceMembership.findUniqueOrThrow({
                where: { workspaceId_accountId: membership },
                select: { role: true },
              });
          if (existing.role !== role)
            throw new HttpContractError(HTTP_ERROR_CODE.OPERATION_CONFLICT);
          return;
        }

        const id = randomUUID();
        const now = new Date();
        await tx.accessNotification.createMany({
          data: {
            id,
            workspaceId,
            boardId,
            recipientId: recipient.id,
            actorId,
            grantedRole: role,
            createdAt: now,
          },
        });
        await tx.accessNotificationDelivery.createMany({
          data: { notificationId: id, updatedAt: now },
        });
        await tx.auditEvent.createMany({
          data: {
            id: randomUUID(),
            occurredAt: now,
            actorAccountId: actorId,
            origin: 'HTTP',
            scope: 'WORKSPACE',
            operation: boardId
              ? 'BOARD_MEMBER_INCLUDED'
              : 'WORKSPACE_MEMBER_INCLUDED',
            result: 'SUCCESS',
            entityType: boardId ? 'BOARD' : 'WORKSPACE',
            entityId: boardId ?? workspaceId,
            afterData: { accountId: recipient.id, role },
            context: { workspaceId },
            operationId: id,
            correlationId: id,
            sequence: 1,
          },
        });
        if (boardId) {
          await tx.boardFeedEvent.createMany({
            data: {
              id: randomUUID(),
              boardId,
              actorId,
              occurredAt: now,
              operation: 'BOARD_MEMBER_INCLUDED',
            },
          });
        }
      });
    } catch (error) {
      if (
        error instanceof HttpContractError &&
        error.code === HTTP_ERROR_CODE.REQUEST_FORBIDDEN
      ) {
        const operationId = randomUUID();
        await this.db.auditEvent.createMany({
          data: {
            id: randomUUID(),
            occurredAt: new Date(),
            actorAccountId: actorId,
            origin: 'HTTP',
            scope: 'SECURITY',
            operation: boardId
              ? 'INCLUDE_BOARD_MEMBER'
              : 'INCLUDE_WORKSPACE_MEMBER',
            result: 'DENIED',
            entityType: 'WORKSPACE_RESOURCE',
            operationId,
            correlationId: operationId,
            sequence: 1,
          },
        });
      }
      throw error;
    }
  }

  notifications(accountId: string) {
    return this.db.accessNotification.findMany({
      where: {
        recipientId: accountId,
        workspace: { members: { some: { accountId } } },
        OR: [
          { boardId: null },
          { board: { members: { some: { accountId } } } },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        grantedRole: true,
        workspaceId: true,
        boardId: true,
        actor: { select: { emailKey: true } },
        workspace: { select: { name: true } },
        board: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async authorize(
    tx: Prisma.TransactionClient,
    accountId: string,
    { workspaceId, boardId }: SharingScope,
  ) {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, accountId, account: eligible },
      select: { role: true },
    });
    if (membership) {
      if (!boardId && membership.role === 'ADMIN') return;
      if (
        boardId &&
        (await tx.board.findFirst({
          where: {
            id: boardId,
            workspaceId,
            ...(membership.role === 'ADMIN'
              ? {}
              : { members: { some: { accountId, role: 'ADMIN' } } }),
          },
          select: { id: true },
        }))
      )
        return;
    }
    throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
  }
}
