export const recoveryOrigin = "https://127.0.0.1:15444";
export const recoveryRecipient = "belloflow@nextpartner.com.br";
export const recoverySender = "recuperacao@notify.nextpartner.com.br";
export const recoveryMarker = "/tmp/bello-recovery-attempt-used";
export function assertRecoveryProfile(environment) {
  if (
    environment.BELLO_LOCAL_ONLY !== "true" ||
    environment.BELLO_RECOVERY_REHEARSAL !== "true" ||
    !/^bello-e2e-[0-9a-f-]{36}$/.test(environment.BELLO_E2E_RUN ?? "")
  )
    throw new Error();
}
// Fail closed before reaching the production adapter; a used budget is never restored.
export function singleDelivery(adapter) {
  let used = false;
  return {
    async deliver(input) {
      if (
        used ||
        input.recipientEmail !== recoveryRecipient ||
        input.signal.aborted
      )
        return { status: "NOT_ACCEPTED" };
      used = true;
      return adapter.deliver(input);
    },
  };
}
