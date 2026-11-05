import { ControlledPasswordRecoveryDeliveryAdapter } from './password-recovery-delivery.adapter.js';

describe('ControlledPasswordRecoveryDeliveryAdapter', () => {
  const input = {
    recipientEmail: 'synthetic@example.test',
    recoveryUrl: 'https://bello.example/reset-password#token=synthetic',
    expiresAt: new Date('2030-01-01T00:30:00Z'),
  };

  it('accepts deterministically without accessing persistence', async () => {
    const signal = new AbortController().signal;
    await expect(
      new ControlledPasswordRecoveryDeliveryAdapter().deliver({
        ...input,
        signal,
      }),
    ).resolves.toEqual({ status: 'ACCEPTED' });
  });

  it('classifies an already aborted call as indeterminate', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new ControlledPasswordRecoveryDeliveryAdapter().deliver({
        ...input,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ status: 'INDETERMINATE' });
  });
});
