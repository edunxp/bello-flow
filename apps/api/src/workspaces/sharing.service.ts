import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';
import { normalizeAccountEmail } from '../identity/account-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  activeAccount,
  assignmentImpact,
  lockBoardMembers,
  recordAssignments,
} from './card-assignments.js';
import { creationId } from './workspace.service.js';

export type SharingScope = { workspaceId: string; boardId?: string };
type BoardScope = Required<SharingScope>;
export type BoardRole = 'ADMIN' | 'MEMBER' | 'OBSERVER';
export interface BoardMemberChange {
  accountId: string;
  expectedRole: BoardRole;
  role: BoardRole | null;
  operationId: string;
  impactToken?: string;
  confirmAssignments?: boolean;
}
const eligible = activeAccount;

@Injectable()
export class SharingService {
  constructor(private readonly db: PrismaService) {}

  async members(actorId: string, scope: SharingScope) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.authorize(tx, actorId, scope);
          return this.readMembers(tx, scope);
        },
        { isolationLevel: 'RepeatableRead' },
      );
    } catch (error) {
      return this.auditDenial(
        error,
        actorId,
        scope.boardId ? 'LIST_BOARD_MEMBERS' : 'LIST_WORKSPACE_MEMBERS',
      );
    }
  }

  private async readMembers(
    tx: Prisma.TransactionClient,
    { workspaceId, boardId }: SharingScope,
  ) {
    if (boardId) {
      const members = await tx.boardMembership.findMany({
        where: { workspaceId, boardId },
        select: {
          accountId: true,
          role: true,
          workspaceMember: {
            select: { account: { select: { emailKey: true } } },
          },
        },
        orderBy: { accountId: 'asc' },
      });
      return {
        members: members.map((member) => ({
          accountId: member.accountId,
          role: member.role,
          email: member.workspaceMember.account.emailKey,
        })),
        boards: [],
      };
    }

    const [members, boards] = await Promise.all([
      tx.workspaceMembership.findMany({
        where: { workspaceId },
        select: { role: true, account: { select: { emailKey: true } } },
        orderBy: { accountId: 'asc' },
      }),
      tx.board.findMany({
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
        if (boardId) {
          await lockBoardMembers(tx, boardId);
          await this.authorize(tx, actorId, scope);
        }
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
        await this.notify(tx, scope, actorId, recipient.id, role, id, now);
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
          await tx.board.update({
            where: { id: boardId },
            select: { id: true },
            data: { syncRevision: { increment: 1 } },
          });
          await tx.boardFeedEvent.createMany({
            data: {
              id: randomUUID(),
              boardId,
              actorId,
              occurredAt: now,
              operation: 'BOARD_MEMBER_INCLUDED',
              subjectAccountId: recipient.id,
            },
          });
        }
      });
    } catch (error) {
      return this.auditDenial(
        error,
        actorId,
        boardId ? 'INCLUDE_BOARD_MEMBER' : 'INCLUDE_WORKSPACE_MEMBER',
      );
    }
  }

  async boardMemberImpact(
    actorId: string,
    scope: BoardScope,
    accountId: string,
  ) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.authorize(tx, actorId, scope);
          const where = {
            workspaceId: scope.workspaceId,
            boardId: scope.boardId,
            accountId,
          };
          if (
            !(await tx.boardMembership.findUnique({
              where: { workspaceId_boardId_accountId: where },
              select: { accountId: true },
            }))
          )
            throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
          const { assignments, token } = await assignmentImpact(tx, where);
          return { count: assignments.length, token };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    } catch (error) {
      return this.auditDenial(error, actorId, 'READ_BOARD_MEMBER_IMPACT');
    }
  }

  async changeBoardMember(
    actorId: string,
    scope: BoardScope,
    change: BoardMemberChange,
  ) {
    const { workspaceId, boardId } = scope;
    const operation =
      change.role === null
        ? 'BOARD_MEMBER_REMOVED'
        : 'BOARD_MEMBER_ROLE_CHANGED';
    const id = creationId(
      actorId,
      change.operationId,
      workspaceId,
      boardId,
      'BOARD_MEMBER_CHANGE',
    );
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          change.accountId,
          change.expectedRole,
          change.role,
          ...(change.impactToken === undefined &&
          change.confirmAssignments === undefined
            ? []
            : [change.impactToken, change.confirmAssignments]),
        ]),
      )
      .digest('hex');
    try {
      await this.db.$transaction(
        async (tx) => {
          await this.authorize(tx, actorId, scope);
          await lockBoardMembers(tx, boardId);
          await this.authorize(tx, actorId, scope);
          const receipt = await tx.boardFeedEvent.findUnique({
            where: { id },
            select: { requestHash: true },
          });
          if (receipt) {
            if (receipt.requestHash !== requestHash) this.conflict();
            return;
          }
          const member = { workspaceId, boardId, accountId: change.accountId };
          const where = { workspaceId_boardId_accountId: member };
          const before = await tx.boardMembership.findUnique({
            where,
            select: { role: true },
          });
          if (
            before?.role !== change.expectedRole ||
            before.role === change.role
          )
            this.conflict();

          if (
            before.role === 'ADMIN' &&
            !(await tx.boardMembership.findFirst({
              where: {
                workspaceId,
                boardId,
                role: 'ADMIN',
                accountId: { not: change.accountId },
                workspaceMember: { account: eligible },
              },
              select: { accountId: true },
            }))
          )
            this.conflict();

          const now = new Date();
          if (change.role === null || change.role === 'OBSERVER') {
            const { assignments, token } = await assignmentImpact(tx, member);
            if (
              (change.impactToken !== undefined &&
                change.impactToken !== token) ||
              (assignments.length &&
                (change.impactToken !== token || !change.confirmAssignments))
            )
              this.conflict();
            if (assignments.length) {
              await tx.cardAssignment.deleteMany({ where: member });
              await recordAssignments(
                tx,
                { ...member, actorId },
                assignments.map(({ cardId }) => cardId),
                false,
                { id, now, automatic: true },
              );
            }
          }

          if (change.role === null) {
            await tx.boardMembership.delete({
              where,
              select: { accountId: true },
            });
          } else {
            const account = await tx.account.findFirst({
              where: { id: change.accountId, ...eligible },
              select: { id: true },
            });
            if (!account)
              throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
            await tx.boardMembership.update({
              where,
              data: { role: change.role },
              select: { accountId: true },
            });
          }

          if (change.role !== null)
            await this.notify(
              tx,
              scope,
              actorId,
              change.accountId,
              change.role,
              id,
              now,
            );
          await tx.board.update({
            where: { id: boardId },
            select: { id: true },
            data: { syncRevision: { increment: 1 } },
          });
          await tx.auditEvent.createMany({
            data: {
              id: randomUUID(),
              occurredAt: now,
              actorAccountId: actorId,
              origin: 'HTTP',
              scope: 'WORKSPACE',
              operation,
              result: 'SUCCESS',
              entityType: 'BOARD',
              entityId: boardId,
              beforeData: { accountId: change.accountId, role: before.role },
              afterData: { accountId: change.accountId, role: change.role },
              context: { workspaceId },
              operationId: id,
              correlationId: id,
              sequence: 1,
            },
          });
          await tx.boardFeedEvent.createMany({
            data: {
              id,
              boardId,
              actorId,
              occurredAt: now,
              operation,
              requestHash,
              subjectAccountId: change.accountId,
            },
          });
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      return this.auditDenial(error, actorId, operation);
    }
  }

  private conflict(): never {
    throw new HttpContractError(HTTP_ERROR_CODE.OPERATION_CONFLICT);
  }

  private async notify(
    tx: Prisma.TransactionClient,
    { workspaceId, boardId }: SharingScope,
    actorId: string,
    recipientId: string,
    role: BoardRole,
    id: string,
    now: Date,
  ) {
    await tx.accessNotification.createMany({
      data: {
        id,
        workspaceId,
        boardId,
        recipientId,
        actorId,
        grantedRole: role,
        createdAt: now,
      },
    });
    await tx.accessNotificationDelivery.createMany({
      data: { notificationId: id, updatedAt: now },
    });
  }

  private async auditDenial(
    error: unknown,
    actorId: string,
    operation: string,
  ): Promise<never> {
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
          operation,
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
