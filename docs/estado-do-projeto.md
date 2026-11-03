# Estado do projeto Bello Flow

Este documento é um resumo informativo para continuidade entre sessões. Ele não
substitui AT, DEC, RN, BEL ou pendências, não altera seus estados e não autoriza
implementação por si só. Deve ser atualizado somente quando um novo objetivo for
aprovado ou um marco relevante for publicado.

## Fase atual

- **Última entrega funcional concluída:** F1-B.3 — `AuthenticationService`.
- **Próxima etapa proposta:** F1-B.4 — Camada HTTP de Autenticação.
- **Estado:** planejamento; implementação ainda não autorizada.
- **Decisão de planejamento concluída:** PT-005 — cookies, CSRF, origem e CORS.
- **Contratos de planejamento aprovados:** D1–D5 — endpoints, erros, logout,
  operações indeterminadas, CSRF/auditoria e encapsulamento da camada HTTP.
- **Limites:** as aprovações documentais da PT-005 e de D1–D5 não declaram
  implementação nem autorizam endpoints HTTP, cookies, CSRF, proxy ou frontend.

## Etapas concluídas

| Etapa | Classificação do registro | Evidências |
|---|---|---|
| Fase 0 — Fundação técnica | agrupamento resumido da fundação F0.1, PostgreSQL local, Prisma, qualidade e CI | commit `88022a3`; [evidências da F0.2.1](operacao/postgresql-local.md#evidências-da-f021); [pipeline de CI](../.github/workflows/ci.yml) |
| F1-A.1 — Fundação de identidade e auditoria | identificador comprovado em migration e teste de integração | [migration](../apps/api/prisma/migrations/20261102000000_f1_a_1_identity_foundation/migration.sql); [teste PostgreSQL](../apps/api/test/f1-a-1-postgresql.e2e-spec.ts) |
| F1-A.2 — Bootstrap administrativo e Argon2id | identificador comprovado nos testes; entrega consolidada no procedimento operacional | [bootstrap administrativo](operacao/bootstrap-administrativo.md); [teste do provider](../apps/api/test/f1-a-2-bootstrap-provider.e2e-spec.ts); [teste da CLI](../apps/api/test/f1-a-2-bootstrap-cli.e2e-spec.ts); commit `6da993d` |
| F1-B.2.1 — Modelo e privilégios de sessão | identificador comprovado em migration e teste de integração | [migration](../apps/api/prisma/migrations/20261102010000_f1_b_2_1_auth_session/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-2-1-auth-session.e2e-spec.ts) |
| F1-B.2.2 — Primitivas criptográficas | agrupamento resumido dos artefatos de primitivas entregues no commit `a2c64c6`; o identificador não aparece como marcador autônomo no repositório | [implementação](../apps/api/src/auth/session-primitives.ts); [testes](../apps/api/src/auth/session-primitives.spec.ts) |
| F1-B.2.3 — Persistência e reconciliação de sessões | identificador comprovado no teste de integração | [persistência](../apps/api/src/auth/auth-session.persistence.ts); [teste PostgreSQL](../apps/api/test/f1-b-2-3-session-persistence.e2e-spec.ts); commit `a2c64c6` |
| F1-B.3 — Serviço de autenticação por e-mail e senha | marco funcional consolidado; os subpassos F1-B.3.3.2 e F1-B.3.3.3 aparecem nos testes de integração | [`AuthenticationService`](../apps/api/src/auth/authentication.service.ts); [teste de falha de login](../apps/api/test/f1-b-3-3-2-failed-login.e2e-spec.ts); [teste de autenticação](../apps/api/test/f1-b-3-3-3-authentication.e2e-spec.ts); commit `bdd6ddc` |

Os agrupamentos resumidos organizam evidências já existentes; não criam fases
normativas nem alteram o estado de decisões ou pendências.

## Marcos publicados

### Último marco funcional

- **Marco:** F1-B.3 — `AuthenticationService`.
- **SHA:** `bdd6ddcd5b9f8fb2ef144742d4e2e74d4ac2f4e8`.
- **Publicação e CI:** confirmados no processo de publicação correspondente.

### Último marco publicado

- **Marco:** política de autonomia operacional do Codex.
- **SHA:** `6e17738be06534d405e5f20251cc9450375188dc`.
- **Publicação e CI:** confirmados no processo de publicação correspondente.

## Próximo objetivo

Concluir o planejamento técnico da camada HTTP de autenticação sem iniciar sua
implementação. Os contratos aprovados definem:

- `POST /api/auth/login`, `GET /api/auth/session`,
  `POST /api/auth/logout` e `POST /api/auth/logout-all`;
- identidade mínima e matriz externa de erros;
- semânticas distintas de logout atual e global;
- tratamento de resultado indeterminado e falha comprovada de entrega;
- logs técnicos para rejeições isoladas de origem/CSRF, sem novos eventos
  funcionais de auditoria; e
- uso exclusivo do contrato público de `AuthenticationService` pela camada HTTP.

O planejamento deve preservar [AT-001 e AT-002](arquitetura/decisoes-tecnicas.md),
[DEC-020](produto/decisoes-funcionais.md), BEL-038 em
[requisitos funcionais](produto/requisitos-funcionais.md), RN-069–RN-072 e
RN-120–RN-129 em [regras de negócio](produto/regras-de-negocio.md) e os fluxos de
[segurança e autorização](arquitetura/seguranca-e-autorizacao.md). Esses
contratos aprovados são limites do planejamento. As rotas, formatos de resposta
e decisões D1–D5 estão detalhados em
[segurança e autorização](arquitetura/seguranca-e-autorizacao.md#contratos-http-de-autenticação--d1d5).
O contrato de cookie, origem, CORS e CSRF permanece aprovado na resolução da
PT-005. Não há evidência de implementação da camada HTTP.

## Decisão técnica relevante

A **PT-005** foi resolvida em 2026-11-03 como complemento aprovado de AT-001 e
AT-005. Ela define mesma origem pública, API sob `/api`, preservação de
`/health/live`, cookie seguro, origem canônica, CORS desabilitado e proteção
CSRF. O contrato está em
[decisões técnicas](arquitetura/decisoes-tecnicas.md#complemento-aprovado--resolução-da-pt-005)
e [segurança e autorização](arquitetura/seguranca-e-autorizacao.md#transporte-http-cookie-origem-cors-e-csrf).

Esse fechamento é documental e não move a F1-B.4 para implementação.

## Contratos HTTP aprovados

As decisões **D1–D5** foram aprovadas e documentadas em 2026-11-03 como
complemento de AT-001, AT-003 e PT-005. Elas definem os quatro endpoints de
autenticação, a matriz externa de erros, as semânticas de logout, o tratamento
de operações indeterminadas, os limites entre logs técnicos e auditoria e o
encapsulamento por `AuthenticationService`.

Essa aprovação define comportamento esperado para planejamento e testes
futuros, mas não declara os endpoints, cookies, validações ou controllers como
implementados. A F1-B.4 permanece em planejamento e a implementação requer
autorização posterior específica.

## Pendência relevante

Permanece com o estado registrado no documento canônico de
[pendências técnicas](arquitetura/pendencias-tecnicas.md):

- **PT-008:** limites de tentativas para login, recuperação, transações e e-mail.

Para o login HTTP, continuam pendentes limiares, janelas, chaves, bloqueios,
armazenamento, `Retry-After` e comportamento definitivo de `429`.

Esta referência não fecha, resolve nem reclassifica qualquer pendência.
