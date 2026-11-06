import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
  type RequestSecurityResult,
} from '../http/request-security.js';
import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from '../http/session-cookie.js';
import {
  AUTHENTICATION_ERROR_CODE,
  AuthenticationError,
  AuthenticationService,
} from './authentication.service.js';
import {
  createHttpRequestCancellation,
  readLoginHttpInput,
  readPasswordRecoveryHttpInput,
  readPasswordResetHttpInput,
  requestContainsBody,
} from './auth-http-request.js';
import { PasswordRecoveryRequestService } from './password-recovery-request.service.js';
import {
  PasswordResetService,
  PasswordResetValidationError,
} from './password-reset.service.js';

type AuthIdentityResponse = {
  readonly account: { readonly id: string };
};

type AuthEndpoint =
  | 'login'
  | 'session'
  | 'logout'
  | 'logout-all'
  | 'password-recovery'
  | 'password-reset';

function identityResponse(accountId: string): AuthIdentityResponse {
  return { account: { id: accountId } };
}

@Controller('api/auth')
@UseFilters(HttpBoundaryErrorFilter)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authentication: AuthenticationService,
    private readonly passwordRecovery: PasswordRecoveryRequestService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthIdentityResponse> {
    const config = this.readHttpSecurityConfig(request);
    this.requireApplicationHeader(request, 'login');
    this.requireMutatingOrigin(request, config, 'login');
    this.requireJsonContentType(request);

    const body = readLoginHttpInput(request.body);
    if (!body.valid) {
      throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
    }

    const cancellation = createHttpRequestCancellation(request, response);
    let session;
    try {
      session = await this.authentication.authenticateWithPassword(body.input, {
        trustedIp: request.ip,
        signal: cancellation.signal,
      });
    } catch (error) {
      this.throwLoginError(error, response);
    } finally {
      cancellation.dispose();
    }

    const externalResponse = identityResponse(session.accountId);
    try {
      const cookie = serializeSessionCookie(
        session.token,
        config.sessionCookie,
      );
      response.setHeader('Set-Cookie', cookie);
    } catch (error) {
      if (!response.headersSent) {
        response.removeHeader('Set-Cookie');
        try {
          await this.authentication.revokeUndeliveredSession({
            accountId: session.accountId,
            sessionId: session.sessionId,
          });
        } catch (compensationError) {
          this.throwServiceError(compensationError);
        }
        throw new HttpContractError(HTTP_ERROR_CODE.SERVICE_UNAVAILABLE);
      }
      throw error;
    }
    return externalResponse;
  }

  @Get('session')
  async session(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthIdentityResponse> {
    const config = this.readHttpSecurityConfig(request);
    this.requireApplicationHeader(request, 'session');
    await this.requireBodyless(request);

    const cookie = readSessionCookie(request.rawHeaders, config.sessionCookie);
    if (cookie.status === 'ABSENT') {
      throw new HttpContractError(HTTP_ERROR_CODE.UNAUTHENTICATED);
    }
    if (cookie.status === 'INVALID') {
      response.setHeader(
        'Set-Cookie',
        serializeClearedSessionCookie(config.sessionCookie),
      );
      throw new HttpContractError(HTTP_ERROR_CODE.UNAUTHENTICATED);
    }

    let identity;
    try {
      identity = await this.authentication.resolveAuthenticatedSession(
        cookie.token,
      );
    } catch (error) {
      this.throwServiceError(error);
    }
    if (identity === null) {
      response.setHeader(
        'Set-Cookie',
        serializeClearedSessionCookie(config.sessionCookie),
      );
      throw new HttpContractError(HTTP_ERROR_CODE.UNAUTHENTICATED);
    }
    return identityResponse(identity.accountId);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const config = this.readHttpSecurityConfig(request);
    this.requireApplicationHeader(request, 'logout');
    this.requireMutatingOrigin(request, config, 'logout');
    await this.requireBodyless(request);

    const cookie = readSessionCookie(request.rawHeaders, config.sessionCookie);
    try {
      await this.authentication.logoutCurrentSession(
        cookie.status === 'VALID' ? cookie.token : undefined,
      );
    } catch (error) {
      this.throwServiceError(error);
    }
    response.setHeader(
      'Set-Cookie',
      serializeClearedSessionCookie(config.sessionCookie),
    );
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const config = this.readHttpSecurityConfig(request);
    this.requireApplicationHeader(request, 'logout-all');
    this.requireMutatingOrigin(request, config, 'logout-all');
    await this.requireBodyless(request);

    const cookie = readSessionCookie(request.rawHeaders, config.sessionCookie);
    let result;
    try {
      result = await this.authentication.logoutAllSessions(
        cookie.status === 'VALID' ? cookie.token : undefined,
      );
    } catch (error) {
      this.throwServiceError(error);
    }
    if (result.status === 'UNAUTHENTICATED') {
      throw new HttpContractError(HTTP_ERROR_CODE.UNAUTHENTICATED);
    }
    response.setHeader(
      'Set-Cookie',
      serializeClearedSessionCookie(config.sessionCookie),
    );
  }

  @Post('password-recovery')
  @HttpCode(202)
  async requestPasswordRecovery(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const config = this.readHttpSecurityConfig(request);
    this.requireApplicationHeader(request, 'password-recovery');
    this.requireMutatingOrigin(request, config, 'password-recovery');
    this.requireJsonContentType(request);

    const body = readPasswordRecoveryHttpInput(request.body);
    if (!body.valid) {
      throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
    }

    const result = await this.passwordRecovery.request({
      email: body.input.email,
      trustedIp: request.ip,
    });
    if (result.status === 'RECORDED') return;
    if (result.status === 'RATE_LIMITED') {
      this.throwRateLimited(result.retryAfterSeconds, response);
    }
    if (result.status === 'SERVICE_UNAVAILABLE') {
      throw new HttpContractError(HTTP_ERROR_CODE.SERVICE_UNAVAILABLE);
    }
    throw new HttpContractError(HTTP_ERROR_CODE.INTERNAL_ERROR);
  }

  @Post('password-reset')
  @HttpCode(204)
  async resetPassword(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const config = this.readHttpSecurityConfig(request);
    this.requireApplicationHeader(request, 'password-reset');
    this.requireMutatingOrigin(request, config, 'password-reset');
    this.requireJsonContentType(request);

    const body = readPasswordResetHttpInput(request.body);
    if (!body.valid) {
      throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
    }

    const cancellation = createHttpRequestCancellation(request, response);
    let result;
    try {
      result = await this.passwordResetService.reset({
        ...body.input,
        trustedIp: request.ip,
        signal: cancellation.signal,
      });
    } catch (error) {
      if (error instanceof PasswordResetValidationError) {
        throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
      }
      throw error;
    } finally {
      cancellation.dispose();
    }

    if (result.status === 'COMPLETED') return;
    if (result.status === 'AUTHENTICATION_FAILED') {
      throw new HttpContractError(HTTP_ERROR_CODE.AUTHENTICATION_FAILED);
    }
    if (result.status === 'RATE_LIMITED') {
      this.throwRateLimited(result.retryAfterSeconds, response);
    }
    if (result.status === 'SERVICE_UNAVAILABLE') {
      throw new HttpContractError(HTTP_ERROR_CODE.SERVICE_UNAVAILABLE);
    }
    throw new HttpContractError(HTTP_ERROR_CODE.INTERNAL_ERROR);
  }

  private readHttpSecurityConfig(request: Request): HttpSecurityConfig {
    const config = request.app.get(HTTP_SECURITY_CONFIG_SETTING) as unknown;
    if (!config || typeof config !== 'object') {
      throw new HttpContractError(HTTP_ERROR_CODE.INTERNAL_ERROR);
    }
    return config as HttpSecurityConfig;
  }

  private requireApplicationHeader(
    request: Request,
    endpoint: AuthEndpoint,
  ): void {
    const result = validateApplicationRequestHeader(request.rawHeaders);
    if (!result.valid) {
      this.logRequestRejection(endpoint, 'APPLICATION_HEADER', result);
      throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
    }
  }

  private requireMutatingOrigin(
    request: Request,
    config: HttpSecurityConfig,
    endpoint: AuthEndpoint,
  ): void {
    const result = validateMutatingRequestOrigin(
      request.rawHeaders,
      config.publicOrigin,
    );
    if (!result.valid) {
      this.logRequestRejection(endpoint, 'ORIGIN', result);
      throw new HttpContractError(HTTP_ERROR_CODE.REQUEST_FORBIDDEN);
    }
  }

  private requireJsonContentType(request: Request): void {
    if (!validateJsonContentType(request.rawHeaders).valid) {
      throw new HttpContractError(HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE);
    }
  }

  private async requireBodyless(request: Request): Promise<void> {
    if (await requestContainsBody(request)) {
      throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
    }
  }

  private logRequestRejection(
    endpoint: AuthEndpoint,
    control: 'APPLICATION_HEADER' | 'ORIGIN',
    result: Extract<RequestSecurityResult, { readonly valid: false }>,
  ): void {
    this.logger.warn({
      event: 'AUTH_HTTP_REQUEST_REJECTED',
      endpoint,
      control,
      reason: result.reason,
    });
  }

  private throwLoginError(error: unknown, response: Response): never {
    if (error instanceof AuthenticationError) {
      if (
        error.code === AUTHENTICATION_ERROR_CODE.RATE_LIMITED &&
        Number.isSafeInteger(error.retryAfterSeconds) &&
        error.retryAfterSeconds !== undefined &&
        error.retryAfterSeconds > 0
      ) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpContractError(HTTP_ERROR_CODE.RATE_LIMITED);
      }
      if (
        error.code === AUTHENTICATION_ERROR_CODE.INVALID_INPUT ||
        error.code === AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED
      ) {
        throw new HttpContractError(HTTP_ERROR_CODE.AUTHENTICATION_FAILED);
      }
    }
    this.throwServiceError(error);
  }

  private throwRateLimited(
    retryAfterSeconds: number,
    response: Response,
  ): never {
    if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds <= 0) {
      throw new HttpContractError(HTTP_ERROR_CODE.INTERNAL_ERROR);
    }
    response.setHeader('Retry-After', String(retryAfterSeconds));
    throw new HttpContractError(HTTP_ERROR_CODE.RATE_LIMITED);
  }

  private throwServiceError(error: unknown): never {
    if (
      error instanceof AuthenticationError &&
      (error.code === AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE ||
        error.code === AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE)
    ) {
      throw new HttpContractError(HTTP_ERROR_CODE.SERVICE_UNAVAILABLE);
    }
    throw error;
  }
}
