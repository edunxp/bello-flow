import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  advanceOrder,
  conflict,
  lockContainers,
  neighbors,
  placement,
  positionAt,
  siblings,
  type Container,
  type MoveIntent,
} from './board-order.js';
import {
  civilDate,
  scheduleView,
  workspaceToday,
  type CardScheduleChange,
} from './card-schedule.js';
import {
  activeAccount,
  assignmentRoles,
  lockBoardMembers,
  participantIdentity,
  participantView,
  recordAssignments,
} from './card-assignments.js';
import {
  labelFields,
  labelOrder,
  lockWorkspaceLabels,
  recordCardLabels,
} from './card-labels.js';
import { commentVersion, type CommentChange } from './card-comments.js';
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
const scheduleFields = {
  startDate: true,
  dueDate: true,
  completedAt: true,
  completedById: true,
} as const;
const workspaceZone = { select: { timeZone: true } } as const;
const orderBy = { position: 'asc' } as const;
class SourceChanged extends Error {}

@Injectable()
export class BoardContentService {
  constructor(private readonly db: PrismaService) {}

  async read(context: BoardContext) {
    const result = await this.transaction(async (tx) => {
      const board = await tx.board.findFirst({
        where: this.boardScope(context),
        select: {
          archived: true,
          orderRevision: true,
          syncRevision: true,
          workspace: workspaceZone,
          members: {
            where: { accountId: context.accountId },
            select: { role: true },
          },
          lists: {
            orderBy,
            select: {
              ...listFields,
              archived: true,
              positionRevision: true,
              cardOrderRevision: true,
              cards: {
                select: {
                  ...cardFields,
                  ...scheduleFields,
                  archived: true,
                  labels: {
                    where: { workspaceId: context.workspaceId },
                    select: { label: { select: labelFields } },
                    orderBy: { label: { name: 'asc' } },
                  },
                  assignments: {
                    where: {
                      workspaceId: context.workspaceId,
                      boardId: context.boardId,
                    },
                    select: { member: { select: participantIdentity } },
                    orderBy: { accountId: 'asc' },
                  },
                  positionRevision: true,
                },
                orderBy,
              },
            },
          },
        },
      });
      if (!board) return null;
      const timeZone = board.workspace.timeZone;
      const now = new Date();
      const today = workspaceToday(timeZone, now);
      const overdue = board.lists.some(({ cards }) =>
        cards.some(
          (card) => card.dueDate !== null && card.completedAt === null,
        ),
      )
        ? await tx.$queryRaw<{ id: string }[]>`
            SELECT card.id FROM board_card card
            JOIN board_list list ON list.id = card.list_id
            WHERE list.board_id = ${context.boardId}::uuid
              AND card.completed_at IS NULL AND card.due_date IS NOT NULL
              AND ${now}::timestamptz >= ((card.due_date + 1)::timestamp AT TIME ZONE ${timeZone})
          `
        : [];
      const editable = this.editable(board);
      const eligibleAssignees = editable
        ? await tx.boardMembership.findMany({
            where: {
              workspaceId: context.workspaceId,
              boardId: context.boardId,
              role: { in: assignmentRoles },
              workspaceMember: { account: activeAccount },
            },
            select: participantIdentity,
            orderBy: { accountId: 'asc' },
          })
        : [];
      const availableLabels = editable
        ? await tx.workspaceLabel.findMany({
            where: { workspaceId: context.workspaceId },
            select: labelFields,
            orderBy: labelOrder,
          })
        : [];
      return {
        board,
        editable,
        eligibleAssignees,
        availableLabels,
        timeZone,
        today,
        overdue: new Set(overdue.map(({ id }) => id)),
      };
    });
    if (!result) return this.deny(context, 'READ_BOARD_CONTENT', false);
    const {
      board,
      timeZone,
      today,
      overdue,
      editable,
      eligibleAssignees,
      availableLabels,
    } = result;
    const lists = board.lists.map(({ cards, ...list }) => {
      const content = cards.map(
        ({ assignments, labels, archived, ...card }) => ({
          archived,
          labels: labels.map(({ label }) => label),
          ...card,
          assignees: assignments.map(({ member }) => participantView(member)),
          ...scheduleView(card, overdue.has(card.id)),
        }),
      );
      return {
        ...list,
        cards: content.filter(({ archived }) => !archived),
        archivedCards: content.filter(({ archived }) => archived),
      };
    });
    return {
      timeZone,
      today,
      editable,
      eligibleAssignees: eligibleAssignees.map(participantView),
      availableLabels,
      orderRevision: board.orderRevision,
      syncRevision: board.syncRevision,
      lists: lists.filter(({ archived }) => !archived),
      archivedLists: lists.filter(({ archived }) => archived),
    };
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
    const container: Container = card
      ? { kind: 'CARD', id: mutation.listId }
      : { kind: 'LIST', id: context.boardId };
    const result = await this.transaction(
      async (tx) => {
        const access = () =>
          tx.board.findFirst({
            where: this.boardScope(context),
            select: {
              archived: true,
              members: {
                where: { accountId: context.accountId },
                select: { role: true },
              },
            },
          });
        const board = await access();
        if (!board) return { denied: 'HIDDEN' } as const;
        if (!this.editable(board)) return { denied: 'READ_ONLY' } as const;

        const listAccess = () =>
          tx.boardList.findFirst({
            where: { id: mutation.listId, boardId: context.boardId },
            select: { archived: true },
          });
        if (card && !existingId && !(await listAccess()))
          return { denied: 'HIDDEN' } as const;

        if (!existingId) {
          await lockContainers(tx, [container]);
          const current = await access();
          if (!current) return { denied: 'HIDDEN' } as const;
          if (!this.editable(current)) return { denied: 'READ_ONLY' } as const;
        }
        const list = card ? await listAccess() : null;
        if (card && !list) return { denied: 'HIDDEN' } as const;

        const before = card
          ? await tx.boardCard.findFirst({
              where: {
                id,
                ...(existingId
                  ? { listId: mutation.listId }
                  : { list: { boardId: context.boardId } }),
              },
            })
          : await tx.boardList.findFirst({
              where: { id, boardId: context.boardId },
            });
        if (existingId && !before) return { denied: 'HIDDEN' } as const;
        if (existingId && (before?.archived || list?.archived))
          return { denied: 'READ_ONLY' } as const;

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
        if (list?.archived) return { denied: 'READ_ONLY' } as const;
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

        let position = 0n;
        if (!existingId) {
          const items = await siblings(tx, container);
          position = await positionAt(tx, container, items, items.length);
        }
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
                position,
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
              data: {
                ...data,
                id,
                boardId: context.boardId,
                creationHash,
                position,
              },
            });
        }

