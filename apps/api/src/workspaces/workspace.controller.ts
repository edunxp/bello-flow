import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticationService } from '../auth/authentication.service.js';
import { HTTP_SECURITY_CONFIG_SETTING } from '../http/configure-http-application.js';
import {
  HTTP_ERROR_CODE,
  HttpBoundaryErrorFilter,
  HttpContractError,
} from '../http/http-errors.js';
import type { HttpSecurityConfig } from '../http/http-security.config.js';
import {
  validateApplicationRequestHeader,
  validateJsonContentType,
  validateMutatingRequestOrigin,
} from '../http/request-security.js';
import { readSessionCookie } from '../http/session-cookie.js';
import { parseCivilDate } from './card-schedule.js';
import { BoardContentService } from './board-content.service.js';
import { SharingService } from './sharing.service.js';
import { WorkspaceService } from './workspace.service.js';

function invalid(): never {
  throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
}

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    invalid();
  return value;
}

function invalidText(value: string): boolean {
  return value.includes('\0') || /\p{Surrogate}/u.test(value);
}

function text(value: unknown, max: number, trim: boolean): string {
  if (typeof value !== 'string' || !value.trim() || invalidText(value))
    invalid();
  const result = trim ? value.trim() : value;
  if (Array.from(result).length > max) invalid();
  return result;
}

function commentText(value: unknown, max: number) {
  const content = text(value, max, false);
  if (/^[\p{White_Space}\p{Cf}]*$/u.test(content)) invalid();
  return content;
}

function labelFields(body: Record<string, unknown> | undefined) {
  const name = text(body?.name, 50, true);
  const color = body?.color ?? null;
  if (
    color !== null &&
    (typeof color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(color))
  )
    invalid();
  return { name, color: color?.toLowerCase() ?? null };
}

