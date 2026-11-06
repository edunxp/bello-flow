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

`BELLO_PASSWORD_RECOVERY_DELIVERY_MODE` aceita `disabled`, `controlled` ou
`resend`; ausência preserva `disabled`. `controlled` é exclusivo de
`NODE_ENV=test`, ativa o processador com adapter técnico sem serviço externo e
exige `BELLO_PUBLIC_ORIGIN` válida. `resend` é proibido em teste e exige
`BELLO_PASSWORD_RECOVERY_RESEND_API_KEY`,
`BELLO_PASSWORD_RECOVERY_FROM_ADDRESS` e `BELLO_PUBLIC_ORIGIN` HTTPS válidas.
Valor desconhecido, barreira ambiental violada ou configuração inválida impede
a inicialização. A chave e o remetente reais permanecem fora do repositório; a
ativação produtiva depende da validação operacional da PT-009.

A proteção de admissão do login possui os seguintes limites opcionais de
runtime:

| Variável                             | Padrão | Intervalo válido |
| ------------------------------------ | -----: | ---------------: |
| `BELLO_LOGIN_IDENTITY_BUCKETS_MAX`   |  16000 |          1–16000 |
| `BELLO_LOGIN_IP_BUCKETS_MAX`         |   4000 |           1–4000 |
| `BELLO_LOGIN_ARGON2_CONCURRENCY`     |      2 |              1–2 |
| `BELLO_LOGIN_ARGON2_QUEUE_MAX`       |      4 |              0–4 |
| `BELLO_LOGIN_ARGON2_WAIT_TIMEOUT_MS` |   1000 |        1–1000 ms |

Valores fora desses intervalos impedem a inicialização. Os buckets e a fila são
locais à instância única e mantidos apenas em memória; reiniciar o processo zera
os contadores. Aumentar os tetos depende de evidência de capacidade vinculada à
PT-016.

A API expõe os contratos internos de autenticação em:

- `POST /api/auth/login`;
- `GET /api/auth/session`;
- `POST /api/auth/logout`;
- `POST /api/auth/logout-all`.

Essas rotas usam cookie de sessão `HttpOnly`, exigem
`X-Bello-Flow-Request: 1` e aplicam origem, conteúdo e autenticação conforme o
perfil específico de cada endpoint. Tokens de sessão não integram respostas
JSON.

O NestJS escuta em `http://127.0.0.1:13000`. O Angular local escuta em
`http://127.0.0.1:14200` e encaminha `/api` para a API; o frontend usa URLs
relativas. HTTP é permitido somente em loopback no perfil local. Produção exige
origem HTTPS e proxy confiável explícito.

A verificação de atividade está disponível em `GET /health/live`.
