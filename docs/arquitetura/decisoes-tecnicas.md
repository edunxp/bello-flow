# Decisões técnicas do Bello Flow

## Convenções

- **AT** identifica uma decisão arquitetural aprovada.
- As regras numeradas em cada AT são normativas para a implementação.
- Parâmetros aprovados complementam as dez regras sem criar funcionalidade nova.
- Itens ainda não aprovados permanecem em [pendencias-tecnicas.md](pendencias-tecnicas.md).
- Regras funcionais continuam normativas e não são substituídas por este documento.

## AT-001 — Autenticação e segurança das sessões

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. A autenticação utiliza e-mail e senha, em conformidade com DEC-020.
2. Senhas são armazenadas com Argon2id e nunca em formato recuperável.
3. Sessões são persistidas no PostgreSQL e identificadas por valores criptograficamente aleatórios.
4. A sessão é transportada por cookie `HttpOnly`, `Secure` e `SameSite`; tokens de sessão não são armazenados no armazenamento JavaScript do Angular.
5. Cada requisição protegida valida a sessão, o estado ativo da conta e as permissões atuais.
6. Logout revoga a sessão no servidor.
7. Desativação da conta e redefinição de senha revogam as sessões existentes.
8. Autenticação, falhas, recuperação e revogações são auditadas conforme a matriz funcional aprovada, sem registrar segredos.
9. Mutações são protegidas contra CSRF, validam a origem aplicável e utilizam HTTPS.
10. WebSocket é autenticado pela sessão e revalida sessão e permissões durante seu uso.

### Parâmetros aprovados

- expiração por inatividade: 8 horas;
- vida absoluta: 7 dias;
- múltiplos dispositivos permitidos;
- encerramento global de sessões disponível.

### Complemento aprovado — imutabilidade do e-mail no MVP

- **Estado:** Aprovada
- **Data de aprovação:** 2026-11-04
- **Justificativa:** manter um localizador de autenticação e recuperação estável sem substituir o UUID técnico interno nem introduzir fluxo de alteração de identidade no MVP.
- **Identidade:** `account.id` UUID permanece o identificador técnico interno; `account.email` e `account.email_key` são únicos e imutáveis após a criação da conta.
- **Verificação:** `email_verified_at` permanece estado separado, e a verificação inicial continua obrigatória antes do acesso protegido.
- **Aplicação:** não existe operação de alteração ou substituição de e-mail no MVP.
- **PostgreSQL:** a credencial runtime não recebe `UPDATE` sobre `account.email` ou `account.email_key`; concessões futuras para ciclo de vida ou verificação da conta devem continuar excluindo essas colunas.
- **Ciclo de vida:** desativação não libera nem transfere o endereço.
- **Limite:** não são definidos trigger, migration adicional ou procedimento excepcional de alteração; mudanças futuras desse contrato exigem nova decisão aprovada.
- **Rastreabilidade:** complementa DEC-020, RN-069–RN-072, RN-120–RN-125 e RN-128 sem resolver ou reclassificar PT-003, PT-007, PT-008 ou PT-009.

### Complemento aprovado — resolução da PT-005

- **Estado:** Aprovada
- **Estado anterior:** pendência técnica não aprovada em PT-005
- **Data de aprovação:** 2026-11-03
- **Justificativa:** validar o transporte HTTP de sessão e os controles de CSRF
  na topologia same-origin escolhida para o MVP.
- **Impacto:** detalha AT-001 e a validação de origem prevista em AT-005, sem
  alterar regras funcionais, prazos server-side ou escopos de autorização.
- **Substituições:** nenhuma AT, DEC ou RN é substituída.
- Angular e NestJS compartilham a mesma origem pública; a aplicação ocupa `/`,
  a API funcional ocupa `/api` e o endpoint operacional `/health/live` é
  preservado. Produção usa proxy reverso, desenvolvimento usa o proxy do
  Angular e o frontend chama a API por URLs relativas.
