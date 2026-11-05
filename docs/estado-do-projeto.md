# Estado do projeto Bello Flow

Este documento é um resumo informativo para continuidade entre sessões. Ele não
substitui AT, DEC, RN, BEL ou pendências, não altera seus estados e não autoriza
implementação por si só. Deve ser atualizado somente quando um novo objetivo for
aprovado ou um marco relevante for publicado.

## Fase atual

- **Última entrega publicada:** F1-B.4.5.2 — Camada Transacional da Recuperação de
  Senha, concluída pelo commit `bd243c69c66d43486a62650a21ec5266a1ecc415`.
- **Publicação e CI:** branch `main` sincronizada após a publicação; execução
  [CI 42033583132](https://github.com/edunxp/bello-flow/actions/runs/42033583132)
  aprovada nos jobs `Quality`, `API integration` e `Required`.
- **Estado da F1-B.4.5:** fundação PostgreSQL e camada transacional publicadas, com
  intenção, conclusão atômica e reconciliação observacional validadas em
  PostgreSQL real. A recuperação de senha completa ainda não está concluída:
  casos de uso, processamento e entrega de e-mail, endpoints HTTP e frontend
  permanecem sem implementação.
- **Próximo objetivo:** F1-B.4.5.3 — Admissão e Capacidade Compartilhada,
  formalizada para planejamento e ainda não implementada. O incremento restringe-se
  às quotas efêmeras da recuperação e à capacidade Argon2id global compartilhada,
  sem casos de uso completos, PostgreSQL, e-mail, HTTP ou frontend.
- **Pendências:** PT-003, PT-007, PT-008 e PT-009 preservam o estado de seus
  documentos canônicos. Esta consolidação não as encerra nem declara a recuperação
  disponível em produção.

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
| F1-B.4.3 — Proteção de Admissão do Login | token buckets, sentinela, memória limitada, saturação segura e capacidade Argon2id integrados ao caso de uso | [`LoginAdmissionService`](../apps/api/src/auth/login-admission.service.ts); [testes unitários](../apps/api/src/auth/login-admission.service.spec.ts); commit `289a580842d812382bcb27070a4ab13a27864f45` |
| F1-B.4.4 — Endpoints HTTP de Autenticação | implementação concluída e publicada, com CI remoto aprovado | [`AuthController`](../apps/api/src/auth/auth.controller.ts); [teste E2E HTTP](../apps/api/test/f1-b-4-4-auth-http.e2e-spec.ts); [integração PostgreSQL](../apps/api/test/f1-b-3-3-3-authentication.e2e-spec.ts); commit `d2343340a75ca6b15700e47738c8c34cbadc4202`; [CI 41831592216](https://github.com/edunxp/bello-flow/actions/runs/41831592216) |
| F1-B.4.5.1 — Fundação PostgreSQL da Recuperação de Senha | fundação física publicada; não implementa operações, processamento ou HTTP | [migration](../apps/api/prisma/migrations/20261104000000_f1_b_4_5_1_password_recovery_foundation/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-1-password-recovery-foundation.e2e-spec.ts); commit `e8d464c56561df5dad50751ba3335b0b898c2752` |
| F1-B.4.5.2.1 — Adequação Física e Advisory Lock Compartilhado | concluído e publicado | [migration](../apps/api/prisma/migrations/20261105000000_f1_b_4_5_2_1_physical_advisory_lock/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-1-physical-advisory-lock.e2e-spec.ts); commit `52a26a81fe9d344f7dc904b33d7a0ccb4cf44f19`; [CI 41952530637](https://github.com/edunxp/bello-flow/actions/runs/41952530637) |
| F1-B.4.5.2.2 — Registro Transacional da Intenção de Reset | concluído e publicado | [migration](../apps/api/prisma/migrations/20261106000000_f1_b_4_5_2_2_start_password_reset/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-2-start-password-reset.e2e-spec.ts); commit `eabee2de9a886385d028f3e10440a61e637a77b9`; [CI 41960353198](https://github.com/edunxp/bello-flow/actions/runs/41960353198) |
| F1-B.4.5.2.3 — Conclusão Atômica do Reset de Senha | concluído e publicado | [migration](../apps/api/prisma/migrations/20261107000000_f1_b_4_5_2_3_complete_password_reset/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-3-complete-password-reset.e2e-spec.ts); commit `ea55393fdcddc47c0b42c51bb7f0116daedfacda`; [CI 42019866304](https://github.com/edunxp/bello-flow/actions/runs/42019866304) |
| F1-B.4.5.2.4 — Reconciliação da Operação de Reset | concluído e publicado | [migration](../apps/api/prisma/migrations/20261108000000_f1_b_4_5_2_4_reconcile_password_reset/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-4-reconcile-password-reset.e2e-spec.ts); commit `bd243c69c66d43486a62650a21ec5266a1ecc415`; [CI 42033583132](https://github.com/edunxp/bello-flow/actions/runs/42033583132) |

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

### F1-B.4.3 — Proteção de Admissão do Login

- **SHA:** `289a580842d812382bcb27070a4ab13a27864f45`.
- **Publicação:** confirmada pela referência local `origin/main` inspecionada antes
  da F1-B.4.4; nenhum `fetch` foi realizado nesta atividade.
- **Escopo entregue:** token buckets por identidade/sentinela e IP, limites de
  memória, saturação localizada, concorrência e fila Argon2id.

### F1-B.4.4 — Endpoints HTTP de Autenticação

- **SHA:** `d2343340a75ca6b15700e47738c8c34cbadc4202`.
- **Publicação:** confirmada na branch `main`.
- **CI:** execução
  [41831592216](https://github.com/edunxp/bello-flow/actions/runs/41831592216)
  concluída com sucesso nos jobs `Quality`, `API integration` e `Required`.
- Os quatro endpoints `/api/auth/*`, os controles PT-005, cookies e a matriz de
  erros estão ligados ao contrato público de `AuthenticationService`.
- Testes unitários, E2E HTTP e integração HTTP com PostgreSQL descartável foram
  executados localmente, incluindo login, resolução e logout auditado.
- O gate local de cobertura permanece acima de 90% em todas as métricas para web,
  API e consolidado.

### F1-B.4.5.1 — Fundação PostgreSQL da Recuperação de Senha

- **SHA:** `e8d464c56561df5dad50751ba3335b0b898c2752`.
- **Publicação:** confirmada na branch `main`, sincronizada com a referência local
  `origin/main` no início do planejamento da F1-B.4.5.2.
- **CI:** execução
  [41904162348](https://github.com/edunxp/bello-flow/actions/runs/41904162348)
  concluída com sucesso nos jobs `Quality`, `API integration` e `Required`.
- **Escopo entregue:** `changed_operation_id` comprovável na credencial; relações
  de request, tentativa, token e operação; constraints e índices; backfill sem UUID
  inventado; função de bootstrap compatível; negação inicial de privilégios; e
  teste PostgreSQL real em banco descartável.
- **Limite:** não há funções transacionais de reset, grants runtime, casos de uso,
  processamento, endpoint ou disponibilidade produtiva.

### F1-B.4.5.2 — Camada Transacional da Recuperação de Senha

| Incremento | Entrega | Estado |
|---|---|---|
| F1-B.4.5.2.1 | Adequação Física e Advisory Lock Compartilhado | Concluído |
| F1-B.4.5.2.2 | Registro Transacional da Intenção de Reset | Concluído |
| F1-B.4.5.2.3 | Conclusão Atômica do Reset de Senha | Concluído |
| F1-B.4.5.2.4 | Reconciliação da Operação de Reset | Concluído |

- **Publicação:** os quatro incrementos foram publicados em `main`. As execuções
  [41952530637](https://github.com/edunxp/bello-flow/actions/runs/41952530637),
  [41960353198](https://github.com/edunxp/bello-flow/actions/runs/41960353198),
  [42019866304](https://github.com/edunxp/bello-flow/actions/runs/42019866304) e
  [42033583132](https://github.com/edunxp/bello-flow/actions/runs/42033583132)
  concluíram com sucesso nos jobs `Quality`, `API integration` e `Required`.
- **Escopo entregue:** adequação física e advisory lock compartilhado; registro
  transacional da intenção; conclusão atômica com consumo, credencial,
  invalidações, cancelamentos, revogações e auditoria; e reconciliação
  exclusivamente observacional e fail-closed.
- **Limite:** a camada transacional está concluída, mas isso não implementa casos
  de uso, processamento ou entrega de e-mail, endpoints HTTP, frontend nem o
  protocolo futuro para terminalizar intenções abandonadas. Não há declaração de
  disponibilidade produtiva.

## Próximo incremento

- **F1-B.4.5.3 — Admissão e Capacidade Compartilhada:** planejamento formalizado;
  implementação ainda não iniciada e não autorizada por este registro.
- **Objetivo:** implementar os controles efêmeros de admissão da solicitação e do
  reset e separar a capacidade Argon2id global para uso compartilhado por login e
  futuro caso de uso de reset, preservando integralmente o login publicado.
- **Escopo:** buckets de identidade normalizada ou sentinela e IP confiável,
  reserva simultânea sem débito parcial, `Retry-After`, memória limitada,
  saturação localizada, capacidade Argon2id, cancelamento seguro e relógio
  controlável. Não inclui endpoint, caso de uso completo, persistência, outbox,
  provider, terminalização, frontend ou nova operação PostgreSQL.
- **Dependências concluídas:** fundação física F1-B.4.5.1; camada transacional
  F1-B.4.5.2; fundação HTTP/PT-005; autenticação, sessões e capacidade Argon2id do
  login já publicadas.
- **Dependências pendentes posteriores:** protocolo autorizado para intenções
  abandonadas; PT-009 para provider real, timeout, credenciais e política de
  erros; e assinaturas/privilégios da futura fronteira SQL. Elas não bloqueiam o
  planejamento da F1-B.4.5.3. PT-003, PT-007 e PT-008 não são encerradas.
- **Contratos aplicáveis:** complemento aprovado da F1-B.4.5 em AT-001, AT-003,
  AT-009 e AT-010; BEL-032 e BEL-038; DEC-010 e DEC-020; RN-069–RN-072 e
  RN-120–RN-129; contratos de segurança, persistência, auditoria e qualidade da
  recuperação de senha.
- **Fronteiras gerais preservadas:** anti-enumeração; PT-005; quotas por identidade ou
  sentinela e IP; capacidade Argon2id compartilhada; token CSPRNG de uso único,
  armazenado somente por hash e nunca persistido em claro; locks por conta;
  menor privilégio; auditoria sem segredos; e ausência de disponibilidade
  produtiva enquanto PT-009 permanecer aberta.
- **Critérios gerais posteriores:** DTOs e respostas HTTP exatos; quotas,
  cooldown e capacidade; geração, expiração e uso único do token; até três
  tentativas; transições e `UNKNOWN`; concorrência e rollback; auditoria e
  retenção; PostgreSQL real descartável; ausência de segredos; regressões;
  cobertura mínima de 90% e jobs `Quality`, `API integration` e `Required`.
- **Compatibilidade obrigatória:** as quotas, respostas, concorrência,
  cancelamentos e resultados do login permanecem inalterados; a capacidade
  Argon2id passa a ser global sem criar quota de recuperação dentro do login.
- **Critérios de aceite:** quotas e reposições exatas, reserva atômica, maior
  `Retry-After`, saturação `503`, limites estritos de mapas, fila Argon2id FIFO,
  cancelamento/liberação únicos, ausência de PostgreSQL e Argon2id após rejeição
  de pré-admissão, relógio determinístico, regressão integral do login e cobertura
  mínima de 90% por métrica e aplicação.

### Sequência posterior proposta — não aprovada

Os identificadores abaixo organizam o planejamento e não constituem contrato,
autorização de implementação ou aprovação automática:

1. F1-B.4.5.4 — Solicitação e Classificação da Recuperação;
2. F1-B.4.5.5 — Caso de Uso de Redefinição;
3. F1-B.4.5.6 — Processador de Entrega com Adapter Controlado;
4. F1-B.4.5.7 — Provider Produtivo e Configuração Operacional;
5. F1-B.4.5.8 — Terminalização de Intenções Abandonadas;
6. F1-B.4.5.9 — Retenção Operacional;
7. F1-B.4.5.10 — Endpoints HTTP de Recuperação; e
8. F1-B.4.5.11 — Frontend e Prontidão Ponta a Ponta.

PT-009, o protocolo de terminalização e a futura fronteira SQL permanecem
abertos e exigem decisões próprias antes dos incrementos que deles dependem.

Qualquer operação de versionamento, publicação ou próximo incremento exige
autorização específica. As rotas, formatos de resposta e decisões D1–D5
permanecem em
[segurança e autorização](arquitetura/seguranca-e-autorizacao.md#contratos-http-de-autenticação--d1d5).

## Decisão técnica relevante

A **PT-005** foi resolvida em 2026-11-03 como complemento aprovado de AT-001 e
AT-005. Ela define mesma origem pública, API sob `/api`, preservação de
`/health/live`, cookie seguro, origem canônica, CORS desabilitado e proteção
CSRF. O contrato está em
[decisões técnicas](arquitetura/decisoes-tecnicas.md#complemento-aprovado--resolução-da-pt-005)
e [segurança e autorização](arquitetura/seguranca-e-autorizacao.md#transporte-http-cookie-origem-cors-e-csrf).

O contrato foi materializado pela fundação HTTP da F1-B.4.1 e ligado aos
endpoints na F1-B.4.4, publicada no commit
`d2343340a75ca6b15700e47738c8c34cbadc4202`.

## Contratos HTTP aprovados

As decisões **D1–D5** foram aprovadas e documentadas em 2026-11-03 como
complemento de AT-001, AT-003 e PT-005. Elas definem os quatro endpoints de
autenticação, a matriz externa de erros, as semânticas de logout, o tratamento
de operações indeterminadas, os limites entre logs técnicos e auditoria e o
encapsulamento por `AuthenticationService`.

F1-B.4.1 implementou a fundação e as primitivas HTTP; F1-B.4.2 implementou os
casos públicos de sessão e o encapsulamento previsto por D5; F1-B.4.3 publicou a
admissão protegida. A F1-B.4.4 publicou os endpoints, controllers, cookies,
validações e erros externos no commit
`d2343340a75ca6b15700e47738c8c34cbadc4202`, validado pela execução CI
`41831592216`.

## Pendência relevante

Permanece com o estado registrado no documento canônico de
[pendências técnicas](arquitetura/pendencias-tecnicas.md):

- **PT-008:** o subconjunto de proteção do login está implementado e publicado na
  F1-B.4.3. A fundação PostgreSQL e as operações transacionais da recuperação
  foram publicadas nas F1-B.4.5.1 e F1-B.4.5.2, mas casos de uso, processamento e
  limites integrados da recuperação permanecem pendentes; a pendência não está
  integralmente encerrada.

Para o login HTTP, foram aprovados token buckets independentes por identidade ou
sentinela compartilhada para e-mails não normalizáveis e por IP confiável,
reserva atômica, `429` com `Retry-After`, memória efêmera limitada, saturação
localizada, duas execuções Argon2id e fila limitada. Os contratos estão
em [decisões técnicas](arquitetura/decisoes-tecnicas.md#complemento-aprovado--proteção-do-login-da-pt-008)
e [segurança e autorização](arquitetura/seguranca-e-autorizacao.md#proteção-do-login--subconjunto-aprovado-da-pt-008).
A admissão foi publicada na F1-B.4.3 e ligada ao endpoint pela F1-B.4.4
publicada.
Aumentos de capacidade continuam dependendo de evidências relacionadas à PT-016.

Esta referência não encerra integralmente a PT-003, PT-007 ou PT-008, não resolve
a PT-009 e não declara a recuperação disponível em produção.
