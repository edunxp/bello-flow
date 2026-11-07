// Operational harness only. No public route, scheduler, or production source change.
import { Test } from "@nestjs/testing";
import { open } from "node:fs/promises";
import { Client } from "pg";
import { AppModule } from "../../apps/api/dist/app.module.js";
import {
  PASSWORD_RECOVERY_DELIVERY_CONFIG,
  loadPasswordRecoveryDeliveryConfig,
} from "../../apps/api/dist/auth/password-recovery-delivery.config.js";
import { PASSWORD_RECOVERY_DELIVERY_ADAPTER } from "../../apps/api/dist/auth/password-recovery-delivery.adapter.js";
import { PasswordRecoveryDeliveryProcessor } from "../../apps/api/dist/auth/password-recovery-delivery.processor.js";
import { ResendPasswordRecoveryDeliveryAdapter } from "../../apps/api/dist/auth/password-recovery-resend.adapter.js";
import {
  assertRecoveryProfile,
  recoveryOrigin,
  recoverySender,
  recoveryMarker,
  singleDelivery,
} from "./recovery-profile.mjs";
let module, timer;
let initialized = false;
export async function executeRecovery(message, http = globalThis.fetch) {
  let key = message?.key;
  try {
    assertRecoveryProfile(process.env);
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.BELLO_PUBLIC_ORIGIN !== recoveryOrigin
    )
      throw new Error();
    const db = new URL(process.env.DATABASE_URL);
    if (
      db.hostname !== "database" ||
      db.port !== "5432" ||
      db.pathname !== "/bello_test" ||
      db.username !== "bello_test_app"
    )
      throw new Error();
    const client = new Client({ connectionString: db.toString() });
    try {
      await client.connect();
      const proof = (
        await client.query(
          "SELECT current_database() AS db,current_user AS usr",
        )
      ).rows[0];
      if (proof.db !== "bello_test" || proof.usr !== "bello_test_app")
        throw new Error();
    } finally {
      await client.end();
    }
    const config = loadPasswordRecoveryDeliveryConfig({
      NODE_ENV: "development",
      BELLO_PUBLIC_ORIGIN: recoveryOrigin,
      BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: "resend",
      BELLO_PASSWORD_RECOVERY_FROM_ADDRESS: recoverySender,
      BELLO_PASSWORD_RECOVERY_RESEND_API_KEY: key,
    });
    // Durable for this container, even after errors, process restart or UNKNOWN.
    const marker = await open(recoveryMarker, "wx", 0o600);
    await marker.close();
    const observations = [];
    const adapter = singleDelivery(
      new ResendPasswordRecoveryDeliveryAdapter(key, recoverySender, http, {
        log: (observation) => observations.push(observation.result),
      }),
    );
    key = "";
    message.key = "";
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PASSWORD_RECOVERY_DELIVERY_CONFIG)
      .useValue(Object.freeze({ ...config, maximumClaimsPerCycle: 1 }))
      .overrideProvider(PASSWORD_RECOVERY_DELIVERY_ADAPTER)
      .useValue(adapter)
      .compile();
    module.useLogger(false);
    const processor = module.get(PasswordRecoveryDeliveryProcessor);
    // Config stays resend: disabled remains a kill switch. Only this harness suppresses scheduling.
    processor.onApplicationBootstrap = () => {};
    await module.init();
    const result = await processor.runCycle();
    await module.close();
    module = undefined;
    process.send(
      { type: "result", ...result, delivery: observations[0] ?? "NONE" },
      () => process.exit(0),
    );
  } catch {
    await module?.close();
    process.send?.({ type: "failed" }, () => process.exit(1));
  } finally {
    key = "";
    clearTimeout(timer);
  }
}
if (process.argv[1]?.endsWith("/recovery-worker.mjs")) {
  if (!process.send) process.exit(1);
  timer = setTimeout(() => process.exit(1), 30000);
  process.on("message", (message) => {
    if (initialized) return;
    initialized = true;
    if (
      process.env.BELLO_REHEARSAL_SIMULATION === "true" ||
      message?.mockPort !== undefined
    )
      process.exit(1);
    void executeRecovery(message);
  });
  process.on("disconnect", () => process.exit(1));
  process.send({ type: "ready" });
}
