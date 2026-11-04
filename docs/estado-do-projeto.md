# Estado do projeto Bello Flow

Este documento é um resumo informativo para continuidade entre sessões. Ele não
substitui AT, DEC, RN, BEL ou pendências, não altera seus estados e não autoriza
implementação por si só. Deve ser atualizado somente quando um novo objetivo for
aprovado ou um marco relevante for publicado.

## Fase atual

- **Última entrega publicada:** F1-B.4.2 — Casos de Uso Públicos de Sessão.
- **Estado da F1-B.4:** fundação HTTP e casos públicos de sessão implementados;
  integração HTTP e proteção de admissão do login ainda ausentes.
- **Decisão técnica:** PT-005 resolvida; D1–D5 preservadas como contratos
  normativos com implementação parcial.
- **Proteção de login aprovada:** subconjunto da PT-008 — token buckets por
  identidade ou sentinela compartilhada e por IP, memória limitada, saturação
  segura e concorrência Argon2id. Essa proteção ainda não está implementada.
- **Limite:** não existem controllers nem endpoints `/api/auth/*`; a autenticação
  HTTP completa não foi entregue.

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
| F1-B.4.1 — Fundação HTTP Segura | configuração fail-fast, origem canônica, proxy confiável, cookies, validações de requisição, parser, erros e proxy Angular; políticas preparadas, ainda sem ligação aos endpoints | [configuração HTTP](../apps/api/src/http/http-security.config.ts); [teste E2E](../apps/api/test/f1-b-4-1-http-foundation.e2e-spec.ts); commit `6bdf62be85ba5c7eb91f6ffd41b872b2e3b5ebcc` |
| F1-B.4.2 — Casos de Uso Públicos de Sessão | resolução, logout individual, logout global e compensação expostos por `AuthenticationService`; persistência preservada internamente | [`AuthenticationService`](../apps/api/src/auth/authentication.service.ts); [testes unitários](../apps/api/src/auth/authentication.service.spec.ts); commit `9bb29a427cb74a712f008695712b8a4b77eacae4` |

Os agrupamentos resumidos organizam evidências já existentes; não criam fases
normativas nem alteram o estado de decisões ou pendências.

## Marcos publicados

### F1-B.4.1 — Fundação HTTP Segura

- **SHA:** `6bdf62be85ba5c7eb91f6ffd41b872b2e3b5ebcc`.
- **Publicação e CI:** confirmados no processo de publicação correspondente.
- **Escopo entregue:** configuração fail-fast, origem, proxy, perfis de cookie,
  validações de headers/origem/conteúdo, parser JSON, erros HTTP e proxy Angular.
- **Limite:** as políticas estão preparadas, mas ainda não conectadas a endpoints.

### F1-B.4.2 — Casos de Uso Públicos de Sessão

- **SHA:** `9bb29a427cb74a712f008695712b8a4b77eacae4`.
- **Publicação e CI:** confirmados no processo de publicação correspondente.
- **Escopo entregue:** resolução de sessão, logout individual, logout global e
  compensação de sessão não entregue, com reconciliação e idempotência.
- **Encapsulamento:** `AuthSessionPersistence` permanece interna ao módulo.

## Etapas pendentes da F1-B.4

- **F1-B.4.3:** não implementada.
- **F1-B.4.4:** não implementada.
- **F1-B.4.5:** não implementada.

Qualquer próximo incremento exige autorização específica. Os quatro endpoints
aprovados, a conexão dos controles de requisição, a emissão e limpeza de cookies
na fronteira HTTP e a proteção de admissão do login continuam pendentes. As
rotas, formatos de resposta e decisões D1–D5 permanecem em
[segurança e autorização](arquitetura/seguranca-e-autorizacao.md#contratos-http-de-autenticação--d1d5).

## Decisão técnica relevante

A **PT-005** foi resolvida em 2026-11-03 como complemento aprovado de AT-001 e
AT-005. Ela define mesma origem pública, API sob `/api`, preservação de
`/health/live`, cookie seguro, origem canônica, CORS desabilitado e proteção
CSRF. O contrato está em
[decisões técnicas](arquitetura/decisoes-tecnicas.md#complemento-aprovado--resolução-da-pt-005)
e [segurança e autorização](arquitetura/seguranca-e-autorizacao.md#transporte-http-cookie-origem-cors-e-csrf).

O contrato foi parcialmente materializado pela fundação HTTP da F1-B.4.1. A
aplicação dos controles aos endpoints continua pendente.

## Contratos HTTP aprovados

As decisões **D1–D5** foram aprovadas e documentadas em 2026-11-03 como
complemento de AT-001, AT-003 e PT-005. Elas definem os quatro endpoints de
autenticação, a matriz externa de erros, as semânticas de logout, o tratamento
de operações indeterminadas, os limites entre logs técnicos e auditoria e o
encapsulamento por `AuthenticationService`.

F1-B.4.1 implementou a fundação e as primitivas HTTP; F1-B.4.2 implementou os
casos públicos de sessão e o encapsulamento previsto por D5. Os endpoints,
controllers e a integração completa de cookies e validações permanecem ausentes.

## Pendência relevante

Permanece com o estado registrado no documento canônico de
[pendências técnicas](arquitetura/pendencias-tecnicas.md):

- **PT-008:** o subconjunto de proteção do login está aprovado para planejamento;
  limites de recuperação de senha, retentativas transacionais e processamento de
  e-mails permanecem abertos.

Para o login HTTP, foram aprovados token buckets independentes por identidade ou
sentinela compartilhada para e-mails não normalizáveis e por IP confiável,
reserva atômica, `429` com `Retry-After`, memória efêmera limitada, saturação
localizada, duas execuções Argon2id e fila limitada. Os contratos estão
em [decisões técnicas](arquitetura/decisoes-tecnicas.md#complemento-aprovado--proteção-do-login-da-pt-008)
e [segurança e autorização](arquitetura/seguranca-e-autorizacao.md#proteção-do-login--subconjunto-aprovado-da-pt-008).
Essas decisões estão documentadas, mas a admissão do login não está implementada.
Aumentos de capacidade dependem de evidências relacionadas à PT-016.

Esta referência não encerra integralmente a PT-008 nem reclassifica suas partes
remanescentes.
