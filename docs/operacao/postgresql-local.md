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
