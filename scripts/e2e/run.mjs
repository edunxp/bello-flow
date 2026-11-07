import { randomUUID } from "node:crypto";
import { fork, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { createServer } from "node:https";
import { request as upstreamRequest } from "node:http";
import { once } from "node:events";
import { Client } from "pg";
import { chromium, expect } from "@playwright/test";
import { PasswordCredentialService } from "../../apps/api/dist/credentials/password-credential.service.js";

const origin = "https://127.0.0.1:15443";
const initialPassword = "Synthetic browser password 2026!";
const newPassword = "Synthetic replacement password 2026!";
const run = process.env.BELLO_E2E_RUN;
const check = (value) => {
  if (!value) throw new Error("Assertion failed");
};
const databaseUrl = (user, password) => {
  const url = new URL("postgresql://database:5432/bello_test");
  url.username = user;
  url.password = password;
  return url.toString();
};
let stage = "isolation";
let api, server, browser, migrator, temporary;
const contexts = [];
let observations = [];
const deliveries = new Map();
const timeLimit = 20000;
let failures = 0;
function safeFailure(error) {
  const frames = [...String(error?.stack ?? "").matchAll(/run\.mjs:(\d+):\d+/g)]
    .map((match) => match[1])
    .slice(0, 4);
  const category =
    error?.name === "TimeoutError"
      ? "timeout"
      : /^[0-9A-Z]{5}$/.test(error?.code ?? "")
        ? "SQLSTATE " + error.code
        : "assertion or operation";
  return category + "; harness lines " + frames.join(",");
}
async function scenario(name, action) {
  stage = name;
  observations = [];
  try {
    await action();
    console.log("PASS " + name);
  } catch (error) {
    failures++;
    console.error(
      "FAIL " +
        name +
        " (" +
        safeFailure(error) +
        "; HTTP " +
        observations.join(",") +
        ")",
    );
  }
}
function timeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Deadline")), timeLimit);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function fixture() {
  const id = randomUUID();
  const email = id.replaceAll("-", "") + "@example.test";
  const hash = await new PasswordCredentialService().hashPassword(
    initialPassword,
  );
  await migrator.query(
    `INSERT INTO public.account(id,first_name,last_name,email,email_key,email_verified_at,status,created_at)
    VALUES($1,'Browser','Synthetic',$2,$2,clock_timestamp(),'ACTIVE',clock_timestamp())`,
    [id, email],
  );
  await migrator.query(
    `INSERT INTO public.password_credential(account_id,password_hash,changed_at,changed_operation_id)
    VALUES($1,$2,clock_timestamp(),$3)`,
    [id, hash, randomUUID()],
  );
  return { id, email };
}
async function pageFor(viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  contexts.push(context);
  const page = await context.newPage();
  const errors = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (
      [
        "/api/auth/login",
        "/api/auth/session",
        "/api/auth/logout",
        "/api/auth/password-reset",
        "/api/auth/password-recovery",
      ].includes(path)
    )
      observations.push(path.slice(10) + ":" + response.status());
  });
  page.on("pageerror", () => errors.push(true));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  return { context, page, errors };
}
async function login(page, account, password = initialPassword) {
  await page.goto(origin + "/login");
  await page.getByLabel("E-mail", { exact: true }).fill(account.email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Sessão ativa.", { exact: false })).toBeVisible();
}
async function recover(page, account) {
  await page.goto(origin + "/forgot-password");
  await page.getByLabel("E-mail", { exact: true }).fill(account.email);
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
  await expect
    .poll(() => deliveries.has(account.email), { timeout: timeLimit })
    .toBe(true);
  return deliveries.get(account.email);
}
async function reset(page, link, password = newPassword) {
  await page.goto(link);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.getByLabel("Nova senha", { exact: true }).fill(password);
  await page
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill(password);
  await page
    .getByRole("button", { name: "Redefinir senha", exact: true })
    .click();
}
async function session(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session", {
      headers: { "X-Bello-Flow-Request": "1" },
    });
    return { status: response.status, body: await response.json() };
  });
}
try {
  check(/^bello-e2e-[0-9a-f-]{36}$/.test(run ?? ""));
  check(
    process.env.BELLO_TEST_APP_PASSWORD &&
      process.env.BELLO_TEST_MIGRATOR_PASSWORD,
  );
  const migrationUrl = databaseUrl(
    "bello_test_migrator",
    process.env.BELLO_TEST_MIGRATOR_PASSWORD,
  );
  stage = "migrations";
  const migration = spawnSync(
    "node",
    ["../../node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      cwd: "apps/api",
      env: { PATH: process.env.PATH, MIGRATION_DATABASE_URL: migrationUrl },
      stdio: "ignore",
    },
  );
  check(migration.status === 0);
  migrator = new Client({ connectionString: migrationUrl });
  await migrator.connect();
  const identity = (
    await migrator.query(
      "SELECT current_database() AS db,current_user AS usr,version() AS version",
    )
  ).rows[0];
  check(
    identity.db === "bello_test" &&
      identity.usr === "bello_test_migrator" &&
      identity.version.startsWith("PostgreSQL 18.6"),
  );
  temporary = await mkdtemp(join(tmpdir(), "bello-browser-"));
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
  api = fork("scripts/e2e/api.mjs", [], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      BELLO_E2E_RUN: run,
      DATABASE_URL: databaseUrl(
        "bello_test_app",
        process.env.BELLO_TEST_APP_PASSWORD,
      ),
      BELLO_PUBLIC_ORIGIN: origin,
      BELLO_PASSWORD_RECOVERY_DELIVERY_MODE: "controlled",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const ready = await timeout(
    new Promise((resolve, reject) => {
      api.on("message", (message) => {
        if (message.type === "ready") resolve(message.port);
        else if (message.type === "delivery")
          deliveries.set(message.recipient, message.url);
        else if (message.type === "failed")
          reject(new Error("API startup failed"));
      });
      api.once("exit", () => reject(new Error("API exited")));
    }),
  );
  stage = "same-origin gateway";
  const webRoot = resolve("apps/web/dist/web/browser");
  server = createServer(
    {
      key: await readFile(join(temporary, "key.pem")),
      cert: await readFile(join(temporary, "cert.pem")),
    },
    async (req, res) => {
      if (
        req.url.startsWith("/api/") ||
        req.url.split("?")[0] === "/health/live"
      ) {
        const headers = { ...req.headers };
        for (const name of Object.keys(headers))
          if (name === "forwarded" || name.startsWith("x-forwarded-"))
            delete headers[name];
        const upstream = upstreamRequest(
          {
            host: "127.0.0.1",
            port: ready,
            path: req.url,
            method: req.method,
            headers,
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
          },
        );
        upstream.on("error", () => {
          res.writeHead(503);
          res.end();
        });
        req.pipe(upstream);
        return;
      }
      try {
        const path = new URL(req.url, origin).pathname;
        const candidate = resolve(webRoot, "." + decodeURIComponent(path));
        if (candidate !== webRoot && !candidate.startsWith(webRoot + sep)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const file = extname(candidate)
          ? candidate
          : join(webRoot, "index.html");
        const contents = await readFile(file);
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".ico")
                ? "image/x-icon"
                : "text/html; charset=utf-8",
        );
        res.end(contents);
      } catch {
        res.writeHead(404);
        res.end();
      }
    },
  );
  server.listen(15443, "127.0.0.1");
  await once(server, "listening");
  stage = "chromium";
  browser = await chromium.launch({ headless: true });
  console.log(
    "Browser: Chromium; HTTPS test certificate exception is scoped to disposable contexts.",
  );

  await scenario("login / reload / cookie / logout (real stack)", async () => {
    const account = await fixture();
    const { page, context, errors } = await pageFor();
    let headersValid = true;
    page.on("request", (request) => {
      if (request.url().startsWith(origin + "/api/auth/"))
        headersValid &&= request.headers()["x-bello-flow-request"] === "1";
    });
    await login(page, account);
    const cookies = await context.cookies();
    check(cookies.length === 1);
    const cookie = cookies[0];
    check(
      cookie.name === "__Host-bello_flow_session" &&
        cookie.httpOnly &&
        cookie.secure &&
        cookie.sameSite === "Lax" &&
        cookie.path === "/" &&
        cookie.domain === "127.0.0.1",
    );
    const hidden = await page.evaluate(() => document.cookie);
    check(hidden === "");
    await page.reload();
    await expect(
      page.getByText("Sessão ativa.", { exact: false }),
    ).toBeVisible();
    const identity = await session(page);
    check(
      identity.status === 200 &&
        JSON.stringify(Object.keys(identity.body)) === '["account"]' &&
        JSON.stringify(Object.keys(identity.body.account)) === '["id"]',
    );
    const storageEmpty = await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    );
    check(storageEmpty && headersValid);
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Entrar no Bello Flow" }),
    ).toBeVisible();
    check((await session(page)).status === 401);
    check((await context.cookies()).length === 0 && errors.length === 0);
    const revoked = await migrator.query(
      "SELECT count(*)::int AS count FROM public.auth_session WHERE account_id=$1 AND revocation_reason='LOGOUT'",
      [account.id],
    );
    check(revoked.rows[0].count === 1);
    await context.close();
  });

  await scenario("generic rejected login (real stack)", async () => {
    const account = await fixture();
    const { page, context } = await pageFor();
    await page.goto(origin + "/login");
    for (const email of [account.email, "unknown-login@example.test"]) {
      await page.getByLabel("E-mail", { exact: true }).fill(email);
      await page
        .getByLabel("Senha", { exact: true })
        .fill("Incorrect synthetic password 2026!");
      const response = page.waitForResponse(
        (r) => r.url() === origin + "/api/auth/login",
      );
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      check((await response).status() === 401);
      await expect(
        page.getByText("Não foi possível entrar com os dados informados."),
      ).toBeVisible();
    }
    await context.close();
  });

  await scenario(
    "session expiry and navigation revalidation (real stack)",
    async () => {
      const account = await fixture();
      const { page, context } = await pageFor();
      await login(page, account);
      const loadedSession = page.waitForResponse(
        (r) => r.url() === origin + "/api/auth/session",
      );
      await page.goto(origin + "/forgot-password");
      check((await loadedSession).status() === 200);
      await expect(
        page.getByRole("heading", { name: "Recuperar acesso" }),
      ).toBeVisible();
      await page.evaluate(() => {
        window.__belloE2EDocument = true;
      });
      // Only the owned disposable fixture is aged; keep the published constraints intact.
      await migrator.query(
        `UPDATE public.auth_session SET created_at=created_at-interval '9 hours',
      last_activity_at=last_activity_at-interval '9 hours',absolute_expires_at=absolute_expires_at-interval '9 hours'
      WHERE account_id=$1`,
        [account.id],
      );
      await page.getByRole("link", { name: "Voltar ao login" }).click();
      check(await page.evaluate(() => window.__belloE2EDocument === true));
      await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
      check((await session(page)).status === 401);
      await context.close();
    },
  );

  await scenario(
    "recovery / reset / revoked account sessions / preserved other account (real stack)",
    async () => {
      const account = await fixture();
      const other = await fixture();
      const first = await pageFor();
      const second = await pageFor();
      const otherTab = await pageFor();
      await login(first.page, account);
      await login(second.page, account);
      await login(otherTab.page, other);
      const recovery = await pageFor();
      const link = await recover(recovery.page, account);
      const resetResponse = otherTab.page.waitForResponse(
        (r) => r.url() === origin + "/api/auth/password-reset",
      );
      await reset(otherTab.page, link);
      const response = await resetResponse;
      check(response.status() === 204 && !response.headers()["set-cookie"]);
      await expect(
        otherTab.page.getByText("Senha redefinida.", { exact: false }),
      ).toBeVisible();
      check(
        (await session(first.page)).status === 401 &&
          (await session(second.page)).status === 401,
      );
      check((await session(otherTab.page)).body.account.id === other.id);
      const count = await migrator.query(
        "SELECT count(*)::int AS count FROM public.auth_session WHERE account_id=$1 AND revocation_reason='PASSWORD_RESET'",
        [account.id],
      );
      check(count.rows[0].count === 2);
      await login(recovery.page, account, newPassword);
      await reset(otherTab.page, link);
      await expect(
        otherTab.page.getByText(
          "Link inválido ou indisponível. Solicite uma nova recuperação.",
        ),
      ).toBeVisible();
      await Promise.all([
        first.context.close(),
        second.context.close(),
        otherTab.context.close(),
        recovery.context.close(),
      ]);
    },
  );

  await scenario(
    "same-document link reopening / reload / skip-link / no token storage (real stack)",
    async () => {
      const account = await fixture();
      const { page, context } = await pageFor();
      const link = await recover(page, account);
      await page.goto(link);
      await expect(
        page.getByLabel("Nova senha", { exact: true }),
      ).toBeVisible();
      check(new URL(page.url()).hash === "");
      await page.reload();
      await expect(
        page.getByText("Link inválido ou indisponível.", { exact: false }),
      ).toBeVisible();
      // Fragment navigation in the same loaded document, like reopening the original link.
      await page.goto(link);
      await expect(
        page.getByLabel("Nova senha", { exact: true }),
      ).toBeVisible();
      check(new URL(page.url()).hash === "");
      const url = page.url();
      await page.keyboard.press("Tab");
      await page.getByRole("link", { name: "Pular para o conteúdo" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main-content")).toBeFocused();
      check(page.url() === url);
      await page.setViewportSize({ width: 320, height: 740 });
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );

      check(
        await page.evaluate(
          () =>
            localStorage.length === 0 &&
            sessionStorage.length === 0 &&
            !JSON.stringify(history.state).includes("token="),
        ),
      );
      await page.getByRole("link", { name: "Voltar ao login" }).click();
      await expect(
        page.getByRole("heading", { name: "Entrar no Bello Flow" }),
      ).toBeVisible();
      await page.goBack();
      await expect(
        page.getByText("Link inválido ou indisponível.", { exact: false }),
      ).toBeVisible();
      check(!page.url().includes("token="));
      await context.close();
    },
  );

  await scenario("expired reset token rejection (real stack)", async () => {
    const account = await fixture();
    const { page, context } = await pageFor();
    const link = await recover(page, account);
    // Preserve the 30-minute invariant while ageing only this test account's tokens.
    await migrator.query(
      `UPDATE public.password_reset_token SET created_at=created_at-interval '31 minutes',
      expires_at=expires_at-interval '31 minutes' WHERE account_id=$1`,
      [account.id],
    );
    await reset(page, link);
    await expect(
      page.getByText(
        "Link inválido ou indisponível. Solicite uma nova recuperação.",
      ),
    ).toBeVisible();
    await context.close();
  });

  await scenario(
    "anti-enumeration / CSRF / same-origin / health (real HTTP)",
    async () => {
      const account = await fixture();
      const { page, context } = await pageFor();
      await page.goto(origin + "/login");
      const result = await page.evaluate(
        async ({ email, origin }) => {
          const headers = {
            "X-Bello-Flow-Request": "1",
            "Content-Type": "application/json",
          };
          const recover = async (value) => {
            const r = await fetch("/api/auth/password-recovery", {
              method: "POST",
              headers,
              body: JSON.stringify({ email: value }),
            });
            return [
              r.status,
              await r.text(),
              r.headers.get("Access-Control-Allow-Origin"),
              r.headers.get("Access-Control-Allow-Credentials"),
            ];
          };
          const values = await Promise.all([
            recover(email),
            recover("unknown@example.test"),
            recover("invalid"),
          ]);
          const forbidden = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              password: "synthetic-not-a-real-password",
            }),
          });
          const health = await fetch("/health/live");
          return {
            values,
            forbidden: forbidden.status,
            health: health.status,
            cors: health.headers.get("Access-Control-Allow-Origin"),
            origin: location.origin === origin,
          };
        },
        { email: account.email, origin },
      );
      check(
        result.values.every(
          (value) =>
            value[0] === 202 &&
            value[1] === "" &&
            value[2] === null &&
            value[3] === null,
        ) &&
          result.forbidden === 403 &&
          result.health === 200 &&
          result.cors === null &&
          result.origin,
      );
      const forged = await context.request.post(
        origin + "/api/auth/password-recovery",
        {
          headers: {
            Origin: "https://outside.invalid",
            "X-Bello-Flow-Request": "1",
          },
          data: { email: account.email },
        },
      );
      check(forged.status() === 403);
      const noHeader = await context.request.get(origin + "/api/auth/session");
      check(noHeader.status() === 403);
      await context.close();
    },
  );

  await scenario(
    "keyboard / required feedback / responsive layout (browser)",
    async () => {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 320, height: 740 },
        { width: 640, height: 800 },
      ]) {
        const { page, context } = await pageFor(viewport);
        await page.goto(origin + "/login");
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(
          page.getByText("Preencha os campos obrigatórios antes de continuar."),
        ).toBeVisible();
        await expect(page.locator("#form-feedback")).toBeFocused();
        check(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.getByLabel("E-mail", { exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(page.getByLabel("Senha", { exact: true })).toBeFocused();
        if (viewport.width === 1280) {
          await page.evaluate(() => {
            document.body.style.zoom = "2";
          });
          await expect(
            page.getByRole("button", { name: "Entrar", exact: true }),
          ).toBeVisible();
          check(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
        }
        await context.close();
      }
    },
  );

  await scenario(
    "unavailable logout / no false success (controlled failure)",
    async () => {
      const account = await fixture();
      const { page, context } = await pageFor();
      await login(page, account);
      let calls = 0;
      await page.route("**/api/auth/logout", async (route) => {
        calls++;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":{"code":"SERVICE_UNAVAILABLE","message":"Service unavailable"}}',
        });
      });
      await page.getByRole("button", { name: "Sair", exact: true }).click();
      await expect(
        page.getByText("Não foi possível confirmar a operação.", {
          exact: false,
        }),
      ).toBeVisible();
      check(calls === 1 && (await session(page)).status === 200);
      await context.close();
    },
  );

  await scenario(
    "rate limit / no automatic retry (controlled failure)",
    async () => {
      const { page, context } = await pageFor();
      await page.goto(origin + "/forgot-password");
      let calls = 0;
      await page.route("**/api/auth/password-recovery", async (route) => {
        calls++;
        await route.fulfill({
          status: 429,
          headers: { "Retry-After": "3" },
          contentType: "application/json",
          body: '{"error":{"code":"RATE_LIMITED","message":"Rate limited"}}',
        });
      });
      await page
        .getByLabel("E-mail", { exact: true })
        .fill("synthetic@example.test");
      await page
        .getByRole("button", { name: "Solicitar recuperação", exact: true })
        .click();
      await expect(
        page.getByText("Muitas tentativas.", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Solicitar recuperação",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", {
          name: "Solicitar recuperação",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 5000 });
      check(calls === 1);
      await context.close();
    },
  );

  await scenario(
    "late login after navigation (real login / controlled response delay)",
    async () => {
      const account = await fixture();
      const { page, context } = await pageFor();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let responseReceived;
      const received = new Promise((resolve) => {
        responseReceived = resolve;
      });
      await page.route("**/api/auth/login", async (route) => {
        const response = await route.fetch();
        responseReceived();
        await gate;
        await route.fulfill({ response });
      });
      await page.goto(origin + "/login");
      await page.getByLabel("E-mail", { exact: true }).fill(account.email);
      await page.getByLabel("Senha", { exact: true }).fill(initialPassword);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await timeout(received);
      await page.getByRole("link", { name: "Esqueci minha senha" }).click();
      await expect(
        page.getByRole("heading", { name: "Recuperar acesso" }),
      ).toBeVisible();
      release();
      await expect.poll(async () => (await session(page)).status).toBe(200);
      await page.getByRole("link", { name: "Bello Flow — início" }).click();
      await expect(
        page.getByText("Sessão ativa.", { exact: false }),
      ).toBeVisible();
      await context.close();
    },
  );

  // Visual evidence contains only the empty public login, never passwords, cookies or reset links.
  await scenario("empty public login visual evidence", async () => {
    const { page, context } = await pageFor();
    await page.goto(origin + "/login");
    await expect(
      page.getByRole("heading", { name: "Entrar no Bello Flow" }),
    ).toBeVisible();
    await mkdir("/tmp/bello-e2e-visuals", { recursive: true });
    await page.screenshot({ path: "/tmp/bello-e2e-visuals/login-desktop.png" });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.screenshot({ path: "/tmp/bello-e2e-visuals/login-mobile.png" });
    await context.close();
  });
} catch (error) {
  failures++;
  console.error("FAIL setup stage: " + stage + " (" + safeFailure(error) + ")");
} finally {
  deliveries.clear();
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (api?.connected) {
    api.send("stop");
    await timeout(once(api, "exit")).catch(() => api.kill());
  }
  await migrator?.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
console.log(
  "Browser E2E result: " +
    (failures === 0 ? "success" : "failure") +
    "; failed scenarios: " +
    failures,
);
process.exitCode = failures ? 1 : 0;
