import { Injectable } from '@nestjs/common';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { normalizeAccountEmail } from '../identity/account-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AuthSessionPersistence,
  type CreatedAuthSession,
  type ReconcileAuthSessionOperationInput,
  type ResolvedAuthSession,
  SESSION_PERSISTENCE_ERROR_CODE,
  SessionPersistenceError,
} from './auth-session.persistence.js';
import {
  AUTH_SESSION_AUDIT_OPERATION,
  generateOperationId,
  type OperationId,
  type SessionId,
} from './session-primitives.js';
import {
  LOGIN_ADMISSION_ERROR_CODE,
  LoginAdmissionError,
  LoginAdmissionService,
  type LoginAdmissionCompletion,
} from './login-admission.service.js';

export const AUTHENTICATION_ERROR_CODE = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  AUTHENTICATION_REJECTED: 'AUTHENTICATION_REJECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  OPERATIONAL_FAILURE: 'OPERATIONAL_FAILURE',
  OPERATION_INDETERMINATE: 'OPERATION_INDETERMINATE',
} as const);

export type AuthenticationErrorCode =
  (typeof AUTHENTICATION_ERROR_CODE)[keyof typeof AUTHENTICATION_ERROR_CODE];

export class AuthenticationError extends Error {
  constructor(
    public readonly code: AuthenticationErrorCode,
    public readonly operationId: OperationId,
    public readonly sessionId?: SessionId,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'AuthenticationError';
  }
}

export interface AuthenticateWithPasswordInput {
  readonly email: unknown;
  readonly password: unknown;
}

export interface PasswordAuthenticationContext {
  readonly trustedIp: string | undefined;
  readonly signal?: AbortSignal;
}

export interface AuthenticatedPasswordSession extends CreatedAuthSession {
  readonly accountId: string;
}

export interface AuthenticatedSessionIdentity {
  readonly accountId: string;
}

export type LogoutCurrentSessionResult =
  { readonly status: 'COMPLETED' } | { readonly status: 'NO_ACTIVE_SESSION' };

export type LogoutAllSessionsResult =
  { readonly status: 'COMPLETED' } | { readonly status: 'UNAUTHENTICATED' };

export interface RevokeUndeliveredSessionInput {
  readonly accountId: string;
  readonly sessionId: SessionId;
}

type AuthenticationAccount = {
  id: string;
  status: string;
  emailVerifiedAt: Date | null;
  deactivatedAt: Date | null;
  credential: {
    passwordHash: string;
    changedAt: Date;
  } | null;
};

