export function cleanup({
  run,
  owned,
  network,
  networkCreated,
  docker,
  extraNetworks = [],
}) {
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
  for (const ownedNetwork of [
    ...(networkCreated ? [network] : []),
    ...extraNetworks,
  ]) {
    try {
      const actual = docker([
        "network",
        "inspect",
        "--format",
        '{{index .Labels "bello.e2e.run"}}',
        ownedNetwork,
      ]);
      if (actual !== run) throw new Error("Ownership mismatch");
      docker(["network", "rm", ownedNetwork]);
      if (
        docker([
          "network",
          "ls",
          "--filter",
          "name=^" + ownedNetwork + "$",
          "--format",
          "{{.ID}}",
        ])
      )
        throw new Error("Removal not confirmed");
    } catch {
      clean = false;
      process.stderr.write(
        "Scoped cleanup needs inspection: " + ownedNetwork + "\n",
      );
    }
  }
  return clean;
}
