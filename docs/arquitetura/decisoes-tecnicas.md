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

- **Estado:** Aprovado; parcialmente implementado
- **Data de aprovação:** 2026-11-03
- **Justificativa:** definir a fronteira HTTP mínima de autenticação sobre os
  serviços e a persistência já existentes, sem expor contratos internos.
- **Impacto:** detalha AT-001, AT-003 e a PT-005; não altera regras funcionais,
  prazos de sessão, política de auditoria ou escopos de autorização.
- **Substituições:** nenhuma AT, DEC ou RN é substituída.
- **Implementação:** a F1-B.4.1 implementou a fundação e as primitivas HTTP no
  commit `6bdf62be85ba5c7eb91f6ffd41b872b2e3b5ebcc`; a F1-B.4.2 implementou os casos
  públicos de sessão e o encapsulamento de D5 no commit
  `9bb29a427cb74a712f008695712b8a4b77eacae4`. Controllers e endpoints de
  autenticação, a ligação das políticas HTTP e a admissão protegida do login
  permanecem ausentes.
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

- **Estado:** Aprovado para planejamento; não implementado
- **Data de aprovação:** 2026-11-03
- **Complemento aprovado:** bucket sentinela compartilhado para e-mails não
  normalizáveis, incorporado em 2026-11-03 sem declarar implementação.
- **Escopo:** somente `POST /api/auth/login`; recuperação de senha, retentativas
  transacionais e processamento de e-mails permanecem pendentes na PT-008.
- **Impacto:** detalha AT-001, AT-003, AT-005, AT-010 e os contratos HTTP D1–D5,
  sem alterar PT-005, regras funcionais, Argon2id ou auditoria de autenticações
  efetivamente avaliadas.
- **Substituições:** nenhuma AT, DEC ou RN é substituída.
- **PT-008/D1 — escopo:** somente o login é fechado; recuperação de senha,
  retentativas transacionais e processamento de e-mails permanecem abertos.
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

### Rastreabilidade

- **Requisitos:** BEL-032, BEL-038.
- **Decisões funcionais:** DEC-010, DEC-020.
- **Regras:** RN-069–RN-072, RN-120–RN-129.
- **Relacionadas:** AT-002, AT-003, AT-005, AT-009.

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
- **Pendência:** tratamento seguro dos links e tokens nas solicitações persistidas, sem armazenar segredo recuperável desnecessário.

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
| 2026-11-03 | Subconjunto de login da PT-008 aprovado para planejamento, com token buckets, memória limitada, saturação segura e concorrência Argon2id, sem declarar implementação; recuperação, transações e e-mail permanecem pendentes. |
| 2026-11-03 | D1–D5 aprovadas para os contratos HTTP de autenticação da F1-B.4, sem declarar implementação e preservando PT-005 e PT-008. |
| 2026-11-03 | PT-005 resolvida como complemento aprovado de AT-001 e AT-005, definindo topologia same-origin, cookie, origem, CORS e proteção CSRF da camada HTTP sem declarar implementação. |
| 2026-10-30 | AT-001 a AT-010 consolidadas como aprovadas pelo responsável pelo produto. |

## Política de alteração

Uma alteração futura deve preservar o identificador AT, registrar data, estado anterior, estado novo, justificativa, impactos e eventuais substituições. Pendências não podem ser apresentadas como decisões aprovadas.
