// Local homologation only: this entry point can never enable mail delivery.
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../apps/api/dist/app.module.js";
import { configureHttpApplication } from "../../apps/api/dist/http/configure-http-application.js";
import { loadHttpSecurityConfig } from "../../apps/api/dist/http/http-security.config.js";
import { PASSWORD_RECOVERY_DELIVERY_CONFIG } from "../../apps/api/dist/auth/password-recovery-delivery.config.js";
import { recoveryOrigin } from "./recovery-profile.mjs";
const origin =
  process.env.BELLO_RECOVERY_REHEARSAL === "true"
    ? recoveryOrigin
    : "https://127.0.0.1:15443";
let app;
try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.BELLO_PASSWORD_RECOVERY_DELIVERY_MODE !== "disabled" ||
    process.env.BELLO_PUBLIC_ORIGIN !== origin ||
    !/^bello-e2e-[0-9a-f-]{36}$/.test(process.env.BELLO_E2E_RUN ?? "") ||
    !process.send
  )
    throw new Error();
  app = await NestFactory.create(AppModule, {
    bodyParser: false,
    rawBody: true,
    logger: false,
  });
  configureHttpApplication(app, loadHttpSecurityConfig(process.env));
  await app.listen(0, "127.0.0.1");
  process.send({
    type: "ready",
    port: app.getHttpServer().address().port,
    mailMode: app.get(PASSWORD_RECOVERY_DELIVERY_CONFIG).mode,
  });
  process.on("message", async (message) => {
    if (message === "stop") {
      await app.close();
      process.exit(0);
    }
  });
  process.on("disconnect", async () => {
    await app.close();
    process.exit(0);
  });
} catch {
  await app?.close();
  process.send?.({ type: "failed" });
  process.exit(1);
}