        if (!existingId)
          await advanceOrder(tx, context.boardId, container.kind, [
            container.id,
          ]);
        else
          await tx.board.update({
            where: { id: context.boardId },
            select: { id: true },
            data: { syncRevision: { increment: 1 } },
          });
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
      },
      existingId ? 'Serializable' : 'ReadCommitted',
    );
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result.resource;
  }

  async revision(context: BoardContext) {
    const board = await this.db.board.findFirst({
      where: this.boardScope(context),
      select: { syncRevision: true, workspace: workspaceZone },
    });
    if (!board) return this.deny(context, 'READ_BOARD_CONTENT', false);
    return {
      syncRevision: board.syncRevision,
      today: workspaceToday(board.workspace.timeZone),
      timeZone: board.workspace.timeZone,
    };
  }

  async comments(context: BoardContext, listId: string, cardId: string) {
    const result = await this.transaction(async (tx) => {
      const access = await this.boardAccess(tx, context);
      if (!access) return null;
      const card = await tx.boardCard.findFirst({
        where: { id: cardId, listId, list: { boardId: context.boardId } },
        select: {
          archived: true,
          list: { select: { archived: true } },
          comments: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              authorId: true,
              content: true,
              createdAt: true,
              editedAt: true,
              removedAt: true,
              author: { select: { emailKey: true } },
              removedBy: { select: { emailKey: true } },
            },
          },
        },
      });
      if (!card) return null;
      const editable =
        !card.archived && !card.list?.archived && this.editable(access);
      return {
        editable,
        comments: card.comments.map(({ author, removedBy, ...comment }) => {
          const live = comment.removedAt === null;
          const own = comment.authorId === context.accountId;
          return {
            id: comment.id,
            author: author.emailKey,
            createdAt: comment.createdAt,
            editedAt: comment.editedAt,
            removedAt: comment.removedAt,
            removedBy: removedBy?.emailKey ?? null,
            content: live ? comment.content : null,
            version: live ? commentVersion(comment) : null,
            canEdit: live && editable && own,
            canModerate:
              live && editable && !own && access.members[0]?.role === 'ADMIN',
          };
        }),
      };
    });
    if (!result) return this.deny(context, 'READ_CARD_COMMENTS', false);
    return result;
  }

  async changeComment(
    context: BoardContext,
    listId: string,
    cardId: string,
    change: CommentChange,
    operationId: string,
  ) {
    const operation = {
      CREATE: 'COMMENT_CREATED',
      EDIT: 'COMMENT_EDITED',
      REMOVE: 'COMMENT_REMOVED',
      MODERATE: 'COMMENT_MODERATED',
    }[change.kind];
    const eventId = creationId(
      context.accountId,
      operationId,
      context.workspaceId,
      context.boardId,
      'CARD_COMMENT',
    );
    const id = change.kind === 'CREATE' ? eventId : change.id;
    const result = await this.transaction(async (tx) => {
      const access = await this.boardAccess(tx, context);
      if (!access) return { denied: 'HIDDEN' } as const;
      if (!this.editable(access)) return { denied: 'READ_ONLY' } as const;
      await lockBoardMembers(tx, context.boardId);
      const current = await this.boardAccess(tx, context);
      if (!current) return { denied: 'HIDDEN' } as const;
      if (!this.editable(current)) return { denied: 'READ_ONLY' } as const;
      const card = await tx.boardCard.findFirst({
        where: { id: cardId, listId, list: { boardId: context.boardId } },
        select: { archived: true, list: { select: { archived: true } } },
      });
      if (!card) return { denied: 'HIDDEN' } as const;
      if (card.archived || card.list?.archived)
        return { denied: 'READ_ONLY' } as const;

      const before =
        change.kind === 'CREATE'
          ? null
          : await tx.cardComment.findFirst({
              where: { id, cardId },
              select: {
                authorId: true,
                content: true,
                createdAt: true,
                editedAt: true,
                removedAt: true,
              },
            });
      if (change.kind !== 'CREATE') {
        if (!before) return { denied: 'HIDDEN' } as const;
        const own = before.authorId === context.accountId;
        if (
          change.kind === 'MODERATE'
            ? own || current.members[0]?.role !== 'ADMIN'
            : !own
        )
          return { denied: 'READ_ONLY' } as const;
        if (before.removedAt || commentVersion(before) !== change.version)
          conflict();
      }

      const now = new Date();
      const content = 'content' in change ? change.content : null;
      if (change.kind === 'EDIT' && before?.content === content) conflict();
      const authorId = before?.authorId ?? context.accountId;
      const removing = change.kind === 'REMOVE' || change.kind === 'MODERATE';
      const receipt = await tx.auditEvent.createMany({
        data: {
          id: eventId,
          occurredAt: now,
          actorAccountId: context.accountId,
          origin: 'HTTP',
          scope: 'BOARD',
          operation,
          result: 'SUCCESS',
          entityType: 'COMMENT',
          entityId: id,
          context: {
            workspaceId: context.workspaceId,
            boardId: context.boardId,
            listId,
            cardId,
          },
          operationId: eventId,
          correlationId: eventId,
          sequence: 1,
          beforeData: before
            ? { authorId, content: before.content }
            : undefined,
          afterData: removing
            ? {
                authorId,
                removedById: context.accountId,
                removedAt: now.toISOString(),
                ...(change.kind === 'MODERATE'
                  ? { justification: change.justification }
                  : {}),
              }
            : { authorId, content },
        },
        skipDuplicates: true,
      });
      if (!receipt.count) conflict();
      if (change.kind === 'CREATE') {
        await tx.cardComment.create({
          data: { id, cardId, authorId, content, createdAt: now },
          select: { id: true },
        });
      } else {
        const data = removing
          ? { content: null, removedAt: now, removedById: context.accountId }
          : { content, editedAt: now };
        await tx.cardComment.update({
          where: { id },
          data,
          select: { id: true },
        });
      }
      await tx.board.update({
        where: { id: context.boardId },
        select: { id: true },
        data: { syncRevision: { increment: 1 } },
      });
      await tx.boardFeedEvent.createMany({
        data: {
          id: eventId,
          boardId: context.boardId,
          listId,
          cardId,
          commentId: id,
          actorId: context.accountId,
          occurredAt: now,
          operation,
        },
      });
      return { confirmed: true };
    }, 'ReadCommitted');
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result;
  }

  private boardAccess(tx: Prisma.TransactionClient, context: BoardContext) {
    return tx.board.findFirst({
      where: this.boardScope(context),
      select: {
        archived: true,
        members: {
          where: { accountId: context.accountId },
          select: { role: true },
        },
      },
    });
  }

  async changeCardLabel(
    context: BoardContext,
    listId: string,
    cardId: string,
    labelId: string,
    applied: boolean,
    operationId: string,
  ) {
    const operation = applied ? 'CARD_LABEL_ADDED' : 'CARD_LABEL_REMOVED';
    const eventId = creationId(
      context.accountId,
      operationId,
      context.workspaceId,
      context.boardId,
      'CARD_LABEL',
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify([listId, cardId, labelId, applied]))
      .digest('hex');
    const result = await this.transaction(async (tx) => {
      const access = () =>
        tx.board.findFirst({
          where: this.boardScope(context),
          select: {
            archived: true,
            members: {
              where: { accountId: context.accountId },
              select: { role: true },
            },
          },
        });
      const board = await access();
      if (!board) return { denied: 'HIDDEN' } as const;
      if (!this.editable(board)) return { denied: 'READ_ONLY' } as const;
      await lockWorkspaceLabels(tx, context.workspaceId);
      await lockBoardMembers(tx, context.boardId);
      const current = await access();
      if (!current) return { denied: 'HIDDEN' } as const;
      if (!this.editable(current)) return { denied: 'READ_ONLY' } as const;
      const receipt = await tx.boardFeedEvent.findUnique({
        where: { id: eventId },
        select: { requestHash: true },
      });
      const card = await tx.boardCard.findFirst({
        where: {
          id: cardId,
          ...(receipt ? {} : { listId }),
          list: { boardId: context.boardId },
        },
        select: { archived: true, list: { select: { archived: true } } },
      });
      if (!card) return { denied: 'HIDDEN' } as const;
      if (receipt) {
        if (receipt.requestHash !== requestHash) conflict();
        return { confirmed: true };
      }
      if (card.archived || card.list?.archived)
        return { denied: 'READ_ONLY' } as const;
      if (
        !(await tx.workspaceLabel.findFirst({
          where: { id: labelId, workspaceId: context.workspaceId },
          select: { id: true },
        }))
      )
        return { denied: 'HIDDEN' } as const;

      const where = { cardId, workspaceId: context.workspaceId, labelId };
      const change = applied
        ? await tx.cardLabel.createMany({ data: where, skipDuplicates: true })
        : await tx.cardLabel.deleteMany({ where });
      if (!change.count) conflict();
      await tx.board.update({
        where: { id: context.boardId },
        select: { id: true },
        data: { syncRevision: { increment: 1 } },
      });
      await recordCardLabels(
        tx,
        {
          workspaceId: context.workspaceId,
          actorId: context.accountId,
          labelId,
        },
        [{ id: cardId, boardId: context.boardId, listId }],
        operation,
        { id: eventId, now: new Date(), requestHash },
      );
      return { confirmed: true };
    }, 'ReadCommitted');
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result;
  }

  async changeAssignee(
    context: BoardContext,
    listId: string,
    cardId: string,
    accountId: string,
    assigned: boolean,
    operationId: string,
  ) {
    const operation = assigned
      ? 'CARD_ASSIGNEE_ADDED'
      : 'CARD_ASSIGNEE_REMOVED';
    const eventId = creationId(
      context.accountId,
      operationId,
      context.workspaceId,
      context.boardId,
      'CARD_ASSIGNEE',
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify([listId, cardId, accountId, assigned]))
      .digest('hex');
    const result = await this.transaction(async (tx) => {
      const access = () =>
        tx.board.findFirst({
          where: this.boardScope(context),
          select: {
            archived: true,
            members: {
              where: { accountId: context.accountId },
              select: { role: true },
            },
          },
        });
      const board = await access();
      if (!board) return { denied: 'HIDDEN' } as const;
      if (!this.editable(board)) return { denied: 'READ_ONLY' } as const;
      await lockBoardMembers(tx, context.boardId);
      const current = await access();
      if (!current) return { denied: 'HIDDEN' } as const;
      if (!this.editable(current)) return { denied: 'READ_ONLY' } as const;

      const receipt = await tx.boardFeedEvent.findUnique({
        where: { id: eventId },
        select: { requestHash: true },
      });
      const card = await tx.boardCard.findFirst({
        where: {
          id: cardId,
          ...(receipt ? {} : { listId }),
          list: { boardId: context.boardId },
        },
        select: { archived: true, list: { select: { archived: true } } },
      });
      if (!card) return { denied: 'HIDDEN' } as const;
      if (receipt) {
        if (receipt.requestHash !== requestHash) conflict();
        return { confirmed: true };
      }
      if (card.archived || card.list?.archived)
        return { denied: 'READ_ONLY' } as const;
      const member = {
        workspaceId: context.workspaceId,
        boardId: context.boardId,
        accountId,
      };
      if (
        assigned &&
        !(await tx.boardMembership.findFirst({
          where: {
            ...member,
            role: { in: assignmentRoles },
            workspaceMember: { account: activeAccount },
          },
          select: { accountId: true },
        }))
      )
        return { denied: 'READ_ONLY' } as const;

      const where = { cardId, ...member };
      if (assigned) {
        const created = await tx.cardAssignment.createMany({
          data: { id: randomUUID(), ...where },
          skipDuplicates: true,
        });
        if (!created.count) conflict();
      } else {
        const deleted = await tx.cardAssignment.deleteMany({ where });
        if (!deleted.count) conflict();
      }
      await tx.board.update({
        where: { id: context.boardId },
        select: { id: true },
        data: { syncRevision: { increment: 1 } },
      });
      await recordAssignments(
        tx,
        { ...member, actorId: context.accountId },
        [cardId],
        assigned,
        {
          id: eventId,
          now: new Date(),
          requestHash,
        },
      );
      return { confirmed: true };
    }, 'ReadCommitted');
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result;
  }

  async schedule(
    context: BoardContext,
    listId: string,
    cardId: string,
    change: CardScheduleChange,
    operationId: string,
  ) {
    const completion = 'completed' in change;
    const operation = completion
      ? change.completed
        ? 'CARD_COMPLETED'
        : 'CARD_REOPENED'
      : 'CARD_DATES_CHANGED';
    const eventId = creationId(
      context.accountId,
      operationId,
      context.workspaceId,
      context.boardId,
      'CARD_SCHEDULE',
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify([listId, cardId, change]))
      .digest('hex');
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
      const receipt = await tx.boardFeedEvent.findUnique({
        where: { id: eventId },
        select: { requestHash: true },
      });
      const current = await tx.boardCard.findFirst({
        where: {
          id: cardId,
          ...(receipt ? {} : { listId }),
          list: { boardId: context.boardId },
        },
        select: {
          ...scheduleFields,
          archived: true,
          list: { select: { archived: true } },
        },
      });
      if (!current) return { denied: 'HIDDEN' } as const;
      if (receipt) {
        if (receipt.requestHash !== requestHash) conflict();
        return { confirmed: true };
      }
      if (current.archived || current.list?.archived)
        return { denied: 'READ_ONLY' } as const;

      const occurredAt = new Date();
      let data: Prisma.BoardCardUncheckedUpdateInput;
      let beforeData: Prisma.InputJsonObject;
      let afterData: Prisma.InputJsonObject;
      if (completion) {
        if ((current.completedAt !== null) === change.completed) conflict();
        const completedAt = change.completed ? occurredAt : null;
        const completedById = change.completed ? context.accountId : null;
        data = { completedAt, completedById };
        beforeData = {
          completedAt: current.completedAt?.toISOString() ?? null,
          completedById: current.completedById,
        };
        afterData = {
          completedAt: completedAt?.toISOString() ?? null,
          completedById,
        };
      } else {
        beforeData = {
          startDate: civilDate(current.startDate),
          dueDate: civilDate(current.dueDate),
        };
        afterData = {
          startDate: civilDate(change.startDate),
          dueDate: civilDate(change.dueDate),
        };
        if (
          beforeData.startDate === afterData.startDate &&
          beforeData.dueDate === afterData.dueDate
        )
          conflict();
        data = change;
      }

      await tx.boardCard.update({
        where: { id: cardId },
        data,
        select: { id: true },
      });
      await tx.board.update({
        where: { id: context.boardId },
        select: { id: true },
        data: { syncRevision: { increment: 1 } },
      });
      await tx.auditEvent.createMany({
        data: {
          id: randomUUID(),
          occurredAt,
          actorAccountId: context.accountId,
          origin: 'HTTP',
          scope: 'BOARD',
          operation,
          result: 'SUCCESS',
          entityType: 'CARD',
          entityId: cardId,
          context: {
            workspaceId: context.workspaceId,
            boardId: context.boardId,
            listId,
          },
          operationId: eventId,
          correlationId: eventId,
          sequence: 1,
          beforeData,
          afterData,
        },
      });
      await tx.boardFeedEvent.createMany({
        data: {
          id: eventId,
          boardId: context.boardId,
          actorId: context.accountId,
          occurredAt,
          operation,
          listId,
          cardId,
          requestHash,
        },
      });
      return { confirmed: true };
    });
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result;
  }

  archiveList(
    context: BoardContext,
    listId: string,
    archived: boolean,
    operationId: string,
  ) {
    return this.changeArchive(context, { listId, archived }, operationId);
  }

  archiveCard(
    context: BoardContext,
    listId: string,
    cardId: string,
    archived: boolean,
    operationId: string,
    destinationListId?: string,
  ) {
    return this.changeArchive(
      context,
      { listId, cardId, archived, destinationListId },
      operationId,
    );
  }

  private async changeArchive(
    context: BoardContext,
    change: {
      listId: string;
      cardId?: string;
      archived: boolean;
      destinationListId?: string;
    },
    operationId: string,
  ) {
    const { listId, cardId, archived, destinationListId } = change;
    const kind = cardId ? 'CARD' : 'LIST';
    const operation = kind + (archived ? '_ARCHIVED' : '_RESTORED');
    const eventId = creationId(
      context.accountId,
      operationId,
      context.workspaceId,
      context.boardId,
      kind + '_ARCHIVE',
    );
    const intent = [
      listId,
      cardId,
      archived,
      ...(destinationListId ? [destinationListId] : []),
    ];
    const requestHash = createHash('sha256')
      .update(JSON.stringify(intent))
      .digest('hex');
    const result = await this.transaction(async (tx) => {
      const access = await this.boardAccess(tx, context);
      if (!access) return { denied: 'HIDDEN' } as const;
      if (!this.editable(access)) return { denied: 'READ_ONLY' } as const;
      await lockBoardMembers(tx, context.boardId);
      const findList = (id: string) =>
        tx.boardList.findFirst({
          where: { id, boardId: context.boardId },
          select: { archived: true },
        });
      if (
        !(await findList(listId)) ||
        (destinationListId && !(await findList(destinationListId)))
      )
        return { denied: 'HIDDEN' } as const;
      const containers: Container[] = [{ kind: 'CARD', id: listId }];
      if (!cardId) containers.push({ kind: 'LIST', id: context.boardId });
      if (destinationListId)
        containers.push({ kind: 'CARD', id: destinationListId });
      await lockContainers(tx, containers);
      const current = await this.boardAccess(tx, context);
      if (!current) return { denied: 'HIDDEN' } as const;
      if (!this.editable(current)) return { denied: 'READ_ONLY' } as const;

      const receipt = await tx.boardFeedEvent.findUnique({
        where: { id: eventId },
        select: { requestHash: true },
      });
      if (receipt) {
        if (receipt.requestHash !== requestHash) conflict();
        return { confirmed: true } as const;
      }
      const list = await findList(listId);
      if (!list) return { denied: 'HIDDEN' } as const;
      const state = cardId
        ? await tx.boardCard.findFirst({
            where: { id: cardId, listId },
            select: { archived: true },
          })
        : list;
      if (!state) return { denied: 'HIDDEN' } as const;
      const data = { archived, positionRevision: { increment: 1 } };
      const beforeData: Prisma.InputJsonObject = { archived: state.archived };
      const afterData: Prisma.InputJsonObject = { archived };
      if (destinationListId) {
        const destination = await findList(destinationListId);
        if (!destination) return { denied: 'HIDDEN' } as const;
        if (destination.archived) return { denied: 'READ_ONLY' } as const;
        if (!cardId || archived || !list.archived) conflict();
        const target: Container = { kind: 'CARD', id: destinationListId };
        const original = await siblings(tx, { kind: 'CARD', id: listId });
        const prior = original.findIndex(({ id }) => id === cardId);
        const items = await siblings(tx, target);
        const position = await positionAt(tx, target, items, items.length);
        Object.assign(beforeData, {
          listId,
          leftId: original[prior - 1]?.id ?? null,
          rightId: original[prior + 1]?.id ?? null,
        });
        Object.assign(afterData, {
          listId: destinationListId,
          ...neighbors(items, items.length),
        });
        await tx.boardCard.update({
          where: { id: cardId },
          data: { ...data, listId: destinationListId, position },
          select: { id: true },
        });
      } else {
        if (cardId && list.archived) return { denied: 'READ_ONLY' } as const;
        if (state.archived === archived) conflict();
        if (cardId) {
          await tx.boardCard.update({
            where: { id: cardId },
            data,
            select: { id: true },
          });
        } else {
          await tx.boardList.update({
            where: { id: listId },
            data,
            select: { id: true },
          });
        }
      }
      await advanceOrder(
        tx,
        context.boardId,
        kind,
        destinationListId ? [listId, destinationListId] : [listId],
      );
      const occurredAt = new Date();
      await tx.auditEvent.createMany({
        data: {
          id: randomUUID(),
          occurredAt,
          actorAccountId: context.accountId,
          origin: 'HTTP',
          scope: 'BOARD',
          operation,
          result: 'SUCCESS',
          entityType: kind,
          entityId: cardId ?? listId,
          context: {
            workspaceId: context.workspaceId,
            boardId: context.boardId,
            listId,
          },
          operationId: eventId,
          correlationId: eventId,
          sequence: 1,
          beforeData,
          afterData,
        },
      });
      await tx.boardFeedEvent.createMany({
        data: {
          id: eventId,
          boardId: context.boardId,
          actorId: context.accountId,
          occurredAt,
          operation,
          listId: destinationListId ?? listId,
          cardId,
          requestHash,
        },
      });
      return { confirmed: true } as const;
    }, 'ReadCommitted');
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result;
  }

  async move(
    context: BoardContext,
    kind: Container['kind'],
    intent: MoveIntent,
  ) {
    const card = kind === 'CARD';
    const operation = card ? 'CARD_MOVED' : 'LIST_REORDERED';
    const eventId = creationId(
      context.accountId,
      intent.operationId,
      context.workspaceId,
      context.boardId,
      'MOVE',
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify([kind, intent]))
      .digest('hex');
    const result = await this.transaction(async (tx) => {
      const scope = this.boardScope(context);
      // Authorize before looking up any item, then revalidate after waiting for locks.
      const authorization = {
        archived: true,
        orderRevision: true,
        members: {
          where: { accountId: context.accountId },
          select: { role: true },
        },
      } as const;
      const access = await tx.board.findFirst({
        where: scope,
        select: authorization,
      });
      if (!access) return { denied: 'HIDDEN' } as const;
      if (!this.editable(access)) return { denied: 'READ_ONLY' } as const;
      if (
        !card &&
        (intent.sourceId !== context.boardId ||
          intent.destinationId !== context.boardId)
      )
        return { denied: 'HIDDEN' } as const;
      const findCard = () =>
        tx.boardCard.findFirst({
          where: { id: intent.itemId, list: { boardId: context.boardId } },
          select: {
            id: true,
            listId: true,
            positionRevision: true,
            archived: true,
          },
        });
      const current = card ? await findCard() : null;
      if (card && !current) return { denied: 'HIDDEN' } as const;
      const source: Container = {
        kind,
        id: current?.listId ?? context.boardId,
      };
      const destination: Container = { kind, id: intent.destinationId };
      if (
        card &&
        !(await tx.boardList.findFirst({
          where: { id: destination.id, boardId: context.boardId },
          select: { id: true },
        }))
      )
        return { denied: 'HIDDEN' } as const;
      await lockContainers(tx, [source, destination]);
      const board = await tx.board.findFirst({
        where: scope,
        select: authorization,
      });
      if (!board) return { denied: 'HIDDEN' } as const;
      if (!this.editable(board)) return { denied: 'READ_ONLY' } as const;

      const receipt = await tx.boardFeedEvent.findUnique({
        where: { id: eventId },
        select: { requestHash: true },
      });
      if (receipt) {
        if (receipt.requestHash !== requestHash) conflict();
        return { confirmed: true };
      }
      const item = card
        ? await findCard()
        : await tx.boardList.findFirst({
            where: { id: intent.itemId, boardId: context.boardId },
            select: { positionRevision: true, archived: true },
          });
      if (!item) return { denied: 'HIDDEN' } as const;
      if ('listId' in item && item.listId !== source.id)
        throw new SourceChanged();
      if (item.archived) return { denied: 'READ_ONLY' } as const;
      if (
        intent.itemRevision > item.positionRevision ||
        (intent.itemRevision === item.positionRevision &&
          intent.sourceId !== source.id)
      )
        conflict();

      let sourceRevision = board.orderRevision;
      let destinationRevision = board.orderRevision;
      if (card) {
        const containers = await tx.boardList.findMany({
          where: {
            boardId: context.boardId,
            id: { in: [source.id, intent.sourceId, destination.id] },
          },
          select: { id: true, cardOrderRevision: true, archived: true },
        });
        const from = containers.find(({ id }) => id === intent.sourceId);
        const to = containers.find(({ id }) => id === destination.id);
        const actualSource = containers.find(({ id }) => id === source.id);
        if (!from || !to || !actualSource) return { denied: 'HIDDEN' } as const;
        if (actualSource.archived || to.archived)
          return { denied: 'READ_ONLY' } as const;
        sourceRevision = from.cardOrderRevision;
        destinationRevision = to.cardOrderRevision;
      }
      if (
        intent.sourceRevision > sourceRevision ||
        intent.destinationRevision > destinationRevision
      )
        conflict();
      const original = await siblings(tx, source);
      const visible = original.filter(({ archived }) => !archived);
      const oldIndex = visible.findIndex(({ id }) => id === intent.itemId);
      const before = {
        containerId: source.id,
        leftId: visible[oldIndex - 1]?.id ?? null,
        rightId: visible[oldIndex + 1]?.id ?? null,
      };
      const same = source.id === destination.id;
      const target = (same ? original : await siblings(tx, destination)).filter(
        ({ id }) => id !== intent.itemId,
      );
      const active = target.filter(({ archived }) => !archived);
      const index = placement(
        active,
        intent,
        intent.destinationRevision === destinationRevision,
      );
      if (same && index === oldIndex) conflict();
      // Archived items reserve their positions without participating in visible placement.
      const previous = active[index - 1]?.id;
      const slot = previous
        ? target.findIndex(({ id }) => id === previous) + 1
        : 0;
      const position = await positionAt(tx, destination, target, slot);
      const data = { position, positionRevision: { increment: 1 } };
      if (card) {
        await tx.boardCard.update({
          where: { id: intent.itemId },
          data: { ...data, listId: destination.id },
          select: { id: true },
        });
      } else {
        await tx.boardList.update({
          where: { id: intent.itemId },
          data,
          select: { id: true },
        });
      }
      await advanceOrder(
        tx,
        context.boardId,
        kind,
        same ? [source.id] : [source.id, destination.id],
      );
      const occurredAt = new Date();
      const listId = card ? destination.id : intent.itemId;
      await tx.auditEvent.createMany({
        data: {
          id: randomUUID(),
          occurredAt,
          actorAccountId: context.accountId,
          origin: 'HTTP',
          scope: 'BOARD',
          operation,
          result: 'SUCCESS',
          entityType: kind,
          entityId: intent.itemId,
          context: {
            workspaceId: context.workspaceId,
            boardId: context.boardId,
            listId,
          },
          operationId: eventId,
          correlationId: eventId,
          sequence: 1,
          beforeData: before,
          afterData: {
            containerId: destination.id,
            ...neighbors(active, index),
          },
        },
      });
      await tx.boardFeedEvent.createMany({
        data: {
          id: eventId,
          boardId: context.boardId,
          actorId: context.accountId,
          occurredAt,
          operation,
          listId,
          cardId: card ? intent.itemId : null,
          requestHash,
        },
      });
      return { confirmed: true };
    }, 'ReadCommitted');
    if (result.denied)
      return this.deny(context, operation, result.denied === 'READ_ONLY');
    return result;
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
    isolationLevel: Prisma.TransactionIsolationLevel = 'Serializable',
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(run, {
          isolationLevel,
        });
      } catch (error) {
        if (
          !(error instanceof SourceChanged) &&
          (!(error instanceof Prisma.PrismaClientKnownRequestError) ||
            !(
              ['P2002', 'P2034'].includes(error.code) ||
              (error.code === 'P2010' &&
                ['40001', '40P01'].includes(String(error.meta?.code)))
            ))
        )
          throw error;
        if (attempt === 3) {
          if (isolationLevel === 'ReadCommitted') conflict();
          throw error;
        }
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
