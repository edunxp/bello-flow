// Future authorized live operation only; never run by tests or CI.
import { BootstrapTerminal } from "../../apps/api/dist/bootstrap/bootstrap-terminal.js";
import {
  assertRecoveryProfile,
  recoveryRecipient,
  recoverySender,
} from "./recovery-profile.mjs";
import { runRecoveryWorker } from "./recovery-worker-client.mjs";
let key = "";
try {
  assertRecoveryProfile(process.env);
  if (
    process.argv.length !== 2 ||
    process.env.BELLO_REHEARSAL_SIMULATION === "true"
  )
    throw new Error();
  const terminal = new BootstrapTerminal();
  terminal.assertInteractive();
  terminal.writeLine(
    "Uma tentativa para " +
      recoveryRecipient +
      ", remetente " +
      recoverySender +
      ".",
  );
  terminal.writeLine(
    "Exige autorização específica do responsável e evidências aprovadas da PT-009:",
  );
  terminal.writeLine(
    "tracking de abertura/cliques desativado; domínio/MFA/TLS/chave restrita/quotas conferidos;",
  );
  terminal.writeLine(
    "guarda, rotação/revogação e tratamento externo (EUA, mensagens/logs30dias, backups7dias) aceitos.",
  );
  terminal.writeLine(
    "O link completo será tratado pelo Resend. Não há retry, inclusive após erro ou UNKNOWN.",
  );
  const approval = await terminal.promptText(
    "Após aprovação do ensaio, digite AUTORIZO UMA TENTATIVA: ",
  );
  if (approval !== "AUTORIZO UMA TENTATIVA") throw new Error();
  key = await terminal.promptSecret(
    "Chave Resend restrita (oculta, não gravada): ",
  );
  if (!key || /\s|[\u0000-\u001f\u007f]/u.test(key)) throw new Error();
  const result = await runRecoveryWorker({ key });
  key = "";
  if (result.infrastructureError || result.delivery !== "ACCEPTED") {
    terminal.writeError(
      "Tentativa encerrada: " +
        result.delivery +
        ". Sem reenvio; investigar antes de outro ensaio.",
    );
    process.exitCode = 1;
  } else {
    terminal.writeLine(
      "Provider aceitou a mensagem. Isso não comprova entrega: confira a caixa e valide o link nesta máquina.",
    );
  }
} catch {
  console.error(
    "Ensaio não concluído. Nenhum detalhe sensível foi impresso; não repita automaticamente.",
  );
  process.exitCode = 1;
} finally {
  key = "";
}
