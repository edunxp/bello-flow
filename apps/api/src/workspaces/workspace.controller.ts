import { Controller, Get, Param, Post, Req, UseFilters } from '@nestjs/common';
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
import { WorkspaceService } from './workspace.service.js';

function invalid(): never {
  throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
}

function identifier(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    invalid();
  return value;
}

function text(value: unknown, max: number, trim: boolean): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    invalid();
  const result = trim ? value.trim() : value;
  if (Array.from(result).length > max) invalid();
  return result;
}

@Controller('api/workspaces')
@UseFilters(HttpBoundaryErrorFilter)
export class WorkspaceController {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly authentication: AuthenticationService,
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
    return this.workspaces.create(accountId, { name, description, timeZone });
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
    return this.workspaces.createBoard(accountId, identifier(workspaceId), {
      name: text(body?.name, 100, true),
      description: text(body?.description, 2000, false),
    });
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
