// Disposable synthetic account, never an administrative bootstrap or real user.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { BootstrapTerminal } from "../../apps/api/dist/bootstrap/bootstrap-terminal.js";
import { PasswordCredentialService } from "../../apps/api/dist/credentials/password-credential.service.js";
import {
  recoveryRecipient,
  assertRecoveryProfile,
} from "./recovery-profile.mjs";
export const localEmail = "homologacao@example.test";
export function connection(user, password) {
  const url = new URL("postgresql://database:5432/bello_test");
  url.username = user;
  url.password = password;
  return url.toString();
}
export async function createLocalAccount(password, email = localEmail) {
  if (email !== localEmail) {
    assertRecoveryProfile(process.env);
    if (email !== recoveryRecipient) throw new Error();
  }
  if (
    process.env.BELLO_LOCAL_ONLY !== "true" ||
    !/^bello-e2e-[0-9a-f-]{36}$/.test(process.env.BELLO_E2E_RUN ?? "")
  )
    throw new Error();
  const credentials = new PasswordCredentialService();
  const hash = await credentials.hashPassword(password);
  const client = new Client({
    connectionString: connection(
      "bello_test_migrator",
      process.env.BELLO_TEST_MIGRATOR_PASSWORD,
    ),
  });
  await client.connect();
  try {
    const row = (
      await client.query("SELECT current_database() AS db,current_user AS usr")
    ).rows[0];
    if (row.db !== "bello_test" || row.usr !== "bello_test_migrator")
      throw new Error();
    const id = randomUUID();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO public.account(id,first_name,last_name,email,email_key,email_verified_at,status,created_at)
      VALUES($1,'Homologacao','Local',$2,$2,clock_timestamp(),'ACTIVE',clock_timestamp())`,
      [id, email],
    );
    await client.query(
      `INSERT INTO public.password_credential(account_id,password_hash,changed_at,changed_operation_id)
      VALUES($1,$2,clock_timestamp(),$3)`,
      [id, hash, randomUUID()],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
if (process.argv[1]?.endsWith("/local-account.mjs")) {
  let password = "";
  try {
    const terminal = new BootstrapTerminal();
    terminal.assertInteractive();
    password = await terminal.promptSecret(
      "Senha de homologação (12–128 caracteres, não será exibida): ",
    );
    const confirmation = await terminal.promptSecret("Confirme a senha: ");
    if (password !== confirmation) throw new Error();
    const email =
      process.env.BELLO_RECOVERY_REHEARSAL === "true"
        ? recoveryRecipient
        : localEmail;
    await createLocalAccount(password, email);
    console.log("Conta de homologação pronta: " + email);
  } catch {
    console.error(
      "Conta não criada: confira senha, confirmação e se já existe nessa sessão.",
    );
    process.exitCode = 1;
  } finally {
    password = "";
  }
}
