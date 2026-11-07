import { cleanup } from "./resources.mjs";
// Only resources with this run's random identity may be removed.
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const arguments_ = process.argv.slice(2);
if (
  arguments_.length > 1 ||
  arguments_.some(
    (value) =>
      ![
        "--local",
        "--local-smoke",
        "--local-check",
        "--recovery",
        "--recovery-smoke",
        "--recovery-check",
      ].includes(value),
  )
) {
  console.error(
    "Modo inválido. Consulte os comandos documentados de E2E e homologação.",
  );
  process.exit(1);
}
const recovery =
  process.argv.includes("--recovery") ||
  process.argv.includes("--recovery-smoke") ||
  process.argv.includes("--recovery-check");
const port = recovery ? 15444 : 15443;
const origin = "https://127.0.0.1:" + port;
const localCheck =
  process.argv.includes("--local-check") ||
  process.argv.includes("--recovery-check");
const local =
  process.argv.includes("--local") ||
  process.argv.includes("--recovery") ||
  localCheck;
const smoke =
  process.argv.includes("--local-smoke") ||
  process.argv.includes("--recovery-smoke");
let keep = false;
const run = "bello-e2e-" + randomUUID();
const label = "bello.e2e.run=" + run;
const image = run + ":test";
const database = run + "-db";
const runner = run + "-runner";
const network = run + "-net";
const environment = { ...process.env };
for (const name of [
  "POSTGRES_PASSWORD",
  "BELLO_DEV_APP_PASSWORD",
  "BELLO_DEV_MIGRATOR_PASSWORD",
  "BELLO_DEV_BOOTSTRAP_PASSWORD",
  "BELLO_DEV_AUDIT_MAINTENANCE_PASSWORD",
  "BELLO_SHADOW_MIGRATOR_PASSWORD",
  "BELLO_TEST_APP_PASSWORD",
  "BELLO_TEST_MIGRATOR_PASSWORD",
  "BELLO_TEST_BOOTSTRAP_PASSWORD",
  "BELLO_TEST_AUDIT_MAINTENANCE_PASSWORD",
]) {
  environment[name] = randomBytes(24).toString("hex");
}
environment.POSTGRES_USER = "bello_admin";
environment.POSTGRES_DB = "postgres";
environment.BELLO_E2E_RUN = run;
environment.BELLO_RECOVERY_REHEARSAL = recovery ? "true" : "false";
environment.BELLO_REHEARSAL_SIMULATION = recovery && smoke ? "true" : "false";
environment.BELLO_LOCAL_ONLY = local || smoke ? "true" : "false";
const owned = [];
const extraNetworks = [];
const frontend = run + "-front";
let networkCreated = false;
function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    env: environment,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) throw new Error("Docker operation failed");
  return result.stdout?.trim() ?? "";
}
let status = 0;
try {
  docker(
    ["build", "--label", label, "-t", image, "-f", "infra/e2e/Dockerfile", "."],
    { stdio: "inherit" },
  );
  owned.push(["image", image]);
  docker(["network", "create", "--internal", "--label", label, network]);
  networkCreated = true;
  if (local) {
    docker(["network", "create", "--label", label, frontend]);
    extraNetworks.push(frontend);
  }
  const dbEnv = Object.keys(environment)
    .filter(
      (name) =>
        name === "POSTGRES_PASSWORD" ||
        name === "POSTGRES_USER" ||
        name === "POSTGRES_DB" ||
        (name.startsWith("BELLO_") && name.endsWith("_PASSWORD")),
    )
    .flatMap((name) => ["--env", name]);
  docker([
    "run",
    "--detach",
    "--name",
    database,
    "--label",
    label,
    "--network",
    network,
    "--network-alias",
    "database",
    "--tmpfs",
    "/var/lib/postgresql:rw",
    ...dbEnv,
    "postgres:18.6-bookworm",
  ]);
  owned.push(["container", database]);
  // Readiness is operational polling, never evidence about concurrency.
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync(
      "docker",
      [
        "exec",
        database,
        "pg_isready",
        "-q",
        "-U",
        "bello_admin",
        "-d",
        "postgres",
      ],
      { stdio: "ignore" },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("PostgreSQL readiness failed");
  const { readFileSync } = await import("node:fs");
  docker(["exec", "-i", database, "bash", "-s"], {
    input: readFileSync("infra/postgres/init/01-init-databases.sh", "utf8"),
  });
  const proof = JSON.parse(docker(["container", "inspect", database]))[0];
  if (
    proof.Config.Labels["bello.e2e.run"] !== run ||
    proof.HostConfig.Tmpfs["/var/lib/postgresql"] !== "rw" ||
    Object.keys(proof.HostConfig.PortBindings ?? {}).length !== 0
  )
    throw new Error("Database isolation not proved");
  const container = docker([
    "create",
    "--name",
    runner,
    "--label",
    label,
    "--network",
    local ? frontend : network,
    "--shm-size",
    "1g",
    ...(local ? ["--publish", "127.0.0.1:" + port + ":" + port] : []),
    "--env",
    "BELLO_E2E_RUN",
    "--env",
    "BELLO_LOCAL_ONLY",
    "--env",
    "BELLO_RECOVERY_REHEARSAL",
    "--env",
    "BELLO_REHEARSAL_SIMULATION",
    "--env",
    "BELLO_TEST_APP_PASSWORD",
    "--env",
    "BELLO_TEST_MIGRATOR_PASSWORD",
    image,
    ...(local || smoke
      ? [
          "node",
          "scripts/e2e/local.mjs",
          ...(smoke ? ["--smoke"] : []),
          ...(recovery ? ["--recovery"] : []),
        ]
      : []),
  ]);
  if (!container) throw new Error("Runner creation failed");
  owned.push(["container", runner]);
  if (local) docker(["network", "connect", network, runner]);
  if (local) {
    const bindings = JSON.parse(docker(["inspect", runner]))[0].HostConfig
      .PortBindings;
    if (
      Object.keys(bindings).length !== 1 ||
      bindings[port + "/tcp"]?.length !== 1 ||
      bindings[port + "/tcp"][0].HostIp !== "127.0.0.1" ||
      bindings[port + "/tcp"][0].HostPort !== String(port)
    )
      throw new Error("Loopback binding not proved");
    docker(["start", runner]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (docker(["logs", runner]).includes("LOCAL_READY")) {
        ready = true;
        break;
      }
      if (
        docker(["inspect", "--format", "{{.State.Running}}", runner]) !== "true"
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error("Local startup failed");
    const effective = JSON.parse(docker(["inspect", runner]))[0].NetworkSettings
      .Ports[port + "/tcp"];
    if (effective?.length !== 1 || effective[0].HostIp !== "127.0.0.1")
      throw new Error("Effective loopback publication not proved");
    if (localCheck) {
      const { get } = await import("node:https");
      for (const path of ["/health/live", "/login"]) {
        await new Promise((resolve, reject) => {
          const req = get(
            origin + path,
            { rejectUnauthorized: false },
            (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () =>
                res.statusCode === 200 &&
                (path === "/login"
                  ? body.includes("<app-root>")
                  : body === '{"status":"ok"}')
                  ? resolve()
                  : reject(new Error()),
              );
            },
          );
          req.on("error", reject);
          req.setTimeout(10000, () => req.destroy(new Error()));
        });
      }
      console.log(
        "PASS publicação loopback: health e shell Angular via HTTPS no host.",
      );
    }
    keep = !localCheck;
    if (!localCheck) {
      console.log("HTTPS local: " + origin);
      console.log(
        "API sem envio automático. Banco descartável. Identificador: " + run,
      );
      console.log("Criar conta: npm run homologacao:conta -- " + run);
      if (recovery)
        console.log(
          "Perfil de preparo: nenhum envio feito. Ensaio exige autorização posterior própria.",
        );
      console.log("Encerrar: npm run homologacao:parar -- " + run);
    }
  } else {
    const result = spawnSync("docker", ["start", "--attach", runner], {
      stdio: "inherit",
    });
    if (
      !smoke &&
      result.status === 0 &&
      docker(["inspect", "--format", "{{.State.ExitCode}}", runner]) === "0"
    ) {
      const output = "/tmp/" + run + "-visuals";
      docker(["cp", runner + ":/tmp/bello-e2e-visuals", output]);
      process.stdout.write("Empty public login screenshots: " + output + "\n");
    }
    if (
      result.status !== 0 ||
      docker(["inspect", "--format", "{{.State.ExitCode}}", runner]) !== "0"
    )
      status = 1;
  }
} catch {
  process.stderr.write(
    "Browser E2E failed; no credentials or raw errors are printed.\n",
  );
  status = 1;
} finally {
  if (
    !keep &&
    !cleanup({ run, owned, network, networkCreated, docker, extraNetworks })
  )
    status = 1;
}
process.exitCode = status;
