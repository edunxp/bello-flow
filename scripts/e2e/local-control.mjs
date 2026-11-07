import { spawnSync } from "node:child_process";
import { cleanup } from "./resources.mjs";
const [action, run] = process.argv.slice(2);
const docker = (args) => {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error();
  return result.stdout.trim();
};
try {
  if (
    !["account", "stop"].includes(action) ||
    !/^bello-e2e-[0-9a-f-]{36}$/.test(run ?? "")
  )
    throw new Error();
  const runner = run + "-runner";
  const proof = JSON.parse(docker(["inspect", runner]))[0];
  if (
    proof.Config.Labels["bello.e2e.run"] !== run ||
    !proof.Config.Cmd.includes("scripts/e2e/local.mjs")
  )
    throw new Error();
  if (action === "account") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error();
    const result = spawnSync(
      "docker",
      ["exec", "-it", runner, "node", "scripts/e2e/local-account.mjs"],
      { stdio: "inherit" },
    );
    if (result.status !== 0) throw new Error();
  } else {
    const owned = [
      ["image", run + ":test"],
      ["container", run + "-db"],
      ["container", runner],
    ];
    if (
      !cleanup({
        run,
        owned,
        network: run + "-net",
        networkCreated: true,
        extraNetworks: [run + "-front"],
        docker,
      })
    )
      throw new Error();
    console.log(
      "Sessão local encerrada; banco e recursos temporários removidos.",
    );
  }
} catch {
  console.error(
    "Operação local não concluída. Confira ação, identificador, TTY e ownership. Nenhum alvo genérico será removido.",
  );
  process.exitCode = 1;
}
