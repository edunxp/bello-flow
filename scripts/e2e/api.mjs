// This entry point is test-only, is never part of apps/api/dist, and exposes no diagnostic route.
import { Test } from "@nestjs/testing";
import { AppModule } from "../../apps/api/dist/app.module.js";
import { PASSWORD_RECOVERY_DELIVERY_ADAPTER } from "../../apps/api/dist/auth/password-recovery-delivery.adapter.js";
import { ACCESS_NOTIFICATION_MAIL } from "../../apps/api/dist/workspaces/access-notification-delivery.js";
import { configureHttpApplication } from "../../apps/api/dist/http/configure-http-application.js";
import { loadHttpSecurityConfig } from "../../apps/api/dist/http/http-security.config.js";

let app;
try {
  if (
    process.env.NODE_ENV !== "test" ||
    !/^bello-e2e-[0-9a-f-]{36}$/.test(process.env.BELLO_E2E_RUN ?? "") ||
    !process.send
  )
    throw new Error();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PASSWORD_RECOVERY_DELIVERY_ADAPTER)
    .useValue({
      async deliver(input) {
        if (input.signal.aborted) return { status: "INDETERMINATE" };
        process.send({
          type: "delivery",
          recipient: input.recipientEmail,
          url: input.recoveryUrl,
        });
        return { status: "ACCEPTED" };
      },
    })
    .overrideProvider(ACCESS_NOTIFICATION_MAIL)
    .useValue({
      async deliver(message) {
        process.send({ type: "access-mail", ...message });
        return message.text.endsWith(
          "OBSERVER. Abra o Bello Flow para consultar o acesso.",
        )
          ? "FAILED"
          : "SENT";
      },
    })
    .compile();
  app = module.createNestApplication({
    bodyParser: false,
    rawBody: true,
    logger: false,
  });
  configureHttpApplication(app, loadHttpSecurityConfig(process.env));
  await app.listen(0, "127.0.0.1");
  process.send({ type: "ready", port: app.getHttpServer().address().port });
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
  if (app) await app.close();
  process.send?.({ type: "failed" });
  process.exit(1);
}
