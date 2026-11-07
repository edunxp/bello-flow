import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "pg";
import { chromium, expect } from "@playwright/test";
import { createLocalAccount } from "./local-account.mjs";
import { runRecoveryWorker } from "./recovery-worker-client.mjs";
import {
  recoveryOrigin,
  recoveryRecipient,
  recoverySender,
  singleDelivery,
} from "./recovery-profile.mjs";
const check = (value) => {
  if (!value) throw new Error();
};
export async function runRecoverySmoke({ origin, migrationUrl }) {
  check(
    origin === recoveryOrigin &&
      process.env.BELLO_REHEARSAL_SIMULATION === "true",
  );
  const initialPassword = "Synthetic recovery rehearsal password 2026!";
  const newPassword = "Synthetic changed rehearsal password 2026!";
  let browser, client;
  let calls = 0,
    link = "",
    validPayload = false;
  const mock = createServer(async (req, res) => {
    calls++;
    try {
      check(req.method === "POST" && req.url === "/emails");
      check(req.headers.authorization === "Bearer synthetic-rehearsal-key");
      let body = "";
      for await (const part of req) {
        body += part;
        check(body.length < 10000);
      }
      const payload = JSON.parse(body);
      check(payload.from === "Bello Flow <" + recoverySender + ">");
      check(payload.to.length === 1 && payload.to[0] === recoveryRecipient);
      check(payload.subject === "Redefina sua senha no Bello Flow");
      const match = payload.text.match(
        /https:\/\/127\.0\.0\.1:15444\/reset-password#token=[A-Za-z0-9_-]{43}/,
      );
      check(match && payload.html.includes('href="' + match[0] + '"'));
      check(
        !payload.html.includes("<img") && !payload.html.includes("http://"),
      );
      check(
        Object.keys(payload).sort().join(",") === "from,html,subject,text,to",
      );
      link = match[0];
      validPayload = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "synthetic-provider-id" }));
    } catch {
      res.writeHead(501);
      res.end();
    }
  });
  try {
    // Budget remains consumed on exception and UNKNOWN, wrong recipients never delegate.
    for (const mode of ["throw", "INDETERMINATE"]) {
      let delegated = 0;
      const bounded = singleDelivery({
        async deliver() {
          delegated++;
          if (mode === "throw") throw new Error();
          return { status: mode };
        },
      });
      const input = {
        recipientEmail: recoveryRecipient,
        signal: new AbortController().signal,
      };
      await bounded.deliver({ ...input, recipientEmail: "other@example.test" });
      check(delegated === 0);
      try {
        await bounded.deliver(input);
      } catch {
        check(mode === "throw");
      }
      check(
        (await bounded.deliver(input)).status === "NOT_ACCEPTED" &&
          delegated === 1,
      );
    }
    await createLocalAccount(initialPassword, recoveryRecipient);
    client = new Client({ connectionString: migrationUrl });
    await client.connect();
    await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(origin + "/forgot-password");
    await page.getByLabel("E-mail", { exact: true }).fill(recoveryRecipient);
    const response = page.waitForResponse(
      (r) => r.url() === origin + "/api/auth/password-recovery",
    );
    await page
      .getByRole("button", { name: "Solicitar recuperação", exact: true })
      .click();
    check((await response).status() === 202);
    check(calls === 0);
    const worker = await runRecoveryWorker({
      key: "synthetic-rehearsal-key",
      mockPort: mock.address().port,
    });
    check(
      worker.processed === 1 &&
        !worker.infrastructureError &&
        worker.delivery === "ACCEPTED",
    );
    check(calls === 1 && validPayload);
    const counts = (
      await client.query(
        "SELECT (SELECT count(*)::int FROM public.password_recovery_delivery_attempt WHERE state='SENT') AS sent,(SELECT count(*)::int FROM public.password_reset_token) AS tokens",
      )
    ).rows[0];
    check(counts.sent === 1 && counts.tokens === 1);
    let blocked = false;
    try {
      await runRecoveryWorker({
        key: "synthetic-rehearsal-key",
        mockPort: mock.address().port,
      });
    } catch {
      blocked = true;
    }
    check(blocked && calls === 1);
    await page.goto(link);
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Confirme a nova senha", { exact: true })
      .fill(newPassword);
    const resetResponse = page.waitForResponse(
      (r) => r.url() === origin + "/api/auth/password-reset",
    );
    await page
      .getByRole("button", { name: "Redefinir senha", exact: true })
      .click();
    check((await resetResponse).status() === 204);
    await page.goto(link);
    await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Confirme a nova senha", { exact: true })
      .fill(newPassword);
    const reuseResponse = page.waitForResponse(
      (r) => r.url() === origin + "/api/auth/password-reset",
    );
    await page
      .getByRole("button", { name: "Redefinir senha", exact: true })
      .click();
    check((await reuseResponse).status() === 401);
    await page.goto(origin + "/login");
    await page.getByLabel("E-mail", { exact: true }).fill(recoveryRecipient);
    await page.getByLabel("Senha", { exact: true }).fill(initialPassword);
    const oldLogin = page.waitForResponse(
      (r) => r.url() === origin + "/api/auth/login",
    );
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    check((await oldLogin).status() === 401);
    await page.getByLabel("Senha", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(
      page.getByText("Sessão ativa.", { exact: false }),
    ).toBeVisible();
    check(calls === 1);
    console.log(
      "PASS ensaio simulado: API disabled, HTTP local único, destinatário/payload/link, marcador de reexecução, reset, uso único e troca de senha.",
    );
    await context.close();
  } finally {
    link = "";
    await browser?.close();
    await client?.end();
    if (mock.listening) {
      const closed = once(mock, "close");
      mock.closeAllConnections();
      mock.close();
      await closed;
    }
  }
}