@Controller('api/workspaces')
@UseFilters(HttpBoundaryErrorFilter)
export class WorkspaceController {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly authentication: AuthenticationService,
    private readonly sharing: SharingService,
    private readonly content: BoardContentService,
  ) {}

  @Get()
  async list(@Req() request: Request) {
    return this.workspaces.list(await this.account(request));
  }

  @Post()
  async create(@Req() request: Request) {
    const accountId = await this.account(request, true);
    const body = request.body as Record<string, unknown> | undefined;
    const name = text(body?.name, 100, true);
    const description =
      body?.description === undefined || body.description === ''
        ? undefined
        : text(body.description, 2000, false);
    const timeZone = text(body?.timeZone, 100, true);
    if (!timeZone.includes('/')) invalid();
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone });
    } catch {
      invalid();
    }
    return this.workspaces.create(accountId, identifier(body?.operationId), {
      name,
      description,
      timeZone,
    });
  }

  @Get('notifications')
  async notifications(@Req() request: Request) {
    return this.sharing.notifications(await this.account(request));
  }

  @Get(':workspaceId/members')
  async members(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.sharing.members(await this.account(request), {
      workspaceId: identifier(workspaceId),
    });
  }

  @Get(':workspaceId/boards/:boardId/members')
  async boardMembers(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('boardId') boardId: string,
  ) {
    return this.sharing.members(await this.account(request), {
      workspaceId: identifier(workspaceId),
      boardId: identifier(boardId),
    });
  }

  @Post(':workspaceId/members')
  @HttpCode(204)
  async include(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    const accountId = await this.account(request, true);
    const body = request.body as Record<string, unknown> | undefined;
    await this.sharing.include(
      accountId,
      { workspaceId: identifier(workspaceId) },
      body?.email,
      body?.role,
    );
  }

  @Post(':workspaceId/boards/:boardId/members')
  @HttpCode(204)
  async includeBoardMember(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('boardId') boardId: string,
  ) {
    const accountId = await this.account(request, true);
    const body = request.body as Record<string, unknown> | undefined;
    await this.sharing.include(
      accountId,
      {
        workspaceId: identifier(workspaceId),
        boardId: identifier(boardId),
      },
      body?.email,
      body?.role,
    );
  }

  @Get(':workspaceId/boards/:boardId/members/:accountId/assignment-impact')
  async assignmentImpact(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params);
    return this.sharing.boardMemberImpact(
      context.accountId,
      context,
      identifier(params.accountId),
    );
  }

  @Post(':workspaceId/boards/:boardId/members/change')
  @HttpCode(204)
  async changeBoardMember(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params, true);
    const body = request.body as Record<string, unknown> | undefined;
    const role = (value: unknown) => {
      if (value !== 'ADMIN' && value !== 'MEMBER' && value !== 'OBSERVER')
        invalid();
      return value;
    };
    const impactToken = body?.impactToken;
    const confirmAssignments = body?.confirmAssignments;
    if (
      impactToken !== undefined &&
      (typeof impactToken !== 'string' || !/^[0-9a-f]{64}$/u.test(impactToken))
    )
      invalid();
    if (
      confirmAssignments !== undefined &&
      typeof confirmAssignments !== 'boolean'
    )
      invalid();
    await this.sharing.changeBoardMember(context.accountId, context, {
      accountId: identifier(body?.accountId),
      expectedRole: role(body?.expectedRole),
      role: body?.role === null ? null : role(body?.role),
      impactToken,
      confirmAssignments,
      operationId: identifier(body?.operationId),
    });
  }

  @Get(':workspaceId/labels')
  async labels(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspaces.labels(
      await this.account(request),
      identifier(workspaceId),
    );
  }

  @Post(':workspaceId/labels')
  async createLabel(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    const body = request.body as Record<string, unknown> | undefined;
    return this.workspaces.changeLabel(
      await this.account(request, true),
      identifier(workspaceId),
      {
        kind: 'CREATE',
        fields: labelFields(body),
      },
      identifier(body?.operationId),
    );
  }

  @Patch(':workspaceId/labels/:labelId')
  async editLabel(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const body = request.body as Record<string, unknown> | undefined;
    return this.workspaces.changeLabel(
      await this.account(request, true),
      identifier(params.workspaceId),
      {
        kind: 'UPDATE',
        id: identifier(params.labelId),
        fields: labelFields(body),
      },
      identifier(body?.operationId),
    );
  }

  @Post(':workspaceId/labels/:labelId/delete')
  @HttpCode(204)
  async deleteLabel(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const accountId = await this.account(request, true);
    const body = request.body as Record<string, unknown> | undefined;
    if (body?.confirmed !== true) invalid();
    await this.workspaces.changeLabel(
      accountId,
      identifier(params.workspaceId),
      {
        kind: 'DELETE',
        id: identifier(params.labelId),
        fields: labelFields(body),
      },
      identifier(body?.operationId),
    );
  }

  @Get(':workspaceId/boards')
  async boards(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspaces.listBoards(
      await this.account(request),
      identifier(workspaceId),
    );
  }

  @Get(':workspaceId/boards/:boardId')
  async board(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('boardId') boardId: string,
  ) {
    return this.workspaces.board(
      await this.account(request),
      identifier(workspaceId),
      identifier(boardId),
    );
  }

  @Post(':workspaceId/boards')
  async createBoard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    const accountId = await this.account(request, true);
    const body = request.body as Record<string, unknown> | undefined;
    return this.workspaces.createBoard(
      accountId,
      identifier(workspaceId),
      identifier(body?.operationId),
      {
        name: text(body?.name, 100, true),
        description: text(body?.description, 2000, false),
      },
    );
  }

  @Get(':workspaceId/boards/:boardId/lists')
  async lists(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    return this.content.read(await this.contentContext(request, params));
  }

  @Get(':workspaceId/boards/:boardId/lists/revision')
  async orderRevision(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    return this.content.revision(await this.contentContext(request, params));
  }

  @Post(':workspaceId/boards/:boardId/lists/move')
  @HttpCode(204)
  async move(@Req() request: Request, @Param() params: Record<string, string>) {
    const context = await this.contentContext(request, params, true);
    const body = request.body as Record<string, unknown> | undefined;
    const revision = (value: unknown) => {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 2147483647
      )
        invalid();
      return value;
    };
    if (body?.kind !== 'LIST' && body?.kind !== 'CARD') invalid();
    const itemId = identifier(body.itemId);
    const leftId = body.leftId === null ? null : identifier(body.leftId);
    const rightId = body.rightId === null ? null : identifier(body.rightId);
    if (
      itemId === leftId ||
      itemId === rightId ||
      (leftId !== null && leftId === rightId)
    )
      invalid();
    await this.content.move(context, body.kind, {
      itemId,
      leftId,
      rightId,
      sourceId: identifier(body.sourceId),
      destinationId: identifier(body.destinationId),
      itemRevision: revision(body.itemRevision),
      sourceRevision: revision(body.sourceRevision),
      destinationRevision: revision(body.destinationRevision),
      operationId: identifier(body.operationId),
    });
  }

  @Patch(':workspaceId/boards/:boardId/lists/:listId')
  editList(@Req() request: Request, @Param() params: Record<string, string>) {
    return this.writeList(request, params);
  }

  @Post(':workspaceId/boards/:boardId/lists')
  async writeList(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params, true);
    const body = request.body as Record<string, unknown> | undefined;
    return this.content.write(
      context,
      {
        name: text(body?.name, 100, true),
        listId:
          params.listId === undefined ? undefined : identifier(params.listId),
      },
      params.listId === undefined ? identifier(body?.operationId) : '',
    );
  }

  @Get(':workspaceId/boards/:boardId/lists/:listId/cards/:cardId/comments')
  async comments(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params);
    return this.content.comments(
      context,
      identifier(params.listId),
      identifier(params.cardId),
    );
  }

  @Post(':workspaceId/boards/:boardId/lists/:listId/cards/:cardId/comments')
  @HttpCode(204)
  async changeComment(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params, true);
    const listId = identifier(params.listId);
    const cardId = identifier(params.cardId);
    const body = request.body as Record<string, unknown> | undefined;
    const operationId = identifier(body?.operationId);
    if (body?.kind === 'CREATE') {
      await this.content.changeComment(
        context,
        listId,
        cardId,
        { kind: 'CREATE', content: commentText(body.content, 10000) },
        operationId,
      );
      return;
    }
    const id = identifier(body?.id);
    const version = body?.version;
    if (typeof version !== 'string' || !/^[0-9a-f]{64}$/u.test(version))
      invalid();
    if (body?.kind === 'EDIT') {
      await this.content.changeComment(
        context,
        listId,
        cardId,
        {
          kind: 'EDIT',
          id,
          version,
          content: commentText(body.content, 10000),
        },
        operationId,
      );
      return;
    }
    if (
      (body?.kind !== 'REMOVE' && body?.kind !== 'MODERATE') ||
      body.confirmed !== true
    )
      invalid();
    await this.content.changeComment(
      context,
      listId,
      cardId,
      body.kind === 'MODERATE'
        ? {
            kind: 'MODERATE',
            id,
            version,
            justification: commentText(body.justification, 2000),
          }
        : { kind: 'REMOVE', id, version },
      operationId,
    );
  }

  @Post(':workspaceId/boards/:boardId/lists/:listId/cards/:cardId/labels')
  @HttpCode(204)
  async changeCardLabel(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params, true);
    const body = request.body as Record<string, unknown> | undefined;
    if (typeof body?.applied !== 'boolean') invalid();
    await this.content.changeCardLabel(
      context,
      identifier(params.listId),
      identifier(params.cardId),
      identifier(body.labelId),
      body.applied,
      identifier(body.operationId),
    );
  }

  @Post(':workspaceId/boards/:boardId/lists/:listId/cards/:cardId/assignees')
  @HttpCode(204)
  async changeAssignee(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params, true);
    const body = request.body as Record<string, unknown> | undefined;
    if (typeof body?.assigned !== 'boolean') invalid();
    await this.content.changeAssignee(
      context,
      identifier(params.listId),
      identifier(params.cardId),
      identifier(body.accountId),
      body.assigned,
      identifier(body.operationId),
    );
  }

  @Post(':workspaceId/boards/:boardId/lists/:listId/cards/:cardId/schedule')
  @HttpCode(204)
  async scheduleCard(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params, true);
    const body = request.body as Record<string, unknown> | undefined;
    const listId = identifier(params.listId);
    const cardId = identifier(params.cardId);
    const operationId = identifier(body?.operationId);
    if (body?.completed !== undefined) {
      if (
        typeof body.completed !== 'boolean' ||
        body.startDate !== undefined ||
        body.dueDate !== undefined
      )
        invalid();
      await this.content.schedule(
        context,
        listId,
        cardId,
        { completed: body.completed },
        operationId,
      );
      return;
    }
    const startDate = parseCivilDate(body?.startDate);
    const dueDate = parseCivilDate(body?.dueDate);
    if (startDate && dueDate && dueDate < startDate) invalid();
    await this.content.schedule(
      context,
      listId,
      cardId,
      { startDate, dueDate },
      operationId,
    );
  }

  @Patch(':workspaceId/boards/:boardId/lists/:listId/cards/:cardId')
  editCard(@Req() request: Request, @Param() params: Record<string, string>) {
    return this.writeCard(request, params);
  }

  @Post(':workspaceId/boards/:boardId/lists/:listId/cards')
  async writeCard(
    @Req() request: Request,
    @Param() params: Record<string, string>,
  ) {
    const context = await this.contentContext(request, params, true);
    const body = request.body as Record<string, unknown> | undefined;
    const editing = params.cardId !== undefined;
    const title =
      editing && body?.title === undefined
        ? undefined
        : text(body?.title, 200, true);
    const description = editing
      ? body?.description
      : (body?.description ?? null);
    if (title === undefined && description === undefined) invalid();
    if (
      description !== undefined &&
      description !== null &&
      (typeof description !== 'string' ||
        invalidText(description) ||
        Array.from(description).length > 20_000)
    )
      invalid();
    return this.content.write(
      context,
      {
        title,
        description,
        listId: identifier(params.listId),
        cardId:
          params.cardId === undefined ? undefined : identifier(params.cardId),
      },
      params.cardId === undefined ? identifier(body?.operationId) : '',
    );
  }

  private async contentContext(
    request: Request,
    params: Record<string, string>,
    mutating = false,
  ) {
    return {
      accountId: await this.account(request, mutating),
      workspaceId: identifier(params.workspaceId),
      boardId: identifier(params.boardId),
    };
  }

  private async account(request: Request, mutating = false) {
    request.res?.setHeader('Cache-Control', 'private, no-store');
    const config = request.app.get(
      HTTP_SECURITY_CONFIG_SETTING,
    ) as HttpSecurityConfig;
    if (
      !validateApplicationRequestHeader(request.rawHeaders).valid ||
      (mutating &&
        !validateMutatingRequestOrigin(request.rawHeaders, config.publicOrigin)
          .valid)
    ) {
      throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
    }
    if (mutating && !validateJsonContentType(request.rawHeaders).valid) {
      throw new HttpContractError(HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE);
    }
    const cookie = readSessionCookie(request.rawHeaders, config.sessionCookie);
    const identity =
      cookie.status === 'VALID'
        ? await this.authentication.resolveAuthenticatedSession(cookie.token)
        : null;
    if (!identity) throw new HttpContractError(HTTP_ERROR_CODE.UNAUTHENTICATED);
    return identity.accountId;
  }
}