function isEligible(account: AuthenticationAccount): boolean {
  return (
    account.status === 'ACTIVE' &&
    account.emailVerifiedAt !== null &&
    account.deactivatedAt === null
  );
}

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: PasswordCredentialService,
    private readonly sessions: AuthSessionPersistence,
    private readonly admission: LoginAdmissionService,
  ) {}

  async authenticateWithPassword(
    input: AuthenticateWithPasswordInput,
    context: PasswordAuthenticationContext,
  ): Promise<AuthenticatedPasswordSession> {
    try {
      return await this.admission.executeProtected({
        email: input?.email,
        trustedIp: context?.trustedIp,
        signal: context?.signal,
        operation: () => this.executeAuthentication(input),
      });
    } catch (error) {
      if (!(error instanceof LoginAdmissionError)) {
        throw error;
      }
      const operationId = generateOperationId();
      if (
        error.code === LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED &&
        Number.isSafeInteger(error.retryAfterSeconds) &&
        error.retryAfterSeconds !== undefined &&
        error.retryAfterSeconds > 0
      ) {
        throw new AuthenticationError(
          AUTHENTICATION_ERROR_CODE.RATE_LIMITED,
          operationId,
          undefined,
          error.retryAfterSeconds,
        );
      }
      throw new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
        operationId,
      );
    }
  }

  private async executeAuthentication(
    input: AuthenticateWithPasswordInput,
  ): Promise<LoginAdmissionCompletion<AuthenticatedPasswordSession>> {
    const operationId = generateOperationId();
    try {
      return {
        status: 'AUTHENTICATED',
        value: await this.authenticate(input, operationId),
      };
    } catch (error) {
      const authenticationError =
        error instanceof AuthenticationError
          ? error
          : new AuthenticationError(
              AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
              operationId,
            );
      if (
        authenticationError.code === AUTHENTICATION_ERROR_CODE.INVALID_INPUT ||
        authenticationError.code ===
          AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED
      ) {
        return {
          status: 'DETERMINED_REJECTION',
          error: authenticationError,
        };
      }
      return {
        status:
          authenticationError.code ===
          AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE
            ? 'INDETERMINATE'
            : 'OPERATIONAL_FAILURE',
        error: authenticationError,
      };
    }
  }

  async resolveAuthenticatedSession(
    token: unknown,
  ): Promise<AuthenticatedSessionIdentity | null> {
    const session = await this.resolveSession(token, generateOperationId());
    return session ? { accountId: session.accountId } : null;
  }

  async logoutCurrentSession(
    token: unknown,
  ): Promise<LogoutCurrentSessionResult> {
    const operationId = generateOperationId();
    const session = await this.resolveSession(token, operationId);
    if (session === null) {
      return { status: 'NO_ACTIVE_SESSION' };
    }

    try {
      await this.sessions.logoutSession({
        accountId: session.accountId,
        sessionId: session.sessionId,
        operationId,
      });
      return { status: 'COMPLETED' };
    } catch (error) {
      if (this.isSafelyAbsentSession(error)) {
        return { status: 'NO_ACTIVE_SESSION' };
      }
      await this.reconcileIndeterminateRevocation(error, {
        accountId: session.accountId,
        sessionId: session.sessionId,
        operationId,
        operation: AUTH_SESSION_AUDIT_OPERATION.SESSION_LOGOUT,
      });
      return { status: 'COMPLETED' };
    }
  }

  async logoutAllSessions(token: unknown): Promise<LogoutAllSessionsResult> {
    const operationId = generateOperationId();
    const session = await this.resolveSession(token, operationId);
    if (session === null) {
      return { status: 'UNAUTHENTICATED' };
    }

    try {
      await this.sessions.revokeAllSessions({
        accountId: session.accountId,
        operationId,
      });
      return { status: 'COMPLETED' };
    } catch (error) {
      await this.reconcileIndeterminateRevocation(error, {
        accountId: session.accountId,
        operationId,
        operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
      });
      return { status: 'COMPLETED' };
    }
  }

  async revokeUndeliveredSession(
    input: RevokeUndeliveredSessionInput,
  ): Promise<void> {
    const operationId = generateOperationId();
    try {
      await this.sessions.revokeUndeliveredSession({ ...input, operationId });
    } catch (error) {
      if (this.isSafelyAbsentSession(error)) {
        return;
      }
      await this.reconcileIndeterminateRevocation(error, {
        ...input,
        operationId,
        operation: AUTH_SESSION_AUDIT_OPERATION.SESSIONS_REVOKED,
      });
    }
  }

  private async authenticate(
    input: AuthenticateWithPasswordInput,
    operationId: OperationId,
  ): Promise<AuthenticatedPasswordSession> {
    const normalizedEmail = normalizeAccountEmail(input.email);
    if (normalizedEmail.status === 'INVALID') {
      await this.performNegativeVerification(input.password, operationId);
      return this.rejectDetermined(
        null,
        operationId,
        AUTHENTICATION_ERROR_CODE.INVALID_INPUT,
      );
    }

    const account = await this.prisma.account.findUnique({
      where: { emailKey: normalizedEmail.emailKey },
      select: {
        id: true,
        status: true,
        emailVerifiedAt: true,
        deactivatedAt: true,
        credential: {
          select: { passwordHash: true, changedAt: true },
        },
      },
    });

    if (!account?.credential) {
      const candidateStatus = await this.performNegativeVerification(
        input.password,
        operationId,
      );
      return this.rejectDetermined(
        account?.id ?? null,
        operationId,
        candidateStatus === 'INVALID'
          ? AUTHENTICATION_ERROR_CODE.INVALID_INPUT
          : AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
      );
    }

    const verification = await this.credentials.verifyPassword(
      input.password,
      account.credential.passwordHash,
    );
    if (verification.status === 'INVALID_CANDIDATE') {
      await this.performNegativeVerification(input.password, operationId);
      return this.rejectDetermined(
        account.id,
        operationId,
        AUTHENTICATION_ERROR_CODE.INVALID_INPUT,
      );
    }
    if (
      verification.status === 'INVALID_STORED_HASH' ||
      verification.status === 'OPERATIONAL_FAILURE'
    ) {
      throw new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
        operationId,
      );
    }
    if (verification.status === 'NO_MATCH' || !isEligible(account)) {
      return this.rejectDetermined(
        account.id,
        operationId,
        AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
      );
    }

    try {
      const session = await this.sessions.createSession({
        accountId: account.id,
        credential: {
          encodedPasswordHash: account.credential.passwordHash,
          changedAt: account.credential.changedAt,
        },
        operationId,
      });
      return { accountId: account.id, ...session };
    } catch (error) {
      if (
        error instanceof SessionPersistenceError &&
        (error.code === SESSION_PERSISTENCE_ERROR_CODE.ACCOUNT_NOT_ELIGIBLE ||
          error.code === SESSION_PERSISTENCE_ERROR_CODE.CREDENTIAL_CHANGED)
      ) {
        return this.rejectDetermined(
          account.id,
          operationId,
          AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
        );
      }
      throw this.mapPersistenceError(error, operationId);
    }
  }

  private async performNegativeVerification(
    password: unknown,
    operationId: OperationId,
  ): Promise<'VALID' | 'INVALID'> {
    const result = await this.credentials.performNegativeVerification(password);
    if (result.status === 'OPERATIONAL_FAILURE') {
      throw new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
        operationId,
      );
    }
    return result.candidateStatus;
  }

  private async rejectDetermined(
    accountId: string | null,
    operationId: OperationId,
    code:
      | typeof AUTHENTICATION_ERROR_CODE.INVALID_INPUT
      | typeof AUTHENTICATION_ERROR_CODE.AUTHENTICATION_REJECTED,
  ): Promise<never> {
    try {
      await this.sessions.recordFailedLogin({ accountId, operationId });
    } catch (error) {
      throw this.mapPersistenceError(error, operationId);
    }
    throw new AuthenticationError(code, operationId);
  }

  private async resolveSession(
    token: unknown,
    operationId: OperationId,
  ): Promise<ResolvedAuthSession | null> {
    try {
      return await this.sessions.resolveSession(token);
    } catch {
      throw new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
        operationId,
      );
    }
  }

  private isSafelyAbsentSession(error: unknown): boolean {
    return (
      error instanceof SessionPersistenceError &&
      (error.code === SESSION_PERSISTENCE_ERROR_CODE.SESSION_NOT_FOUND ||
        error.code === SESSION_PERSISTENCE_ERROR_CODE.SESSION_ALREADY_REVOKED)
    );
  }

  private async reconcileIndeterminateRevocation(
    error: unknown,
    input: ReconcileAuthSessionOperationInput,
  ): Promise<void> {
    if (
      !(error instanceof SessionPersistenceError) ||
      error.code !== SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE
    ) {
      throw this.mapPersistenceError(error, input.operationId);
    }

    let reconciliation;
    try {
      reconciliation = await this.sessions.reconcileOperation(input);
    } catch (reconciliationError) {
      throw this.mapPersistenceError(reconciliationError, input.operationId);
    }

    if (reconciliation === 'COMPLETED') {
      return;
    }
    if (reconciliation === 'UNKNOWN') {
      throw new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE,
        input.operationId,
        input.sessionId,
      );
    }
    throw new AuthenticationError(
      AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
      input.operationId,
    );
  }

  private mapPersistenceError(
    error: unknown,
    operationId: OperationId,
  ): AuthenticationError {
    if (
      error instanceof SessionPersistenceError &&
      error.code === SESSION_PERSISTENCE_ERROR_CODE.OPERATION_INDETERMINATE
    ) {
      return new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE,
        error.operationId ?? operationId,
        error.sessionId,
      );
    }
    return new AuthenticationError(
      AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
      operationId,
    );
  }
}
