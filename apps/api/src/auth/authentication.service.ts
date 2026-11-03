import { Injectable } from '@nestjs/common';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { normalizeAccountEmail } from '../identity/account-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AuthSessionPersistence,
  type CreatedAuthSession,
  SESSION_PERSISTENCE_ERROR_CODE,
  SessionPersistenceError,
} from './auth-session.persistence.js';
import {
  generateOperationId,
  type OperationId,
  type SessionId,
} from './session-primitives.js';

export const AUTHENTICATION_ERROR_CODE = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  AUTHENTICATION_REJECTED: 'AUTHENTICATION_REJECTED',
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
  ) {
    super(code);
    this.name = 'AuthenticationError';
  }
}

export interface AuthenticateWithPasswordInput {
  readonly email: unknown;
  readonly password: unknown;
}

export interface AuthenticatedPasswordSession extends CreatedAuthSession {
  readonly accountId: string;
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
  ) {}

  async authenticateWithPassword(
    input: AuthenticateWithPasswordInput,
  ): Promise<AuthenticatedPasswordSession> {
    const operationId = generateOperationId();

    try {
      return await this.authenticate(input, operationId);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATIONAL_FAILURE,
        operationId,
      );
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
