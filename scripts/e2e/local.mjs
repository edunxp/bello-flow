import { fork, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Client } from "pg";
import { chromium, expect } from "@playwright/test";
import { openGateway } from "./gateway.mjs";
import {
  connection,
  createLocalAccount,
  localEmail,
} from "./local-account.mjs";
import { recoveryOrigin } from "./recovery-profile.mjs";
import { runRecoverySmoke } from "./recovery-smoke.mjs";
const recovery = process.argv.includes("--recovery");
const smoke = process.argv.includes("--smoke");
const origin = recovery ? recoveryOrigin : "https://127.0.0.1:15443";
let api, server, temporary, browser;
const check = (value) => {
  if (!value) throw new Error();
};
let timer;
let stage = "isolation";
try {
  check(process.env.BELLO_LOCAL_ONLY === "true");
  check(/^bello-e2e-[0-9a-f-]{36}$/.test(process.env.BELLO_E2E_RUN ?? ""));
  check(
    process.env.BELLO_TEST_APP_PASSWORD &&
      process.env.BELLO_TEST_MIGRATOR_PASSWORD,
  );
  check(recovery === (process.env.BELLO_RECOVERY_REHEARSAL === "true"));
  stage = "migrations";
  const migrationUrl = connection(
    "bello_test_migrator",
    process.env.BELLO_TEST_MIGRATOR_PASSWORD,
  );
  check(
    spawnSync(
      "node",
      ["../../node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        cwd: "apps/api",
        env: { PATH: process.env.PATH, MIGRATION_DATABASE_URL: migrationUrl },
        stdio: "ignore",
      },
    ).status === 0,
  );
  temporary = await mkdtemp(join(tmpdir(), "bello-local-"));
  stage = "tls";
  check(
    spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        join(temporary, "key.pem"),
        "-out",
        join(temporary, "cert.pem"),
      ],
      { stdio: "ignore" },
    ).status === 0,
  );
  stage = "api";
  api = fork("scripts/e2e/local-api.mjs", [], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "development",
      BELLO_E2E_RUN: process.env.BELLO_E2E_RUN,
      BELLO_RECOVERY_REHEARSAL: recovery ? "true" : "false",
      DATABASE_URL: connection(
        "bello_test_app",
        process.env.BELLO_TEST_APP_PASSWORD,
      ),
      BELLO_PUBLIC_ORIGIN: origin,
      BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: "disabled",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const apiPort = await Promise.race([
    new Promise((resolve, reject) => {
      api.on("message", (message) => {
        if (message.type === "ready" && message.mailMode === "disabled")
          resolve(message.port);
        else reject(new Error());
      });
      api.once("exit", () => reject(new Error()));
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error()), 20000);
    }),
  ]);
  clearTimeout(timer);
  stage = "gateway";
  server = await openGateway({
    apiPort,
    port: recovery ? 15444 : 15443,
    host: "0.0.0.0",
    key: await readFile(join(temporary, "key.pem")),
    cert: await readFile(join(temporary, "cert.pem")),
  });
  if (smoke && recovery) {
    stage = "recovery smoke";
    await runRecoverySmoke({ origin, migrationUrl });
  } else if (smoke) {
    stage = "smoke";
    const password = "Synthetic local smoke password 2026!";
    await createLocalAccount(password);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(origin + "/login");
    await page.getByLabel("E-mail", { exact: true }).fill(localEmail);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(
      page.getByText("Sessão ativa.", { exact: false }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Sessão ativa.", { exact: false }),
    ).toBeVisible();
    const cookies = await context.cookies();
    check(cookies.length === 1 && cookies[0].httpOnly && cookies[0].secure);
    await page.goto(origin + "/forgot-password");
    await page.getByLabel("E-mail", { exact: true }).fill(localEmail);
    const response = page.waitForResponse(
      (r) => r.url() === origin + "/api/auth/password-recovery",
    );
    await page
      .getByRole("button", { name: "Solicitar recuperação", exact: true })
      .click();
    check((await response).status() === 202);
    await expect(
      page.getByText(
        "Se houver uma conta elegível, você receberá instruções por e-mail.",
      ),
    ).toBeVisible();
    const client = new Client({ connectionString: migrationUrl });
    await client.connect();
    try {
      const counts = (
        await client.query(`SELECT
        (SELECT count(*)::int FROM public.password_recovery_request WHERE state='PENDING') AS pending,
        (SELECT count(*)::int FROM public.password_recovery_delivery_attempt) AS attempts,
        (SELECT count(*)::int FROM public.password_reset_token) AS tokens`)
      ).rows[0];
      check(
        counts.pending === 1 && counts.attempts === 0 && counts.tokens === 0,
      );
    } finally {
      await client.end();
    }
    await context.close();
    console.log(
      "PASS homologação: login, recarga, cookie seguro, recuperação202 e nenhuma tentativa/token com envio disabled.",
    );
  } else {
    console.log("LOCAL_READY");
    await new Promise((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
  }
} catch (error) {
  const frame = /recovery-smoke\.mjs:(\d+):\d+/.exec(
    String(error?.stack ?? ""),
  );
  if (frame) console.error("Asserção do ensaio na linha " + frame[1] + ".");
  console.error(
    "Falha de homologação local na etapa " +
      stage +
      ". Detalhes sensíveis omitidos.",
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (api?.connected) {
    const exited = once(api, "exit");
    api.send("stop");
    await exited;
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
