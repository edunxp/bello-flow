# PostgreSQL local

## Escopo

Esta configuração executa somente o PostgreSQL de desenvolvimento. NestJS e Angular continuam no WSL2. Ela não representa a infraestrutura de produção e não altera as decisões AT-001 a AT-010 nem o estado das pendências PT-001 a PT-020.

## Pré-requisitos

- Docker Desktop integrado ao WSL2;
- Docker Compose;
- porta TCP `15432` livre no loopback.

## Configuração local

Crie o arquivo local de credenciais a partir do exemplo e substitua todos os valores de senha:

```bash
cp .env.postgres.example .env.postgres
```

O arquivo `.env.postgres` é ignorado pelo Git. Não use as credenciais de desenvolvimento em outros ambientes.

## Operação

Validar a configuração resolvida, sem exibir as variáveis carregadas:

```bash
docker compose config --quiet
```

Iniciar o PostgreSQL:

```bash
docker compose up -d postgres
```

Consultar o estado e o healthcheck:

```bash
docker compose ps postgres
docker inspect --format '{{.State.Health.Status}}' bello-postgres-1
```

Reiniciar sem remover o volume:

```bash
docker compose restart postgres
```

Encerrar o serviço preservando os dados:

```bash
docker compose down
```

Não use `docker compose down --volumes` ou comandos de remoção do volume sem autorização específica.

## Bancos e papéis

| Banco | Papel operacional | Papel de migration |
|---|---|---|
| `bello_dev` | `bello_dev_app` | `bello_dev_migrator` |
| `bello_shadow` | nenhum | `bello_shadow_migrator` |
| `bello_test` | `bello_test_app` | `bello_test_migrator` |

Papéis operacionais possuem somente `CONNECT` no banco correspondente e `USAGE` no schema `public`. Papéis de migration também possuem `CREATE` no schema `public` do próprio banco. Nenhum desses papéis possui `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` ou `BYPASSRLS`.

Os scripts em `infra/postgres/init` são executados pela imagem oficial somente quando o volume está vazio. Alterar um script não modifica automaticamente um volume já inicializado.

## Conexão pelo WSL2

O PostgreSQL é publicado somente em `127.0.0.1:15432`. Exemplo de formato para a aplicação de desenvolvimento:

```text
postgresql://bello_dev_app:<senha-local>@127.0.0.1:15432/bello_dev
```

As credenciais administrativas e de migration não devem ser usadas pelo processo normal da aplicação.

## Prisma e API local

Gerar o Prisma Client não acessa o PostgreSQL e não requer URLs administrativas:

```bash
npm run prisma:generate --workspace=@bello/api
```

O processo da API deve receber somente `DATABASE_URL`. A função Bash abaixo lê o
arquivo local em uma subshell, codifica a senha operacional com a API `URL` do
Node.js, remove as demais credenciais do ambiente do processo filho e não exibe
nem grava a senha no histórico:

```bash
with_bello_dev_database() (
  set +a
  source ./.env.postgres

  if [[ -z "${BELLO_DEV_APP_PASSWORD:-}" ]]; then
    echo 'BELLO_DEV_APP_PASSWORD is required' >&2
    return 1
  fi

  DATABASE_URL="$(
    BELLO_DEV_APP_PASSWORD="$BELLO_DEV_APP_PASSWORD" node -e '
      const url = new URL("postgresql://bello_dev_app@127.0.0.1:15432/bello_dev");
      url.password = process.env.BELLO_DEV_APP_PASSWORD;
      process.stdout.write(url.toString());
    '
  )" || return

  unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  unset BELLO_DEV_APP_PASSWORD BELLO_DEV_MIGRATOR_PASSWORD
  unset BELLO_SHADOW_MIGRATOR_PASSWORD BELLO_TEST_APP_PASSWORD
  unset BELLO_TEST_MIGRATOR_PASSWORD
  unset MIGRATION_DATABASE_URL SHADOW_DATABASE_URL
  export DATABASE_URL

  exec "$@"
)
```

Defina a função a partir da raiz do repositório e inicie a API:

