import { fork } from "node:child_process";
import { connection } from "./local-account.mjs";
import { assertRecoveryProfile, recoveryOrigin } from "./recovery-profile.mjs";
// Key travels only over private IPC, never argv, Docker config or child environment.
export async function runRecoveryWorker({ key, mockPort }) {
  assertRecoveryProfile(process.env);
  const simulation = process.env.BELLO_REHEARSAL_SIMULATION === "true";
  if (simulation !== Number.isInteger(mockPort)) throw new Error();
  if (
    simulation &&
    (key !== "synthetic-rehearsal-key" || mockPort < 1 || mockPort > 65535)
  )
    throw new Error();
  const child = fork(
    simulation
      ? "scripts/e2e/recovery-simulation-worker.mjs"
      : "scripts/e2e/recovery-worker.mjs",
    [],
    {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "development",
        BELLO_LOCAL_ONLY: "true",
        BELLO_RECOVERY_REHEARSAL: "true",
        BELLO_E2E_RUN: process.env.BELLO_E2E_RUN,
        BELLO_REHEARSAL_SIMULATION: simulation ? "true" : "false",
        DATABASE_URL: connection(
          "bello_test_app",
          process.env.BELLO_TEST_APP_PASSWORD,
        ),
        BELLO_PUBLIC_ORIGIN: recoveryOrigin,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      let result,
        sent = false;
      timer = setTimeout(() => {
        child.kill();
        reject(new Error());
      }, 30000);
      child.on("message", (message) => {
        if (message?.type === "ready" && !sent) {
          sent = true;
          child.send({ key, mockPort });
          key = "";
        } else if (message?.type === "result") result = message;
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 && result ? resolve(result) : reject(new Error()),
      );
    });
  } finally {
    key = "";
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}
