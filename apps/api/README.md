# Bello Flow API

Aplicação backend NestJS do Bello Flow. Concentra os módulos e casos de uso do
monólito modular e sua integração com PostgreSQL por Prisma.

O estado atual e o próximo objetivo estão em
[Estado do projeto](../../docs/estado-do-projeto.md).

Os comandos devem ser executados na raiz do monorepositório:

```bash
npm run build:api
npm run test --workspace=@bello/api
npm run test:e2e --workspace=@bello/api
npm run quality:local
```

Para iniciar a API local com o wrapper de banco descrito em
[PostgreSQL local](../../docs/operacao/postgresql-local.md), use:

```bash
with_bello_dev_database env \
  NODE_ENV=development \
  BELLO_PUBLIC_ORIGIN=http://127.0.0.1:14200 \
  npm run dev:api
```

`NODE_ENV` aceita `development`, `test` ou `production`.
`BELLO_PUBLIC_ORIGIN` é a origem pública canônica percebida pelo navegador.
`BELLO_TRUSTED_PROXIES` aceita uma lista de IPs ou CIDRs explícitos, separados
por vírgula; pode ficar ausente no desenvolvimento local sem proxy confiável e é
obrigatória em produção.

O NestJS escuta em `http://127.0.0.1:13000`. O Angular local escuta em
`http://127.0.0.1:14200` e encaminha `/api` para a API; o frontend usa URLs
relativas. HTTP é permitido somente em loopback no perfil local. Produção exige
origem HTTPS e proxy confiável explícito.

A verificação de atividade está disponível em `GET /health/live`.
