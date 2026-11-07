// Only resources with this run's random identity may be removed.
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

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
const owned = [];
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
function cleanup() {
  let clean = true;
  for (const [kind, name] of owned.reverse()) {
    try {
      const actual = docker([
        kind,
        "inspect",
        "--format",
        '{{index .Config.Labels "bello.e2e.run"}}',
        name,
      ]);
      if (actual !== run) throw new Error("Ownership mismatch");
      docker([kind, "rm", ...(kind === "container" ? ["--force"] : []), name]);
      const filter =
        kind === "image" ? "reference=" + name : "name=^" + name + "$";
      const remains = docker([
        kind,
        "ls",
        ...(kind === "container" ? ["--all"] : []),
        "--filter",
        filter,
        "--format",
        "{{.ID}}",
      ]);
      if (remains) throw new Error("Removal not confirmed");
    } catch {
      clean = false;
      process.stderr.write("Scoped cleanup needs inspection: " + name + "\n");
    }
  }
  if (networkCreated) {
    try {
      const actual = docker([
        "network",
        "inspect",
        "--format",
        '{{index .Labels "bello.e2e.run"}}',
        network,
      ]);
      if (actual !== run) throw new Error("Ownership mismatch");
      docker(["network", "rm", network]);
      if (
        docker([
          "network",
          "ls",
          "--filter",
          "name=^" + network + "$",
          "--format",
          "{{.ID}}",
        ])
      )
        throw new Error("Removal not confirmed");
    } catch {
      clean = false;
      process.stderr.write(
        "Scoped cleanup needs inspection: " + network + "\n",
      );
    }
  }
  return clean;
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
    network,
    "--shm-size",
    "1g",
    "--env",
    "BELLO_E2E_RUN",
    "--env",
    "BELLO_TEST_APP_PASSWORD",
    "--env",
    "BELLO_TEST_MIGRATOR_PASSWORD",
    image,
  ]);
  if (!container) throw new Error("Runner creation failed");
  owned.push(["container", runner]);
  const result = spawnSync("docker", ["start", "--attach", runner], {
    stdio: "inherit",
  });
  if (
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
} catch {
  process.stderr.write(
    "Browser E2E failed; no credentials or raw errors are printed.\n",
  );
  status = 1;
} finally {
  if (!cleanup()) status = 1;
}
process.exitCode = status;
