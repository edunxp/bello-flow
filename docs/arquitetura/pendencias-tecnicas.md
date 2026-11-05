# Pendências técnicas

## Convenção

Os itens das seções de pendências abaixo não são decisões aprovadas. Eles
registram escolhas, provas de conceito ou validações necessárias antes ou
durante a implementação. Uma resolução futura deve indicar a AT afetada,
evidências e impactos, sem alterar silenciosamente regras funcionais. A seção
de pendências resolvidas preserva apenas a rastreabilidade e aponta para a
fonte normativa que aprovou cada resolução.

## Pendências prioritárias antes da implementação

| ID técnico | Pendência                                                                                                                                                                                                      | AT relacionada         | Resultado esperado                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| PT-001     | versões específicas e compatibilidade de Node.js, Angular, NestJS, Prisma e PostgreSQL                                                                                                                         | todas                  | matriz de versões suportadas e política de atualização                                                                         |
| PT-002     | representação física das posições esparsas e critério de rebalanceamento                                                                                                                                       | AT-004                 | prova de concorrência, precisão, crescimento e ordenação estável                                                               |
| PT-003     | bloqueios, ordem de aquisição, isolamento e repetição por operação; as operações F1-B.4.5.2 foram publicadas e provaram seu recorte, mas a pendência permanece para outras mutações                            | AT-003, AT-004         | catálogo por mutação crítica com comportamento de conflito e evidência real por operação                                       |
| PT-004     | modelo físico, restrições e índices                                                                                                                                                                            | AT-003, AT-004, AT-006 | modelo revisado contra autorização, consultas e desempenho                                                                     |
| PT-006     | protocolo de revisão, mensagens, reconexão e verificações periódicas                                                                                                                                           | AT-005                 | contrato de sincronização e recuperação testável                                                                               |
| PT-007     | tratamento seguro de links/tokens nas solicitações persistidas de e-mail; a fundação física foi publicada e o contrato não persiste token ou link recuperável, mas geração e processamento continuam pendentes | AT-009                 | comprovar geração just-in-time, hash de validação, estados e falhas em PostgreSQL real                                         |
| PT-008     | limites de tentativas para login e recuperação, transações e e-mail; login e F1-B.4.5.1–F1-B.4.5.4 estão publicados, enquanto redefinição e processamento da recuperação permanecem pendentes                  | AT-001, AT-003, AT-009 | implementar e validar redefinição, processamento e limites integrados da recuperação sem alterar as quotas publicadas do login |

