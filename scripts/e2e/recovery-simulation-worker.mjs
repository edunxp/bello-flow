// Test-only entry point. Live launcher cannot select a mock transport.
import { executeRecovery } from "./recovery-worker.mjs";
import { RESEND_EMAIL_ENDPOINT } from "../../apps/api/dist/auth/password-recovery-resend.adapter.js";
if (!process.send || process.env.BELLO_REHEARSAL_SIMULATION !== "true")
  process.exit(1);
const timer = setTimeout(() => process.exit(1), 30000);
let initialized = false;
process.on("message", (message) => {
  if (initialized) return;
  initialized = true;
  if (
    message?.key !== "synthetic-rehearsal-key" ||
    !Number.isInteger(message.mockPort) ||
    message.mockPort < 1 ||
    message.mockPort > 65535
  )
    process.exit(1);
  const port = message.mockPort;
  delete message.mockPort;
  void executeRecovery(message, async (url, options) => {
    if (url !== RESEND_EMAIL_ENDPOINT) throw new Error();
    return fetch("http://127.0.0.1:" + port + "/emails", options);
  }).finally(() => clearTimeout(timer));
});
process.on("disconnect", () => process.exit(1));
process.send({ type: "ready" });