- Em produção, a sessão usa o cookie `__Host-bello_flow_session`, com
  `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sem `Domain` e com
  `Max-Age=604800`. O prazo do cookie não substitui a validade server-side de
  8 horas de inatividade e 7 dias de vida absoluta.
- O token de sessão não integra respostas JSON, logs, métricas ou auditoria.
- Desenvolvimento prefere HTTPS para paridade. HTTP é permitido somente em
  loopback, com nome de cookie distinto, sem `Secure` exclusivamente nesse
  perfil, e deve ser rejeitado fora do ambiente local.
- Cada ambiente possui uma origem pública canônica. Esquema, host e porta são
  comparados exatamente; a origem autorizada não é derivada de `Host` ou de
  `X-Forwarded-*` fornecidos pelo cliente. Somente proxies conhecidos são
  confiados e devem remover ou sobrescrever headers encaminhados.
- CORS não é habilitado no MVP same-origin: a API não autoriza origens
  externas, não emite `Access-Control-Allow-Origin` ou
  `Access-Control-Allow-Credentials` e não usa wildcard nem reflexão de
  `Origin`.
- Chamadas protegidas da aplicação, inclusive GET autenticado, exigem uma
  única ocorrência lógica de `X-Bello-Flow-Request: 1`; endpoints operacionais
  explicitamente públicos são dispensados e não resolvem sessão.
- Métodos mutáveis validam `Origin` exatamente contra a origem configurada ou,
  quando ele estiver ausente, a origem de um `Referer` válido. `Origin: null`,
  valores múltiplos, inválidos ou ausência de ambos são rejeitados. Endpoints
  mutáveis com corpo JSON aceitam somente `application/json`; endpoints sem
  corpo não recebem exigência artificial de `Content-Type`. O login aplica os
  controles antes da autenticação.
- Não há token CSRF persistido adicional nesta primeira versão. Os controles
  de header, origem, conteúdo, cookie e HTTPS permanecem complementares.
- Toda requisição protegida válida pode contar como atividade, inclusive GET e
  polling, preservando o intervalo mínimo existente de cinco minutos e sem
  ampliar a vida absoluta.
- Logout confirma a revogação antes do sucesso e limpa o cookie com nome,
  `Path` e escopo compatíveis. Resultado indeterminado segue reconciliação; o
  servidor não presume entrega do cookie após transmitir a resposta nem trata
  o fechamento posterior da conexão como falha de entrega.

O contrato detalhado e seus limites operacionais estão em
[segurança e autorização](seguranca-e-autorizacao.md#transporte-http-cookie-origem-cors-e-csrf).

### Complemento aprovado — contratos HTTP D1–D5 da F1-B.4

- **Estado:** Aprovado, implementado e publicado
- **Data de aprovação:** 2026-11-03
- **Justificativa:** definir a fronteira HTTP mínima de autenticação sobre os
  serviços e a persistência já existentes, sem expor contratos internos.
- **Impacto:** detalha AT-001, AT-003 e a PT-005; não altera regras funcionais,
  prazos de sessão, política de auditoria ou escopos de autorização.
- **Substituições:** nenhuma AT, DEC ou RN é substituída.
- **Implementação:** a F1-B.4.1 implementou a fundação e as primitivas HTTP no
  commit `6bdf62be85ba5c7eb91f6ffd41b872b2e3b5ebcc`; a F1-B.4.2 implementou os casos
  públicos de sessão e o encapsulamento de D5 no commit
  `9bb29a427cb74a712f008695712b8a4b77eacae4`; a F1-B.4.3 implementou a admissão
  protegida do login no commit `289a580842d812382bcb27070a4ab13a27864f45`.
  A F1-B.4.4 publicou a ligação dos quatro endpoints, das políticas HTTP e dos
  cookies no commit `d2343340a75ca6b15700e47738c8c34cbadc4202`; a execução CI
  `41831592216` foi aprovada nos jobs `Quality`, `API integration` e `Required`.
- **D1 — endpoints e erros:** a API de autenticação possui os contratos
  `POST /api/auth/login`, `GET /api/auth/session`,
  `POST /api/auth/logout` e `POST /api/auth/logout-all`, com identidade externa
  mínima, respostas de erro genéricas e sem exposição de token ou
  identificadores internos.
- **D2 — logout:** o logout atual sem sessão válida admite limpeza local
  idempotente e `204`; o logout global exige identidade autenticada válida e
  responde `401` quando ela não puder ser determinada.
- **D3 — indeterminação:** resultado indeterminado não é repetido
  automaticamente, não produz sucesso aparente e, em revogação, não limpa o
  cookie enquanto não houver confirmação ou reconciliação conclusiva.
- **D4 — CSRF e auditoria:** rejeições isoladas na fronteira HTTP por origem ou
  CSRF produzem somente logs técnicos estruturados e sem segredos. Os eventos
  funcionais existentes de autenticação e revogação permanecem inalterados; a
  admissão abusiva do login é detalhada pelo subconjunto aprovado da PT-008.
- **D5 — encapsulamento:** controllers utilizam exclusivamente o contrato
  público de `AuthenticationService`; `AuthSessionPersistence` permanece
  interno ao módulo e DTOs externos selecionam explicitamente seus campos.

O contrato completo, inclusive matriz de erros e limites de implementação, está
em [segurança e autorização](seguranca-e-autorizacao.md#contratos-http-de-autenticação--d1d5).

### Complemento aprovado — proteção do login da PT-008

- **Estado:** Aprovado e implementado para o login; PT-008 permanece parcial
- **Data de aprovação:** 2026-11-03
- **Complemento aprovado:** bucket sentinela compartilhado para e-mails não
  normalizáveis, incorporado em 2026-11-03 sem declarar implementação.
- **Escopo:** somente `POST /api/auth/login`; recuperação de senha não é regida
  por este complemento e foi posteriormente formalizada no complemento da
  F1-B.4.5, com implementação e processamento ainda pendentes.
- **Impacto:** detalha AT-001, AT-003, AT-005, AT-010 e os contratos HTTP D1–D5,
  sem alterar PT-005, regras funcionais, Argon2id ou auditoria de autenticações
  efetivamente avaliadas.
- **Substituições:** nenhuma AT, DEC ou RN é substituída.
- **PT-008/D1 — escopo:** somente o login é fechado por este recorte; o contrato
  de recuperação é fechado separadamente pela F1-B.4.5, sem declarar
  implementação ou provider produtivo.
- **PT-008/D2 — limites do login:** a admissão exige simultaneamente um token
  bucket por identidade normalizada,
  com capacidade 5 e reposição de um token a cada 180 segundos, e outro por IP
  confiável, com capacidade 60 e reposição de um token a cada 5 segundos.
- A normalização de e-mail é a mesma da autenticação existente. O bucket independe
  da existência da conta e não exige consulta ao PostgreSQL. Sucesso confirmado
  remove o bucket da identidade; o bucket do IP não é resetado.
- E-mails que não possam ser normalizados usam uma única chave técnica sentinela
  compartilhada, sempre combinada com o bucket do IP confiável. A sentinela tem
  capacidade de 5 tokens e repõe 1 token a cada 180 segundos, como uma identidade,
  ocupa uma única posição do mapa limitado a 16.000 identidades e não armazena o
  e-mail bruto nem consulta a existência da conta. Ela não consome o orçamento
  individual reservado às chaves normalizadas válidas.
- Esgotamento da sentinela retorna o mesmo `429 RATE_LIMITED` genérico. Quando a
  tentativa for admitida, a entrada não normalizável preserva a verificação
  Argon2id negativa e a auditoria funcional aplicável; rejeição determinada
  continua retornando o `401 AUTHENTICATION_FAILED` genérico.
- A reserva dos dois tokens é síncrona, atômica, identificada e anterior a
  PostgreSQL e Argon2id. Rejeição por limite não debita parcialmente, não desloca
  a reposição nem inicia autenticação.
- Rejeição determinada confirma o consumo; sucesso confirmado reseta somente a
  identidade; falha anterior à autenticação, falha operacional ou resultado
  indeterminado restituem a reserva de forma idempotente e sem exceder a
  capacidade. Resultado indeterminado preserva a reconciliação e não é repetido.
- **PT-008/D3 — auditoria:** `429` anterior à avaliação da credencial é rejeição
  técnica de admissão e produz somente log técnico ou métrica sem dados
  sensíveis. Não cria `AUTH_LOGIN_FAILED`; a auditoria funcional aprovada por
  RN-128 permanece para autenticações efetivamente avaliadas.
- **PT-008/D4 — resposta de limite:** a rejeição retorna
  `429 RATE_LIMITED` genérico com `Retry-After` em segundos até o próximo token;
  se ambos estiverem esgotados, prevalece a maior espera.
- **PT-008/D5 — armazenamento:** o estado é efêmero e local à instância única,
  com limites independentes de
  16.000 identidades e 4.000 IPs. Reinicialização zera os contadores. Somente
  bucket integralmente recuperado, sem reserva ou obrigação pendente, pode ser
  removido; bucket restritivo não é expulso nem tem sua proteção degradada.
- Na saturação, uma limpeza excepcional remove somente entradas elegíveis. Se a
  nova chave ainda não puder ser admitida, somente aquela requisição recebe
  `503 SERVICE_UNAVAILABLE`, sem autenticação, admissão parcial ou indisponibilidade
  global; buckets existentes continuam operando.
- **PT-008/D6 — capacidade Argon2id:** a execução protegida admite no máximo duas
  autenticações simultâneas e fila
  FIFO de até quatro posições, com espera positiva limitada a um segundo. Falha
  de aquisição retorna `503`; timeout, cancelamento e aquisição são mutuamente
  exclusivos; reserva e vaga são restituídas ou liberadas exatamente uma vez.
  Desconexão após o início não libera capacidade antes do fim real do trabalho.
- Configuração pode reduzir os limites aprovados, respeitando: identidades até
  16.000, IPs até 4.000, concorrência de 1 a 2, fila de 0 a 4 e timeout positivo
  de até um segundo. Configuração inválida impede a inicialização. Aumentos
  exigem evidência de capacidade e desempenho vinculada à PT-016.
- **PT-008/D7 — demais endpoints:** não são criadas quotas genéricas para sessão,
  logout ou logout global.

O detalhamento, os critérios de teste e os limites de saturação estão em
[segurança e autorização](seguranca-e-autorizacao.md#proteção-do-login--subconjunto-aprovado-da-pt-008).

### Complemento aprovado — F1-B.4.5 Recuperação de Senha

- **Estado:** Aprovado; fundação PostgreSQL F1-B.4.5.1 publicada e demais
  incrementos ainda pendentes
- **Data de aprovação:** 2026-11-04
- **Escopo:** formaliza exclusivamente a recuperação e a redefinição de senha da
  F1-B.4.5. Não altera os quatro endpoints publicados na F1-B.4.4, não implementa
  verificação inicial de e-mail, administração de contas ou alteração de e-mail e
  não declara disponibilidade produtiva.
- **Identidade:** `account.id` UUID permanece a identidade técnica. A resolução
  inicial usa `account.email_key`; `account.email` e `account.email_key` continuam
  imutáveis. A estrutura de recuperação persiste somente `account_id` nullable,
  nunca o e-mail bruto ou sua chave normalizada.
- **HTTP:** os contratos são `POST /api/auth/password-recovery`, com DTO exato
  `{ email }` e `202` sem corpo, e `POST /api/auth/password-reset`, com DTO exato
  `{ token, newPassword }` e `204` sem corpo. Ambos aplicam PT-005. Respostas de
  solicitação não distinguem existência, elegibilidade, cooldown ou limite de
  tokens da conta; tokens determinados como inválidos usam `401
  AUTHENTICATION_FAILED` uniforme.
- **Abuso:** a solicitação usa buckets simultâneos por identidade normalizada ou
  sentinela, com capacidade 3 e reposição de um token a cada 10 minutos, e por IP
  confiável, com capacidade 30 e reposição de um token por minuto. O reset usa
  bucket por IP confiável com capacidade 60 e reposição de um token a cada 5
  segundos. Mapas são limitados a 16.000 identidades e 4.000 IPs; saturação sem
  entrada removível retorna `503`. Cooldown persistente por conta é de 10 minutos.
  `429` inclui o maior `Retry-After` aplicável e não alcança PostgreSQL ou Argon2id.
- **Capacidade Argon2id:** login e reset compartilham o mesmo limite global de
  duas execuções, fila FIFO de quatro e espera máxima de um segundo. Cancelamento
  só retira espera ainda não admitida; trabalho iniciado mantém a vaga até terminar.
  As quotas próprias do login não são modificadas.
- **Token:** cada tentativa gera just-in-time 32 bytes de CSPRNG, codificados em
  Base64URL canônica sem padding. A validação persiste somente
  `SHA-256("bello-flow/password-reset/v1\0" || token_bytes)`. O token é de uso
  único, expira em 30 minutos e seu valor bruto existe somente na memória do
  processador entre preparação e chamada externa.
- **Outbox:** a persistência PostgreSQL é específica de recuperação, sem outbox
  genérica. Uma solicitação possui até três tentativas de entrega; cada tentativa
  possui no máximo um token. Requests usam os estados `RECEIVED`, `SUPPRESSED`,
  `PENDING`, `PREPARING`, `PREPARED`, `SENDING`, `SENT`, `FAILED`, `UNKNOWN` e
  `CANCELLED` como estado agregado; tentativas usam o subconjunto de processamento
  de `PREPARING` a `CANCELLED`. `SENDING` precisa de commit confirmado antes da
  chamada externa.
- **Falhas de entrega:** falha determinada pode criar nova tentativa após 1 e 5
  minutos, no máximo três tentativas totais. Crash em `PREPARED`, antes de
  `SENDING`, permite invalidar aquele token e preparar outro. Resultado externo
  indeterminado produz `UNKNOWN`, não é reenviado automaticamente, não recupera o
  token bruto, não inventa confirmação de entrega e preserva a expiração natural
  do token potencialmente entregue. Nova solicitação legítima continua possível
  conforme quotas, cooldown e teto de tokens ativos.
- **Concorrência:** criação de token e reset reutilizam o advisory lock derivado
  de `account.id`. A ordem é conta, credencial, marcador de reset existente
  quando aplicável, requests, tentativas, tokens, sessões e auditoria, com linhas
  da mesma classe ordenadas por UUID. Claim faz seleção otimista e, dentro da
  transação, adquire primeiro o lock da conta. Argon2id e chamadas externas nunca
  ocorrem dentro de transação aberta. O teto de três tokens ativos por conta é
  verificado sob esse lock.
- **Reset atômico:** depois do Argon2id e da aquisição dos locks, conta,
  credencial e token são revalidados. Consumo do token, atualização da credencial,
  invalidação dos demais tokens, cancelamento das intenções pendentes, revogação
  das sessões com `PASSWORD_RESET` e auditoria formam uma única transação.
  O endpoint não lê nem limpa cookie de sessão, pois um cookie presente pode
  pertencer a outra conta; PostgreSQL permanece a autoridade da revogação.
- **Correlação:** cada request possui `recovery_request_id`, cada tentativa possui
  `delivery_attempt_id` e cada reset possui `reset_operation_id`.
  `password_credential.changed_operation_id` registra explicitamente a última
  alteração. O backfill usa somente o `operation_id` comprovado do bootstrap e
  falha se encontrar credencial sem origem demonstrável; IDs não são inventados.
- Um marcador operacional específico de `reset_operation_id`, conta, token e
  correlação esperada da credencial preserva `STARTED`, `UNKNOWN` e conclusões
  através de reinício, sem armazenar segredo e sem substituir a auditoria. A
  F1-B.4.5.2 acrescenta `REJECTED` como conclusão terminal.
- **Reconciliação:** `COMPLETED`, `REJECTED`, `NOT_FOUND`, `INCONSISTENT` e
  `UNKNOWN` exigem o conjunto coerente de credencial, consumo/invalidação de
  tokens, cancelamentos, revogações e auditoria. Alteração posterior da credencial
  não apaga a prova de reset anterior: token consumido e auditoria transacional
  preservam a evidência, enquanto a alteração corrente também deve possuir
  correlação válida. Ausência de metadado eliminado legitimamente nunca é
  classificada como `NOT_FOUND`, e auditoria histórica isolada não substitui a
  prova transacional completa.
- **Auditoria:** ingressos operacionais, quotas, claims, leases, supressões e
  falhas anteriores à avaliação funcional permanecem em metadados operacionais,
  logs ou métricas minimizados. Somente solicitação elegível levada a `PENDING`,
  aceitação de envio e reset funcionalmente avaliado geram eventos funcionais,
  atômicos com sua mutação e sem e-mail, IP bruto, senha, PHC, token, hash ou link.
- **Retenção:** metadados terminais resolvidos são mantidos inicialmente por 30
  dias após `terminal_at`. Estados ativos, marcadores `UNKNOWN`, operações ainda
  reconciliáveis, pais com filhos protegidos e tokens potencialmente entregues
  ainda válidos não podem ser eliminados. Limpeza usa credencial de manutenção,
  lotes limitados e ordem tokens, tentativas e requests. Auditoria preserva sua
  retenção normativa de 24 meses.
- **Privilégios:** grants por coluna isolados não constituem garantia de
  atomicidade. A fundação F1-B.4.5.1 preserva negação do runtime nas novas tabelas,
  e a F1-B.4.5.2 aprova funções SQL restritas, transação única, grants mínimos e
  testes PostgreSQL reais, sem novo DML sensível direto do runtime.
- **Operação:** a origem confiável existente constrói a rota frontend
  `/reset-password`. Adapter controlado é permitido somente para validação. A
  PT-009 permanece aberta e a recuperação não pode ser declarada disponível em
  produção sem provider real, timeout, credenciais e política de erros aprovados.
- **Qualidade:** testes unitários, HTTP e PostgreSQL real cobrem anti-enumeração,
  quotas, estados, leases, crash, concorrência, rollback, uso único, expiração,
  reconciliação, grants, auditoria, retenção e regressão. Permanecem cobertura
  mínima de 90% nas quatro métricas por aplicação e consolidado e os jobs
  `Quality`, `API integration` e `Required`.
- **Pendências:** resolve normativamente PT-007 e o recorte de recuperação da
  PT-008; resolve em PT-003 apenas a ordem e a repetição desta operação. PT-003
  permanece aberta para outras mutações e para validação da implementação;
  PT-008 permanece aberta para evidências de implementação e processamento real;
  PT-009 permanece integralmente aberta.

### Rastreabilidade

- **Requisitos:** BEL-032, BEL-038.
- **Decisões funcionais:** DEC-010, DEC-020.
- **Regras:** RN-069–RN-072, RN-120–RN-129.
- **Relacionadas:** AT-002, AT-003, AT-005, AT-009.

### Complemento aprovado — F1-B.4.5.2 Operações Transacionais e Reconciliação

- **Estado:** Aprovado para implementação; implementação e evidências ainda
  pendentes.
- **Data de aprovação:** 2026-11-04.
- **Escopo:** restringe a F1-B.4.5.2 às operações PostgreSQL de intenção,
  conclusão e reconciliação do reset, à adequação do advisory lock usado pelo
  login, aos grants e aos testes PostgreSQL reais. Endpoint HTTP, quotas,
  geração e entrega produtiva de token, processamento de e-mail, provider e
  frontend permanecem em incrementos posteriores. Fixtures inseridas pelo
  migrator comprovam somente a fronteira PostgreSQL.
- **Fronteira protegida:** ficam aprovadas as interfaces conceituais
  `auth_account_advisory_lock_key(account_id uuid)`,
  `acquire_auth_account_advisory_xact_lock(account_id uuid)`,
  `start_password_reset_operation(...)`,
  `complete_password_reset_operation(...)` e
  `reconcile_password_reset_operation(reset_operation_id uuid)`. A chave é
  auxiliar interna; o runtime recebe `EXECUTE` somente nas operações necessárias.
  O migrator atual pode ser owner das funções `SECURITY DEFINER`; não se cria nova
  role.
- **Hardening:** funções protegidas validam argumentos estritamente, qualificam
  objetos, fixam `search_path = pg_catalog, public, pg_temp`, não usam SQL
  dinâmico e revogam execução de `PUBLIC`, bootstrap e manutenção. Não são
  concedidos novos DML sensíveis diretos ao runtime nem removidos os acessos já
  exigidos pelo login.
- **Lock compartilhado:** PostgreSQL reproduz exatamente o algoritmo existente:
  UUID v4 canônico em minúsculas, domínio UTF-8 `bello:auth:account:`, SHA-256,
  primeiros oito bytes e interpretação `bigint` signed big-endian. Caller não
  fornece a chave como autoridade. Código antigo e novo devem obter a mesma
  chave, comprovada inclusive pelos vetores
  `00000000-0000-4000-8000-000000000000` → `5305774703633831484` e
  `00000000-0000-4000-8000-000000000003` → `-9219222644233059831`, além de
  concorrência cruzada antes da troca do login.
- **Reset:** a intenção é persistida antes do Argon2id. O hash é calculado fora
  da transação e, quando integrado ao serviço, usa a capacidade global
  compartilhada. A conclusão adquire primeiro o advisory lock, revalida as
  precondições, bloqueia linhas na ordem normativa e grava atomicamente consumo,
  credencial, invalidações, cancelamentos, revogações, auditoria e terminalização.
  `STARTED` admite conclusão; `COMPLETED` e `REJECTED` admitem somente retorno
  idempotente comprovado; `NOT_FOUND`, `INCONSISTENT` e `UNKNOWN` recusam mutação
  de sucesso e exigem reconciliação.
- **Rejeição:** `REJECTED` fica aprovado como estado terminal do marcador e
  resultado explícito da reconciliação. Rejeição funcional determinada depois
  de resolver a conta produz auditoria e nenhum efeito de reset bem-sucedido.
  Token não resolvido não cria marcador nem auditoria vinculada à conta.
- **Cancelamento:** tentativa de entrega passa a possuir
  `cancelled_operation_id`; sua nulidade acompanha `CANCELLED`. Correlações
  terminais anteriores nunca são sobrescritas.
- **Reconciliação:** os resultados são `COMPLETED`, `REJECTED`, `NOT_FOUND`,
  `INCONSISTENT` e `UNKNOWN`. Estado terminal ou auditoria isolados nunca bastam.
  A operação é exclusivamente observacional e não altera marcador, auditoria nem
  efeitos de negócio. `STARTED` ou `UNKNOWN` sem evidência conclusiva retorna
  `UNKNOWN`; idade, timeout, reinício, lock livre e ausência de efeitos não provam
  abandono. `NOT_FOUND` somente é reconhecido quando o marcador já estiver
  terminal nesse estado e as evidências forem coerentes; nenhuma nova
  terminalização `NOT_FOUND` é produzida pelo runtime neste incremento. Commit
  indeterminado não é repetido antes de classificação conclusiva.
- **Concorrência:** `READ COMMITTED` é o padrão condicionado à prova dos locks e
  revalidações. `40001`, `40P01` e `55P03` exclusivamente por `lock_timeout` nos
  locks aprovados admitem até duas novas tentativas completas. Erros de conexão,
  `57014`, falhas não identificadas e qualquer commit possivelmente enviado não
  são repetidos antes da reconciliação. Na intenção, a linha do token é bloqueada
  antes do `INSERT` do marcador por causa da FK imediata; o advisory lock da conta
  preserva compatibilidade com a ordem global da conclusão.
- **Limites:** esta aprovação não declara a F1-B.4.5.2 implementada, não encerra
  PT-003, PT-007 ou PT-008 e não altera a situação integralmente aberta da
  PT-009. O protocolo autorizado para encerrar intenções abandonadas permanece
  pendente para incremento futuro, antes da disponibilização produtiva completa;
  esta etapa não aprova função de fechamento, nova role, credencial, ownership,
  lease, heartbeat ou fencing.

O contrato físico, os predicados de aplicabilidade, a matriz de evidências e os
campos de auditoria estão em
[persistência e auditoria](persistencia-e-auditoria.md#operações-transacionais-da-f1-b452),
e os limites de segurança estão em
[segurança e autorização](seguranca-e-autorizacao.md#fronteira-postgresql-da-f1-b452).

## AT-002 — Autorização centralizada

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. O NestJS possui um serviço central de políticas de autorização organizado por domínio.
2. Toda operação é negada por padrão quando não existir permissão explícita aplicável.
3. A decisão considera usuário, ação, recurso, participação e papel atuais.
4. Papéis globais, de Workspace e de quadro são independentes e não possuem herança implícita.
5. Governança administrativa e acesso ao conteúdo são avaliados separadamente.
6. HTTP, operações internas e WebSocket utilizam as mesmas políticas de negócio.
7. Consultas de coleções são restringidas no backend e no PostgreSQL; filtros do Angular não constituem controle de acesso.
8. Mutações sensíveis revalidam autorização dentro da transação.
9. Feed e auditoria autorizam cada evento contextualmente e redigem dados protegidos quando aplicável.
10. Negativas relevantes geram auditoria sem revelar existência ou conteúdo privado indevido.

### Parâmetros aprovados

- serviço central com políticas organizadas por domínio;
- resposta HTTP 404 quando a existência do recurso não puder ser revelada;
- resposta HTTP 403 nas demais negativas de autorização;
- sem cache persistente de permissões entre requisições no MVP;
- consulta do estado atual das permissões.

### Rastreabilidade

- **Requisitos:** BEL-026–BEL-032, BEL-035, BEL-036, BEL-038.
- **Decisões funcionais:** DEC-004, DEC-006–DEC-010, DEC-017, DEC-020, DEC-021.
- **Regras:** RN-007–RN-009, RN-017–RN-025, RN-083–RN-097, RN-124, RN-129.
- **Relacionadas:** AT-001, AT-003, AT-005, AT-006.

## AT-003 — Consistência transacional e auditoria obrigatória

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. A mutação de negócio e sua auditoria obrigatória são gravadas na mesma transação PostgreSQL.
2. O evento obrigatório de feed e a revisão aplicável participam da mesma transação.
3. A operação comunica sucesso somente depois da confirmação do commit.
4. Falha em qualquer gravação obrigatória provoca rollback integral.
5. Autorização, elegibilidade e condições de concorrência são revalidadas dentro da transação.
6. E-mails, WebSocket e chamadas externas não são realizados dentro da transação.
7. Transações permanecem curtas e todos os participantes utilizam o mesmo contexto transacional.
8. Conflitos recuperáveis admitem repetição automática limitada, com nova validação e proteção contra duplicidades.
9. A auditoria registra identificador, instante, ator ou origem, operação, resultado e correlação conforme a matriz funcional.
10. Resultado de commit indeterminado é reconciliado por identificador único de operação antes de qualquer repetição e não é presumido como sucesso ou falha definitiva.

### Parâmetros aprovados

- falha da auditoria obrigatória: rollback integral;
- conflitos recuperáveis: tentativas automáticas limitadas;
- commit indeterminado: identificador único e reconciliação antes de repetir;
- garantias sustentadas pelo PostgreSQL, não somente por convenções do Prisma.

### Rastreabilidade

- **Requisitos:** BEL-006–BEL-011, BEL-031, BEL-032 e mutações auditáveis do MVP.
- **Decisões funcionais:** DEC-009, DEC-010, DEC-016, DEC-018.
- **Regras:** RN-032–RN-038, RN-057–RN-059, RN-126–RN-130.
- **Pendências funcionais/técnicas de origem:** PEN-023, PEN-026.
- **Relacionadas:** AT-002, AT-004–AT-006, AT-009.

## AT-004 — Ordenação concorrente

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. Listas e cartões utilizam posições ordenáveis esparsas.
2. O backend determina a ordenação final confirmada.
3. Itens e contêineres possuem revisões granulares para detectar concorrência.
4. Uma movimentação informa item, origem, destino, vizinhos pretendidos e revisão conhecida.
5. Permissões, existência, vizinhos, revisão e estado operacional são revalidados dentro da transação.
6. Operações independentes são preservadas sempre que puderem ser conciliadas.
7. Conflitos sobre o mesmo item são serializados e prevalece a última operação confirmada pelo servidor.
8. Bloqueios são pontuais e adquiridos em ordem determinística.
9. Rebalanceamento restringe-se ao contêiner afetado e não muda a ordem funcional percebida.
10. Movimento confirmado atualiza ordenação, revisão, auditoria e feed aplicável atomicamente.

### Parâmetros aprovados

- posições esparsas;
- rebalanceamento controlado;
- revisões granulares de item e contêiner;
- bloqueios pontuais e determinísticos;
- representação física da chave de posição ainda pendente de validação.

### Rastreabilidade

- **Requisitos:** BEL-006–BEL-011, BEL-031, BEL-032.
- **Decisões funcionais:** DEC-016, DEC-018.
- **Regras:** RN-057–RN-059, RN-063–RN-066, RN-130.
- **Relacionadas:** AT-003, AT-005.

## AT-005 — Sincronização em tempo real

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. A sincronização utiliza WebSocket Gateway no NestJS com uma instância inicial do backend.
2. Todas as mutações continuam sendo feitas pela API HTTP.
3. A conexão WebSocket é autenticada pela sessão e valida sua origem.
4. A inscrição em um quadro exige autorização específica e atual.
5. Eventos são emitidos somente depois do commit confirmado.
6. Cada quadro possui revisão monotônica persistida para sinalizar alterações relevantes.
7. Mensagens carregam somente os dados mínimos necessários e não revelam informações protegidas.
8. Reconexão ou diferença de revisão provoca recuperação do estado autorizado por HTTP.
9. Revogação de acesso invalida inscrições afetadas e impede novas entregas protegidas.
10. Falha de comunicação não reverte alteração confirmada e a sincronização permanece recuperável.

### Parâmetros aprovados

- HTTP para mutações e WebSocket para notificações;
- revisão de sincronização persistida por quadro;
- recuperação por HTTP e verificações periódicas leves;
- uma instância de backend;
- sem Redis ou distribuidor externo no MVP;
- revisão de sincronização do quadro distinta das revisões granulares da AT-004.

### Rastreabilidade

- **Requisitos:** BEL-006–BEL-011, BEL-031, BEL-036.
- **Decisões funcionais:** DEC-006–DEC-009, DEC-016, DEC-018.
- **Regras:** RN-022–RN-031, RN-057–RN-059, RN-092–RN-094.
- **Relacionadas:** AT-001–AT-004.

## AT-006 — Proteção e retenção da auditoria

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. Registros de auditoria são append-only durante a retenção aplicável.
2. A credencial operacional da aplicação não possui `UPDATE`, `DELETE`, `TRUNCATE` ou DDL sobre a auditoria.
3. Manutenção utiliza credencial separada da credencial operacional.
4. Toda consulta de auditoria é protegida pelas políticas da AT-002.
5. Campos são exibidos, omitidos ou redigidos conforme a matriz aprovada em PEN-037.
6. A retenção é de 24 meses contados pelo instante de ocorrência do evento.
7. O expurgo é controlado e agendado e registra execução, período, quantidade e resultado.
8. Falha de consulta não expõe dados; falha da auditoria obrigatória segue o rollback da AT-003.
9. Identificadores e correlação permitem investigação sem armazenar credenciais ou tokens.
10. Backup e restauração preservam integridade, acesso restrito e política de retenção.

### Parâmetros aprovados

- append-only e privilégios PostgreSQL restritos;
- backups protegidos;
- sem verificação criptográfica adicional de integridade no MVP;
- expurgo automático agendado;
- credencial administrativa separada;
- a solução não garante inviolabilidade contra administradores privilegiados do banco.

### Rastreabilidade

- **Requisitos:** BEL-032, BEL-036, BEL-038.
- **Decisões funcionais:** DEC-003, DEC-008, DEC-010, DEC-015, DEC-020.
- **Regras:** RN-032–RN-038, RN-095–RN-097, RN-113–RN-115, RN-126–RN-130.
- **Pendências de origem:** PEN-022, PEN-024, PEN-025, PEN-027, PEN-037.
- **Relacionadas:** AT-002, AT-003, AT-007, AT-010.

## AT-007 — Infraestrutura e recuperação

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. A implantação inicial utiliza Docker Compose em servidor único.
2. Aplicação e PostgreSQL são serviços separados; o banco possui armazenamento persistente e não é exposto publicamente.
3. Todo acesso externo utiliza HTTPS/TLS e WebSocket seguro.
4. Segredos permanecem fora do código, das imagens e do versionamento.
5. Produção possui configuração própria, imagens versionadas, healthchecks, reinício e logs controlados.
6. Backups são automatizados, externos, protegidos e verificáveis.
7. Restaurações são testadas periodicamente em ambiente isolado.
8. Atualizações e migrations seguem procedimentos controlados.
9. Serviço, disco, backups e certificados possuem monitoramento essencial.
10. Recuperação preserva as regras de auditoria, retenção, sessões e permissões.

### Parâmetros aprovados

- backup-base acompanhado de arquivamento WAL;
- RPO-alvo de até 1 hora;
- RTO-alvo de até 4 horas;
- testes mensais de restauração;
- RPO e RTO são metas sujeitas a comprovação operacional.

### Rastreabilidade

- **Requisitos:** BEL-032, BEL-038 e disponibilidade do MVP.
- **Decisões funcionais:** DEC-010, DEC-020.
- **Regras:** RN-037, RN-118–RN-129.
- **Relacionadas:** AT-001, AT-006, AT-008–AT-010.

## AT-008 — Bootstrap e migrations

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. O primeiro Administrador Global é criado exclusivamente por bootstrap administrativo não público.
2. O bootstrap é de uso único e registra persistentemente sua conclusão.
3. Identidade, papel global, estado do bootstrap e auditoria inicial são criados atomicamente.
4. O e-mail é único e precisa estar verificado antes do primeiro login.
5. Segredos de ativação não são gravados em logs nem no versionamento.
6. Migrations Prisma são executadas separadamente com privilégios específicos.
7. A compatibilidade entre aplicação e banco é verificada antes da inicialização da aplicação.
8. Migrations de produção são versionadas, validadas e possuem plano de recuperação.
9. Recuperação emergencial é separada do bootstrap, restrita e auditada.
10. Operações administrativas preservam pelo menos um administrador obrigatório ativo em cada escopo funcional aplicável.

### Parâmetros aprovados

- bootstrap por CLI administrativa;
- execução única protegida contra concorrência;
- recuperação emergencial offline e controlada, priorizando conta existente;
- autorização e evidências obrigatórias;
- migrations como etapa administrativa separada.

### Rastreabilidade

- **Requisitos:** BEL-035, BEL-036, BEL-038.
- **Decisões funcionais:** DEC-005–DEC-008, DEC-020.
- **Regras:** RN-116–RN-125.
- **Pendências resolvidas funcionalmente:** PEN-035, PEN-036.
- **Relacionadas:** AT-001–AT-003, AT-006, AT-007.

## AT-009 — E-mails e notificações

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. O NestJS possui serviço de e-mail compatível com provedor SMTP ou API configurável.
2. Solicitações de envio são persistidas no PostgreSQL e processadas somente depois do commit da operação de origem.
3. Falha do provedor não desfaz operação de negócio já confirmada.
4. Tokens são criptograficamente aleatórios, de uso único e prazo limitado; somente seu hash é persistido na estrutura de validação.
5. O e-mail precisa ser verificado antes do acesso inicial protegido.
6. Recuperação não revela se a conta existe e possui limitação de frequência.
7. Redefinição de senha revoga sessões e gera auditoria sem segredos.
8. Inclusões diretas em Workspaces e quadros geram as notificações previstas na DEC-021.
9. Templates são padronizados, usam HTTPS e contêm apenas informações mínimas.
10. O sistema acompanha estado, tentativas limitadas, prevenção controlável de duplicidade e diagnóstico dos envios.

### Parâmetros aprovados

- pendências de envio persistidas no PostgreSQL;
- processador interno ao NestJS, sem fila externa;
- link de verificação válido por 24 horas;
- link de recuperação válido por 30 minutos;
- tokens de uso único;
- e-mail e Central de Notificações para inclusões em Workspace e quadro;
- não existe promessa de entrega exatamente uma vez pelo provedor.

### Rastreabilidade

- **Requisitos:** BEL-026, BEL-035, BEL-038.
- **Decisões funcionais:** DEC-020, DEC-021.
- **Regras:** RN-069–RN-076, RN-120–RN-128.
- **Relacionadas:** AT-001, AT-003, AT-007, AT-010.
- **Evolução:** a F1-B.4.5 aprovou geração just-in-time sem persistir token ou
  link recuperável. Implementação, evidência PostgreSQL e provider produtivo
  permanecem pendentes; PT-009 continua aberta.

## AT-010 — Observabilidade, testes e prontidão

- **Estado:** Aprovada
- **Data de consolidação:** 2026-10-30

### Regras técnicas

1. Logs estruturados registram horário, nível, módulo, operação e correlação.
2. Logs não registram senhas, tokens, cookies, credenciais ou conteúdo sensível desnecessário.
3. A aplicação expõe verificações distintas de atividade e prontidão.
4. São acompanhados erros, latência, transações, banco, WebSocket e notificações.
5. Existem alertas essenciais para infraestrutura, backup, disco e certificados.
6. Testes automatizados cobrem regras de negócio, autorizações e negativas.
7. Testes de integração usam PostgreSQL real para auditoria, rollback, idempotência, concorrência e ordenação.
8. O Angular possui testes de componentes e dos fluxos E2E essenciais.
9. O pipeline de CI valida código, tipos, testes e build.
10. A prontidão exige critérios documentados de segurança, integridade, funcionalidade, recuperação e ausência de defeitos críticos conhecidos.

### Parâmetros aprovados

- cobertura mínima global de 90%, com relatório;
- cenários críticos obrigatórios independentemente da cobertura numérica;
- pipeline CI obrigatório e aprovado antes de incorporar alterações à branch principal;
- logs, healthchecks, métricas e alertas essenciais;
- nenhuma plataforma complexa de observabilidade é obrigatória no MVP.

### Rastreabilidade

- **Requisitos:** todos os requisitos essenciais do MVP, com ênfase em BEL-010, BEL-032, BEL-036 e BEL-038.
- **Decisões funcionais:** DEC-003, DEC-007, DEC-010, DEC-016, DEC-020.
- **Regras:** RN-007–RN-010, RN-032–RN-038, RN-057–RN-059, RN-126–RN-130.
- **Relacionadas:** AT-001–AT-009.

## Histórico

| Data | Alteração |
|---|---|
| 2026-11-04 | Contrato da F1-B.4.5.2 aprovado para implementação, restringindo o incremento a intenção, conclusão, reconciliação observacional, advisory lock compartilhado, grants e testes PostgreSQL; fechamento autorizado de intenções abandonadas permanece futuro, sem declarar implementação e preservando PT-003, PT-007, PT-008 e PT-009 abertas. |
| 2026-11-04 | Contrato da F1-B.4.5 aprovado para implementação, formalizando recuperação de senha, HTTP, admissão, token, outbox específica, concorrência, reconciliação, retenção, privilégios e testes, sem declarar implementação ou disponibilidade produtiva e mantendo PT-009 aberta. |
| 2026-11-03 | Subconjunto de login da PT-008 aprovado para planejamento, com token buckets, memória limitada, saturação segura e concorrência Argon2id, sem declarar implementação; recuperação, transações e e-mail permanecem pendentes. |
| 2026-11-03 | D1–D5 aprovadas para os contratos HTTP de autenticação da F1-B.4, sem declarar implementação e preservando PT-005 e PT-008. |
| 2026-11-03 | PT-005 resolvida como complemento aprovado de AT-001 e AT-005, definindo topologia same-origin, cookie, origem, CORS e proteção CSRF da camada HTTP sem declarar implementação. |
| 2026-10-30 | AT-001 a AT-010 consolidadas como aprovadas pelo responsável pelo produto. |

## Política de alteração

Uma alteração futura deve preservar o identificador AT, registrar data, estado anterior, estado novo, justificativa, impactos e eventuais substituições. Pendências não podem ser apresentadas como decisões aprovadas.
