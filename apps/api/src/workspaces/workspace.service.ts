import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fields = { name: string; description?: string };
type BoardFields = Fields & { description: string };

export function creationId(
  accountId: string,
  operationId: string,
  workspaceId?: string,
  ...scope: string[]
) {
  const bytes = createHash('sha256')
    .update(
      JSON.stringify([
        'bello-resource-creation-v1',
        accountId,
        workspaceId ?? null,
        operationId,
        ...scope,
      ]),
    )
    .digest();
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly db: PrismaService) {}

  list(accountId: string) {
    return this.db.workspace.findMany({
      where: { members: { some: { accountId } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async create(
    accountId: string,
    operationId: string,
    fields: Fields & { timeZone: string },
  ) {
    const id = creationId(accountId, operationId);
    const workspace = await this.db.$transaction(async (tx) => {
      if (!(await this.eligible(tx, accountId))) return null;
      const inserted = await tx.workspace.createMany({
        data: { ...fields, id },
        skipDuplicates: true,
      });
      const workspace = await tx.workspace.findFirstOrThrow({
        where: {
          id,
          ...(inserted.count === 0 ? { members: { some: { accountId } } } : {}),
        },
      });
      if (inserted.count === 0) {
        return this.replay(workspace, fields);
      }
      await tx.workspaceMembership.create({
        data: { workspaceId: id, accountId, role: 'ADMIN' },
      });
      await this.audit(tx, accountId, id, 'WORKSPACE', workspace);
      return workspace;
    });
    if (!workspace) return this.deny(accountId, 'CREATE_WORKSPACE');
    return workspace;
  }

  async listBoards(accountId: string, workspaceId: string) {
    const workspace = await this.db.workspace.findFirst({
      where: { id: workspaceId, members: { some: { accountId } } },
      select: {
        boards: {
          where: { members: { some: { accountId } } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!workspace) return this.deny(accountId, 'LIST_BOARDS');
    return workspace.boards;
  }

  async board(accountId: string, workspaceId: string, id: string) {
    const board = await this.db.board.findFirst({
      where: { id, workspaceId, members: { some: { accountId } } },
    });
    if (!board) return this.deny(accountId, 'READ_BOARD');
    return board;
  }

  async createBoard(
    accountId: string,
    workspaceId: string,
    operationId: string,
    fields: BoardFields,
  ) {
    const id = creationId(accountId, operationId, workspaceId);
    const board = await this.db.$transaction(async (tx) => {
      const membership = await tx.workspaceMembership.findUnique({
        where: { workspaceId_accountId: { workspaceId, accountId } },
      });
      if (!membership || !(await this.eligible(tx, accountId))) return null;

      const inserted = await tx.board.createMany({
        data: { ...fields, id, workspaceId },
        skipDuplicates: true,
      });
      const created = await tx.board.findFirstOrThrow({
        where: {
          id,
          workspaceId,
          ...(inserted.count === 0 ? { members: { some: { accountId } } } : {}),
        },
      });
      if (inserted.count === 0) {
        return this.replay(created, fields);
      }
      await tx.boardMembership.create({
        data: { workspaceId, boardId: id, accountId, role: 'ADMIN' },
      });
      await this.audit(tx, accountId, workspaceId, 'BOARD', created);
      await tx.boardFeedEvent.createMany({
        data: ['BOARD_CREATED', 'BOARD_ADMIN_GRANTED'].map((operation) => ({
          id: randomUUID(),
          boardId: id,
          actorId: accountId,
          occurredAt: new Date(),
          operation,
        })),
      });
      return created;
    });
    if (!board) return this.deny(accountId, 'CREATE_BOARD');
    return board;
  }

  private replay<
    T extends { name: string; description: string | null; timeZone?: string },
  >(resource: T, fields: Fields & { timeZone?: string }): T {
    if (
      resource.name !== fields.name ||
      resource.description !== (fields.description ?? null) ||
      resource.timeZone !== fields.timeZone
    ) {
      throw new HttpContractError(HTTP_ERROR_CODE.OPERATION_CONFLICT);
    }
    return resource;
  }

  private eligible(tx: Prisma.TransactionClient, accountId: string) {
    return tx.account.findFirst({
      where: {
        id: accountId,
        status: 'ACTIVE',
        emailVerifiedAt: { not: null },
        deactivatedAt: null,
      },
      select: { id: true },
    });
  }

  private async deny(accountId: string, operation: string): Promise<never> {
    const operationId = randomUUID();
    await this.db.auditEvent.createMany({
      data: {
        id: randomUUID(),
        occurredAt: new Date(),
        actorAccountId: accountId,
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
    throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorAccountId: string,
    workspaceId: string,
    entityType: 'WORKSPACE' | 'BOARD',
    resource: { id: string } & Prisma.InputJsonObject,
  ) {
    const operationId = resource.id;
    const common = {
      occurredAt: new Date(),
      actorAccountId,
      origin: 'HTTP',
      scope: 'WORKSPACE',
      result: 'SUCCESS',
      entityType,
      entityId: resource.id,
      context: { workspaceId },
      operationId,
      correlationId: operationId,
    };
    await tx.auditEvent.createMany({
      data: [
        {
          ...common,
          id: randomUUID(),
          operation: entityType + '_CREATED',
          afterData: resource,
          sequence: 1,
        },
        {
          ...common,
          id: randomUUID(),
          operation: entityType + '_ADMIN_GRANTED',
          afterData: { accountId: actorAccountId, role: 'ADMIN' },
          sequence: 2,
        },
      ],
    });
  }
}
