import type { Request, Response } from 'express';
import { readParsedJsonBodyByteLength } from '../http/configure-http-application.js';

export type LoginHttpInput = {
  readonly email: string;
  readonly password: string;
};

export type LoginHttpInputResult =
  | { readonly valid: true; readonly input: LoginHttpInput }
  | { readonly valid: false };

export type PasswordRecoveryHttpInput = {
  readonly email: string;
};

export type PasswordRecoveryHttpInputResult =
  | { readonly valid: true; readonly input: PasswordRecoveryHttpInput }
  | { readonly valid: false };

export type PasswordResetHttpInput = {
  readonly token: string;
  readonly newPassword: string;
};

export type PasswordResetHttpInputResult =
  | { readonly valid: true; readonly input: PasswordResetHttpInput }
  | { readonly valid: false };

function readRawHeaderValues(
  rawHeaders: readonly string[],
  name: string,
): readonly string[] | null {
  if (rawHeaders.length % 2 !== 0) {
    return null;
  }
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]!.toLowerCase() === name.toLowerCase()) {
      values.push(rawHeaders[index + 1]!);
    }
  }
  return values;
}

export function readLoginHttpInput(value: unknown): LoginHttpInputResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(record, 'email') ||
    !Object.hasOwn(record, 'password') ||
    typeof record.email !== 'string' ||
    typeof record.password !== 'string'
  ) {
    return { valid: false };
  }
  return {
    valid: true,
    input: { email: record.email, password: record.password },
  };
}

export function readPasswordRecoveryHttpInput(
  value: unknown,
): PasswordRecoveryHttpInputResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 1 ||
    !Object.hasOwn(record, 'email') ||
    typeof record.email !== 'string'
  ) {
    return { valid: false };
  }
  return { valid: true, input: { email: record.email } };
}

export function readPasswordResetHttpInput(
  value: unknown,
): PasswordResetHttpInputResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(record, 'token') ||
    !Object.hasOwn(record, 'newPassword') ||
    typeof record.token !== 'string' ||
    typeof record.newPassword !== 'string'
  ) {
    return { valid: false };
  }
  return {
    valid: true,
    input: { token: record.token, newPassword: record.newPassword },
  };
}

function chunkHasBytes(chunk: unknown): boolean {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk) > 0;
  }
  return chunk instanceof Uint8Array && chunk.byteLength > 0;
}

export async function requestContainsBody(request: Request): Promise<boolean> {
  const parsedJsonByteLength = readParsedJsonBodyByteLength(request);
  if (parsedJsonByteLength !== undefined) {
    return parsedJsonByteLength > 0;
  }
  if (request.body !== undefined) {
    return true;
  }

  const contentLengths = readRawHeaderValues(
    request.rawHeaders,
    'Content-Length',
  );
  if (contentLengths === null || contentLengths.length > 1) {
    return true;
  }
  if (contentLengths.length === 1) {
    const value = contentLengths[0]!;
    if (!/^\d+$/.test(value)) {
      return true;
    }
    const length = Number(value);
    if (!Number.isSafeInteger(length) || length > 0) {
      return true;
    }
  }

  const transferEncodings = readRawHeaderValues(
    request.rawHeaders,
    'Transfer-Encoding',
  );
  if (transferEncodings === null || transferEncodings.length > 1) {
    return true;
  }
  if (transferEncodings.length === 0 || request.readableEnded) {
    return false;
  }

  for await (const chunk of request) {
    if (chunkHasBytes(chunk)) {
      return true;
    }
  }
  return false;
}

export type HttpRequestCancellation = {
  readonly signal: AbortSignal;
  dispose(): void;
};

export function createHttpRequestCancellation(
  request: Request,
  response: Response,
): HttpRequestCancellation {
  const controller = new AbortController();
  const abortForRequest = () => controller.abort();
  const abortForResponse = () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  };

  request.once('aborted', abortForRequest);
  response.once('close', abortForResponse);
  if (
    request.aborted ||
    (request.destroyed && !request.complete) ||
    (response.destroyed && !response.writableEnded)
  ) {
    controller.abort();
  }

  return {
    signal: controller.signal,
    dispose: () => {
      request.off('aborted', abortForRequest);
      response.off('close', abortForResponse);
    },
  };
}
