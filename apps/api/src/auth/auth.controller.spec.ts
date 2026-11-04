import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import {
  AUTHENTICATION_ERROR_CODE,
  AuthenticationError,
  type AuthenticationService,
} from './authentication.service.js';
import {
  generateOperationId,
  generateSessionId,
} from './session-primitives.js';
import { HTTP_SECURITY_CONFIG_SETTING } from '../http/configure-http-application.js';
import { HttpContractError } from '../http/http-errors.js';
import { loadHttpSecurityConfig } from '../http/http-security.config.js';

const config = loadHttpSecurityConfig({
  NODE_ENV: 'test',
  BELLO_PUBLIC_ORIGIN: 'http://127.0.0.1:14200',
});
const accountId = '7ceac8d7-f290-4e48-8b42-67e83c982548';
const token = 'A'.repeat(43);

function loginRequest(): Request {
  return Object.assign(new EventEmitter(), {
    app: {
      get: vi.fn((name: string) =>
        name === HTTP_SECURITY_CONFIG_SETTING ? config : undefined,
      ),
    },
    rawHeaders: [
      'X-Bello-Flow-Request',
      '1',
      'Origin',
      config.publicOrigin,
      'Content-Type',
      'application/json',
    ],
    body: { email: 'user@example.com', password: 'candidate-password' },
    ip: '127.0.0.1',
    aborted: false,
    destroyed: false,
    complete: true,
  }) as unknown as Request;
}

function responseWithSetHeaderFailure(
  headersSent = false,
  removeHeader = vi.fn(),
): Response {
  return Object.assign(new EventEmitter(), {
    headersSent,
    destroyed: false,
    writableEnded: false,
    setHeader: vi.fn(() => {
      throw new Error('controlled setHeader failure');
    }),
    removeHeader,
  }) as unknown as Response;
}

describe('AuthController delivery boundary', () => {
  const authenticateWithPassword = vi.fn();
  const revokeUndeliveredSession = vi.fn();
  const authentication = {
    authenticateWithPassword,
    revokeUndeliveredSession,
  } as unknown as AuthenticationService;
  const controller = new AuthController(authentication);

  beforeEach(() => {
    vi.clearAllMocks();
    authenticateWithPassword.mockResolvedValue({
      accountId,
      sessionId: generateSessionId(),
      operationId: generateOperationId(),
      token,
      createdAt: new Date(),
      absoluteExpiresAt: new Date(),
    });
    revokeUndeliveredSession.mockResolvedValue(undefined);
  });

  it('compensates once when cookie delivery fails before headers start', async () => {
    const removeHeader = vi.fn();
    const response = responseWithSetHeaderFailure(false, removeHeader);

    await expect(
      controller.login(loginRequest(), response),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    } satisfies Partial<HttpContractError>);

    const session = authenticateWithPassword.mock.results[0]!.value;
    expect(removeHeader).toHaveBeenCalledWith('Set-Cookie');
    expect(revokeUndeliveredSession).toHaveBeenCalledWith({
      accountId,
      sessionId: expect.any(String),
    });
    expect(revokeUndeliveredSession).toHaveBeenCalledOnce();
    expect(session).toBeInstanceOf(Promise);
  });

  it('does not compensate a failure observed after headers started', async () => {
    const removeHeader = vi.fn();
    const response = responseWithSetHeaderFailure(true, removeHeader);

    await expect(controller.login(loginRequest(), response)).rejects.toThrow(
      'controlled setHeader failure',
    );

    expect(revokeUndeliveredSession).not.toHaveBeenCalled();
    expect(removeHeader).not.toHaveBeenCalled();
  });

  it('does not hide an indeterminate compensation as success', async () => {
    const response = responseWithSetHeaderFailure(false);
    revokeUndeliveredSession.mockRejectedValue(
      new AuthenticationError(
        AUTHENTICATION_ERROR_CODE.OPERATION_INDETERMINATE,
        generateOperationId(),
      ),
    );

    await expect(
      controller.login(loginRequest(), response),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    expect(revokeUndeliveredSession).toHaveBeenCalledOnce();
  });

  it('fails closed when the trusted application configuration is absent', async () => {
    const request = loginRequest();
    (request.app as unknown as { get: (name: string) => unknown }).get = vi.fn(
      () => undefined,
    );

    await expect(
      controller.login(request, responseWithSetHeaderFailure()),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(authenticateWithPassword).not.toHaveBeenCalled();
  });
});
