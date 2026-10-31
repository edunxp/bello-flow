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
| 2026-10-30 | AT-001 a AT-010 consolidadas como aprovadas pelo responsável pelo produto. |

## Política de alteração

Uma alteração futura deve preservar o identificador AT, registrar data, estado anterior, estado novo, justificativa, impactos e eventuais substituições. Pendências não podem ser apresentadas como decisões aprovadas.