O subconjunto de login da PT-008 foi aprovado em 2026-11-03 para planejamento,
sem que a aprovação, por si, declarasse implementação. A proteção foi publicada
na F1-B.4.3 pelo commit `289a580842d812382bcb27070a4ab13a27864f45` e ligada ao
endpoint de login pela F1-B.4.4 publicada no commit
`d2343340a75ca6b15700e47738c8c34cbadc4202`, cuja execução CI `41831592216` foi
aprovada nos jobs `Quality`, `API integration` e `Required`. O contrato define
os token buckets de identidade ou sentinela compartilhada e de IP confiável,
respostas `429` e `503`, memória efêmera limitada, saturação, concorrência
Argon2id e critérios de teste no
[complemento de AT-001](decisoes-tecnicas.md#complemento-aprovado--proteção-do-login-da-pt-008)
e no [contrato de segurança](seguranca-e-autorizacao.md#proteção-do-login--subconjunto-aprovado-da-pt-008).
Antes da formalização da F1-B.4.5, PT-008 permanecia sem limites aprovados para
recuperação de senha, retentativas transacionais e processamento de e-mails. As
decisões D1–D5 dos contratos HTTP permanecem preservadas e não criam quotas
genéricas para outros endpoints.

Em 2026-11-04, o complemento aprovado da F1-B.4.5 resolveu normativamente o
recorte de recuperação de senha de PT-007 e PT-008 e definiu, para essa operação,
a ordem de locks e repetição vinculada à PT-003. A fundação PostgreSQL da
F1-B.4.5.1 foi publicada no commit
`e8d464c56561df5dad50751ba3335b0b898c2752`, com relações, constraints, índices,
backfill, correlação da credencial, negação inicial de privilégios e testes reais.
Isso não implementa geração, processamento ou operações transacionais.

O contrato aprovado da F1-B.4.5.2 formalizou intenção, conclusão, reconciliação,
advisory lock compartilhado, grants e testes, inclusive `REJECTED` e correlação
de cancelamento das tentativas. O recorte foi publicado em quatro subincrementos,
com migrations, funções, grants e evidências PostgreSQL. Por isso PT-003 preserva
somente os demais recortes e mutações, PT-007 não é declarada encerrada e PT-008
continua aberta para admissão, casos de uso, processamento e limites reais. Os
contratos estão em
[decisões técnicas](decisoes-tecnicas.md#complemento-aprovado--f1-b45-recuperação-de-senha),
[segurança](seguranca-e-autorizacao.md#recuperação-de-senha--contrato-aprovado-da-f1-b45)
e [persistência](persistencia-e-auditoria.md#recuperação-de-senha-da-f1-b45), com
o recorte F1-B.4.5.2 detalhado em
[operações transacionais](persistencia-e-auditoria.md#operações-transacionais-da-f1-b452).
PT-009 permanece integralmente aberta: adapter controlado valida apenas o fluxo
técnico e não escolhe nem substitui provider SMTP/API produtivo.

A F1-B.4.5.3 foi publicada no commit
`47a6ae033f42d40b56c24bad82b454af0616e2ec`, com CI `42050631222` aprovado. Ela
implementa a admissão efêmera da recuperação e a capacidade Argon2id global
compartilhada sem alterar as quotas publicadas do login. PT-008 permaneceu aberta
porque classificação persistente, casos de uso e processamento ponta a ponta
ainda estavam pendentes naquele marco.

A F1-B.4.5.4 foi publicada no commit
`a57f718bf4efb74f2daa76c4b5127c9241d939be`, com CI `42069921440` aprovado. Ela
implementa solicitação e classificação protegidas, cooldown histórico,
reconciliação observacional, grants mínimos, admissão e anti-enumeração. Isso
reduz o recorte pendente da PT-008, mas não o encerra: redefinição, processamento,
entrega e limites ponta a ponta ainda exigem implementação e evidências.

O contrato da F1-B.4.5.5 formaliza o caso de uso interno de redefinição sobre as
operações SQL já publicadas, a política de senha e o executor Argon2id global.
A decisão F1-B.4.5.5/D1 consolida a matriz funcional da reserva de reset: refund
somente antes do envio do start ou após rollback comprovado dessa fase sem
`STARTED`; negativas determinadas, intenção confirmada, falhas posteriores e
indeterminação consomem a tentativa. Isso remove a decisão indispensável do
planejamento, mas não encerra PT-003, PT-007, PT-008 ou PT-009: implementação e
evidências do caso de uso, geração/processamento do token, fluxo integrado e
provider continuam pendentes. Frontend, provider, terminalização e retenção
pertencem a incrementos posteriores e não foram aprovados automaticamente.

A reconciliação da F1-B.4.5.2 é exclusivamente observacional e não produz nova
terminalização `NOT_FOUND`. O protocolo autorizado para encerrar intenções
abandonadas, inclusive autoridade e coordenação persistente entre executores,
permanece pendência operacional para incremento futuro antes da disponibilização
produtiva completa. Não se aprovam nesta etapa função de fechamento, nova role,
credencial, ownership, lease, heartbeat ou fencing. Essa postergação preserva
PT-003, PT-007, PT-008 e PT-009 abertas e não declara a recuperação funcional
concluída.

## Pendências técnicas resolvidas

Esta seção registra encerramentos para preservar rastreabilidade. O contrato
normativo aprovado permanece na decisão técnica e no documento arquitetural
indicados; o registro de encerramento não declara implementação.

| ID técnico | Estado                                 | Resolução                                                                                                                                                                                   | Evidência normativa                                                                                                                                                                     |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PT-005     | **Resolvida — aprovada em 2026-11-03** | mesma origem pública para Angular e NestJS; cookie host-only seguro; origem canônica; CORS desabilitado; proteção CSRF por header, origem e conteúdo; perfis de desenvolvimento controlados | [complemento de AT-001](decisoes-tecnicas.md#complemento-aprovado--resolução-da-pt-005) e [contrato de segurança](seguranca-e-autorizacao.md#transporte-http-cookie-origem-cors-e-csrf) |

## Pendências operacionais

| ID técnico | Pendência                                                 | AT relacionada        | Resultado esperado                                          |
| ---------- | --------------------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| PT-009     | provedor SMTP ou API                                      | AT-009                | fornecedor/configuração, limites, erros e ambiente de teste |
| PT-010     | hospedagem, terminação TLS e destino externo de backups   | AT-007                | topologia operacional e responsabilidades claras            |
| PT-011     | política de retenção de backups                           | AT-006, AT-007        | prazo, descarte e relação com retenção da auditoria         |
| PT-012     | mecanismo de backup-base, WAL e restauração               | AT-007                | RPO/RTO demonstrados por exercício mensal                   |
| PT-013     | mecanismo de expurgo da auditoria                         | AT-006                | execução controlada, observável e compatível com backups    |
| PT-014     | ferramentas e limiares de logs, métricas, erros e alertas | AT-007, AT-010        | conjunto mínimo operacional sem plataforma excessiva        |
| PT-015     | ferramentas e desenho do pipeline de testes/CI            | AT-010                | execução reproduzível dos gates aprovados                   |
| PT-016     | capacidade, desempenho e limites operacionais             | AT-003–AT-007, AT-009 | metas e testes baseados em carga esperada                   |

PT-015 possui evidência executável no workflow versionado de CI, com os jobs
`Quality`, `API integration` e `Required`, além do gate local reproduzível. A
pendência permanece aberta até revisão e aprovação específicas que confirmem se
essas evidências encerram integralmente ferramentas e desenho do pipeline.
Ferramentas e limiares operacionais de observabilidade continuam em PT-014.

## Pendências de bootstrap e migrations

| ID técnico | Pendência                                               | AT relacionada | Resultado esperado                                              |
| ---------- | ------------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| PT-017     | interface, autorização e evidências da CLI de bootstrap | AT-008         | procedimento único, concorrente-seguro e não público            |
| PT-018     | procedimento de recuperação administrativa emergencial  | AT-008         | fluxo offline, restrito, auditado e priorizando conta existente |
| PT-019     | credenciais e fluxo operacional de migrations           | AT-006–AT-008  | separação comprovada entre aplicação, migration e manutenção    |
| PT-020     | política de compatibilidade e recuperação de migrations | AT-007, AT-008 | validação prévia e resposta documentada a falha                 |

PT-017 possui evidências implementadas de interface, autorização, execução única,
concorrência e reconciliação da CLI no procedimento de bootstrap e em testes
PostgreSQL. Permanece aberta até revisão e aprovação documental específicas;
recuperação administrativa emergencial continua separada em PT-018.

PT-019 possui evidências locais e no CI da separação entre credenciais de
aplicação, migration, shadow, bootstrap e manutenção, incluindo migrations em
etapa administrativa. Permanece aberta porque o fluxo produtivo, a integração
com o mecanismo definitivo de secrets e os procedimentos de compatibilidade e
recuperação ainda não foram aprovados; estes últimos também permanecem em PT-020.

## Pendências técnicas herdadas da especificação funcional

| PEN                                      | Situação após as ATs                                                                 | Trabalho ainda necessário                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| PEN-022 — armazenamento da auditoria     | AT-006 aprova PostgreSQL, append-only e separação de credenciais                     | formato físico, índices, volume e eventual particionamento        |
| PEN-023 — consistência mutação/auditoria | AT-003 aprova transação única e rollback integral                                    | provar comportamento com Prisma/PostgreSQL e falhas reais         |
| PEN-024 — adulteração                    | AT-006 aprova privilégios restritos e reconhece limite contra administrador do banco | desenhar papéis, grants e verificação operacional                 |
| PEN-025 — expiração após 24 meses        | AT-006 aprova expurgo automático controlado                                          | escolher mecanismo, agendamento e interação com backups           |
| PEN-026 — falhas e indisponibilidade     | AT-003 aprova rollback, repetição limitada e reconciliação                           | classificar erros, limites e procedimento de commit indeterminado |
| PEN-027 — desempenho e consulta          | AT-006 preserva consultas funcionais aprovadas                                       | índices, paginação, capacidade e consultas SQL justificadas       |

As ATs definem a direção arquitetural dessas pendências, mas a evidência de implementação e os parâmetros não aprovados continuam abertos.

## Provas de conceito recomendadas

As provas abaixo validam decisões já aprovadas; não autorizam mudança funcional:

1. Transação Prisma/PostgreSQL com mutação, auditoria, feed e revisão, incluindo falha e commit indeterminado.
2. Ordenação esparsa concorrente com mesmo item, itens independentes, movimento entre contêineres e rebalanceamento.
3. Privilégios append-only e consulta redigida por escopo.
4. Sessão por cookie, CSRF e autenticação/revogação de WebSocket na topologia escolhida.
5. Persistência e processamento seguro de e-mails sem fila externa.
6. Backup-base, WAL e restauração medidos contra RPO/RTO.

## Itens explicitamente não abertos

Não são pendências do MVP atual:

- adoção de microsserviços;
- Redis;
- fila externa;
- Kubernetes;
- múltiplas instâncias do backend;
- verificação criptográfica adicional da auditoria.

Esses componentes somente podem ser reavaliados mediante necessidade demonstrada e nova decisão.
