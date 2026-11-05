import { Injectable } from '@nestjs/common';

export const PASSWORD_RECOVERY_DELIVERY_ADAPTER = Symbol(
  'PASSWORD_RECOVERY_DELIVERY_ADAPTER',
);

export interface PasswordRecoveryDeliveryInput {
  readonly recipientEmail: string;
  readonly recoveryUrl: string;
  readonly expiresAt: Date;
  readonly signal: AbortSignal;
}

export type PasswordRecoveryDeliveryResult =
  | { readonly status: 'ACCEPTED' }
  | { readonly status: 'NOT_ACCEPTED' }
  | { readonly status: 'INDETERMINATE' };

export interface PasswordRecoveryDeliveryAdapter {
  deliver(
    input: PasswordRecoveryDeliveryInput,
  ): Promise<PasswordRecoveryDeliveryResult>;
}

@Injectable()
export class ControlledPasswordRecoveryDeliveryAdapter implements PasswordRecoveryDeliveryAdapter {
  async deliver(
    input: PasswordRecoveryDeliveryInput,
  ): Promise<PasswordRecoveryDeliveryResult> {
    if (input.signal.aborted) return { status: 'INDETERMINATE' };
    return { status: 'ACCEPTED' };
  }
}
