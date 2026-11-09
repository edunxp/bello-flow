import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { creationId } from './workspace.service.js';

export type BoardContext = {
  accountId: string;
  workspaceId: string;
  boardId: string;
};

type Mutation =
  | { name: string; listId?: string }
  | {
      title: string | undefined;
      description: string | null | undefined;
      listId: string;
      cardId?: string;
    };

const listFields = { id: true, name: true } as const;
const cardFields = { id: true, title: true, description: true } as const;
const orderBy = [{ createdAt: 'asc' }, { id: 'asc' }] as const;

@Injectable()
export class BoardContentService {
  constructor(private readonly db: PrismaService) {}

  async read(context: BoardContext) {
    const board = await this.transaction((tx) =>
      tx.board.findFirst({
        where: this.boardScope(context),
        select: {
          archived: true,
          members: {
            where: { accountId: context.accountId },
            select: { role: true },
          },
          lists: {
            orderBy: [...orderBy],
            select: {
              ...listFields,
              cards: { select: cardFields, orderBy: [...orderBy] },
            },
          },
        },
      }),
    );
    if (!board) return this.deny(context, 'READ_BOARD_CONTENT', false);
    return { editable: this.editable(board), lists: board.lists };
  }

  async write(context: BoardContext, mutation: Mutation, operationId: string) {
    const card = 'title' in mutation;
    const entityType = card ? 'CARD' : 'LIST';
    const existingId = card ? mutation.cardId : mutation.listId;
    const operation =
      entityType + (existingId ? (card ? '_EDITED' : '_RENAMED') : '_CREATED');
    const fields = card
      ? { title: mutation.title, description: mutation.description }
      : { name: mutation.name };
    const id =
      existingId ??
      creationId(
        context.accountId,
        operationId,
        context.workspaceId,
        context.boardId,
        entityType,
        mutation.listId ?? '',
      );
    const creationHash = createHash('sha256')
      .update(JSON.stringify(fields))
      .digest('hex');
    const eventId = existingId ? randomUUID() : id;
    const result = await this.transaction(async (tx) => {
      const board = await tx.board.findFirst({
        where: this.boardScope(context),
        select: {
          archived: true,
          members: {
            where: { accountId: context.accountId },
            select: { role: true },
          },
        },
      });
      if (!board) return { denied: 'HIDDEN' } as const;
      if (!this.editable(board)) return { denied: 'READ_ONLY' } as const;

      if (
        mutation.listId &&
        !(await tx.boardList.findFirst({
          where: { id: mutation.listId, boardId: context.boardId },
          select: { id: true },
        }))
      )
        return { denied: 'HIDDEN' } as const;

      const before = card
        ? await tx.boardCard.findFirst({
            where: { id, listId: mutation.listId },
          })
        : await tx.boardList.findFirst({
            where: { id, boardId: context.boardId },
          });
      if (existingId && !before) return { denied: 'HIDDEN' } as const;

      const previous =
        before &&
        ('title' in before
          ? { id, title: before.title, description: before.description }
          : { id, name: before.name });
      if (!existingId && before) {
        if (before.creationHash !== creationHash) {
          throw new HttpContractError(HTTP_ERROR_CODE.OPERATION_CONFLICT);
        }
        return { resource: previous };
      }
      const resource = card
        ? {
            id,
            title:
              mutation.title ??
              (before && 'title' in before ? before.title : ''),
            description:
              mutation.description === undefined
                ? before && 'title' in before
                  ? before.description
                  : null
                : mutation.description,
          }
        : { id, name: mutation.name };
      const afterData: Prisma.InputJsonObject = { ...resource };
      const beforeData: Prisma.InputJsonObject | undefined = previous
        ? Object.fromEntries(
            Object.entries(previous).filter(
              ([key, value]) => key === 'id' || afterData[key] !== value,
            ),
          )
        : undefined;
      if (beforeData && Object.keys(beforeData).length === 1)
        return { resource };
      const changed = beforeData
        ? Object.fromEntries(
            Object.entries(afterData).filter(([key]) => key in beforeData),
          )
        : afterData;

      if (card) {
        const data = {
          title: mutation.title,
          description: mutation.description,
        };
        if (existingId)
          await tx.boardCard.update({
            where: { id },
            data,
            select: { id: true },
          });
        else
          await tx.boardCard.createMany({
            data: {
              title: mutation.title!,
              description: mutation.description,
              id,
              listId: mutation.listId,
              creationHash,
            },
          });
      } else {
        const data = { name: mutation.name };
        if (existingId)
          await tx.boardList.update({
            where: { id },
            data,
            select: { id: true },
          });
        else
          await tx.boardList.createMany({
            data: { ...data, id, boardId: context.boardId, creationHash },
          });
      }

      const occurredAt = new Date();
      const listId = card ? mutation.listId : id;
      await tx.auditEvent.createMany({
        data: {
          id: randomUUID(),
          occurredAt,
          actorAccountId: context.accountId,
          origin: 'HTTP',
          scope: 'BOARD',
          operation,
          result: 'SUCCESS',
          entityType,
          entityId: id,
          context: {
            workspaceId: context.workspaceId,
            boardId: context.boardId,
            listId,
          },
          operationId: eventId,
          correlationId: eventId,
          sequence: 1,
          beforeData,
          afterData: changed,
        },
      });
      await tx.boardFeedEvent.createMany({
        data: {
          id: randomUUID(),
          boardId: context.boardId,
          actorId: context.accountId,
          occurredAt,
          operation,
          listId,
          cardId: card ? id : null,
        },
      });
      return { resource };
    });
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result.resource;
  }

  private boardScope({ boardId, workspaceId, accountId }: BoardContext) {
    return {
      id: boardId,
      workspaceId,
      members: {
        some: {
          accountId,
          workspaceMember: {
            account: {
              status: 'ACTIVE',
              emailVerifiedAt: { not: null },
              deactivatedAt: null,
            },
          },
        },
      },
    };
  }

  private editable(board: { archived: boolean; members: { role: string }[] }) {
    const role = board.members[0]?.role;
    return !board.archived && (role === 'ADMIN' || role === 'MEMBER');
  }

  private async transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(run, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2002', 'P2034'].includes(error.code) ||
          attempt === 3
        )
          throw error;
      }
    }
  }

  private async deny(
    context: BoardContext,
    operation: string,
    readOnly: boolean,
  ): Promise<never> {
    const operationId = randomUUID();
    await this.db.auditEvent.createMany({
      data: {
        id: randomUUID(),
        occurredAt: new Date(),
        actorAccountId: context.accountId,
        origin: 'HTTP',
        scope: 'SECURITY',
        operation,
        result: 'DENIED',
        entityType: 'BOARD_CONTENT',
        operationId,
        correlationId: operationId,
        sequence: 1,
      },
    });
    throw new HttpContractError(
      readOnly
        ? HTTP_ERROR_CODE.REQUEST_FORBIDDEN
        : HTTP_ERROR_CODE.RESOURCE_NOT_FOUND,
    );
  }
}