```bash
with_bello_dev_database npm run dev:api
```

O `PrismaService` conecta durante a inicialização. Se a conexão falhar, o
servidor HTTP não começa a escutar. `Ctrl+C` aciona os hooks de shutdown do
NestJS e encerra o pool do Prisma.

Executar somente a prova de integração Prisma/PostgreSQL:

```bash
with_bello_dev_database \
  npm run test:prisma --workspace=@bello/api
```

Executar todos os testes E2E, incluindo a prova de conexão:

```bash
with_bello_dev_database \
  npm run test:e2e --workspace=@bello/api
```

Gerar e compilar a API explicitamente:

```bash
npm run prisma:generate --workspace=@bello/api
npm run build:api
```

Esse procedimento é exclusivo do desenvolvimento local. Ele pressupõe que
`.env.postgres` seja um arquivo local confiável e não substitui o mecanismo de
segredos do ambiente de implantação. A aplicação nunca deve ser iniciada com
`node --env-file=.env.postgres`, pois isso disponibilizaria todas as credenciais
do arquivo ao processo normal.

### Migrations locais

Migrations usam credenciais distintas da aplicação. A função abaixo fornece ao
Prisma CLI somente as URLs do migrator de desenvolvimento e do shadow database:

```bash
with_bello_dev_migrations() (
  set +a
  source ./.env.postgres

  if [[ -z "${BELLO_DEV_MIGRATOR_PASSWORD:-}" || \
        -z "${BELLO_SHADOW_MIGRATOR_PASSWORD:-}" ]]; then
    echo 'Migration credentials are required' >&2
    return 1
  fi

  MIGRATION_DATABASE_URL="$(
    BELLO_DEV_MIGRATOR_PASSWORD="$BELLO_DEV_MIGRATOR_PASSWORD" node -e '
      const url = new URL("postgresql://bello_dev_migrator@127.0.0.1:15432/bello_dev");
      url.password = process.env.BELLO_DEV_MIGRATOR_PASSWORD;
      process.stdout.write(url.toString());
    '
  )" || return

  SHADOW_DATABASE_URL="$(
    BELLO_SHADOW_MIGRATOR_PASSWORD="$BELLO_SHADOW_MIGRATOR_PASSWORD" node -e '
      const url = new URL("postgresql://bello_shadow_migrator@127.0.0.1:15432/bello_shadow");
      url.password = process.env.BELLO_SHADOW_MIGRATOR_PASSWORD;
      process.stdout.write(url.toString());
    '
  )" || return

  unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  unset BELLO_DEV_APP_PASSWORD BELLO_DEV_MIGRATOR_PASSWORD
  unset BELLO_SHADOW_MIGRATOR_PASSWORD BELLO_TEST_APP_PASSWORD
  unset BELLO_TEST_MIGRATOR_PASSWORD DATABASE_URL
  export MIGRATION_DATABASE_URL SHADOW_DATABASE_URL

  exec "$@"
)
```

Defina a função na raiz do repositório. Antes de aplicar qualquer migration,
gere o artefato sem aplicação, revise o SQL e só então execute o deploy:

```bash
with_bello_dev_migrations \
  npm exec --workspace=@bello/api -- prisma migrate dev --create-only --name <nome>

with_bello_dev_migrations \
  npm exec --workspace=@bello/api -- prisma migrate deploy

with_bello_dev_migrations \
  npm exec --workspace=@bello/api -- prisma migrate status
```

Não use a credencial operacional da API para migrations e nunca configure o
mesmo banco como datasource principal e shadow database.

### Prova local de transações

A prova F0.2.2-C usa uma única tabela descartável em `bello_test`. O migrator
cria e remove a tabela; o processo NestJS recebe somente a URL de
`bello_test_app`, sem privilégios DDL. Execute a função abaixo a partir da raiz
do repositório:

