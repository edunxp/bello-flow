# Estado do projeto Bello Flow

Este documento é a fonte única do **estado factual corrente** dos incrementos para
continuidade entre sessões. Ele registra marcos, SHA, branch, publicação e CI sem
substituir AT, DEC, RN, BEL ou pendências, sem alterar contratos normativos e sem
autorizar implementação por si só. Documentos arquiteturais preservam decisões,
invariantes, justificativas e referências; quando precisarem mencionar situação
corrente, devem apontar para este registro em vez de duplicar o estado operacional.

## Fase atual

- **Último marco publicado — VERIFICADO:** F1-B.4.5.10 — Endpoints HTTP de
  Recuperação, integrada por fast-forward na `main` no commit
  `edb31644d3912f66760b98461e78d2c5e58868ef`.
- **Publicação e CI — VERIFICADO:** branch de trabalho validada pela execução
  [CI 42298230105](https://github.com/edunxp/bello-flow/actions/runs/42298230105)
  e `main` validada pela execução
  [CI 42299013887](https://github.com/edunxp/bello-flow/actions/runs/42299013887),
  ambas no SHA integrado, com `Quality`, `API integration` e `Required` aprovados.
- **Estado da F1-B.4.5:** fundação PostgreSQL, camada transacional, admissão
  efêmera, executor Argon2id global compartilhado, solicitação/classificação
  persistente, caso de uso de redefinição, processamento de entrega, adapter do
  provider e terminalização de intenções abandonadas foram publicados. Os
  endpoints HTTP da recuperação também estão integrados, publicados e validados.
  As reconciliações permanecem observacionais e a regressão do login foi
  preservada. A validação operacional do provider, a interface Angular, a retenção
  operacional e a prontidão ponta a ponta permanecem pendentes, sem
  disponibilidade produtiva declarada.
- **Fluxo de trabalho vigente:** execução em branch exclusiva, com alterações,
  validações, correções rotineiras, commits, push normal da branch e CI incluídos
  no ciclo autorizado. A integração do SHA final na `main` exige autorização
  explícita posterior. Consulte o
  [fluxo de desenvolvimento](operacao/fluxo-de-desenvolvimento.md).
- **Próximo objetivo proposto:** planejar a interface Angular de autenticação e
  recuperação, antes da validação ponta a ponta e da automação de retenção.
  F1-B.4.5.9 e F1-B.4.5.11 preservam seus identificadores históricos e continuam
  propostas sem contrato específico aprovado; o planejamento não autoriza sua
  implementação. A F1-B.4.5.10 já foi entregue e não integra mais as propostas
  pendentes.
- **Pendências:** PT-003, PT-007, PT-008 e PT-009 preservam o estado de seus
  documentos canônicos. Esta consolidação não as encerra nem declara a recuperação
  disponível em produção.

## Etapas concluídas

| Etapa                                                         | Classificação do registro                                                                                                                                                         | Evidências                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fase 0 — Fundação técnica                                     | agrupamento resumido da fundação F0.1, PostgreSQL local, Prisma, qualidade e CI                                                                                                   | commit `88022a3`; [evidências da F0.2.1](operacao/postgresql-local.md#evidências-da-f021); [pipeline de CI](../.github/workflows/ci.yml)                                                                                                                                                                                                                                                                                                                                                               |
| F1-A.1 — Fundação de identidade e auditoria                   | identificador comprovado em migration e teste de integração                                                                                                                       | [migration](../apps/api/prisma/migrations/20261102000000_f1_a_1_identity_foundation/migration.sql); [teste PostgreSQL](../apps/api/test/f1-a-1-postgresql.e2e-spec.ts)                                                                                                                                                                                                                                                                                                                                 |
| F1-A.2 — Bootstrap administrativo e Argon2id                  | identificador comprovado nos testes; entrega consolidada no procedimento operacional                                                                                              | [bootstrap administrativo](operacao/bootstrap-administrativo.md); [teste do provider](../apps/api/test/f1-a-2-bootstrap-provider.e2e-spec.ts); [teste da CLI](../apps/api/test/f1-a-2-bootstrap-cli.e2e-spec.ts); commit `6da993d`                                                                                                                                                                                                                                                                     |
| F1-B.2.1 — Modelo e privilégios de sessão                     | identificador comprovado em migration e teste de integração                                                                                                                       | [migration](../apps/api/prisma/migrations/20261102010000_f1_b_2_1_auth_session/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-2-1-auth-session.e2e-spec.ts)                                                                                                                                                                                                                                                                                                                                  |
| F1-B.2.2 — Primitivas criptográficas                          | agrupamento resumido dos artefatos de primitivas entregues no commit `a2c64c6`; o identificador não aparece como marcador autônomo no repositório                                 | [implementação](../apps/api/src/auth/session-primitives.ts); [testes](../apps/api/src/auth/session-primitives.spec.ts)                                                                                                                                                                                                                                                                                                                                                                                 |
| F1-B.2.3 — Persistência e reconciliação de sessões            | identificador comprovado no teste de integração                                                                                                                                   | [persistência](../apps/api/src/auth/auth-session.persistence.ts); [teste PostgreSQL](../apps/api/test/f1-b-2-3-session-persistence.e2e-spec.ts); commit `a2c64c6`                                                                                                                                                                                                                                                                                                                                      |
| F1-B.3 — Serviço de autenticação por e-mail e senha           | marco funcional consolidado; os subpassos F1-B.3.3.2 e F1-B.3.3.3 aparecem nos testes de integração                                                                               | [`AuthenticationService`](../apps/api/src/auth/authentication.service.ts); [teste de falha de login](../apps/api/test/f1-b-3-3-2-failed-login.e2e-spec.ts); [teste de autenticação](../apps/api/test/f1-b-3-3-3-authentication.e2e-spec.ts); commit `bdd6ddc`                                                                                                                                                                                                                                          |
| F1-B.4.1 — Fundação HTTP Segura                               | configuração fail-fast, origem canônica, proxy confiável, cookies, validações de requisição, parser, erros e proxy Angular; políticas preparadas, ainda sem ligação aos endpoints | [configuração HTTP](../apps/api/src/http/http-security.config.ts); [teste E2E](../apps/api/test/f1-b-4-1-http-foundation.e2e-spec.ts); commit `6bdf62be85ba5c7eb91f6ffd41b872b2e3b5ebcc`                                                                                                                                                                                                                                                                                                               |
| F1-B.4.2 — Casos de Uso Públicos de Sessão                    | resolução, logout individual, logout global e compensação expostos por `AuthenticationService`; persistência preservada internamente                                              | [`AuthenticationService`](../apps/api/src/auth/authentication.service.ts); [testes unitários](../apps/api/src/auth/authentication.service.spec.ts); commit `9bb29a427cb74a712f008695712b8a4b77eacae4`                                                                                                                                                                                                                                                                                                  |
| F1-B.4.3 — Proteção de Admissão do Login                      | token buckets, sentinela, memória limitada, saturação segura e capacidade Argon2id integrados ao caso de uso                                                                      | [`LoginAdmissionService`](../apps/api/src/auth/login-admission.service.ts); [testes unitários](../apps/api/src/auth/login-admission.service.spec.ts); commit `289a580842d812382bcb27070a4ab13a27864f45`                                                                                                                                                                                                                                                                                                |
| F1-B.4.4 — Endpoints HTTP de Autenticação                     | implementação concluída e publicada, com CI remoto aprovado                                                                                                                       | [`AuthController`](../apps/api/src/auth/auth.controller.ts); [teste E2E HTTP](../apps/api/test/f1-b-4-4-auth-http.e2e-spec.ts); [integração PostgreSQL](../apps/api/test/f1-b-3-3-3-authentication.e2e-spec.ts); commit `d2343340a75ca6b15700e47738c8c34cbadc4202`; [CI 41831592216](https://github.com/edunxp/bello-flow/actions/runs/41831592216)                                                                                                                                                    |
| F1-B.4.5.1 — Fundação PostgreSQL da Recuperação de Senha      | fundação física publicada; não implementa operações, processamento ou HTTP                                                                                                        | [migration](../apps/api/prisma/migrations/20261104000000_f1_b_4_5_1_password_recovery_foundation/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-1-password-recovery-foundation.e2e-spec.ts); commit `e8d464c56561df5dad50751ba3335b0b898c2752`                                                                                                                                                                                                                                           |
| F1-B.4.5.2.1 — Adequação Física e Advisory Lock Compartilhado | concluído e publicado                                                                                                                                                             | [migration](../apps/api/prisma/migrations/20261105000000_f1_b_4_5_2_1_physical_advisory_lock/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-1-physical-advisory-lock.e2e-spec.ts); commit `52a26a81fe9d344f7dc904b33d7a0ccb4cf44f19`; [CI 41952530637](https://github.com/edunxp/bello-flow/actions/runs/41952530637)                                                                                                                                                                  |
| F1-B.4.5.2.2 — Registro Transacional da Intenção de Reset     | concluído e publicado                                                                                                                                                             | [migration](../apps/api/prisma/migrations/20261106000000_f1_b_4_5_2_2_start_password_reset/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-2-start-password-reset.e2e-spec.ts); commit `eabee2de9a886385d028f3e10440a61e637a77b9`; [CI 41960353198](https://github.com/edunxp/bello-flow/actions/runs/41960353198)                                                                                                                                                                      |
| F1-B.4.5.2.3 — Conclusão Atômica do Reset de Senha            | concluído e publicado                                                                                                                                                             | [migration](../apps/api/prisma/migrations/20261107000000_f1_b_4_5_2_3_complete_password_reset/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-3-complete-password-reset.e2e-spec.ts); commit `ea55393fdcddc47c0b42c51bb7f0116daedfacda`; [CI 42019866304](https://github.com/edunxp/bello-flow/actions/runs/42019866304)                                                                                                                                                                |
| F1-B.4.5.2.4 — Reconciliação da Operação de Reset             | concluído e publicado                                                                                                                                                             | [migration](../apps/api/prisma/migrations/20261108000000_f1_b_4_5_2_4_reconcile_password_reset/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-2-4-reconcile-password-reset.e2e-spec.ts); commit `bd243c69c66d43486a62650a21ec5266a1ecc415`; [CI 42033583132](https://github.com/edunxp/bello-flow/actions/runs/42033583132)                                                                                                                                                              |
| F1-B.4.5.3 — Admissão e Capacidade Compartilhada              | concluída e publicada; não implementa caso de uso, persistência ou HTTP                                                                                                           | [`PasswordRecoveryAdmissionService`](../apps/api/src/auth/password-recovery-admission.service.ts); [`Argon2ExecutionService`](../apps/api/src/auth/argon2-execution.service.ts); commit `47a6ae033f42d40b56c24bad82b454af0616e2ec`; [CI 42050631222](https://github.com/edunxp/bello-flow/actions/runs/42050631222)                                                                                                                                                                                    |
| F1-B.4.5.4 — Solicitação e Classificação da Recuperação       | concluída e publicada; não gera token, processa entrega, redefine senha ou expõe HTTP                                                                                             | [`PasswordRecoveryRequestService`](../apps/api/src/auth/password-recovery-request.service.ts); [migration](../apps/api/prisma/migrations/20261109000000_f1_b_4_5_4_password_recovery_request/migration.sql); commit `a57f718bf4efb74f2daa76c4b5127c9241d939be`; [CI 42069921440](https://github.com/edunxp/bello-flow/actions/runs/42069921440)                                                                                                                                                        |
| F1-B.4.5.5 — Caso de Uso de Redefinição de Senha              | implementada, publicada e validada; não gera ou entrega token e não expõe HTTP                                                                                                    | [`PasswordResetService`](../apps/api/src/auth/password-reset.service.ts); [`PasswordResetPersistence`](../apps/api/src/auth/password-reset.persistence.ts); [teste PostgreSQL](../apps/api/test/f1-b-4-5-5-password-reset-use-case.e2e-spec.ts); commit `9ac023961b769b9e52c53d6799501df300c4ce3e`; [CI 42083803500](https://github.com/edunxp/bello-flow/actions/runs/42083803500)                                                                                                                    |
| F1-B.4.5.6 — Processador de Entrega com Adapter Controlado    | implementação publicada e validada pelo CI remoto; provider produtivo permanece fora do recorte                                                                                   | [processador](../apps/api/src/auth/password-recovery-delivery.processor.ts); [persistência](../apps/api/src/auth/password-recovery-delivery.persistence.ts); [migration](../apps/api/prisma/migrations/20261110000000_f1_b_4_5_6_password_recovery_delivery/migration.sql); [teste PostgreSQL](../apps/api/test/f1-b-4-5-6-password-recovery-delivery.e2e-spec.ts); commit `601c92ab8f3922b5f0e2a03c432de5fc74c6258d`; [CI 42117321177](https://github.com/edunxp/bello-flow/actions/runs/42117321177) |
| F1-B.4.5.7 — Provider Produtivo e Configuração Operacional    | implementação publicada e validada; ativação produtiva continua condicionada à PT-009                                                                                             | commit `af392b32d9bd72f57f8375334079043ac85d3603`; [CI 42152502439](https://github.com/edunxp/bello-flow/actions/runs/42152502439)                                                                                                                                                                                                                                                                                                                                                                     |
| F1-B.4.5.8 — Terminalização de Intenções Abandonadas          | concluída, integrada por fast-forward, publicada e validada; não implementa retenção física                                                                                       | commit `3a25547755a361a343755b09511b83bdc3e68ac4`; [CI da branch 42254538285](https://github.com/edunxp/bello-flow/actions/runs/42254538285); [CI da main 42255249588](https://github.com/edunxp/bello-flow/actions/runs/42255249588)                                                                                                                                                                                                                                                                  |
| F1-B.4.5.10 — Endpoints HTTP de Recuperação | concluída, integrada por fast-forward, publicada e validada; sem disponibilidade produtiva declarada | commit `edb31644d3912f66760b98461e78d2c5e58868ef`; [CI da branch 42298230105](https://github.com/edunxp/bello-flow/actions/runs/42298230105); [CI da main 42299013887](https://github.com/edunxp/bello-flow/actions/runs/42299013887) |

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

| Incremento   | Entrega                                        | Estado    |
| ------------ | ---------------------------------------------- | --------- |
| F1-B.4.5.2.1 | Adequação Física e Advisory Lock Compartilhado | Concluído |
| F1-B.4.5.2.2 | Registro Transacional da Intenção de Reset     | Concluído |
| F1-B.4.5.2.3 | Conclusão Atômica do Reset de Senha            | Concluído |
| F1-B.4.5.2.4 | Reconciliação da Operação de Reset             | Concluído |

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

### F1-B.4.5.3 — Admissão e Capacidade Compartilhada

- **SHA:** `47a6ae033f42d40b56c24bad82b454af0616e2ec`.
- **Publicação:** confirmada na branch `main`.
- **CI:** execução
  [42050631222](https://github.com/edunxp/bello-flow/actions/runs/42050631222)
  concluída com sucesso nos jobs `Quality`, `API integration` e `Required`.
- **Escopo entregue:** admissão interna de solicitação e reset com quotas,
  reserva conjunta, restituição idempotente, sentinela, memória limitada e
  saturação localizada; executor Argon2id global com duas execuções, fila FIFO de
  quatro e timeout de um segundo, compartilhado pelo login e por futuros
  consumidores da recuperação.
- **Compatibilidade:** quotas, resultados, cancelamento, restituição, erros e
  contratos HTTP publicados do login foram preservados.
- **Limite:** não há caso de uso funcional, persistência de solicitação, endpoint,
  token, outbox ou entrega de e-mail. A PT-008 permanece aberta e a F1-B.4.5 não
  está concluída.

### F1-B.4.5.4 — Solicitação e Classificação da Recuperação de Senha

- **SHA:** `a57f718bf4efb74f2daa76c4b5127c9241d939be`.
- **Publicação:** confirmada na branch `main`.
- **CI:** execução
  [42069921440](https://github.com/edunxp/bello-flow/actions/runs/42069921440)
  concluída com sucesso nos jobs `Quality`, `API integration` e `Required`.
- **Escopo entregue:** registro e classificação transacional das solicitações;
  cooldown e limites persistentes; reconciliação observacional; fronteira NestJS
  com admissão, normalização, anti-enumeração e tratamento fail-closed de commit
  indeterminado; grants mínimos e testes PostgreSQL reais.
- **Compatibilidade:** login, F1-B.4.5.1–F1-B.4.5.3, quotas publicadas e executor
  Argon2id global permanecem inalterados.
- **Limite:** não gera nem entrega token, não processa e-mail, não redefine senha
  e não expõe HTTP ou frontend. A F1-B.4.5 e a PT-008 permanecem abertas.

### F1-B.4.5.5 — Caso de Uso de Redefinição de Senha

- **SHA:** `9ac023961b769b9e52c53d6799501df300c4ce3e`.
- **Publicação:** confirmada na branch `main`.
- **CI:** execução
  [42083803500](https://github.com/edunxp/bello-flow/actions/runs/42083803500)
  concluída com sucesso nos jobs `Quality`, `API integration` e `Required`.
- **Escopo entregue:** fronteira NestJS e adapter das três operações SQL
  publicadas; política de senha existente; token Base64URL canônico de 32 bytes e
  SHA-256 com separação de domínio; admissão por IP confiável; executor Argon2id
  global; `STARTED` antes do hash caro; conclusão transacional; reconciliação
  observacional; idempotência e ausência de repetição insegura.
- **D1:** a reserva é finalizada exatamente uma vez. Falhas locais comprovadamente
  anteriores ao envio de start, inclusive preparação criptográfica e IDs, fazem
  refund; possível persistência, `STARTED` e falhas posteriores consomem a reserva.
- **Evidências:** testes unitários e de integração, PostgreSQL `18.6` real
  descartável, regressões de login e cobertura acima de 90% por métrica.
- **Limite:** não gera nem entrega token, não processa e-mail, não expõe endpoint
  ou frontend e não encerra a F1-B.4.5, PT-008 ou PT-009.

### F1-B.4.5.6 — Processador de Entrega com Adapter Controlado

- **Estado:** implementada e publicada no commit
  `601c92ab8f3922b5f0e2a03c432de5fc74c6258d`.
- **CI:** execução `42117321177`, evento `push`, com `Quality`, `API integration`
  e `Required` aprovados para o SHA exato.
- **Escopo:** processador NestJS, cinco operações PostgreSQL protegidas, token
  just-in-time, link controlado, adapter técnico, lifecycle e testes.
- **Evidências:** fluxo nominal e falhas, leases, fronteiras transacionais,
  concorrência, privilégios, auditoria, regressões, PostgreSQL `18.6` descartável
  e cobertura acima de 90% por métrica.
- **Limite:** provider produtivo, HTTP público, frontend, fila externa, outbox
  genérica, retenção e incrementos posteriores foram excluídos. PT-007 e PT-008
  permanecem abertas até reclassificação autorizada, e PT-009 permanece aberta.

O contrato está consolidado em
[decisões técnicas](arquitetura/decisoes-tecnicas.md#contrato-aprovado--f1-b456-processador-de-entrega-com-adapter-controlado),
[segurança](arquitetura/seguranca-e-autorizacao.md#f1-b456--processador-de-entrega-com-adapter-controlado),
[persistência](arquitetura/persistencia-e-auditoria.md#operações-protegidas-da-f1-b456)
e [qualidade](arquitetura/qualidade-e-testes.md#critérios-específicos-da-f1-b456).

## Incrementos publicados recentes

### F1-B.4.5.7 — Provider Produtivo e Configuração Operacional

- **Estado:** contrato D1–D7, adapter, configuração, wiring, mensagem,
  observabilidade e testes publicados no commit
  `af392b32d9bd72f57f8375334079043ac85d3603`, com CI `42152502439` aprovado.
- **Provider de referência:** Resend por API HTTPS, endpoint fixo, cliente HTTP
  nativo e port da F1-B.4.5.6 preservado, sem SDK obrigatório, fallback ou segundo
  provider.
- **Contrato:** configuração `disabled|controlled|resend`, segredo separado por
  ambiente, matriz fechada de resultados, timeout inicial de 10 segundos, chamada
  única sem retry, mensagem mínima, tracking desativado, observabilidade
  sanitizada e testes com fake local.
- **Condicionantes:** conta, domínio, remetente, credencial, plano, quotas, TLS,
  tracking, envio real, tratamento de dados, retenção, DPA, subprocessadores e
  jurisdição ainda não foram validados operacionalmente.
- **Dados externos:** a documentação consultada declara armazenamento nos Estados
  Unidos, retenção de mensagens/logs por 30 dias em Free, Pro e Scale e backups
  por 7 dias. Isso não representa aceitação ou mitigação pelo projeto e deve ser
  reconfirmado na contratação.
- **Evidências:** testes unitários e contratuais sem rede externa, regressões em
  PostgreSQL `18.6` descartável, gates locais e CI remoto; nenhuma credencial ou
  mensagem real foi utilizada.
- **Limite:** PT-009 e PT-014 permanecem abertas; publicação técnica não equivale
  a provider validado ou ativação. Recuperação de senha não está declarada
  disponível em produção.

O contrato está consolidado em
[decisões técnicas](arquitetura/decisoes-tecnicas.md#contrato-aprovado--f1-b457-provider-produtivo-e-configuração-operacional),
[segurança](arquitetura/seguranca-e-autorizacao.md#f1-b457--provider-resend-e-barreiras-de-ativação),
[persistência](arquitetura/persistencia-e-auditoria.md#f1-b457--ausência-de-nova-persistência)
e [qualidade](arquitetura/qualidade-e-testes.md#critérios-específicos-da-f1-b457).

### F1-B.4.5.8 — Terminalização de Intenções Abandonadas

- **Estado:** contrato D1–D8 aprovado; implementação concluída, integrada por
  fast-forward, publicada e validada no commit
  `3a25547755a361a343755b09511b83bdc3e68ac4`.
- **CI:** execução da branch `42254538285` e execução final da `main`
  `42255249588`, ambas aprovadas nos jobs `Quality`, `API integration` e
  `Required`.
- **Escopo:** terminalização exclusiva `STARTED → NOT_FOUND` depois da expiração
  do token, ausência completa de efeitos e auditoria e revalidação sob os locks
  PostgreSQL aprovados. `UNKNOWN` permanece intocado.
- **Persistência:** seletor e probe booleano observacionais e função protegida de
  mutação condicional. Não há novo deadline, estado, tabela, lease, heartbeat,
  ownership, fencing numérico, role ou credencial.
- **Executor:** worker interno desabilitado por padrão, polling de 60 segundos,
  lote dez e paralelismo um, sem fila ou scheduler externo.
- **Evidência:** migration incremental, adapter e worker interno, 34 testes
  unitários específicos, 42 cenários PostgreSQL específicos e 202 testes na
  regressão de F1-B.4.5.1–.8. O gate local e os CIs da branch e da `main` foram
  aprovados com cobertura acima de 90% nas quatro métricas.
- **Limite:** conclusão técnica não equivale a disponibilidade produtiva. PT-009
  e PT-014 permanecem abertas, e retenção física pertence à F1-B.4.5.9 ainda não
  aprovada.

O contrato está consolidado em
[decisões técnicas](arquitetura/decisoes-tecnicas.md#contrato-aprovado--f1-b458-terminalização-de-intenções-abandonadas),
[segurança](arquitetura/seguranca-e-autorizacao.md#f1-b458--terminalização-segura-de-intenções-abandonadas),
[persistência](arquitetura/persistencia-e-auditoria.md#f1-b458--terminalização-de-intenções-abandonadas)
e [qualidade](arquitetura/qualidade-e-testes.md#critérios-específicos-da-f1-b458).

### F1-B.4.5.10 — Endpoints HTTP de Recuperação

- **Estado — VERIFICADO:** concluída, integrada por fast-forward na `main`,
  publicada e validada no SHA `edb31644d3912f66760b98461e78d2c5e58868ef`.
- **Commits:** `d9705f7308f5b9f6463d738b628b271f3f2ae05c` implementa os
  endpoints; `edb31644d3912f66760b98461e78d2c5e58868ef` ajusta os providers da
  suíte de integração de autenticação afetada pelo novo construtor HTTP.
- **Escopo materializado:** `POST /api/auth/password-recovery` e
  `POST /api/auth/password-reset` ligam os contratos HTTP publicados aos casos
  de uso internos existentes, sem migration, alteração de schema, novo provider
  ou mudança nos contratos transacionais.
- **Validação local — VERIFICADO:** `quality:local` aprovado; 56 testes HTTP,
  incluindo 23 da recuperação; 66 testes PostgreSQL de solicitação e cinco de
  reset aprovados em PostgreSQL `18.6` descartável. Após a correção da suíte de
  autenticação, seus 13 testes PostgreSQL, os 56 testes HTTP, formatação, lint e
  typecheck da API foram aprovados. Nenhum banco persistente foi utilizado.
- **CI — VERIFICADO:** a primeira execução da branch,
  [CI 42296441022](https://github.com/edunxp/bello-flow/actions/runs/42296441022),
  reprovou por providers ausentes no módulo de teste de autenticação. A correção
  foi validada na branch pelo
  [CI 42298230105](https://github.com/edunxp/bello-flow/actions/runs/42298230105)
  e na `main` pelo
  [CI 42299013887](https://github.com/edunxp/bello-flow/actions/runs/42299013887),
  com `Quality`, `API integration` e `Required` aprovados no SHA final.
- **Limite:** publicação dos endpoints não declara disponibilidade produtiva.
  PT-009 permanece aberta e a interface Angular não integra este incremento.

## Próximos incrementos

### Identificadores históricos propostos — não aprovados

Os identificadores ainda pendentes abaixo organizam o planejamento e não
constituem contrato específico, autorização de implementação ou aprovação
automática:

1. F1-B.4.5.9 — Retenção Operacional; e
2. F1-B.4.5.11 — Frontend e Prontidão Ponta a Ponta.

### Sequência recomendada de execução — não aprovada como contrato específico

1. endpoints HTTP da recuperação de senha — concluídos na F1-B.4.5.10;
2. interface Angular de autenticação e recuperação;
3. validação ponta a ponta e operacional do e-mail;
4. retenção operacional por mecanismo administrativo simples; e
5. prontidão produtiva e regressões finais.

Essa ordem não renumera os identificadores históricos. A F1-B.4.5.9 continua sem
contrato específico aprovado. Uma CLI administrativa, executada por agendamento
simples com credencial de manutenção segregada, é a alternativa arquitetural
preferencial para planejamento, não uma implementação autorizada. Não se aprova
worker permanente, polling contínuo, scheduler distribuído, nova credencial ou
novo serviço por esta orientação.

A retenção normativa de 30 dias após `terminal_at`, a proteção de estados ativos,
`UNKNOWN` e operações reconciliáveis, a ordem de limpeza e os lotes controlados
permanecem obrigatórios. PT-009 continua aberta até validação operacional do
provider. Os contratos HTTP existentes permanecem inalterados, e nenhuma etapa é
declarada disponível em produção antecipadamente.

Qualquer operação de versionamento, publicação ou próximo incremento exige
autorização específica. As rotas, formatos de resposta e decisões D1–D5
permanecem em
[segurança e autorização](arquitetura/seguranca-e-autorizacao.md#contratos-http-de-autenticação--d1d5),
e os endpoints de recuperação permanecem no
[contrato aprovado da F1-B.4.5](arquitetura/seguranca-e-autorizacao.md#recuperação-de-senha--contrato-aprovado-da-f1-b45).

## Roadmap recomendado do Kanban

O **primeiro Kanban utilizável para validação interna** é um marco intermediário,
não o MVP concluído. O **MVP normativo completo** preserva os 28 requisitos
essenciais de [escopo do MVP](produto/escopo-mvp.md#requisitos-essenciais).

A sequência recomendada é:

1. autenticação utilizável;
2. Workspace e quadro;
3. listas e cartões;
4. ordenação e movimentação;
5. participação e colaboração;
6. sincronização por WebSocket;
7. ciclo de vida e movimentação entre quadros; e
8. feed, auditoria consultável e prontidão operacional.

Cada entrega vertical inclui, quando aplicável, Angular, API NestJS, PostgreSQL,
autorização, auditoria e feed, testes automatizados e critérios verificáveis de
aceitação. A sequência não autoriza antecipar requisitos de entregas posteriores.

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
  foram publicadas nas F1-B.4.5.1 e F1-B.4.5.2; a admissão e a capacidade global
  foram publicadas na F1-B.4.5.3; solicitação e classificação persistente foram
  publicadas na F1-B.4.5.4; o caso de uso interno de redefinição foi publicado na
  F1-B.4.5.5. Processamento e limites integrados ponta a ponta permanecem
  pendentes; a pendência não está integralmente encerrada.

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
