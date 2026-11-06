import { performance } from 'node:perf_hooks';
import { Logger } from '@nestjs/common';
import type {
  PasswordRecoveryDeliveryAdapter,
  PasswordRecoveryDeliveryInput,
  PasswordRecoveryDeliveryResult,
} from './password-recovery-delivery.adapter.js';

export const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';
export const RESEND_MAX_RESPONSE_BODY_BYTES = 64 * 1024;

export const RESEND_NOT_ACCEPTED_RESPONSES = Object.freeze([
  [400, 'validation_error'],
  [400, 'invalid_idempotency_key'],
  [401, 'missing_api_key'],
  [401, 'validation_error'],
  [403, 'restricted_api_key'],
  [403, 'suspended_api_key'],
  [404, 'not_found'],
  [405, 'method_not_allowed'],
  [422, 'invalid_attachment'],
  [422, 'missing_required_field'],
  [429, 'daily_quota_exceeded'],
  [429, 'monthly_quota_exceeded'],
  [429, 'rate_limit_exceeded'],
] as const);

export type ResendFetch = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export type ResendDeliveryErrorType =
  | 'NONE'
  | 'CANCELLED'
  | 'TRANSPORT'
  | 'RESPONSE_READ'
  | 'RESPONSE_TOO_LARGE'
  | 'REDIRECT'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_REJECTED'
  | 'UNCLASSIFIED_HTTP';

export interface ResendDeliveryObservation {
  readonly provider: 'resend';
  readonly result: PasswordRecoveryDeliveryResult['status'];
  readonly durationMilliseconds: number;
  readonly httpStatus: number | null;
  readonly errorType: ResendDeliveryErrorType;
  readonly rateLimited: boolean;
}

export interface ResendLogger {
  log(observation: ResendDeliveryObservation): void;
}

const NOT_ACCEPTED = new Set(
  RESEND_NOT_ACCEPTED_RESPONSES.map(([status, name]) => `${status}:${name}`),
);

const DEFAULT_LOGGER: ResendLogger = new Logger(
  'ResendPasswordRecoveryAdapter',
);

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function messageFor(recoveryUrl: string): {
  readonly text: string;
  readonly html: string;
} {
  const text = [
    'Recebemos uma solicitação para redefinir sua senha no Bello Flow.',
    '',
    'Use o link abaixo para redefinir sua senha:',
    recoveryUrl,
    '',
    'Este link é válido por 30 minutos.',
    '',
    'Se você não solicitou esta redefinição, ignore esta mensagem.',
  ].join('\n');
  const escapedUrl = escapeHtml(recoveryUrl);
  const html = [
    '<p>Recebemos uma solicitação para redefinir sua senha no Bello Flow.</p>',
    `<p><a href="${escapedUrl}">Redefina sua senha</a></p>`,
    '<p>Este link é válido por 30 minutos.</p>',
    '<p>Se você não solicitou esta redefinição, ignore esta mensagem.</p>',
  ].join('');
  return { text, html };
}

function validAcceptedResponse(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === 'string' &&
    (value as { id: string }).id.trim().length > 0
  );
}

function readDocumentedError(
  value: unknown,
  httpStatus: number,
): { readonly name: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly statusCode?: unknown;
  };
  if (
    typeof candidate.name !== 'string' ||
    typeof candidate.message !== 'string' ||
    !Number.isInteger(candidate.statusCode) ||
    candidate.statusCode !== httpStatus
  ) {
    return null;
  }
  return { name: candidate.name };
}

type ResponseBodyReadResult =
  | { readonly ok: true; readonly body: string }
  | {
      readonly ok: false;
      readonly errorType: 'RESPONSE_READ' | 'RESPONSE_TOO_LARGE';
    };

async function readResponseBody(
  response: Response,
): Promise<ResponseBodyReadResult> {
  if (!response.body) return { ok: true, body: '' };

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (value.byteLength > RESEND_MAX_RESPONSE_BODY_BYTES - totalBytes) {
        try {
          await reader.cancel();
        } catch {
          // The classification remains conservative if cancellation also fails.
        }
        return { ok: false, errorType: 'RESPONSE_TOO_LARGE' };
      }
      totalBytes += value.byteLength;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The response is already unusable and remains indeterminate.
    }
    return { ok: false, errorType: 'RESPONSE_READ' };
  } finally {
    reader.releaseLock();
  }
  return { ok: true, body };
}

export class ResendPasswordRecoveryDeliveryAdapter implements PasswordRecoveryDeliveryAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly http: ResendFetch = globalThis.fetch,
    private readonly logger: ResendLogger = DEFAULT_LOGGER,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async deliver(
    input: PasswordRecoveryDeliveryInput,
  ): Promise<PasswordRecoveryDeliveryResult> {
    const startedAt = this.now();
    if (input.signal.aborted) {
      return this.observe(startedAt, null, 'INDETERMINATE', 'CANCELLED');
    }

    const content = messageFor(input.recoveryUrl);
    const payload = JSON.stringify({
      from: `Bello Flow <${this.fromAddress}>`,
      to: [input.recipientEmail],
      subject: 'Redefina sua senha no Bello Flow',
      text: content.text,
      html: content.html,
    });

    let response: Response;
    try {
      response = await this.http(RESEND_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: payload,
        redirect: 'manual',
        signal: input.signal,
      });
    } catch {
      return this.observe(
        startedAt,
        null,
        'INDETERMINATE',
        input.signal.aborted ? 'CANCELLED' : 'TRANSPORT',
      );
    }

    if (input.signal.aborted) {
      return this.observe(
        startedAt,
        response.status,
        'INDETERMINATE',
        'CANCELLED',
      );
    }
    if (response.status >= 300 && response.status < 400) {
      return this.observe(
        startedAt,
        response.status,
        'INDETERMINATE',
        'REDIRECT',
      );
    }

    const bodyRead = await readResponseBody(response);
    if (!bodyRead.ok) {
      return this.observe(
        startedAt,
        response.status,
        'INDETERMINATE',
        input.signal.aborted ? 'CANCELLED' : bodyRead.errorType,
      );
    }
    if (input.signal.aborted) {
      return this.observe(
        startedAt,
        response.status,
        'INDETERMINATE',
        'CANCELLED',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyRead.body) as unknown;
    } catch {
      return this.observe(
        startedAt,
        response.status,
        'INDETERMINATE',
        'INVALID_RESPONSE',
      );
    }

    if (response.status === 200 && validAcceptedResponse(parsed)) {
      return this.observe(startedAt, response.status, 'ACCEPTED', 'NONE');
    }

    const documentedError = readDocumentedError(parsed, response.status);
    if (
      documentedError &&
      NOT_ACCEPTED.has(`${response.status}:${documentedError.name}`)
    ) {
      return this.observe(
        startedAt,
        response.status,
        'NOT_ACCEPTED',
        'PROVIDER_REJECTED',
      );
    }

    return this.observe(
      startedAt,
      response.status,
      'INDETERMINATE',
      response.status === 200 ? 'INVALID_RESPONSE' : 'UNCLASSIFIED_HTTP',
    );
  }

  private observe(
    startedAt: number,
    httpStatus: number | null,
    result: PasswordRecoveryDeliveryResult['status'],
    errorType: ResendDeliveryErrorType,
  ): PasswordRecoveryDeliveryResult {
    this.logger.log({
      provider: 'resend',
      result,
      durationMilliseconds: Math.max(0, Math.round(this.now() - startedAt)),
      httpStatus,
      errorType,
      rateLimited: httpStatus === 429,
    });
    return { status: result };
  }
}
