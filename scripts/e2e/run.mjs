import { openGateway } from "./gateway.mjs";
import { randomUUID } from "node:crypto";
import { fork, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const accessMail = [];
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
        else if (message.type === "access-mail") accessMail.push(message);
        else if (message.type === "failed")
          reject(new Error("API startup failed"));
      });
      api.once("exit", () => reject(new Error("API exited")));
    }),
  );
  stage = "same-origin gateway";
  server = await openGateway({
    apiPort: ready,
    key: await readFile(join(temporary, "key.pem")),
    cert: await readFile(join(temporary, "cert.pem")),
  });
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

  await scenario(
    "private Workspaces and boards are isolated (real stack)",
    async () => {
      const owner = await fixture();
      const outsider = await fixture();
      const creator = await pageFor();
      const visitor = await pageFor();
      try {
        await login(creator.page, owner);
        await creator.page
          .getByRole("link", { name: "Abrir Workspaces" })
          .click();

        async function createWorkspace(name) {
          await creator.page.getByLabel("Nome", { exact: true }).fill(name);
          await creator.page
            .getByLabel("Fuso horário regional")
            .fill("America/Sao_Paulo");
          await creator.page
            .getByRole("button", { name: "Criar Workspace" })
            .click();
          const link = creator.page.getByRole("link", { name, exact: true });
          await expect(link).toBeVisible();
          return await link.getAttribute("href");
        }

        async function createBoard(name, workspacePath) {
          await creator.page.goto(origin + workspacePath);
          await creator.page.getByLabel("Nome", { exact: true }).fill(name);
          await creator.page
            .getByLabel("Descrição")
            .fill("Descrição privada de teste");
          await creator.page
            .getByRole("button", { name: "Criar quadro" })
            .click();
          const link = creator.page.getByRole("link", { name, exact: true });
          await expect(link).toBeVisible();
          await link.click();
          await expect(
            creator.page.getByRole("heading", { name, exact: true }),
          ).toBeVisible();
          return new URL(creator.page.url()).pathname;
        }

        const work = await createWorkspace("Trabalho");
        const personal = await createWorkspace("Pessoal");
        const erp = await createBoard("Time ERP", work);
        await createBoard("Pessoal", personal);
        await login(visitor.page, outsider);
        await visitor.page.goto(origin + "/workspaces");
        await expect(
          visitor.page.getByText("Nenhum item disponível."),
        ).toBeVisible();
        await visitor.page.goto(origin + erp);
        await expect(
          visitor.page.getByText("Recurso indisponível."),
        ).toBeVisible();

        const headers = { "X-Bello-Flow-Request": "1" };
        const denied = await visitor.context.request.get(
          origin + "/api" + erp,
          { headers },
        );
        check(denied.status() === 403);
        check(denied.headers()["cache-control"] === "private, no-store");
        const unknown = await visitor.context.request.get(
          origin +
            "/api" +
            work +
            "/boards/40000000-0000-4000-8000-000000000001",
          { headers },
        );
        check(unknown.status() === denied.status());
        check(
          JSON.stringify(await unknown.json()) ===
            JSON.stringify(await denied.json()),
        );
        const blockedCreate = await visitor.context.request.post(
          origin + "/api" + work + "/boards",
          {
            headers: { ...headers, Origin: origin },
            data: {
              operationId: randomUUID(),
              name: "Indevido",
              description: "Indevido",
            },
          },
        );
        check(blockedCreate.status() === 403);
        const workspaceId = work.split("/").at(-1);
        const boardId = erp.split("/").at(-1);
        await migrator.query(
          "INSERT INTO public.workspace_membership (workspace_id, account_id, role) VALUES ($1, $2, 'MEMBER')",
          [workspaceId, outsider.id],
        );
        await visitor.page.goto(origin + work);
        await expect(
          visitor.page.getByText("Nenhum item disponível."),
        ).toBeVisible();
        check(
          (
            await visitor.context.request.get(origin + "/api" + erp, {
              headers,
            })
          ).status() === 403,
        );

        const evidence = await migrator.query(
          `SELECT
           (SELECT count(*)::int FROM public.audit_event WHERE actor_account_id=$1
            AND operation IN ('WORKSPACE_CREATED','WORKSPACE_ADMIN_GRANTED','BOARD_CREATED','BOARD_ADMIN_GRANTED')) AS audit,
           (SELECT count(*)::int FROM public.board_feed_event WHERE board_id=$2) AS feed`,
          [owner.id, boardId],
        );
        check(evidence.rows[0].audit === 8 && evidence.rows[0].feed === 2);

        await creator.page.goto(origin + "/workspaces");
        await expect(
          creator.page.getByRole("link", { name: "Trabalho", exact: true }),
        ).toBeVisible();
        await expect(
          creator.page.getByRole("link", { name: "Pessoal", exact: true }),
        ).toBeVisible();
      } finally {
        await creator.context.close();
        await visitor.context.close();
      }
    },
  );

  await scenario(
    "creation replay and rollback on mandatory writes (real stack)",
    async () => {
      const owner = await fixture();
      const { page, context } = await pageFor();
      try {
        await login(page, owner);
        const headers = { "X-Bello-Flow-Request": "1", Origin: origin };
        const workspacePath = "/api/workspaces";
        const post = (path, data) =>
          context.request.post(origin + path, { headers, data });
        const workspaceFields = {
          name: "Trabalho",
          timeZone: "America/Sao_Paulo",
        };
        const boardFields = { name: "Time ERP", description: "Quadro privado" };
        const workspaceData = { ...workspaceFields, operationId: randomUUID() };
        const first = await post(workspacePath, workspaceData);
        check(first.status() === 201);
        const workspace = await first.json();
        const replay = await post(workspacePath, workspaceData);
        check(
          replay.status() === 201 && (await replay.json()).id === workspace.id,
        );
        check(
          (
            await post(workspacePath, { ...workspaceData, name: "Outro" })
          ).status() === 409,
        );

        const boardsPath = workspacePath + "/" + workspace.id + "/boards";
        const boardData = { ...boardFields, operationId: randomUUID() };
        const competing = await Promise.all([
          post(boardsPath, boardData),
          post(boardsPath, boardData),
        ]);
        check(competing.every((response) => response.status() === 201));
        const [board, repeated] = await Promise.all(
          competing.map((response) => response.json()),
        );
        check(board.id === repeated.id);
        check(
          (await post(boardsPath, { ...boardData, name: "Outro" })).status() ===
            409,
        );

        await page.goto(origin + "/workspaces");
        const routeUrl = origin + workspacePath;
        let discardedStatus;
        await page.route(routeUrl, async (route) => {
          if (
            route.request().method() !== "POST" ||
            discardedStatus !== undefined
          ) {
            return route.fallback();
          }
          discardedStatus = (await route.fetch()).status();
          await route.abort();
        });
        async function submitUncertain() {
          await page.getByLabel("Nome", { exact: true }).fill("Pessoal");
          await page
            .getByLabel("Fuso horário regional")
            .fill("America/Sao_Paulo");
          await page.getByRole("button", { name: "Criar Workspace" }).click();
        }
        await submitUncertain();
        await expect(
          page.getByText("Não foi possível confirmar a criação.", {
            exact: false,
          }),
        ).toBeVisible();
        check(discardedStatus === 201);
        await page.reload();
        await submitUncertain();
        await expect(
          page.getByRole("link", { name: "Pessoal", exact: true }),
        ).toHaveCount(1);
        await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");

        async function snapshot() {
          const result = await migrator.query(
            `SELECT
          (SELECT count(*)::int FROM public.workspace) AS workspaces,
          (SELECT count(*)::int FROM public.workspace_membership) AS workspace_memberships,
          (SELECT count(*)::int FROM public.board) AS boards,
          (SELECT count(*)::int FROM public.board_membership) AS board_memberships,
          (SELECT count(*)::int FROM public.audit_event WHERE actor_account_id=$1 AND scope='WORKSPACE') AS audits,
          (SELECT count(*)::int FROM public.board_feed_event) AS feed`,
            [owner.id],
          );
          return result.rows[0];
        }
        const baseline = await snapshot();
        check(baseline.audits === 6);
        check(
          (
            await migrator.query(
              "SELECT count(*)::int AS count FROM public.board_feed_event WHERE board_id=$1",
              [board.id],
            )
          ).rows[0].count === 2,
        );
        for (const fault of [
          {
            table: "audit_event",
            condition: "NEW.operation = 'WORKSPACE_ADMIN_GRANTED'",
            path: workspacePath,
            data: workspaceFields,
          },
          {
            table: "audit_event",
            condition: "NEW.operation = 'BOARD_ADMIN_GRANTED'",
            path: boardsPath,
            data: boardFields,
          },
          {
            table: "board_feed_event",
            condition: "NEW.operation = 'BOARD_ADMIN_GRANTED'",
            path: boardsPath,
            data: boardFields,
          },
        ]) {
          const data = { ...fault.data, operationId: randomUUID() };
          await migrator.query(`CREATE FUNCTION public.e2e_reject_creation() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic write failure'; END; $$;
          CREATE TRIGGER e2e_reject_creation BEFORE INSERT ON public.${fault.table}
            FOR EACH ROW WHEN (${fault.condition}) EXECUTE FUNCTION public.e2e_reject_creation();`);
          try {
            check((await post(fault.path, data)).status() === 500);
            check(
              JSON.stringify(await snapshot()) === JSON.stringify(baseline),
            );
          } finally {
            await migrator.query(`DROP TRIGGER e2e_reject_creation ON public.${fault.table};
            DROP FUNCTION public.e2e_reject_creation();`);
          }
        }
      } finally {
        await context.close();
      }
    },
  );

  await scenario(
    "explicit sharing, private content, notifications and simulated email (real stack)",
    async () => {
      const owner = await fixture();
      const team = await fixture();
      const personal = await fixture();
      const ownerTab = await pageFor();
      const teamTab = await pageFor();
      const personalTab = await pageFor();
      const headers = { "X-Bello-Flow-Request": "1", Origin: origin };
      const workspacePath = "/api/workspaces";
      const post = (tab, path, data) =>
        tab.context.request.post(origin + path, { headers, data });
      const get = (tab, path) =>
        tab.context.request.get(origin + path, { headers });
      const open = (tab, path) =>
        tab.page.goto(origin + path.replace(/^\/api/, ""));
      try {
        await login(ownerTab.page, owner);
        await login(teamTab.page, team);
        await login(personalTab.page, personal);
        async function create(path, data) {
          const response = await post(ownerTab, path, {
            operationId: randomUUID(),
            ...data,
          });
          check(response.status() === 201);
          return (await response.json()).id;
        }
        const work =
          workspacePath +
          "/" +
          (await create(workspacePath, {
            name: "Trabalho",
            timeZone: "America/Sao_Paulo",
          }));
        const home =
          workspacePath +
          "/" +
          (await create(workspacePath, {
            name: "Pessoal",
            timeZone: "America/Sao_Paulo",
          }));
        const erp =
          work +
          "/boards/" +
          (await create(work + "/boards", {
            name: "Time ERP",
            description: "Privado",
          }));
        const homeBoard =
          home +
          "/boards/" +
          (await create(home + "/boards", {
            name: "Pessoal",
            description: "Privado",
          }));

        check(
          (
            await post(ownerTab, erp + "/members", {
              email: team.email,
              role: "MEMBER",
            })
          ).status() === 403,
        );
        check(
          (
            await post(teamTab, work + "/members", {
              email: team.email,
              role: "MEMBER",
            })
          ).status() === 403,
        );
        check(
          (
            await post(ownerTab, work + "/members", {
              email: "absent@example.test",
              role: "MEMBER",
            })
          ).status() === 403,
        );

        async function include(path, account, role) {
          await open(ownerTab, path + "/members");
          await ownerTab.page.getByLabel("E-mail da conta").fill(account.email);
          await ownerTab.page
            .getByLabel("Papel", { exact: true })
            .selectOption(role);
          await ownerTab.page
            .getByRole("button", { name: "Revisar inclusão" })
            .click();
          await expect(
            ownerTab.page.getByText(account.email, { exact: false }),
          ).toBeVisible();
          await ownerTab.page
            .getByRole("button", { name: "Confirmar inclusão" })
            .click();
          await expect(
            ownerTab.page.getByText("Acesso concedido.", { exact: true }),
          ).toBeVisible();
          await expect(
            ownerTab.page
              .getByRole("list", { name: "Participantes" })
              .getByText(account.email, { exact: false }),
          ).toBeVisible();
        }

        await include(work, team, "MEMBER");
        await open(teamTab, work);
        await expect(
          teamTab.page.getByText("Nenhum item disponível."),
        ).toBeVisible();
        check((await get(teamTab, erp)).status() === 403);
        check((await get(teamTab, erp + "/lists")).status() === 404);
        check(
          (
            await post(teamTab, erp + "/lists", {
              name: "Negada",
              operationId: randomUUID(),
            })
          ).status() === 404,
        );
        await include(erp, team, "MEMBER");
        await include(home, personal, "MEMBER");
        await include(homeBoard, personal, "OBSERVER");

        const lists = erp + "/lists";
        const personalLists = homeBoard + "/lists";
        const patch = (tab, path, data) =>
          tab.context.request.patch(origin + path, { headers, data });
        await open(ownerTab, erp);
        await expect(
          ownerTab.page.getByText("Este quadro ainda não tem listas."),
        ).toBeVisible();
        const createList = async (tab, name) => {
          await tab.page.getByLabel("Nome da nova lista").fill(name);
          await tab.page.getByRole("button", { name: "Criar lista" }).click();
          await expect(
            tab.page.getByRole("heading", { name, exact: true }),
          ).toBeVisible();
        };
        await createList(ownerTab, "A fazer");
        await createList(ownerTab, "Em andamento");
        await open(teamTab, erp);
        await createList(teamTab, "Concluído");
        const workContent = await (await get(teamTab, lists)).json();
        const todo = workContent.lists.find((item) => item.name === "A fazer");
        const todoRegion = teamTab.page.getByRole("region", {
          name: "A fazer",
        });
        await todoRegion.getByText("Renomear lista", { exact: true }).click();
        await todoRegion.getByLabel("Novo nome da lista").fill("A fazer 📝");
        await todoRegion.getByRole("button", { name: "Salvar nome" }).click();
        const renamed = teamTab.page.getByRole("region", {
          name: "A fazer 📝",
        });
        await expect(renamed).toBeVisible();

        const cards = lists + "/" + todo.id + "/cards";
        const route = origin + cards;
        let original;
        await teamTab.page.route(
          route,
          async (intercepted) => {
            original = intercepted.request().postDataJSON();
            const response = await intercepted.fetch();
            check(response.status() === 201);
            await intercepted.abort();
          },
          { times: 1 },
        );
        await renamed.getByLabel("Título do novo cartão").fill("Validar ERP");
        await renamed
          .getByLabel("Descrição do novo cartão")
          .fill("Linha um\nLinha dois");
        await renamed.getByRole("button", { name: "Criar cartão" }).click();
        await expect(
          teamTab.page.getByText("Não foi possível confirmar a criação.", {
            exact: false,
          }),
        ).toBeVisible();
        await renamed.getByRole("button", { name: "Criar cartão" }).click();
        await expect(
          renamed.getByRole("heading", { name: "Validar ERP", exact: true }),
        ).toHaveCount(1);
        const [createdCard] = (
          await (await get(teamTab, lists)).json()
        ).lists.find((item) => item.id === todo.id).cards;
        const cardPath = cards + "/" + createdCard.id;
        await renamed.getByText("Editar cartão", { exact: true }).click();
        await renamed
          .getByLabel("Título do cartão", { exact: true })
          .fill("ERP validado");
        await renamed
          .getByLabel("Descrição do cartão", { exact: true })
          .fill("Descrição atualizada");
        await renamed.getByRole("button", { name: "Salvar cartão" }).click();
        await expect(
          renamed.getByRole("heading", { name: "ERP validado" }),
        ).toBeVisible();
        await teamTab.page.reload();
        await expect(
          renamed.getByText("Descrição atualizada", { exact: true }),
        ).toBeVisible();
        const replay = await post(teamTab, cards, original);
        check(
          replay.status() === 201 &&
            (await replay.json()).title === "ERP validado",
        );
        check(
          (
            await post(teamTab, cards, { ...original, title: "Outro" })
          ).status() === 409,
        );
        const persisted = await migrator.query(
          `SELECT
          (SELECT count(*)::int FROM public.board_card WHERE list_id=$1) AS cards,
          (SELECT count(*)::int FROM public.audit_event WHERE entity_id=$2 AND operation='CARD_CREATED') AS audit,
          (SELECT count(*)::int FROM public.board_feed_event WHERE card_id=$2 AND operation='CARD_CREATED') AS feed`,
          [todo.id, createdCard.id],
        );
        check(
          JSON.stringify(persisted.rows[0]) ===
            JSON.stringify({ cards: 1, audit: 1, feed: 1 }),
        );

        const schedule = cardPath + "/schedule";
        const scheduleCard = (tab, data, path = schedule) =>
          post(tab, path, {
            ...data,
            operationId: data.operationId ?? randomUUID(),
          });
        const readSchedule = async () =>
          (await (await get(teamTab, lists)).json()).lists
            .flatMap((list) => list.cards)
            .find(({ id }) => id === createdCard.id);
        check(
          (
            await scheduleCard(teamTab, {
              startDate: "2026-11-10",
              dueDate: "2026-11-09",
            })
          ).status() === 400,
        );
        check(
          (
            await scheduleCard(teamTab, {
              startDate: "2025-02-29",
              dueDate: null,
            })
          ).status() === 400,
        );
        await teamTab.page.getByText("Editar datas", { exact: true }).click();
        await teamTab.page.getByLabel("Data de início").fill("2000-01-01");
        await teamTab.page.getByLabel("Data de vencimento").fill("2000-01-02");
        await teamTab.page
          .getByRole("button", { name: "Salvar datas" })
          .click();
        await expect(
          teamTab.page.getByText("Pendente · Atrasado", { exact: true }),
        ).toBeVisible();
        await teamTab.page
          .getByRole("button", { name: "Concluir cartão" })
          .click();
        await expect(
          teamTab.page.getByText("por você", { exact: false }),
        ).toBeVisible();
        const firstCompletion = await readSchedule();
        check(
          firstCompletion.completedAt &&
            firstCompletion.completedById === team.id &&
            !firstCompletion.overdue,
        );
        await teamTab.page
          .getByRole("button", { name: "Reabrir cartão" })
          .click();
        await expect(
          teamTab.page.getByText("Pendente · Atrasado", { exact: true }),
        ).toBeVisible();
        const reopened = await readSchedule();
        check(
          reopened.completedAt === null &&
            reopened.completedById === null &&
            reopened.startDate === "2000-01-01",
        );
        const completionHistory = await migrator.query(
          "SELECT before_data FROM public.audit_event WHERE entity_id=$1 AND operation='CARD_REOPENED'",
          [createdCard.id],
        );
        check(
          completionHistory.rows[0].before_data.completedAt ===
            firstCompletion.completedAt,
        );
        check(completionHistory.rows[0].before_data.completedById === team.id);
        for (const table of ["audit_event", "board_feed_event"]) {
          await migrator.query(`CREATE FUNCTION public.e2e_reject_schedule() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic schedule failure'; END; $$;
            CREATE TRIGGER e2e_reject_schedule BEFORE INSERT ON public.${table}
            FOR EACH ROW WHEN (NEW.operation = 'CARD_COMPLETED') EXECUTE FUNCTION public.e2e_reject_schedule();`);
          try {
            check(
              (await scheduleCard(teamTab, { completed: true })).status() ===
                500,
            );
            check(
              JSON.stringify(await readSchedule()) === JSON.stringify(reopened),
            );
          } finally {
            await migrator.query(
              `DROP TRIGGER e2e_reject_schedule ON public.${table}; DROP FUNCTION public.e2e_reject_schedule();`,
            );
          }
        }

        const midnight = await migrator.query(`SELECT
          ((DATE '2009-10-31' + 1)::timestamp AT TIME ZONE 'America/Goose_Bay') = TIMESTAMPTZ '2009-11-01 04:00:00+00' AS fold,
          ((DATE '2026-03-08' + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') = TIMESTAMPTZ '2026-03-09 07:00:00+00' AS dst`);
        check(midnight.rows[0].fold && midnight.rows[0].dst);
        const workspaceForDates = work.split("/").at(-1);
        await migrator.query(
          "UPDATE public.workspace SET time_zone='Pacific/Honolulu' WHERE id=$1",
          [workspaceForDates],
        );
        const today = (await (await get(teamTab, lists + "/revision")).json())
          .today;
        check(
          (
            await scheduleCard(ownerTab, { startDate: null, dueDate: today })
          ).status() === 204,
        );
        check(!(await readSchedule()).overdue);
        await migrator.query(
          "UPDATE public.workspace SET time_zone='Pacific/Kiritimati' WHERE id=$1",
          [workspaceForDates],
        );
        const shifted = await readSchedule();
        check(shifted.overdue && shifted.dueDate === today);
        const confirmed = { completed: true, operationId: randomUUID() };
        check((await scheduleCard(teamTab, confirmed)).status() === 204);
        check((await scheduleCard(teamTab, confirmed)).status() === 204);
        check(
          (
            await scheduleCard(teamTab, { ...confirmed, completed: false })
          ).status() === 409,
        );
        const scheduled = await readSchedule();
        check(
          scheduled.dueDate === today &&
            scheduled.completedAt &&
            !scheduled.overdue,
        );
        await migrator.query(
          "UPDATE public.workspace SET time_zone='America/Sao_Paulo' WHERE id=$1",
          [workspaceForDates],
        );
        check((await readSchedule()).completedAt === scheduled.completedAt);

        await open(ownerTab, homeBoard);
        await createList(ownerTab, "Lista pessoal");
        const [personalList] = (
          await (await get(ownerTab, personalLists)).json()
        ).lists;
        const personalCards = personalLists + "/" + personalList.id + "/cards";
        const personalCardResponse = await post(ownerTab, personalCards, {
          title: "Cartão pessoal",
          description: "Conteúdo pessoal",
          operationId: randomUUID(),
        });
        check(personalCardResponse.status() === 201);
        const personalCard = await personalCardResponse.json();
        const privateSchedule =
          personalCards + "/" + personalCard.id + "/schedule";
        check(
          (
            await scheduleCard(
              ownerTab,
              { startDate: null, dueDate: "2000-01-01" },
              privateSchedule,
            )
          ).status() === 204,
        );
        check(
          (
            await scheduleCard(
              personalTab,
              { completed: true },
              privateSchedule,
            )
          ).status() === 403,
        );
        check(
          (
            await scheduleCard(teamTab, { completed: true }, privateSchedule)
          ).status() === 404,
        );
        await open(personalTab, homeBoard);
        await expect(
          personalTab.page.getByRole("heading", { name: "Lista pessoal" }),
        ).toBeVisible();
        await expect(
          personalTab.page.getByRole("button", { name: "Criar lista" }),
        ).toHaveCount(0);
        check(
          (
            await post(personalTab, personalLists, {
              name: "Negada",
              operationId: randomUUID(),
            })
          ).status() === 403,
        );
        check(
          (
            await patch(personalTab, personalLists + "/" + personalList.id, {
              name: "Negada",
            })
          ).status() === 403,
        );
        await expect(
          personalTab.page.getByText("Conteúdo pessoal", { exact: true }),
        ).toBeVisible();
        await expect(
          personalTab.page.getByRole("button", { name: "Criar cartão" }),
        ).toHaveCount(0);
        check(
          (
            await post(personalTab, personalCards, {
              title: "Negado",
              operationId: randomUUID(),
            })
          ).status() === 403,
        );
        check(
          (
            await patch(personalTab, personalCards + "/" + personalCard.id, {
              description: null,
            })
          ).status() === 403,
        );
        const personalEdit = await patch(
          ownerTab,
          personalCards + "/" + personalCard.id,
          { title: "Título alterado" },
        );
        check(
          personalEdit.status() === 200 &&
            (await personalEdit.json()).description === "Conteúdo pessoal",
        );
        check((await get(teamTab, personalLists)).status() === 404);
        check((await get(personalTab, lists)).status() === 404);
        check(
          (
            await patch(ownerTab, personalLists + "/" + todo.id, {
              name: "Negada",
            })
          ).status() === 404,
        );
        check(
          (
            await patch(
              ownerTab,
              personalLists +
                "/" +
                personalList.id +
                "/cards/" +
                createdCard.id,
              { title: "Negado" },
            )
          ).status() === 404,
        );
        await open(personalTab, erp);
        await expect(
          personalTab.page.getByText("Recurso indisponível."),
        ).toBeVisible();
        await expect(
          personalTab.page.getByRole("heading", { name: "ERP validado" }),
        ).toHaveCount(0);

        for (const table of ["audit_event", "board_feed_event"]) {
          await migrator.query(`CREATE FUNCTION public.e2e_reject_content() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic content failure'; END; $$;
            CREATE TRIGGER e2e_reject_content BEFORE INSERT ON public.${table}
            FOR EACH ROW WHEN (NEW.operation IN ('LIST_CREATED','CARD_EDITED'))
            EXECUTE FUNCTION public.e2e_reject_content();`);
          try {
            check(
              (
                await post(teamTab, lists, {
                  name: "Rollback",
                  operationId: randomUUID(),
                })
              ).status() === 500,
            );
            check(
              (
                await patch(teamTab, cardPath, { title: "Rollback" })
              ).status() === 500,
            );
            const fresh = await (await get(teamTab, lists)).json();
            check(fresh.lists.length === 3);
            check(
              fresh.lists.find((item) => item.id === todo.id).cards[0].title ===
                "ERP validado",
            );
            const events = await migrator.query(
              `SELECT
              (SELECT count(*)::int FROM public.audit_event WHERE operation='CARD_EDITED' AND entity_id=$1) AS audit,
              (SELECT count(*)::int FROM public.board_feed_event WHERE operation='CARD_EDITED' AND card_id=$1) AS feed`,
              [createdCard.id],
            );
            check(events.rows[0].audit === 1 && events.rows[0].feed === 1);
          } finally {
            await migrator.query(`DROP TRIGGER e2e_reject_content ON public.${table};
              DROP FUNCTION public.e2e_reject_content();`);
          }
        }

        const order = async (tab = teamTab) => (await get(tab, lists)).json();
        const move = (intent, tab = teamTab, path = lists) =>
          post(tab, path + "/move", intent);
        const boardIdForOrder = erp.split("/").at(-1);
        const currentOrder = await order();
        const [firstList, secondList, thirdList] = currentOrder.lists;
        const listIntent = (item, leftId, rightId) => ({
          kind: "LIST",
          itemId: item.id,
          itemRevision: item.positionRevision,
          sourceId: boardIdForOrder,
          destinationId: boardIdForOrder,
          sourceRevision: currentOrder.orderRevision,
          destinationRevision: currentOrder.orderRevision,
          leftId,
          rightId,
          operationId: randomUUID(),
        });
        // Force an exhausted gap without changing the visible order.
        await migrator.query(
          "UPDATE public.board_list SET position = CASE id WHEN $1 THEN 100 WHEN $2 THEN 101 ELSE 102 END WHERE board_id=$3",
          [firstList.id, secondList.id, boardIdForOrder],
        );
        const compactingMove = listIntent(
          thirdList,
          firstList.id,
          secondList.id,
        );
        check((await move(compactingMove)).status() === 204);
        check((await move(compactingMove)).status() === 204);
        check(
          (await move({ ...compactingMove, leftId: null })).status() === 409,
        );
        const compacted = await order();
        check(
          compacted.lists.map(({ id }) => id).join(",") ===
            [firstList.id, thirdList.id, secondList.id].join(","),
        );
        check(compacted.orderRevision === currentOrder.orderRevision + 1);
        const positions = await migrator.query(
          "SELECT position::text FROM public.board_list WHERE board_id=$1 ORDER BY position",
          [boardIdForOrder],
        );
        check(
          positions.rows.map(({ position }) => position).join(",") ===
            "4294967296,6442450944,8589934592",
        );

        await open(teamTab, erp);
        await open(ownerTab, erp);
        const drag = async (source, target) => {
          const dataTransfer = await teamTab.page.evaluateHandle(
            () => new DataTransfer(),
          );
          try {
            await source.dispatchEvent("dragstart", { dataTransfer });
            await target.dispatchEvent("dragover", { dataTransfer });
            await target.dispatchEvent("drop", { dataTransfer });
            await source.dispatchEvent("dragend", { dataTransfer });
          } finally {
            await dataTransfer.dispose();
          }
        };
        await teamTab.page.setViewportSize({ width: 1280, height: 2400 });
        await teamTab.page
          .getByRole("button", { name: "Arrastar lista " + secondList.name })
          .dragTo(
            teamTab.page.getByRole("button", {
              name: "Arrastar lista " + firstList.name,
            }),
          );
        await expect(teamTab.page.locator("h3")).toHaveText([
          secondList.name,
          firstList.name,
          thirdList.name,
        ]);
        await expect(ownerTab.page.locator("h3")).toHaveText(
          [secondList.name, firstList.name, thirdList.name],
          { timeout: 10000 },
        );
        await teamTab.page.reload();
        await expect(teamTab.page.locator("h3")).toHaveText([
          secondList.name,
          firstList.name,
          thirdList.name,
        ]);

        const addCard = (listId, title) =>
          create(lists + "/" + listId + "/cards", { title });
        const extraA = await addCard(firstList.id, "Concorrente A");
        const extraB = await addCard(secondList.id, "Concorrente B");
        const anchor = await addCard(secondList.id, "Âncora");
        const from = await order();
        const cardIntent = (id, sourceId, destinationId, leftId, rightId) => {
          const src = from.lists.find((list) => list.id === sourceId);
          const dst = from.lists.find((list) => list.id === destinationId);
          return {
            kind: "CARD",
            itemId: id,
            itemRevision: src.cards.find((card) => card.id === id)
              .positionRevision,
            sourceId,
            destinationId,
            sourceRevision: src.cardOrderRevision,
            destinationRevision: dst.cardOrderRevision,
            leftId,
            rightId,
            operationId: randomUUID(),
          };
        };
        const intentA = cardIntent(
          extraA,
          firstList.id,
          secondList.id,
          anchor,
          null,
        );
        const intentB = cardIntent(
          extraB,
          secondList.id,
          firstList.id,
          createdCard.id,
          extraA,
        );
        await migrator.query("BEGIN");
        let pending;
        try {
          await migrator.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["bello-order:CARD:" + firstList.id],
          );
          pending = Promise.all([move(intentA), move(intentB, ownerTab)]);
          let blocked = false;
          for (let i = 0; i < 60; i++) {
            const { rows } = await migrator.query(
              "SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted",
            );
            if (rows[0].waiting >= 2) {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          check(blocked);
        } finally {
          await migrator.query("ROLLBACK");
        }
        check((await pending).every((result) => result.status() === 204));
        const crossed = await order();
        check(
          crossed.lists
            .find(({ id }) => id === firstList.id)
            .cards.map(({ id }) => id)
            .join(",") === [createdCard.id, extraB].join(","),
        );
        check(
          crossed.lists
            .find(({ id }) => id === secondList.id)
            .cards.map(({ id }) => id)
            .join(",") === [anchor, extraA].join(","),
        );
        const movedSchedule = await readSchedule();
        check(
          movedSchedule.completedAt === scheduled.completedAt &&
            movedSchedule.dueDate === scheduled.dueDate,
        );
        const repeatedCreate = await post(teamTab, cards, original);
        check(
          repeatedCreate.status() === 201 &&
            (await repeatedCreate.json()).id === createdCard.id,
        );
        await open(teamTab, erp);
        const sourceRegion = teamTab.page.getByRole("region", {
          name: firstList.name,
        });
        const targetRegion = teamTab.page.getByRole("region", {
          name: secondList.name,
        });
        await drag(
          sourceRegion.getByRole("button", {
            name: "Arrastar cartão ERP validado",
          }),
          targetRegion.getByRole("button", { name: "Arrastar cartão Âncora" }),
        );
        await expect(targetRegion.locator("h4")).toHaveText([
          "ERP validado",
          "Âncora",
          "Concorrente A",
        ]);
        check((await scheduleCard(teamTab, confirmed)).status() === 204);
        check(
          (await scheduleCard(teamTab, { completed: false })).status() === 404,
        );
        const movedReplay = await post(teamTab, cards, original);
        check(
          movedReplay.status() === 201 &&
            (await movedReplay.json()).id === createdCard.id,
        );
        check(
          (
            await move({
              ...intentA,
              destinationId: personalList.id,
              operationId: randomUUID(),
            })
          ).status() === 404,
        );
        check(
          (
            await move(
              {
                ...intentA,
                sourceId: personalList.id,
                destinationId: personalList.id,
                itemId: personalCard.id,
                operationId: randomUUID(),
              },
              personalTab,
              personalLists,
            )
          ).status() === 403,
        );
        check((await get(personalTab, lists + "/revision")).status() === 404);

        const beforeSame = await order();
        const currentSource = beforeSame.lists.find(
          ({ id }) => id === secondList.id,
        );
        const movingCard = currentSource.cards.find(
          ({ id }) => id === createdCard.id,
        );
        const sameItemIntent = (targetId) => {
          const target = beforeSame.lists.find(({ id }) => id === targetId);
          return {
            kind: "CARD",
            itemId: movingCard.id,
            itemRevision: movingCard.positionRevision,
            sourceId: currentSource.id,
            sourceRevision: currentSource.cardOrderRevision,
            destinationId: target.id,
            destinationRevision: target.cardOrderRevision,
            leftId: target.cards.at(-1)?.id ?? null,
            rightId: null,
            operationId: randomUUID(),
          };
        };
        const competing = [
          sameItemIntent(firstList.id),
          sameItemIntent(thirdList.id),
        ];
        check(
          (await Promise.all(competing.map((intent) => move(intent)))).every(
            (response) => response.status() === 204,
          ),
        );
        const afterSame = await order();
        const occurrence = afterSame.lists
          .flatMap((list) => list.cards)
          .filter(({ id }) => id === movingCard.id);
        check(
          occurrence.length === 1 &&
            occurrence[0].positionRevision === movingCard.positionRevision + 2,
        );
        const history = await migrator.query(
          "SELECT before_data, after_data FROM public.audit_event WHERE entity_id=$1 AND operation='CARD_MOVED' ORDER BY occurred_at DESC LIMIT 2",
          [movingCard.id],
        );
        const finalList = afterSame.lists.find((list) =>
          list.cards.some(({ id }) => id === movingCard.id),
        );
        check(history.rows[0].after_data.containerId === finalList.id);
        check(
          history.rows[0].before_data.containerId ===
            history.rows[1].after_data.containerId,
        );
        check(history.rows[1].before_data.containerId === currentSource.id);

        const failedMove = {
          ...sameItemIntent(secondList.id),
          itemRevision: occurrence[0].positionRevision,
          sourceId: finalList.id,
          sourceRevision: finalList.cardOrderRevision,
          destinationRevision: afterSame.lists.find(
            ({ id }) => id === secondList.id,
          ).cardOrderRevision,
          leftId: extraA,
        };
        for (const table of ["audit_event", "board_feed_event"]) {
          await migrator.query(`CREATE FUNCTION public.e2e_reject_move() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic ordering failure'; END; $$;
            CREATE TRIGGER e2e_reject_move BEFORE INSERT ON public.${table}
            FOR EACH ROW WHEN (NEW.operation = 'CARD_MOVED') EXECUTE FUNCTION public.e2e_reject_move();`);
          try {
            check((await move(failedMove)).status() === 500);
            check(JSON.stringify(await order()) === JSON.stringify(afterSame));
          } finally {
            await migrator.query(
              `DROP TRIGGER e2e_reject_move ON public.${table}; DROP FUNCTION public.e2e_reject_move();`,
            );
          }
        }

        const comments =
          lists + "/" + finalList.id + "/cards/" + createdCard.id + "/comments";
        const sendComment = (tab, fields, path = comments) =>
          post(tab, path, {
            ...fields,
            operationId: fields.operationId ?? randomUUID(),
          });
        const readComments = async (tab, path = comments) =>
          (await (await get(tab, path)).json()).comments;
        const draft = {
          kind: "CREATE",
          content: "Primeira versão sintética",
          operationId: randomUUID(),
        };
        check((await sendComment(teamTab, draft)).status() === 204);
        check((await sendComment(teamTab, draft)).status() === 409);
        check(
          (
            await sendComment(teamTab, { kind: "CREATE", content: " \u200b " })
          ).status() === 400,
        );
        check((await get(personalTab, comments)).status() === 404);
        const [originalComment] = await readComments(teamTab);
        const edit = {
          kind: "EDIT",
          id: originalComment.id,
          version: originalComment.version,
          content: "Versão revisada sintética",
        };
        check(originalComment.canEdit && !originalComment.canModerate);
        check((await sendComment(ownerTab, edit)).status() === 403);
        check((await sendComment(teamTab, edit)).status() === 204);
        const [editedComment] = await readComments(ownerTab);
        check(
          editedComment.createdAt === originalComment.createdAt &&
            editedComment.editedAt,
        );
        check(
          editedComment.canModerate &&
            !editedComment.canEdit &&
            editedComment.content === edit.content,
        );
        const moderate = {
          kind: "MODERATE",
          id: editedComment.id,
          version: editedComment.version,
          confirmed: true,
          justification: "Motivo sintético de moderação",
        };
        check(
          (
            await sendComment(ownerTab, { ...moderate, confirmed: false })
          ).status() === 400,
        );
        check(
          (
            await sendComment(ownerTab, { ...moderate, justification: " " })
          ).status() === 400,
        );
        check(
          (
            await sendComment(ownerTab, {
              ...moderate,
              version: originalComment.version,
            })
          ).status() === 409,
        );
        check((await sendComment(teamTab, moderate)).status() === 403);

        for (const table of ["audit_event", "board_feed_event"]) {
          await migrator.query(`CREATE FUNCTION public.e2e_reject_comment() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic comment failure'; END; $$;
            CREATE TRIGGER e2e_reject_comment BEFORE INSERT ON public.${table}
            FOR EACH ROW WHEN (NEW.operation = 'COMMENT_MODERATED') EXECUTE FUNCTION public.e2e_reject_comment();`);
          try {
            check((await sendComment(ownerTab, moderate)).status() === 500);
            check((await readComments(teamTab))[0].content === edit.content);
          } finally {
            await migrator.query(
              `DROP TRIGGER e2e_reject_comment ON public.${table}; DROP FUNCTION public.e2e_reject_comment();`,
            );
          }
        }
        await open(ownerTab, erp);
        const commentCard = ownerTab.page.getByRole("article").filter({
          has: ownerTab.page.getByRole("heading", { name: "ERP validado" }),
        });
        await commentCard
          .getByRole("button", { name: "Comentários", exact: true })
          .click();
        await expect(
          commentCard.getByText(edit.content, { exact: true }),
        ).toBeVisible();
        await commentCard
          .getByRole("button", { name: "Moderar comentário" })
          .click();
        await commentCard
          .getByLabel("Justificativa de moderação")
          .fill(moderate.justification);
        await commentCard
          .getByRole("button", { name: "Confirmar moderação" })
          .click();
        await expect(
          commentCard.getByText("Comentário removido", { exact: false }),
        ).toBeVisible();
        const [removedComment] = await readComments(teamTab);
        check(
          removedComment.content === null &&
            removedComment.author === team.email &&
            removedComment.removedBy === owner.email,
        );
        check(
          !("justification" in removedComment) &&
            removedComment.version === null,
        );
        check((await sendComment(teamTab, edit)).status() === 409);
        const commentHistory = await migrator.query(
          `SELECT operation, before_data, after_data
          FROM public.audit_event WHERE entity_id=$1 AND entity_type='COMMENT' ORDER BY occurred_at`,
          [editedComment.id],
        );
        check(
          commentHistory.rows.map(({ operation }) => operation).join(",") ===
            "COMMENT_CREATED,COMMENT_EDITED,COMMENT_MODERATED",
        );
        check(commentHistory.rows[1].before_data.content === draft.content);
        check(commentHistory.rows[2].before_data.content === edit.content);
        check(
          commentHistory.rows[2].after_data.justification ===
            moderate.justification,
        );
        const commentFeed = await migrator.query(
          "SELECT to_jsonb(event)::text AS data FROM public.board_feed_event event WHERE comment_id=$1",
          [editedComment.id],
        );
        check(
          commentFeed.rows.length === 3 &&
            commentFeed.rows.every(
              ({ data }) =>
                ![draft.content, edit.content, moderate.justification].some(
                  (text) => data.includes(text),
                ),
            ),
        );
        const privateComments =
          personalCards + "/" + personalCard.id + "/comments";
        const maxBody =
          '{"kind":"CREATE","operationId":"' +
          randomUUID() +
          '","content":"' +
          "\\ud83d\\ude00".repeat(10000) +
          '"}';
        const maxResponse = await ownerTab.context.request.post(
          origin + privateComments,
          {
            headers: { ...headers, "Content-Type": "application/json" },
            data: maxBody,
          },
        );
        check(maxResponse.status() === 204);
        const [ownComment] = await readComments(ownerTab, privateComments);
        check(Array.from(ownComment.content).length === 10000);
        const [observed] = await readComments(personalTab, privateComments);
        check(!observed.canEdit && !observed.canModerate);
        check(
          (
            await sendComment(
              personalTab,
              { kind: "CREATE", content: "Negada" },
              privateComments,
            )
          ).status() === 403,
        );
        check(
          (
            await sendComment(
              ownerTab,
              {
                kind: "REMOVE",
                id: ownComment.id,
                version: ownComment.version,
                confirmed: true,
              },
              privateComments,
            )
          ).status() === 204,
        );
        check(
          (await readComments(personalTab, privateComments))[0].content ===
            null,
        );

        const workCatalog = work + "/labels";
        const homeCatalog = home + "/labels";
        const createLabel = (tab, path, data) =>
          post(tab, path, {
            ...data,
            operationId: data.operationId ?? randomUUID(),
          });
        await open(ownerTab, workCatalog);
        await ownerTab.page.getByLabel("Nome da etiqueta").fill("Straße");
        await ownerTab.page.getByLabel("Cor da etiqueta").fill("#1144AA");
        await ownerTab.page
          .getByRole("button", { name: "Criar etiqueta" })
          .click();
        await expect(
          ownerTab.page.getByText("Straße", { exact: true }),
        ).toBeVisible();
        const catalog = await (await get(teamTab, workCatalog)).json();
        const [label] = catalog.labels;
        check(
          !catalog.editable &&
            label.name === "Straße" &&
            label.color === "#1144aa",
        );
        check(Object.keys(label).sort().join(",") === "color,id,name");
        check(
          (
            await createLabel(ownerTab, workCatalog, { name: "STRASSE" })
          ).status() === 409,
        );
        check(
          (
            await createLabel(teamTab, workCatalog, { name: "Indevida" })
          ).status() === 403,
        );
        check((await get(personalTab, workCatalog)).status() === 403);
        const homeLabelResponse = await createLabel(ownerTab, homeCatalog, {
          name: "STRASSE",
        });
        check(homeLabelResponse.status() === 201);
        const homeLabel = await homeLabelResponse.json();
        const erpLabels =
          lists + "/" + finalList.id + "/cards/" + createdCard.id + "/labels";
        const privateLabels = personalCards + "/" + personalCard.id + "/labels";
        const useLabel = (
          tab,
          path,
          labelId,
          applied = true,
          operationId = randomUUID(),
        ) => post(tab, path, { labelId, applied, operationId });
        check(
          (await useLabel(teamTab, erpLabels, homeLabel.id)).status() === 404,
        );
        check(
          (
            await useLabel(personalTab, privateLabels, homeLabel.id)
          ).status() === 403,
        );
        check(
          (await useLabel(ownerTab, privateLabels, homeLabel.id)).status() ===
            204,
        );
        await open(personalTab, homeBoard);
        await expect(
          personalTab.page.getByText("STRASSE", { exact: true }),
        ).toBeVisible();
        await expect(
          personalTab.page.getByRole("button", { name: "Aplicar etiqueta" }),
        ).toHaveCount(0);

        const teamCreates = async (path, fields) => {
          const response = await post(teamTab, path, {
            ...fields,
            operationId: randomUUID(),
          });
          check(response.status() === 201);
          return (await response.json()).id;
        };
        const privateWorkBoard =
          work +
          "/boards/" +
          (await teamCreates(work + "/boards", {
            name: "Quadro restrito",
            description: "Privado",
          }));
        const privateWorkLists = privateWorkBoard + "/lists";
        const privateWorkList = await teamCreates(privateWorkLists, {
          name: "Restrita",
        });
        const privateWorkCards =
          privateWorkLists + "/" + privateWorkList + "/cards";
        const privateWorkCard = await teamCreates(privateWorkCards, {
          title: "Cartão restrito",
        });
        const restrictedLabels =
          privateWorkCards + "/" + privateWorkCard + "/labels";
        check((await get(ownerTab, privateWorkLists)).status() === 404);
        check(
          (await useLabel(teamTab, restrictedLabels, label.id)).status() ===
            204,
        );
        await open(teamTab, erp);
        const article = teamTab.page.getByRole("article").filter({
          has: teamTab.page.getByRole("heading", { name: "ERP validado" }),
        });
        await article.getByLabel("Adicionar etiqueta").selectOption(label.id);
        await article.getByRole("button", { name: "Aplicar etiqueta" }).click();
        await expect(
          article.getByRole("button", { name: "Remover etiqueta Straße" }),
        ).toBeVisible();
        const manualRemoval = randomUUID();
        check(
          (
            await useLabel(teamTab, erpLabels, label.id, false, manualRemoval)
          ).status() === 204,
        );
        check(
          (
            await useLabel(teamTab, erpLabels, label.id, false, manualRemoval)
          ).status() === 204,
        );
        check((await useLabel(teamTab, erpLabels, label.id)).status() === 204);
        const renamedLabel = { name: "Urgente", color: "#229944" };
        check(
          (
            await patch(ownerTab, workCatalog + "/" + label.id, {
              ...renamedLabel,
              operationId: randomUUID(),
            })
          ).status() === 200,
        );
        await expect(
          article.getByRole("button", { name: "Remover etiqueta Urgente" }),
        ).toBeVisible({ timeout: 10000 });
        const restricted = () =>
          get(teamTab, privateWorkLists).then((response) => response.json());
        check(
          (await restricted()).lists[0].cards[0].labels[0].name === "Urgente",
        );

        const deletePath = workCatalog + "/" + label.id + "/delete";
        check(
          (await createLabel(ownerTab, deletePath, renamedLabel)).status() ===
            400,
        );
        check(
          (
            await createLabel(ownerTab, deletePath, {
              ...label,
              confirmed: true,
            })
          ).status() === 409,
        );
        await migrator.query(`CREATE FUNCTION public.e2e_reject_label_removal() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic label failure'; END; $$;
          CREATE TRIGGER e2e_reject_label_removal BEFORE INSERT ON public.board_feed_event
          FOR EACH ROW WHEN (NEW.operation='CARD_LABEL_REMOVED') EXECUTE FUNCTION public.e2e_reject_label_removal();`);
        try {
          check(
            (
              await createLabel(ownerTab, deletePath, {
                ...renamedLabel,
                confirmed: true,
              })
            ).status() === 500,
          );
          check((await restricted()).lists[0].cards[0].labels.length === 1);
          check(
            (await (await get(ownerTab, workCatalog)).json()).labels.length ===
              1,
          );
        } finally {
          await migrator.query(
            "DROP TRIGGER e2e_reject_label_removal ON public.board_feed_event; DROP FUNCTION public.e2e_reject_label_removal();",
          );
        }
        await open(ownerTab, workCatalog);
        await ownerTab.page
          .getByRole("button", { name: "Excluir Urgente" })
          .click();
        await expect(
          ownerTab.page.getByText("o histórico será preservado", {
            exact: false,
          }),
        ).toBeVisible();
        await ownerTab.page
          .getByRole("button", { name: "Confirmar exclusão" })
          .click();
        await expect(
          ownerTab.page.getByText("Nenhuma etiqueta cadastrada."),
        ).toBeVisible();
        await expect(
          article.getByRole("button", { name: "Remover etiqueta Urgente" }),
        ).toHaveCount(0, { timeout: 10000 });
        check((await restricted()).lists[0].cards[0].labels.length === 0);
        check(
          (await (await get(ownerTab, homeCatalog)).json()).labels.length === 1,
        );
        const createRace = { name: "Corrida", operationId: randomUUID() };
        const raceResponse = await createLabel(
          ownerTab,
          workCatalog,
          createRace,
        );
        check(raceResponse.status() === 201);
        const raceLabel = await raceResponse.json();
        const racePath = workCatalog + "/" + raceLabel.id + "/delete";
        const deleteRace = {
          name: raceLabel.name,
          color: null,
          confirmed: true,
          operationId: randomUUID(),
        };
        await migrator.query("BEGIN");
        let concurrentLabels;
        try {
          await migrator.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["bello-labels:" + work.split("/").at(-1)],
          );
          concurrentLabels = Promise.all([
            useLabel(teamTab, restrictedLabels, raceLabel.id),
            createLabel(ownerTab, racePath, deleteRace),
          ]);
          let waiting = false;
          for (let attempt = 0; attempt < 60; attempt++) {
            const { rows } = await migrator.query(
              "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
            );
            if (rows[0].n >= 2) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          check(waiting);
        } finally {
          await migrator.query("ROLLBACK");
        }
        const [applyResult, deleteResult] = await concurrentLabels;
        check(
          [204, 404].includes(applyResult.status()) &&
            deleteResult.status() === 204,
        );
        check((await restricted()).lists[0].cards[0].labels.length === 0);
        check(
          (await createLabel(ownerTab, racePath, deleteRace)).status() === 409,
        );
        check(
          (await createLabel(ownerTab, workCatalog, createRace)).status() ===
            409,
        );
        const labelHistory = await migrator.query(
          `SELECT
          (SELECT count(*)::int FROM public.audit_event WHERE entity_id=$1 AND operation='WORKSPACE_LABEL_DELETED' AND before_data->>'name'='Urgente' AND context=$2::jsonb) AS audit,
          (SELECT count(*)::int FROM public.board_feed_event WHERE label_id=$1 AND operation='CARD_LABEL_REMOVED') AS feed`,
          [label.id, JSON.stringify({ workspaceId: work.split("/").at(-1) })],
        );
        check(
          labelHistory.rows[0].audit === 1 && labelHistory.rows[0].feed === 3,
        );

        const repeats = await Promise.all([
          post(ownerTab, erp + "/members", {
            email: team.email,
            role: "MEMBER",
          }),
          post(ownerTab, erp + "/members", {
            email: team.email,
            role: "MEMBER",
          }),
        ]);
        check(repeats.every((response) => response.status() === 204));
        check(
          (
            await post(ownerTab, erp + "/members", {
              email: team.email,
              role: "OBSERVER",
            })
          ).status() === 409,
        );
        check((await get(teamTab, homeBoard)).status() === 403);
        check((await get(personalTab, erp)).status() === 403);
        check((await get(teamTab, work + "/members")).status() === 403);
        check((await get(teamTab, erp + "/members")).status() === 403);
        const denials = await migrator.query(
          `SELECT operation, entity_id, context, before_data, after_data
           FROM public.audit_event WHERE actor_account_id=$1 AND scope='SECURITY'
             AND result='DENIED' AND operation IN ('LIST_WORKSPACE_MEMBERS', 'LIST_BOARD_MEMBERS')
           ORDER BY operation`,
          [team.id],
        );
        check(
          denials.rows.map((row) => row.operation).join(",") ===
            "LIST_BOARD_MEMBERS,LIST_WORKSPACE_MEMBERS",
        );
        check(
          denials.rows.every(
            (row) =>
              row.entity_id === null &&
              row.context === null &&
              row.before_data === null &&
              row.after_data === null,
          ),
        );

        const central = workspacePath + "/notifications";
        const ownerNotices = await (await get(ownerTab, central)).json();
        const teamNotices = await (await get(teamTab, central)).json();
        const personalNotices = await (await get(personalTab, central)).json();
        check(
          ownerNotices.length === 0 &&
            teamNotices.length === 2 &&
            personalNotices.length === 2,
        );
        check(
          teamNotices.every((notice) => notice.workspace.name === "Trabalho"),
        );
        check(
          personalNotices.every(
            (notice) => notice.workspace.name === "Pessoal",
          ),
        );

        await teamTab.page.goto(origin + "/notifications");
        await expect(
          teamTab.page.getByRole("link", { name: "Time ERP" }),
        ).toBeVisible();
        await teamTab.page.getByRole("link", { name: "Time ERP" }).click();
        await expect(
          teamTab.page.getByRole("heading", { name: "Time ERP" }),
        ).toBeVisible();
        await open(personalTab, homeBoard);
        await expect(
          personalTab.page.getByRole("heading", {
            name: "Pessoal",
            exact: true,
          }),
        ).toBeVisible();

        await expect
          .poll(
            async () => {
              const result = await migrator.query(
                `SELECT count(*) FILTER (WHERE d.state='SENT')::int AS sent,
                  count(*) FILTER (WHERE d.state='FAILED')::int AS failed
           FROM public.access_notification_delivery d
           JOIN public.access_notification n ON n.id=d.notification_id
           WHERE n.actor_id=$1 AND d.attempt_count=1`,
                [owner.id],
              );
              return result.rows[0];
            },
            { timeout: timeLimit },
          )
          .toEqual({ sent: 3, failed: 1 });
        check(
          accessMail.filter((message) => message.recipientId === team.id)
            .length === 2,
        );
        check(
          accessMail.filter((message) => message.recipientId === personal.id)
            .length === 2,
        );
        check((await get(personalTab, homeBoard)).status() === 200);

        const privileges = (
          await migrator.query(`SELECT
          has_column_privilege('bello_runtime','public.account','email','SELECT') AS raw_email,
          has_column_privilege('bello_runtime','public.access_notification','recipient_id','UPDATE') AS change_recipient,
          has_column_privilege('bello_runtime','public.access_notification_delivery','state','UPDATE') AS change_state,
          to_regprocedure('public.access_notification_recipient(uuid)') IS NULL AS no_recipient_function`)
        ).rows[0];
        check(
          !privileges.raw_email &&
            !privileges.change_recipient &&
            privileges.change_state &&
            privileges.no_recipient_function,
        );
        const runtime = new Client({
          connectionString: databaseUrl(
            "bello_test_app",
            process.env.BELLO_TEST_APP_PASSWORD,
          ),
        });
        await runtime.connect();
        try {
          await runtime.query("BEGIN");
          const reopened = await runtime.query(
            "UPDATE public.access_notification_delivery SET state='SENDING' WHERE notification_id=$1 AND state='SENT'",
            [teamNotices[0].id],
          );
          check(reopened.rowCount === 1);
          for (const [sql, code] of [
            ["SELECT public.access_notification_recipient($1::uuid)", "42883"],
            ["SELECT email FROM public.account WHERE id=$1", "42501"],
          ]) {
            await runtime.query("SAVEPOINT denied_address");
            let deniedCode;
            try {
              const id = code === "42883" ? teamNotices[0].id : team.id;
              await runtime.query(sql, [id]);
            } catch (error) {
              deniedCode = error.code;
            }
            check(deniedCode === code);
            await runtime.query("ROLLBACK TO SAVEPOINT denied_address");
          }
        } finally {
          await runtime.query("ROLLBACK").finally(() => runtime.end());
        }

        const extra = await fixture();
        const workspaceId = work.split("/").at(-1);
        const boardId = erp.split("/").at(-1);
        await migrator.query(
          "INSERT INTO public.workspace_membership (workspace_id, account_id, role) VALUES ($1,$2,'MEMBER')",
          [workspaceId, extra.id],
        );
        async function snapshot() {
          return (
            await migrator.query(`SELECT
            (SELECT count(*)::int FROM public.workspace_membership) AS workspace_members,
            (SELECT count(*)::int FROM public.board_membership) AS board_members,
            (SELECT count(*)::int FROM public.access_notification) AS notices,
            (SELECT count(*)::int FROM public.access_notification_delivery) AS deliveries,
            (SELECT count(*)::int FROM public.audit_event WHERE scope='WORKSPACE') AS audit,
            (SELECT count(*)::int FROM public.board_feed_event) AS feed`)
          ).rows[0];
        }
        const baseline = await snapshot();
        for (const fault of [
          { table: "access_notification", condition: "true", path: home },
          {
            table: "audit_event",
            condition: "NEW.operation = 'WORKSPACE_MEMBER_INCLUDED'",
            path: home,
          },
          {
            table: "board_feed_event",
            condition: "NEW.operation = 'BOARD_MEMBER_INCLUDED'",
            path: erp,
          },
        ]) {
          await migrator.query(`CREATE FUNCTION public.e2e_reject_access_notice() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic notification failure'; END; $$;
            CREATE TRIGGER e2e_reject_access_notice BEFORE INSERT ON public.${fault.table}
            FOR EACH ROW WHEN (${fault.condition}) EXECUTE FUNCTION public.e2e_reject_access_notice();`);
          try {
            check(
              (
                await post(ownerTab, fault.path + "/members", {
                  email: extra.email,
                  role: "MEMBER",
                })
              ).status() === 500,
            );
            check(
              JSON.stringify(await snapshot()) === JSON.stringify(baseline),
            );
          } finally {
            await migrator.query(`DROP TRIGGER e2e_reject_access_notice ON public.${fault.table};
              DROP FUNCTION public.e2e_reject_access_notice();`);
          }
        }

        const delegated = await fixture();
        const delegatedTab = await pageFor();
        await login(delegatedTab.page, delegated);
        check(
          (
            await post(ownerTab, work + "/members", {
              email: delegated.email,
              role: "ADMIN",
            })
          ).status() === 204,
        );
        check((await get(delegatedTab, erp)).status() === 403);
        const governance = await (
          await get(delegatedTab, work + "/members")
        ).json();
        check(
          governance.boards.some(
            (item) => item.id === boardId && !("description" in item),
          ),
        );
        check(
          (
            await post(delegatedTab, erp + "/members", {
              email: delegated.email,
              role: "ADMIN",
            })
          ).status() === 204,
        );
        check((await get(delegatedTab, erp)).status() === 200);
        await delegatedTab.context.close();
      } finally {
        await Promise.all([
          ownerTab.context.close(),
          teamTab.context.close(),
          personalTab.context.close(),
        ]);
      }
    },
  );

  await scenario(
    "board membership changes, live revocation and administrator continuity",
    async () => {
      const [owner, member, deputy] = await Promise.all([
        fixture(),
        fixture(),
        fixture(),
      ]);
      const [admin, participant] = await Promise.all([pageFor(), pageFor()]);
      const headers = { "X-Bello-Flow-Request": "1", Origin: origin };
      const request = (tab, path, data) =>
        tab.context.request.post(origin + path, { headers, data });
      const get = (tab, path) =>
        tab.context.request.get(origin + path, { headers });
      const create = async (path, fields) => {
        const response = await request(admin, path, {
          ...fields,
          operationId: randomUUID(),
        });
        check(response.status() === 201);
        return (await response.json()).id;
      };
      const open = (tab, path) =>
        tab.page.goto(origin + path.replace(/^\/api/, ""));
      try {
        await login(admin.page, owner);
        await login(participant.page, member);
        const workspaces = "/api/workspaces";
        const workspace =
          workspaces +
          "/" +
          (await create(workspaces, {
            name: "Equipe",
            timeZone: "America/Sao_Paulo",
          }));
        const boardId = await create(workspace + "/boards", {
          name: "Planejamento",
          description: "Privado",
        });
        const board = workspace + "/boards/" + boardId;
        const members = board + "/members";
        const lists = board + "/lists";
        const list = await create(lists, { name: "Entrega" });
        const cards = lists + "/" + list + "/cards";
        const cardA = await create(cards, { title: "Cartão um" });
        const cardB = await create(cards, { title: "Cartão dois" });
        for (const [account, role] of [
          [member, "MEMBER"],
          [deputy, "ADMIN"],
        ]) {
          check(
            (
              await request(admin, workspace + "/members", {
                email: account.email,
                role: "MEMBER",
              })
            ).status() === 204,
          );
          check(
            (
              await request(admin, members, { email: account.email, role })
            ).status() === 204,
          );
        }
        const change = (
          account,
          expectedRole,
          role,
          operationId = randomUUID(),
        ) => ({
          accountId: account.id,
          expectedRole,
          role,
          operationId,
        });
        const write = (tab, mutation) =>
          request(tab, members + "/change", mutation);
        check(
          (
            await write(participant, change(member, "MEMBER", "ADMIN"))
          ).status() === 403,
        );
        const assign = (
          tab,
          card,
          account,
          assigned = true,
          operationId = randomUUID(),
        ) =>
          request(tab, cards + "/" + card + "/assignees", {
            accountId: account.id,
            assigned,
            operationId,
          });
        const impact = async () =>
          await (
            await get(admin, members + "/" + member.id + "/assignment-impact")
          ).json();
        await open(admin, board);
        const article = admin.page.getByRole("article").filter({
          has: admin.page.getByRole("heading", { name: "Cartão um" }),
        });
        await article
          .getByLabel("Adicionar responsável")
          .selectOption(owner.id);
        await article
          .getByRole("button", { name: "Atribuir", exact: true })
          .click();
        await expect(
          article.getByRole("button", {
            name: "Remover responsável " + owner.email,
          }),
        ).toBeVisible();
        check((await assign(participant, cardA, member)).status() === 204);
        const authoredComments = cards + "/" + cardA + "/comments";
        check(
          (
            await request(participant, authoredComments, {
              kind: "CREATE",
              content: "Histórico sintético",
              operationId: randomUUID(),
            })
          ).status() === 204,
        );
        const oldImpact = await impact();
        check(
          oldImpact.count === 1 &&
            Object.keys(oldImpact).sort().join(",") === "count,token",
        );
        check((await assign(admin, cardA, member, false)).status() === 204);
        check((await assign(admin, cardB, member)).status() === 204);
        const newImpact = await impact();
        check(
          newImpact.count === oldImpact.count &&
            newImpact.token !== oldImpact.token,
        );
        check(
          (
            await write(admin, {
              ...change(member, "MEMBER", "OBSERVER"),
              impactToken: oldImpact.token,
              confirmAssignments: true,
            })
          ).status() === 409,
        );
        check(
          (
            await write(admin, {
              ...change(member, "MEMBER", "OBSERVER"),
              impactToken: newImpact.token,
            })
          ).status() === 409,
        );
        await open(participant, board);
        await expect(
          participant.page.getByRole("button", { name: "Criar lista" }),
        ).toBeVisible();
        await open(admin, members);
        async function manage(option) {
          await admin.page
            .getByLabel("Alterar acesso de " + member.email, { exact: true })
            .selectOption(option);
          await admin.page
            .getByRole("listitem")
            .filter({ hasText: member.email })
            .getByRole("button", { name: "Revisar alteração" })
            .click();
          const confirmImpact = admin.page.getByRole("checkbox", {
            name: "Confirmo a remoção das atribuições",
          });
          await expect(confirmImpact).toBeVisible();
          await expect(
            admin.page.getByRole("button", { name: "Confirmar alteração" }),
          ).toBeDisabled();
          await confirmImpact.check();
          await admin.page
            .getByRole("button", { name: "Confirmar alteração" })
            .click();
        }
        await manage("OBSERVER");
        await expect(admin.page.getByText("Papel atualizado.")).toBeVisible();
        await expect(
          participant.page.getByRole("button", { name: "Criar lista" }),
        ).toHaveCount(0, { timeout: 10000 });
        await expect(
          participant.page.getByRole("heading", { name: "Entrega" }),
        ).toBeVisible();
        check(
          (
            await request(participant, lists, {
              name: "Negada",
              operationId: randomUUID(),
            })
          ).status() === 403,
        );
        check(
          (await write(admin, change(member, "MEMBER", "ADMIN"))).status() ===
            409,
        );

        check((await impact()).count === 0);
        check((await assign(admin, cardA, member)).status() === 403);
        check((await assign(participant, cardB, owner)).status() === 403);
        const readAssignees = async () =>
          (await (await get(admin, lists)).json()).lists
            .flatMap(({ cards }) => cards)
            .flatMap(({ assignees }) => assignees);
        check(
          (await readAssignees())
            .map(({ accountId }) => accountId)
            .join(",") === owner.id,
        );
        check(
          (
            await write(admin, change(member, "OBSERVER", "MEMBER"))
          ).status() === 204,
        );
        check((await impact()).count === 0);
        const assignmentId = randomUUID();
        check(
          (await assign(admin, cardA, member, true, assignmentId)).status() ===
            204,
        );
        check(
          (await assign(admin, cardA, member, true, assignmentId)).status() ===
            204,
        );
        check((await readAssignees()).length === 2);
        const remove = {
          ...change(member, "MEMBER", null),
          impactToken: (await impact()).token,
          confirmAssignments: true,
        };
        for (const table of ["audit_event", "board_feed_event"]) {
          const revision = await (
            await get(participant, lists + "/revision")
          ).json();
          await migrator.query(`CREATE FUNCTION public.e2e_reject_member_change() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic membership failure'; END; $$;
          CREATE TRIGGER e2e_reject_member_change BEFORE INSERT ON public.${table}
          FOR EACH ROW WHEN (NEW.operation='BOARD_MEMBER_REMOVED') EXECUTE FUNCTION public.e2e_reject_member_change();`);
          try {
            check((await write(admin, remove)).status() === 500);
            check(
              JSON.stringify(
                await (await get(participant, lists + "/revision")).json(),
              ) === JSON.stringify(revision),
            );
            check((await get(participant, lists)).status() === 200);
            check((await impact()).count === 1);
          } finally {
            await migrator.query(`DROP TRIGGER e2e_reject_member_change ON public.${table};
            DROP FUNCTION public.e2e_reject_member_change();`);
          }
        }
        await open(admin, members);
        // Drop the successful response and repeat the exact operation.
        let original;
        await admin.page.route(
          origin + members + "/change",
          async (intercepted) => {
            original = intercepted.request().postDataJSON();
            check((await intercepted.fetch()).status() === 204);
            await intercepted.abort();
          },
          { times: 1 },
        );
        await manage("REMOVE");
        await expect(
          admin.page.getByText("Repita a confirmação", { exact: false }),
        ).toBeVisible();
        await admin.page
          .getByRole("button", { name: "Confirmar alteração" })
          .click();
        await expect(
          admin.page.getByText("Participante removido."),
        ).toBeVisible();
        check(
          (await write(admin, { ...original, role: "MEMBER" })).status() ===
            409,
        );
        await expect(
          participant.page.getByText("Recurso indisponível."),
        ).toBeVisible({ timeout: 10000 });
        await expect(
          participant.page.getByRole("heading", { name: "Planejamento" }),
        ).toHaveCount(0);
        check((await get(participant, lists)).status() === 404);
        check((await get(participant, workspace + "/boards")).status() === 200);
        await open(participant, board);
        await expect(
          participant.page.getByText("Recurso indisponível."),
        ).toBeVisible();
        const history = await migrator.query(
          "SELECT operation, count(*)::int AS total FROM public.audit_event WHERE entity_id=$1 AND operation IN ('BOARD_MEMBER_ROLE_CHANGED','BOARD_MEMBER_REMOVED') GROUP BY operation",
          [boardId],
        );
        check(
          history.rows.find(
            ({ operation }) => operation === "BOARD_MEMBER_ROLE_CHANGED",
          ).total === 2,
        );
        check(
          history.rows.find(
            ({ operation }) => operation === "BOARD_MEMBER_REMOVED",
          ).total === 1,
        );
        check(
          (await readAssignees())
            .map(({ accountId }) => accountId)
            .join(",") === owner.id,
        );
        const retainedComments = (
          await (await get(admin, authoredComments)).json()
        ).comments;
        check(
          retainedComments.length === 1 &&
            retainedComments[0].author === member.email &&
            retainedComments[0].content === "Histórico sintético",
        );
        const assignmentHistory = await migrator.query(
          "SELECT count(*)::int AS n FROM public.audit_event WHERE operation='CARD_ASSIGNEE_REMOVED' AND before_data->>'accountId'=$1",
          [member.id],
        );
        check(assignmentHistory.rows[0].n === 3);

        await migrator.query("BEGIN");
        let competing;
        try {
          await migrator.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["bello-members:" + boardId],
          );
          competing = Promise.all([
            write(admin, change(owner, "ADMIN", "MEMBER")),
            write(admin, change(deputy, "ADMIN", null)),
          ]);
          let waiting = false;
          for (let attempt = 0; attempt < 60; attempt++) {
            const { rows } = await migrator.query(
              "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
            );
            if (rows[0].n >= 2) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          check(waiting);
        } finally {
          await migrator.query("ROLLBACK");
        }
        check(
          (await competing)
            .map((response) => response.status())
            .sort()
            .join(",") === "204,409",
        );
        const final = await (await get(admin, members)).json();
        check(
          final.members.filter(({ role }) => role === "ADMIN").length === 1,
        );
      } finally {
        await Promise.all([admin.context.close(), participant.context.close()]);
      }
    },
  );

  await scenario("WebSocket revisions, recovery and revocation", async () => {
    const [owner, reader] = await Promise.all([fixture(), fixture()]);
    const [admin, observer] = await Promise.all([pageFor(), pageFor()]);
    const headers = { "X-Bello-Flow-Request": "1", Origin: origin };
    const post = (path, data) =>
      admin.context.request.post(origin + path, { headers, data });
    const create = async (path, data) => {
      const response = await post(path, { ...data, operationId: randomUUID() });
      check(response.status() === 201);
      return (await response.json()).id;
    };
    try {
      await login(admin.page, owner);
      await login(observer.page, reader);
      const workspace =
        "/api/workspaces/" +
        (await create("/api/workspaces", {
          name: "Tempo real",
          timeZone: "Etc/UTC",
        }));
      const boardId = await create(workspace + "/boards", {
        name: "Ao vivo",
        description: "Validação WebSocket",
      });
      const board = workspace + "/boards/" + boardId;
      const lists = board + "/lists";
      check(
        (
          await post(workspace + "/members", {
            email: reader.email,
            role: "MEMBER",
          })
        ).status() === 204,
      );

      const socketUrl =
        origin.replace(/^https/, "wss") +
        "/api/realtime?" +
        new URLSearchParams({
          workspaceId: workspace.split("/").at(-1),
          boardId,
        });
      const forbiddenCode = await timeout(
        observer.page.evaluate(
          (url) =>
            new Promise((resolve) => {
              const socket = new WebSocket(url);
              socket.onopen = () => {
                resolve(101);
                socket.close();
              };
              socket.onclose = (event) => resolve(event.code);
            }),
          socketUrl,
        ),
      );
      check(forbiddenCode === 1006);
      check(
        (
          await post(board + "/members", {
            email: reader.email,
            role: "OBSERVER",
          })
        ).status() === 204,
      );

      const received = [];
      const closed = [];
      let disconnect;
      let connect = true;
      let attempts = 0;
      await observer.page.routeWebSocket(socketUrl, (client) => {
        attempts++;
        if (!connect) {
          client.close({ code: 1012 });
          return;
        }
        const server = client.connectToServer();
        disconnect = () => server.close({ code: 3001 });
        server.onMessage((message) => {
          received.push(JSON.parse(message.toString()));
          client.send(message);
        });
        server.onClose((code, reason) => {
          closed.push(code);
          client.close({ code, reason });
        });
      });
      await observer.page.route(origin + lists + "/revision", (route) =>
        route.abort(),
      );
      await observer.page.goto(origin + board.replace(/^\/api/, ""));
      await expect.poll(() => received.length).toBeGreaterThan(0);
      check(Object.keys(received[0]).sort().join() === "boardId,revision");
      check(received[0].boardId === boardId);
      const first = received[0].revision;
      const sessionAged = await migrator.query(
        `UPDATE public.auth_session SET created_at=created_at-interval '6 minutes',
          last_activity_at=last_activity_at-interval '6 minutes',
          absolute_expires_at=absolute_expires_at-interval '6 minutes'
          WHERE account_id=$1 RETURNING last_activity_at`,
        [reader.id],
      );
      check(sessionAged.rowCount === 1);
      await create(lists, { name: "Lista ao vivo" });
      await expect.poll(() => received.at(-1)?.revision).toBe(first + 1);
      await expect(
        observer.page.getByRole("heading", { name: "Lista ao vivo" }),
      ).toBeVisible();
      connect = false;
      disconnect();
      await expect.poll(() => attempts).toBeGreaterThan(1);
      await create(lists, { name: "Lista durante a queda" });
      connect = true;
      await expect
        .poll(() => received.at(-1)?.revision, { timeout: timeLimit })
        .toBe(first + 2);
      await expect(
        observer.page.getByRole("heading", { name: "Lista durante a queda" }),
      ).toBeVisible();

      check(
        (
          await post(board + "/members/change", {
            accountId: reader.id,
            expectedRole: "OBSERVER",
            role: null,
            operationId: randomUUID(),
          })
        ).status() === 204,
      );
      await expect.poll(() => closed).toContain(1008);
      await expect(
        observer.page.getByRole("heading", { name: "Lista ao vivo" }),
      ).toHaveCount(0);
      check(received.at(-1).revision === first + 2);
      const sessionAfterSync = await migrator.query(
        "SELECT last_activity_at FROM public.auth_session WHERE account_id=$1",
        [reader.id],
      );
      check(
        sessionAfterSync.rows[0].last_activity_at.getTime() ===
          sessionAged.rows[0].last_activity_at.getTime(),
      );

      check(
        (
          await post(board + "/members", {
            email: reader.email,
            role: "OBSERVER",
          })
        ).status() === 204,
      );
      const noticesBeforeReopen = received.length;
      await observer.page.goto(origin + board.replace(/^\/api/, ""));
      await expect
        .poll(() => received.length)
        .toBeGreaterThan(noticesBeforeReopen);
      const closesBeforeLogout = closed.length;
      check(
        (
          await observer.context.request.post(origin + "/api/auth/logout", {
            headers,
          })
        ).status() === 204,
      );
      await expect.poll(() => closed.slice(closesBeforeLogout)).toContain(1008);
      await expect(
        observer.page.getByRole("heading", { name: "Lista ao vivo" }),
      ).toHaveCount(0);
      check(observer.errors.length === 0);
    } finally {
      await Promise.all([admin.context.close(), observer.context.close()]);
    }
  });

  await scenario("card archive, restoration, scope and rollback", async () => {
    const [owner, reader] = await Promise.all([fixture(), fixture()]);
    const [admin, observer] = await Promise.all([pageFor(), pageFor()]);
    const headers = { "X-Bello-Flow-Request": "1", Origin: origin };
    const post = (path, data, tab = admin) =>
      tab.context.request.post(origin + path, { headers, data });
    const create = async (path, data) => {
      const response = await post(path, { ...data, operationId: randomUUID() });
      check(response.status() === 201);
      return (await response.json()).id;
    };
    try {
      await login(admin.page, owner);
      await login(observer.page, reader);
      const workspace =
        "/api/workspaces/" +
        (await create("/api/workspaces", {
          name: "Ciclo de vida",
          timeZone: "Etc/UTC",
        }));
      const board =
        workspace +
        "/boards/" +
        (await create(workspace + "/boards", {
          name: "Arquivo",
          description: "Validação do ciclo de vida",
        }));
      const lists = board + "/lists";
      const list = await create(lists, { name: "Fila" });
      const cards = lists + "/" + list + "/cards";
      const first = await create(cards, { title: "Primeiro" });
      const target = await create(cards, {
        title: "Preservado",
        description: "Descrição preservada",
      });
      const last = await create(cards, { title: "Último" });
      const move = await create(cards, { title: "Movido" });
      const card = cards + "/" + target;
      const read = async () => {
        const response = await admin.context.request.get(origin + lists, {
          headers,
        });
        check(response.status() === 200);
        return (await response.json()).lists[0];
      };
      const attempt = { archived: true, operationId: randomUUID() };
      const archive = (data = attempt, tab = admin) =>
        post(card + "/archive", data, tab);
      check(
        (
          await post(card + "/schedule", {
            completed: true,
            operationId: randomUUID(),
          })
        ).status() === 204,
      );
      check(
        (
          await post(card + "/comments", {
            kind: "CREATE",
            content: "Comentário preservado",
            operationId: randomUUID(),
          })
        ).status() === 204,
      );
      check(
        (
          await post(workspace + "/members", {
            email: reader.email,
            role: "MEMBER",
          })
        ).status() === 204,
      );
      check((await archive(attempt, observer)).status() === 404);
      check(
        (
          await post(board + "/members", {
            email: reader.email,
            role: "OBSERVER",
          })
        ).status() === 204,
      );
      check((await archive(attempt, observer)).status() === 403);
      const labelId = await create(workspace + "/labels", {
        name: "Preservada",
      });
      const label = { labelId, applied: true };
      const assignment = { accountId: owner.id, assigned: true };
      const change = (action, fields) =>
        post(card + "/" + action, { ...fields, operationId: randomUUID() });
      check((await change("labels", label)).status() === 204);
      check((await change("assignees", assignment)).status() === 204);
      const privileges = await migrator.query(`SELECT
        has_column_privilege('bello_runtime','public.board_card','archived','UPDATE') AS archive,
        has_table_privilege('bello_runtime','public.board_card','UPDATE') AS full_update,
        has_table_privilege('bello_runtime','public.board_card','DELETE') AS remove`);
      check(
        privileges.rows[0].archive &&
          !privileges.rows[0].full_update &&
          !privileges.rows[0].remove,
      );
      const original = await read();
      for (const table of ["audit_event", "board_feed_event"]) {
        await migrator.query(`CREATE FUNCTION public.e2e_reject_archive() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic archive failure'; END; $$;
          CREATE TRIGGER e2e_reject_archive BEFORE INSERT ON public.${table}
          FOR EACH ROW WHEN (NEW.operation = 'CARD_ARCHIVED') EXECUTE FUNCTION public.e2e_reject_archive();`);
        try {
          check((await archive()).status() === 500);
          check(JSON.stringify(await read()) === JSON.stringify(original));
        } finally {
          await migrator.query(`DROP TRIGGER e2e_reject_archive ON public.${table};
            DROP FUNCTION public.e2e_reject_archive();`);
        }
      }
      const parallel = await Promise.all([archive(), archive()]);
      check(parallel.every((response) => response.status() === 204));
      const active = await read();
      check(
        active.cards.map(({ id }) => id).join() === [first, last, move].join(),
      );
      check(active.archivedCards[0].id === target);
      check(
        active.archivedCards[0].completedAt === original.cards[1].completedAt,
      );
      check(
        (
          await admin.context.request.patch(origin + card, {
            headers,
            data: { title: "Indevido" },
          })
        ).status() === 403,
      );
      check(
        (
          await post(card + "/schedule", {
            completed: false,
            operationId: randomUUID(),
          })
        ).status() === 403,
      );

      for (const [action, fields] of [
        ["labels", { ...label, applied: false }],
        ["assignees", { ...assignment, assigned: false }],
        ["comments", { kind: "CREATE", content: "Comentário indevido" }],
      ]) {
        check((await change(action, fields)).status() === 403);
      }
      const moveWithinList = (itemId, itemRevision) =>
        post(lists + "/move", {
          kind: "CARD",
          itemId,
          leftId: first,
          rightId: last,
          sourceId: list,
          destinationId: list,
          itemRevision,
          sourceRevision: active.cardOrderRevision,
          destinationRevision: active.cardOrderRevision,
          operationId: randomUUID(),
        });
      check(
        (
          await moveWithinList(target, active.archivedCards[0].positionRevision)
        ).status() === 403,
      );

      const boardUrl = origin + board.replace(/^\/api/, "");
      await observer.page.goto(boardUrl);
      await expect(
        observer.page.getByRole("heading", { name: "Primeiro" }),
      ).toBeVisible();
      await expect(
        observer.page.getByRole("heading", { name: "Preservado" }),
      ).toHaveCount(0);
      await observer.page
        .getByRole("button", { name: "Cartões arquivados (1)" })
        .click();
      await expect(
        observer.page.getByText("Descrição preservada"),
      ).toBeVisible();
      await expect(
        observer.page.getByRole("button", { name: "Restaurar cartão" }),
      ).toHaveCount(0);
      await observer.page
        .getByRole("article")
        .filter({ hasText: "Descrição preservada" })
        .getByRole("button", { name: "Comentários" })
        .click();
      await expect(
        observer.page.getByText("Comentário preservado"),
      ).toBeVisible();

      check(
        (
          await moveWithinList(move, active.cards[2].positionRevision)
        ).status() === 204,
      );

      await admin.page.goto(boardUrl);
      await admin.page
        .getByRole("button", { name: "Cartões arquivados (1)" })
        .click();
      await admin.page
        .getByRole("button", { name: "Restaurar cartão" })
        .click();
      await expect(
        admin.page.getByText("Cartão restaurado.", { exact: true }),
      ).toBeVisible();
      await admin.page.reload();
      await expect(
        admin.page.getByRole("heading", { name: "Preservado" }),
      ).toBeVisible();
      check((await archive()).status() === 204);
      const restored = await read();
      check(restored.archivedCards.length === 0);
      check(
        restored.cards.map(({ id }) => id).join() ===
          [first, move, target, last].join(),
      );
      check(restored.cards[2].completedAt === original.cards[1].completedAt);
      check(restored.cards[2].labels[0].id === labelId);
      check(restored.cards[2].assignees[0].accountId === owner.id);
      for (const table of ["audit_event", "board_feed_event"]) {
        const eventIdColumn = table === "audit_event" ? "entity_id" : "card_id";
        const events = await migrator.query(
          `SELECT operation FROM public.${table}
          WHERE ${eventIdColumn}=$1 AND operation IN ('CARD_ARCHIVED','CARD_RESTORED') ORDER BY operation`,
          [target],
        );
        check(
          events.rows.map(({ operation }) => operation).join() ===
            "CARD_ARCHIVED,CARD_RESTORED",
        );
      }
    } finally {
      await Promise.all([admin.context.close(), observer.context.close()]);
    }
  });

  await scenario(
    "list archive preserves card states and reserved order",
    async () => {
      const [owner, reader] = await Promise.all([fixture(), fixture()]);
      const [admin, observer] = await Promise.all([pageFor(), pageFor()]);
      const headers = { "X-Bello-Flow-Request": "1", Origin: origin };
      const post = (path, data, tab = admin) =>
        tab.context.request.post(origin + path, { headers, data });
      const create = async (path, data) => {
        const response = await post(path, {
          ...data,
          operationId: randomUUID(),
        });
        check(response.status() === 201);
        return (await response.json()).id;
      };
      const change = (path, data, tab = admin) =>
        post(path, { ...data, operationId: randomUUID() }, tab);
      try {
        await login(admin.page, owner);
        await login(observer.page, reader);
        const workspace =
          "/api/workspaces/" +
          (await create("/api/workspaces", {
            name: "Ciclo de listas",
            timeZone: "Etc/UTC",
          }));
        const boardId = await create(workspace + "/boards", {
          name: "Restaurar listas",
          description: "Validação do estado herdado",
        });
        const board = workspace + "/boards/" + boardId;
        const lists = board + "/lists";
        const first = await create(lists, { name: "Destino ativo" });
        const archived = await create(lists, { name: "Lista de origem" });
        const last = await create(lists, { name: "Última lista" });
        const move = await create(lists, { name: "Lista movida" });
        const source = lists + "/" + archived;
        const cards = source + "/cards";
        const activeCard = await create(cards, { title: "Volta com a lista" });
        const hiddenCard = await create(cards, { title: "Continua arquivado" });
        const extraction = await create(cards, {
          title: "Retirar sem restaurar lista",
        });
        check(
          (
            await change(cards + "/" + hiddenCard + "/archive", {
              archived: true,
            })
          ).status() === 204,
        );
        check(
          (
            await change(cards + "/" + extraction + "/comments", {
              kind: "CREATE",
              content: "Histórico preservado",
            })
          ).status() === 204,
        );

        const read = async (tab = admin) => {
          const response = await tab.context.request.get(origin + lists, {
            headers,
          });
          check(response.status() === 200);
          return response.json();
        };
        const listIntent = { archived: true, operationId: randomUUID() };
        check(
          (await post(source + "/archive", listIntent, observer)).status() ===
            404,
        );
        check(
          (
            await post(workspace + "/members", {
              email: reader.email,
              role: "MEMBER",
            })
          ).status() === 204,
        );
        check(
          (
            await post(board + "/members", {
              email: reader.email,
              role: "OBSERVER",
            })
          ).status() === 204,
        );
        check(
          (await post(source + "/archive", listIntent, observer)).status() ===
            403,
        );
        const previous = await read();
        for (const table of ["audit_event", "board_feed_event"]) {
          await migrator.query(`CREATE FUNCTION public.e2e_reject_list_archive() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic list archive failure'; END; $$;
          CREATE TRIGGER e2e_reject_list_archive BEFORE INSERT ON public.${table}
          FOR EACH ROW WHEN (NEW.operation = 'LIST_ARCHIVED') EXECUTE FUNCTION public.e2e_reject_list_archive();`);
          try {
            check(
              (await post(source + "/archive", listIntent)).status() === 500,
            );
            check(JSON.stringify(await read()) === JSON.stringify(previous));
          } finally {
            await migrator.query(`DROP TRIGGER e2e_reject_list_archive ON public.${table};
            DROP FUNCTION public.e2e_reject_list_archive();`);
          }
        }
        const responses = await Promise.all([
          post(source + "/archive", listIntent),
          post(source + "/archive", listIntent),
        ]);
        check(responses.every((response) => response.status() === 204));
        const archivedBoard = await read(observer);
        check(
          archivedBoard.lists.map(({ id }) => id).join() ===
            [first, last, move].join(),
        );
        const hidden = archivedBoard.archivedLists[0];
        check(hidden.id === archived && hidden.archived);
        check(
          hidden.cards.map(({ id }) => id).join() ===
            [activeCard, extraction].join(),
        );
        check(hidden.archivedCards[0].id === hiddenCard);
        check((await change(cards, { title: "Indevido" })).status() === 403);
        check(
          (
            await admin.context.request.patch(origin + source, {
              headers,
              data: { name: "Indevido" },
            })
          ).status() === 403,
        );
        check(
          (
            await admin.context.request.patch(
              origin + cards + "/" + activeCard,
              { headers, data: { title: "Indevido" } },
            )
          ).status() === 403,
        );
        check(
          (
            await change(cards + "/" + extraction + "/archive", {
              archived: false,
            })
          ).status() === 403,
        );
        check(
          (
            await change(cards + "/" + extraction + "/archive", {
              archived: false,
              destinationListId: archived,
            })
          ).status() === 403,
        );

        const listUrl = origin + board.replace(/^\/api/, "");
        await observer.page.goto(listUrl);
        await expect(
          observer.page.getByRole("heading", { name: "Destino ativo" }),
        ).toBeVisible();
        await expect(
          observer.page.getByRole("heading", { name: "Lista de origem" }),
        ).toHaveCount(0);
        await observer.page
          .getByRole("button", { name: "Listas arquivadas (1)" })
          .click();
        await expect(
          observer.page.getByRole("heading", { name: "Volta com a lista" }),
        ).toBeVisible();
        await expect(
          observer.page.getByRole("button", { name: "Restaurar lista" }),
        ).toHaveCount(0);

        check(
          (
            await change(lists + "/move", {
              kind: "LIST",
              itemId: move,
              leftId: first,
              rightId: last,
              sourceId: boardId,
              destinationId: boardId,
              itemRevision: archivedBoard.lists[2].positionRevision,
              sourceRevision: archivedBoard.orderRevision,
              destinationRevision: archivedBoard.orderRevision,
            })
          ).status() === 204,
        );
        await admin.page.goto(listUrl);
        await admin.page
          .getByRole("button", { name: "Listas arquivadas (1)" })
          .click();
        const extracted = admin.page
          .getByRole("article")
          .filter({ hasText: "Retirar sem restaurar lista" });
        await extracted
          .getByLabel("Restaurar em lista ativa")
          .selectOption(first);
        await extracted
          .getByRole("button", { name: "Restaurar cartão" })
          .click();
        await expect(
          admin.page.getByText("Cartão restaurado.", { exact: true }),
        ).toBeVisible();
        const afterMove = await read();
        check(afterMove.archivedLists[0].id === archived);
        check(afterMove.lists[0].cards[0].id === extraction);
        const comments = await admin.context.request.get(
          origin + lists + "/" + first + "/cards/" + extraction + "/comments",
          { headers },
        );
        check(comments.status() === 200);
        check(
          (await comments.json()).comments[0].content ===
            "Histórico preservado",
        );

        const restoreList = admin.page
          .getByRole("region", { name: "Lista de origem", exact: true })
          .getByRole("button", { name: "Restaurar lista", exact: true });
        await expect(restoreList).toBeEnabled();
        await restoreList.click();
        await expect(
          admin.page.getByText("Lista restaurada.", { exact: true }),
        ).toBeVisible();
        await admin.page.reload();
        await expect(
          admin.page.getByRole("heading", { name: "Volta com a lista" }),
        ).toBeVisible();
        await expect(
          admin.page.getByRole("heading", { name: "Continua arquivado" }),
        ).toHaveCount(0);
        check((await post(source + "/archive", listIntent)).status() === 204);
        const restored = await read();
        check(restored.archivedLists.length === 0);
        check(
          restored.lists.map(({ id }) => id).join() ===
            [first, move, archived, last].join(),
        );
        check(restored.lists[2].cards[0].id === activeCard);
        check(restored.lists[2].archivedCards[0].id === hiddenCard);
        const grants = await migrator.query(`SELECT
        has_column_privilege('bello_runtime','public.board_list','archived','UPDATE') AS archive,
        has_table_privilege('bello_runtime','public.board_list','UPDATE') AS full_update,
        has_table_privilege('bello_runtime','public.board_list','DELETE') AS remove`);
        check(
          grants.rows[0].archive &&
            !grants.rows[0].full_update &&
            !grants.rows[0].remove,
        );
      } finally {
        await Promise.all([admin.context.close(), observer.context.close()]);
      }
    },
  );

  await scenario(
    "board archive separates governance and freezes content",
    async () => {
      const accounts = await Promise.all([fixture(), fixture(), fixture()]);
      const [governor, owner, observer] = await Promise.all([
        pageFor(),
        pageFor(),
        pageFor(),
      ]);
      const tabs = [governor, owner, observer];
      const headers = { "X-Bello-Flow-Request": "1", Origin: origin };
      const post = (tab, path, data) =>
        tab.context.request.post(origin + path, { headers, data });
      const get = (tab, path) =>
        tab.context.request.get(origin + path, { headers });
      const create = async (tab, path, data) => {
        const response = await post(tab, path, {
          ...data,
          operationId: randomUUID(),
        });
        check(response.status() === 201);
        return (await response.json()).id;
      };
      try {
        for (const [index, tab] of tabs.entries())
          await login(tab.page, accounts[index]);
        const workspace =
          "/api/workspaces/" +
          (await create(governor, "/api/workspaces", {
            name: "Governança",
            timeZone: "Etc/UTC",
          }));
        for (const account of accounts.slice(1)) {
          check(
            (
              await post(governor, workspace + "/members", {
                email: account.email,
                role: "MEMBER",
              })
            ).status() === 204,
          );
        }
        const boards = workspace + "/boards";
        const boardId = await create(owner, boards, {
          name: "Quadro reservado",
          description: "Validação de arquivo",
        });
        const board = boards + "/" + boardId;
        const lists = board + "/lists";
        const list = await create(owner, lists, { name: "Lista operacional" });
        const hidden = await create(owner, lists, {
          name: "Lista arquivada antes",
        });
        const cards = lists + "/" + list + "/cards";
        const cardId = await create(owner, cards, {
          title: "Cartão preservado",
        });
        const card = cards + "/" + cardId;
        const labelId = await create(governor, workspace + "/labels", {
          name: "Etiqueta congelada",
        });
        check(
          (
            await post(owner, card + "/labels", {
              labelId,
              applied: true,
              operationId: randomUUID(),
            })
          ).status() === 204,
        );
        check(
          (
            await post(owner, lists + "/" + hidden + "/archive", {
              archived: true,
              operationId: randomUUID(),
            })
          ).status() === 204,
        );
        check(
          (
            await post(owner, board + "/members", {
              email: accounts[2].email,
              role: "OBSERVER",
            })
          ).status() === 204,
        );
        const archiveIntent = { archived: true, operationId: randomUUID() };
        const archive = (tab, data = archiveIntent) =>
          post(tab, board + "/archive", data);
        check((await get(governor, board)).status() === 403);
        check((await get(governor, lists)).status() === 404);
        const managed = await (
          await get(governor, boards + "/lifecycle")
        ).json();
        check(
          managed.archivedBoards.length === 0 &&
            managed.managedBoards.length === 1,
        );
        check(
          Object.keys(managed.managedBoards[0]).sort().join() ===
            "archived,id,name",
        );
        check(managed.managedBoards[0].id === boardId);
        check((await archive(observer)).status() === 403);
        const state = async () => (await get(owner, lists)).json();
        const original = await state();
        for (const table of ["audit_event", "board_feed_event"]) {
          await migrator.query(`CREATE FUNCTION public.e2e_reject_board_archive() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic board archive failure'; END; $$;
          CREATE TRIGGER e2e_reject_board_archive BEFORE INSERT ON public.${table}
          FOR EACH ROW WHEN (NEW.operation = 'BOARD_ARCHIVED') EXECUTE FUNCTION public.e2e_reject_board_archive();`);
          try {
            check((await archive(governor)).status() === 500);
            check(JSON.stringify(await state()) === JSON.stringify(original));
          } finally {
            await migrator.query(`DROP TRIGGER e2e_reject_board_archive ON public.${table};
            DROP FUNCTION public.e2e_reject_board_archive();`);
          }
        }

        const boardUrl = origin + board.replace(/^\/api/, "");
        await owner.page.goto(boardUrl);
        await expect(
          owner.page.getByRole("heading", { name: "Cartão preservado" }),
        ).toBeVisible();
        let write;
        await migrator.query(`SELECT pg_advisory_lock(47140);
        CREATE FUNCTION public.e2e_pause_list_creation() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(47140); RETURN NEW; END; $$;
        CREATE TRIGGER e2e_pause_list_creation BEFORE INSERT ON public.board_list
          FOR EACH ROW WHEN (NEW.name = 'Escrita em corrida') EXECUTE FUNCTION public.e2e_pause_list_creation();`);
        try {
          write = post(owner, lists, {
            name: "Escrita em corrida",
            operationId: randomUUID(),
          });
          await expect
            .poll(
              async () =>
                (
                  await migrator.query(`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=47140
          AND objsubid=1 AND NOT granted) AS waiting`)
                ).rows[0].waiting,
              {
                timeout: 3000,
                intervals: [25, 50, 100],
              },
            )
            .toBe(true);
          check((await archive(governor)).status() === 204);
        } finally {
          await migrator.query("SELECT pg_advisory_unlock(47140)");
          const response = await write;
          await migrator.query(`DROP TRIGGER e2e_pause_list_creation ON public.board_list;
          DROP FUNCTION public.e2e_pause_list_creation();`);
          check(response.status() === 403);
        }
        check((await archive(governor)).status() === 204);
        await expect(
          owner.page.getByText("Quadro arquivado", { exact: true }),
        ).toBeVisible();
        await expect(
          owner.page.getByRole("button", { name: "Criar cartão", exact: true }),
        ).toHaveCount(0);
        const frozen = await state();
        check(frozen.archived && !frozen.editable);
        check(frozen.lists.length === 1 && frozen.lists[0].id === list);
        check(frozen.archivedLists[0].id === hidden);
        check(frozen.lists[0].cards[0].labels[0].id === labelId);
        check((await get(governor, board)).status() === 403);
        check((await get(governor, lists)).status() === 404);
        check((await get(observer, lists)).status() === 200);
        check((await get(owner, boards)).status() === 200);
        check((await (await get(owner, boards)).json()).length === 0);
        const archivedOwned = await (
          await get(owner, boards + "/lifecycle")
        ).json();
        check(archivedOwned.archivedBoards[0].id === boardId);
        check(
          (
            await post(owner, card + "/comments", {
              kind: "CREATE",
              content: "Indevido",
              operationId: randomUUID(),
            })
          ).status() === 403,
        );
        check(
          (
            await post(owner, card + "/labels", {
              labelId,
              applied: false,
              operationId: randomUUID(),
            })
          ).status() === 403,
        );
        check(
          (
            await governor.context.request.patch(
              origin + workspace + "/labels/" + labelId,
              {
                headers,
                data: {
                  name: "Etiqueta atualizada",
                  operationId: randomUUID(),
                },
              },
            )
          ).status() === 200,
        );
        check(
          (await state()).lists[0].cards[0].labels[0].name ===
            "Etiqueta atualizada",
        );

        await owner.page
          .getByRole("button", { name: "Restaurar quadro", exact: true })
          .click();
        await expect(
          owner.page.getByText("Quadro restaurado.", { exact: true }),
        ).toBeVisible();
        const restored = await state();
        check(
          !restored.archived &&
            restored.editable &&
            restored.archivedLists[0].id === hidden,
        );
        check(
          (await (await get(owner, board + "/members")).json()).members
            .length === 2,
        );
        await governor.page.goto(origin + workspace.replace(/^\/api/, ""));
        await expect(
          governor.page.getByRole("heading", {
            name: "Governança dos quadros",
          }),
        ).toBeVisible();
        await expect(
          governor.page.getByRole("link", { name: "Quadro reservado" }),
        ).toHaveCount(0);
        await governor.page
          .getByRole("button", { name: "Arquivar quadro", exact: true })
          .click();
        await expect(
          governor.page.getByRole("button", {
            name: "Restaurar quadro",
            exact: true,
          }),
        ).toBeVisible();
        check(
          (
            await post(owner, board + "/members/change", {
              accountId: accounts[2].id,
              expectedRole: "OBSERVER",
              role: null,
              operationId: randomUUID(),
            })
          ).status() === 204,
        );
        check((await get(observer, lists)).status() === 404);
        const grants = await migrator.query(`SELECT
        has_column_privilege('bello_runtime','public.board','archived','UPDATE') AS archive,
        has_table_privilege('bello_runtime','public.board','UPDATE') AS full_update,
        has_table_privilege('bello_runtime','public.board','DELETE') AS remove`);
        check(
          grants.rows[0].archive &&
            !grants.rows[0].full_update &&
            !grants.rows[0].remove,
        );
      } finally {
        await Promise.all(tabs.map((tab) => tab.context.close()));
      }
    },
  );

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