```bash
with_bello_test_transaction_probe() (
  set +a
  source ./.env.postgres

  if [[ -z "${BELLO_TEST_APP_PASSWORD:-}" ]]; then
    echo 'BELLO_TEST_APP_PASSWORD is required' >&2
    return 1
  fi

  DATABASE_URL="$(
    BELLO_TEST_APP_PASSWORD="$BELLO_TEST_APP_PASSWORD" node -e '
      const url = new URL("postgresql://bello_test_app@127.0.0.1:15432/bello_test");
      url.password = process.env.BELLO_TEST_APP_PASSWORD;
      process.stdout.write(url.toString());
    '
  )" || return

  docker compose exec -T postgres sh -ec '
    PGPASSWORD="$BELLO_TEST_MIGRATOR_PASSWORD" psql \
      -v ON_ERROR_STOP=1 -h 127.0.0.1 \
      -U bello_test_migrator -d bello_test <<"SQL"
BEGIN;
DO $$
BEGIN
  IF current_database() <> '\''bello_test'\'' OR current_user <> '\''bello_test_migrator'\'' THEN
    RAISE EXCEPTION '\''unexpected database identity'\'';
  END IF;
  IF to_regclass('\''public._f022c_transaction_probe'\'') IS NOT NULL THEN
    RAISE EXCEPTION '\''transaction probe table already exists'\'';
  END IF;
END
$$;
CREATE TABLE public._f022c_transaction_probe (
  run_id text NOT NULL,
  step integer NOT NULL,
  PRIMARY KEY (run_id, step)
);
REVOKE ALL ON TABLE public._f022c_transaction_probe FROM PUBLIC;
GRANT SELECT, INSERT, DELETE
  ON TABLE public._f022c_transaction_probe TO bello_test_app;
COMMIT;
SQL
  ' || return

  cleanup_transaction_probe() {
    docker compose exec -T postgres sh -ec '
      PGPASSWORD="$BELLO_TEST_MIGRATOR_PASSWORD" psql \
        -v ON_ERROR_STOP=1 -h 127.0.0.1 \
        -U bello_test_migrator -d bello_test <<"SQL"
DO $$
BEGIN
  IF current_database() <> '\''bello_test'\'' OR current_user <> '\''bello_test_migrator'\'' THEN
    RAISE EXCEPTION '\''unexpected database identity'\'';
  END IF;
  IF (SELECT pg_get_userbyid(relowner)
      FROM pg_class
      WHERE oid = '\''public._f022c_transaction_probe'\''::regclass) <> current_user THEN
    RAISE EXCEPTION '\''unexpected transaction probe owner'\'';
  END IF;
END
$$;
DROP TABLE public._f022c_transaction_probe;
SELECT to_regclass('\''public._f022c_transaction_probe'\'') IS NULL AS removed;
SQL
    '
  }
  trap cleanup_transaction_probe EXIT

  unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  unset BELLO_DEV_APP_PASSWORD BELLO_DEV_MIGRATOR_PASSWORD
  unset BELLO_SHADOW_MIGRATOR_PASSWORD BELLO_TEST_APP_PASSWORD
  unset BELLO_TEST_MIGRATOR_PASSWORD
  unset MIGRATION_DATABASE_URL SHADOW_DATABASE_URL
  export DATABASE_URL

  PATH=/home/matias/.nvm/versions/node/v24.22.2/bin:$PATH \
    npm run test:transaction --workspace=@bello/api
  test_status=$?

  trap - EXIT
  cleanup_transaction_probe
  cleanup_status=$?

  if ((test_status != 0)); then
    return "$test_status"
  fi
  return "$cleanup_status"
)
```

A checagem inicial interrompe sem remover nada se a tabela já existir. O trap
faz o cleanup também quando o teste falha normalmente e remove somente essa
tabela. Um encerramento não capturável, como `SIGKILL`, pode deixar a tabela;
nesse caso, preserve o estado para diagnóstico em vez de executar limpeza
genérica. O teste E2E comum continua usando `bello_dev` e exclui explicitamente
esta prova, que só deve ser iniciada pela função acima.

## Validação

Confirmar a versão e os bancos criados:

```bash
docker compose exec postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SHOW server_version"'
docker compose exec postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT datname FROM pg_database WHERE datname LIKE '\''bello_%'\'' ORDER BY datname"'
```

