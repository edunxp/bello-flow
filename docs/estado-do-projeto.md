# Estado do projeto Bello Flow

Este documento é a fonte única do **estado factual corrente** dos incrementos para
continuidade entre sessões. Ele registra marcos, SHA, branch, publicação e CI sem
substituir AT, DEC, RN, BEL ou pendências, sem alterar contratos normativos e sem
autorizar implementação por si só. Documentos arquiteturais preservam decisões,
invariantes, justificativas e referências; quando precisarem mencionar situação
corrente, devem apontar para este registro em vez de duplicar o estado operacional.

## Fase atual

- **Último marco publicado — VERIFICADO:** homologação HTTPS local sem e-mail
  integrada por fast-forward na main no SHA
  `8b945da7ba01dbabe492bd2314f7faa4a5f87dcc`.
  [CI final 42413812922](https://github.com/edunxp/bello-flow/actions/runs/42413812922),
  tentativa 1, push/main/SHA exato, com Quality, API integration, Browser E2E e
  Required aprovados. Revisão independente favorável, sem ativação produtiva.
- **Validação manual — RELATADO pelo responsável:** login, restauração após
  recarga, logout e erro com senha incorreta exercitados com sucesso. Sessão
  anterior mantida; não se acessou senha ou hash para essa conferência.
- **Ciclo atual — VERIFICADO:** preparo do ensaio local Resend, autorizado sem
  chave real e sem envio. Branch `work/pt009-resend-rehearsal`,
  `BASE_MAIN_SHA=8b945da7ba01dbabe492bd2314f7faa4a5f87dcc`.
  Git local/remoto inicialmente sincronizado e árvore limpa; nenhum arquivo
  preexistente foi descartado. Risco alto por envolver credencial externa e
  recuperação de senha; revisão independente e ensaio isolado são obrigatórios.
- **Escopo implementado — VERIFICADO:** perfil separado em loopback 15444,
  banco próprio tmpfs/rede interna e API real em development com entrega disabled.
  Conta de homologação e destinatário fixos em belloflow@nextpartner.com.br;
  remetente recuperacao@notify.nextpartner.com.br, ambos confirmados pelo responsável.
  Não altera conta ou sessão da homologação anterior.
- **Worker pontual — VERIFICADO:** comando interativo separado, autorização futura
  própria, chave oculta somente em memória/IPC e ambiente filho somente runtime.
  Configuração resend validada pelo loader existente, sem modificar endpoint,
  payload, timeout ou classificação. Hook de agendamento suprimido exclusivamente
  no harness; runCycle real limitado a um claim. Marcador wx/0600 anterior ao
  processamento/efeito externo e guard de destinatário/orçamento impedem segunda
  tentativa externa na mesma sessão, sem restauração após erro/UNKNOWN.
  Nenhuma rota HTTP de envio ou exposição de link foi adicionada.
- **Testes — VERIFICADO:** quality:local aprovado, cobertura vigente preservada;
  ensaio com Chromium/API/PostgreSQL reais e servidor HTTP local simulado aprovou
  API disabled, payload/link, uma chamada, estados SENT/token, bloqueio de nova
  execução, redefinição, uso único e troca de senha. Apenas chave/senhas sintéticas,
  sem egress e sem captura persistida do link. Gate inicialmente não iniciou por
  conexão WSL indisponível e foi retomado; primeira execução do smoke corrigiu
  apenas expectativas do teste para os contratos existentes 204/401.
  Regressão dos 12 cenários E2E e da homologação disabled aprovadas.
  Publicação loopback15444 conferiu health e shell Angular HTTPS, com limpeza
  própria. Seis verificações negativas de CLI/perfil/IPC recusaram execução
  indevida. Formatação, sintaxe dos scripts e git diff --check aprovados.
- **Documentação e revisão — VERIFICADO:** procedimento do ensaio distingue
  preparo de operação real, evidências pendentes e limites do resultado.
  Revisão independente preliminar sem bloqueantes após ajuste da semântica
  disabled/worker. Commit, publicação, CI e parecer no SHA final ainda pendentes
  neste registro pré-publicação; os resultados serão registrados no relatório
  operacional sem commit adicional apenas para inserir SHA ou CI.
- **Provider — RELATADO por capturas do responsável:** conta Resend Free,
  domínio notify.nextpartner.com.br verificado, MFA habilitado, TLS Enforced e
  chave Sending access restrita ao domínio. Valor da chave não recebido, lido ou
  configurado. Tracking desativado e mensagem real sem reescrita/pixel ainda não
  comprovados; não houve envio real.
- **Pendências — NÃO VERIFICADO:** condições operacionais atuais do provider,
  guarda privada/secret manager, rotação/revogação, DMARC, quotas, tracking,
  DPA/subprocessadores e aceitação aplicável do tratamento externo. Um envio
  futuro exige evidências e autorização específica para uma tentativa ao
  destinatário confirmado. PT-009 e demais pendências continuam abertas; não há
  disponibilidade produtiva nem autorização para ngrok/hospedagem pública.

Procedimentos: [homologação local](operacao/homologacao-local.md),
[ensaio de recuperação local](operacao/ensaio-recuperacao-local.md) e
[validação E2E](operacao/validacao-autenticacao-e2e.md).
Integração na main exige autorização posterior para o SHA final aprovado no CI
e na revisão independente.

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
2. F1-B.4.5.11 — Frontend e Prontidão Ponta a Ponta: somente o recorte de
   interface descrito acima foi autorizado; prontidão operacional permanece futura.

### Sequência recomendada de execução — não aprovada como contrato específico

1. endpoints HTTP da recuperação de senha — concluídos na F1-B.4.5.10;
2. interface Angular de autenticação e recuperação — integrada;
3. validação ponta a ponta controlada — ciclo acima; validação operacional do e-mail posterior;
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

## Múltiplos Workspaces — primeira etapa

- **Estado — VERIFICADO:** implementado e validado localmente na branch
  `work/multiplos-workspaces`, com
  `BASE_MAIN_SHA=2cdb4bd8a34119891006fa91f9e2383e4f2c0694`. Este registro
  antecede commit, publicação e CI remoto.
- **Escopo:** criar e listar Workspaces e quadros privados pela interface e API.
  A mesma conta pode criar os Workspaces Trabalho e Pessoal e os quadros Time
  ERP e Pessoal. A criação concede ao autor o papel de Administrador inicial
  explícito no recurso e registra a auditoria obrigatória e o feed aplicável
  na mesma transação.
- **Autorização:** listar Workspaces exige participação no Workspace. Listar ou
  abrir conteúdo de quadro privado exige participação explícita no Workspace
  e no quadro. A concessão inicial e as consultas seguem DEC-005 a DEC-010 e
  as regras de privacidade, governança e auditoria aplicáveis.
- **Aceite:** validar no navegador e na API com PostgreSQL descartável em Docker.
  A conta criadora vê os dois Workspaces e seus respectivos quadros. Uma conta
  sem vínculo não os vê nem obtém acesso direto. Uma conta vinculada apenas ao
  Workspace não lista nem abre o quadro privado. Os vínculos adicionais desse
  cenário são preparados como dados sintéticos de teste.
- **Etapa seguinte:** gerenciamento de acesso pela interface com e-mail e Central
  de Notificações conforme DEC-021. A homologação desta etapa não depende de
  envio real pela Resend.
- **Evidências — VERIFICADO:** `quality:local` aprovado com 785 testes da API,
  69 da web e cobertura superior a 90% nas quatro métricas. Os 13 cenários em
  Chromium e PostgreSQL descartável passaram. O cenário específico confirmou
  criação e listagem, recusa de criação fora do Workspace, resposta equivalente
  para quadro privado e inexistente, ausência de cache e registros de auditoria
  e feed. A conta de teste com vínculo apenas no Workspace permaneceu sem
  acesso ao quadro.
- **Risco e autorização:** a migration concede ao runtime somente leitura e
  inserção nas tabelas deste recorte, conforme autorizado. A fronteira de
  acesso a dados privados exige revisão independente antes da integração.
- **Correção da revisão — VERIFICADO localmente:** as criações recebem um UUID
  de operação. A API vincula o resultado à conta e ao escopo do recurso.
  A repetição com os mesmos dados devolve o recurso já criado após verificar
  o acesso; dados divergentes retornam conflito. A interface guarda somente o
  UUID pendente na sessão da aba para preservar a operação após recarga.
- **Evidência da correção:** os testes em Docker descartaram uma resposta
  depois da confirmação pelo servidor, repetiram a operação após recarga e
  exercitaram dois POSTs simultâneos para o mesmo quadro. Falhas forçadas na
  auditoria de Workspace e quadro e no feed do quadro deixaram inalteradas as
  contagens de recursos, vínculos, auditoria e feed. A revisão independente
  final e o CI da correção são verificados no SHA publicado.

## Compartilhamento de Workspaces e quadros — segunda etapa

- **Estado — VERIFICADO:** implementado e validado localmente na branch
  `work/compartilhamento-notificacoes`, com
  `BASE_MAIN_SHA=7192cad01aefe42f72fbbb54d7920bedf559d438`. Este registro
  antecede commit, publicação e CI remoto.
- **Escopo:** consultar e incluir participantes pela interface e API, com
  identificação por e-mail exato, verificação de elegibilidade, confirmação
  do destinatário e escolha de papel. Workspace e quadro têm vínculos
  explícitos, e a inclusão em quadro exige participação no Workspace.
- **Autorização:** Administrador do Workspace gerencia participantes do
  Workspace e dos quadros vinculados. Administrador de quadro gerencia
  participantes daquele quadro. Governança administrativa não concede
  conteúdo. Autoconcessão ao quadro é explícita e auditada.
- **Consistência:** o vínculo, a auditoria, o feed aplicável, a notificação
  do destinatário e a solicitação de e-mail são registrados na mesma
  transação. O processador interno trata o e-mail depois do commit.
  A Central é individual e reavalia o acesso ao destino.
- **Aceite:** testar no navegador e na API com PostgreSQL descartável e
  transporte local simulado. O time vê Trabalho e Time ERP conforme os dois
  vínculos, e a conta pessoal vê apenas Pessoal. Recusar acesso cruzado e
  inclusão indevida. Repetição ou concorrência não duplica vínculo nem
  notificações. Falha em gravação obrigatória reverte a operação. Falha de
  entrega preserva a inclusão e o item da Central.
- **Limites:** cadastro, convite pendente, remoção, mudanças de papel e envio
  real pertencem a outros recortes.
- **Evidências — VERIFICADO:** `quality:local` aprovado com 796 testes da API,
  75 da web e cobertura acima de 90% nas quatro métricas. Os 15 cenários em
  Chromium com PostgreSQL descartável passaram. O cenário do incremento
  confirmou isolamento, governança sem acesso ao conteúdo, inclusão explícita,
  repetição sem efeitos duplicados, entrega simulada, falha de entrega com
  acesso preservado e rollback por falhas na Central, na auditoria e no feed.
- **Operação e segurança:** o processador usa transporte injetado no Docker de
  teste, com uma tentativa por entrega. Antes do envio simulado, revalida o
  estado da entrega e a elegibilidade e os vínculos da conta destinatária.
- **Correção da revisão:** o simulador recebe somente o identificador da
  conta no campo de destinatário. A migration não cria função para resolver o
  endereço original e preserva os privilégios existentes da tabela de contas.
  Negativas de listagem administrativa de participantes geram auditoria de
  segurança sem identificar o recurso ou divulgar dados de participantes.
- **Provas da correção:** a credencial de runtime usada no Docker tenta ler a
  coluna de endereço e chamar a função ausente após recolocar uma entrega
  concluída em processamento em uma transação revertida. As duas leituras
  são recusadas. O cenário também confere as negativas auditadas de consulta
  ao Workspace e ao quadro.

## Listas e cartões básicos — BEL-003, BEL-004 e BEL-005

- **Ciclo — VERIFICADO:** branch `work/listas-cartoes-basicos`,
  `BASE_MAIN_SHA=4b25faecf264eef8a381ed8fafa2ef32bfa89594`, com a base local
  e remota conferidas antes da abertura. Os principais riscos são vazamento
  entre quadros, duplicação após perda de resposta e gravação parcial.
- **Escopo implementado:** quadro novo vazio, listas criadas e renomeadas
  pelo usuário, cartões com edição de título e descrição, leitura por
  Observadores e escrita por Administradores e Membros do quadro. A API
  valida a hierarquia e exige participação no quadro, inclusive por URL direta.
- **Consistência:** criação reconciliada por identificador de operação.
  Alterações efetivas, auditoria e feed são gravados na mesma transação.
  O contrato está em [persistência e auditoria](arquitetura/persistencia-e-auditoria.md#listas-e-cartões-básicos).
- **Migration:** a autorização específica cobre SELECT e INSERT nas duas
  tabelas novas, UPDATE de nome na lista e UPDATE de título e descrição
  no cartão para `bello_runtime`. A validação usa banco descartável.
- **Aceite em Docker — VERIFICADO:** 15 cenários passaram com contas sintéticas,
  Chromium e PostgreSQL descartável
  para isolamento entre Trabalho e Pessoal, acesso direto, persistência após
  recarga, perda de resposta e rollback por falhas independentes na auditoria
  e no feed.

- **Qualidade local — VERIFICADO:** `quality:local` passou com 806 testes
  da API, 81 da web e cobertura acima de 90% nas quatro métricas por aplicação
  e no consolidado. Registro anterior ao commit, publicação e CI remoto.

## Ordenação e movimentação no quadro

- **Ciclo:** `work/ordenacao-movimentacao`,
  `BASE_MAIN_SHA=78d32584390e68e7b7f245cc2f5c8be36c0098b5`.
  Escopo BEL-006 a BEL-008 e BEL-010. Riscos centrais são perda de itens,
  divergência sob concorrência e ampliação de acesso entre quadros.
- **Decisão do recorte:** posições BIGINT e espaçamento 2³², aprovados após
  a prova PT-002. Sob mil movimentos no mesmo intervalo, sete rodadas por
  parâmetro, o candidato reduziu os rebalanceamentos de 100 para 31.
- **Implementação:** reordenação de listas e cartões e movimentos entre
  listas do mesmo quadro, com controles de arraste e alternativas por botão.
  Revisões detectam alterações e a consulta periódica atualiza o quadro.
  O [contrato de persistência](arquitetura/persistencia-e-auditoria.md#ordenação-de-listas-e-cartões)
  descreve bloqueios, recompactação e rastreabilidade.
- **Privilégios aprovados:** UPDATE somente nas colunas de posição, vínculo
  de cartão e revisões usadas pelo incremento. Migration validada em
  PostgreSQL descartável.

- **Validação local — VERIFICADO:** gate completo com 813 testes da API,
  84 da web e cobertura acima de 90% em todas as métricas. Os 15 cenários
  em Docker passaram. A validação observou espera real de transações
  concorrentes, movimentos cruzados e sobre o mesmo cartão, rebalanceamento
  sob intervalo esgotado, atualização entre abas, repetição idempotente e
  rollback por falha de auditoria ou feed. Registro anterior ao CI remoto.

## Gestão de acesso ao quadro

- **Ciclo:** `work/gestao-participantes-quadro`,
  `BASE_MAIN_SHA=baf62dcab7b8c0b17cf119f4f2f70a05d8d5973b`.
  Recorte de BEL-026 a BEL-028 para alterar papéis e remover participantes
  com confirmação, proteção do último Administrador ativo e revogação
  de acesso na API e em abas abertas.
- **Privilégios autorizados:** UPDATE apenas de role e DELETE na tabela
  `board_membership` para `bello_runtime`. Validação em PostgreSQL
  descartável. O [contrato](arquitetura/persistencia-e-auditoria.md#alterações-de-participantes-do-quadro)
  descreve a revalidação e os registros transacionais.

- **Validação local — VERIFICADO:** gate completo e 16 cenários em Docker
  com Chromium e PostgreSQL descartável aprovados. A prova confirmou
  rebaixamento e remoção em duas sessões, autorização na API, replay,
  rollback obrigatório e preservação do último Administrador ativo sob
  contenção real. Registro anterior ao CI remoto.

## Datas e conclusão dos cartões

- **Ciclo:** `work/datas-conclusao-cartoes`,
  `BASE_MAIN_SHA=2e48c1e540577f68b3b9c8186d4fd6ddaa819ab5`.
  Escopo BEL-024, com datas civis opcionais e conclusão manual independente
  de lista. O [contrato](arquitetura/persistencia-e-auditoria.md#datas-e-conclusão-dos-cartões)
  detalha fuso, atraso, reabertura e rastreabilidade.
- **Privilégios autorizados:** UPDATE apenas nas quatro colunas de datas e
  conclusão de `board_card` para `bello_runtime`.

- **Validação local — VERIFICADO:** gate completo com 824 testes da API e
  88 da web, cobertura acima de 90% e 16 cenários Docker aprovados.
  Os cenários verificaram limite civil em PostgreSQL, reabertura com
  histórico, autorização, mudança de fuso, preservação em movimento,
  repetição e rollback da auditoria ou do feed. Registro anterior ao CI remoto.

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