Confirmar que os cinco logins de operação e migration não possuem atributos administrativos globais:

```bash
docker compose exec postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname LIKE '\''bello_%'\'' AND rolname <> '\''bello_admin'\'' ORDER BY rolname"'
```

Exibir a matriz efetiva de `CONNECT`; cada papel deve retornar `t` somente em seu banco designado:

```bash
docker compose exec postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "SELECT role_name, database_name, has_database_privilege(role_name, database_name, '\''CONNECT'\'') AS can_connect FROM (VALUES ('\''bello_dev_app'\''), ('\''bello_dev_migrator'\''), ('\''bello_shadow_migrator'\''), ('\''bello_test_app'\''), ('\''bello_test_migrator'\'')) AS roles(role_name) CROSS JOIN (VALUES ('\''bello_dev'\''), ('\''bello_shadow'\''), ('\''bello_test'\'')) AS databases(database_name) ORDER BY role_name, database_name"'
```

O comando abaixo deve falhar com `permission denied for schema public`:

```bash
docker compose exec postgres sh -ec \
  'PGPASSWORD="$BELLO_DEV_APP_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U bello_dev_app -d bello_dev -c "CREATE TABLE f021_must_not_exist(id integer)"'
```

As conexões cruzadas abaixo também devem falhar com `permission denied for database`:

```bash
docker compose exec postgres sh -ec \
  'PGPASSWORD="$BELLO_DEV_APP_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U bello_dev_app -d bello_test -c "SELECT 1"'
docker compose exec postgres sh -ec \
  'PGPASSWORD="$BELLO_SHADOW_MIGRATOR_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U bello_shadow_migrator -d bello_dev -c "SELECT 1"'
docker compose exec postgres sh -ec \
  'PGPASSWORD="$BELLO_TEST_MIGRATOR_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U bello_test_migrator -d bello_shadow -c "SELECT 1"'
```

Para comprovar persistência sem criar tabelas de teste, registre o identificador do cluster e os OIDs dos três bancos, reinicie o serviço e compare os resultados:

```bash
docker compose exec postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT system_identifier FROM pg_control_system(); SELECT datname, oid FROM pg_database WHERE datname LIKE '\''bello_%'\'' ORDER BY datname"'
docker compose restart postgres
docker compose exec postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT system_identifier FROM pg_control_system(); SELECT datname, oid FROM pg_database WHERE datname LIKE '\''bello_%'\'' ORDER BY datname"'
```

O identificador e os OIDs devem permanecer iguais, e o serviço deve voltar ao estado `healthy`.

## Evidências da F0.2.1

Validação manual realizada em 31/10/2026 no terminal Oracle Linux WSL2, conectado ao PostgreSQL executado pelo Docker Desktop:

- container PostgreSQL 18.6 inicializado e com estado final `healthy`;
- bancos `bello_dev`, `bello_shadow` e `bello_test` existentes;
- seis papéis Bello existentes: um administrador de bootstrap e cinco papéis de operação ou migration;
- os cinco papéis de operação ou migration sem `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` ou `BYPASSRLS`;
- matriz de `CONNECT` com 15 combinações: cinco permissões concedidas aos pares previstos e dez negadas;
- privilégio `CREATE` no banco negado aos cinco papéis de operação ou migration;
- privilégio `CREATE` no schema `public` concedido somente ao migrator correspondente de cada banco;
- reinicialização do serviço concluída sem remoção do volume;
- consulta SQL posterior à reinicialização concluída com sucesso;
- `system_identifier` preservado antes e depois da reinicialização: `7702963153209565227`;
- OIDs preservados antes e depois da reinicialização:

| Banco | OID |
|---|---:|
| `bello_dev` | `16389` |
| `bello_shadow` | `16390` |
| `bello_test` | `16391` |

Essas evidências confirmam a inicialização reproduzível, o isolamento dos bancos, o menor privilégio dos papéis não administrativos e a persistência do volume para o escopo local da F0.2.1. Elas não declaram nenhuma pendência PT resolvida e não validam infraestrutura de produção.
