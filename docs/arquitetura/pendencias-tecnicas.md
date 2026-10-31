# Pendências técnicas

## Convenção

Os itens abaixo não são decisões aprovadas. Eles registram escolhas, provas de conceito ou validações necessárias antes ou durante a implementação. Uma resolução futura deve indicar a AT afetada, evidências e impactos, sem alterar silenciosamente regras funcionais.

## Pendências prioritárias antes da implementação

| ID técnico | Pendência | AT relacionada | Resultado esperado |
|---|---|---|---|
| PT-001 | versões específicas e compatibilidade de Node.js, Angular, NestJS, Prisma e PostgreSQL | todas | matriz de versões suportadas e política de atualização |
| PT-002 | representação física das posições esparsas e critério de rebalanceamento | AT-004 | prova de concorrência, precisão, crescimento e ordenação estável |
| PT-003 | bloqueios, ordem de aquisição, isolamento e repetição por operação | AT-003, AT-004 | catálogo por mutação crítica com comportamento de conflito |
| PT-004 | modelo físico, restrições e índices | AT-003, AT-004, AT-006 | modelo revisado contra autorização, consultas e desempenho |
| PT-005 | configuração final de cookies, CSRF, origens e domínios | AT-001, AT-005 | configuração validada na topologia de implantação |
| PT-006 | protocolo de revisão, mensagens, reconexão e verificações periódicas | AT-005 | contrato de sincronização e recuperação testável |
| PT-007 | tratamento seguro de links/tokens nas solicitações persistidas de e-mail | AT-009 | fluxo sem segredo recuperável desnecessário |
| PT-008 | limites de tentativas para login, recuperação, transações e e-mail | AT-001, AT-003, AT-009 | limites e respostas aprovados com critérios de segurança |

## Pendências operacionais

| ID técnico | Pendência | AT relacionada | Resultado esperado |
|---|---|---|---|
| PT-009 | provedor SMTP ou API | AT-009 | fornecedor/configuração, limites, erros e ambiente de teste |
| PT-010 | hospedagem, terminação TLS e destino externo de backups | AT-007 | topologia operacional e responsabilidades claras |
| PT-011 | política de retenção de backups | AT-006, AT-007 | prazo, descarte e relação com retenção da auditoria |
| PT-012 | mecanismo de backup-base, WAL e restauração | AT-007 | RPO/RTO demonstrados por exercício mensal |
| PT-013 | mecanismo de expurgo da auditoria | AT-006 | execução controlada, observável e compatível com backups |
| PT-014 | ferramentas e limiares de logs, métricas, erros e alertas | AT-007, AT-010 | conjunto mínimo operacional sem plataforma excessiva |
| PT-015 | ferramentas e desenho do pipeline de testes/CI | AT-010 | execução reproduzível dos gates aprovados |
| PT-016 | capacidade, desempenho e limites operacionais | AT-003–AT-007, AT-009 | metas e testes baseados em carga esperada |

## Pendências de bootstrap e migrations

| ID técnico | Pendência | AT relacionada | Resultado esperado |
|---|---|---|---|
| PT-017 | interface, autorização e evidências da CLI de bootstrap | AT-008 | procedimento único, concorrente-seguro e não público |
| PT-018 | procedimento de recuperação administrativa emergencial | AT-008 | fluxo offline, restrito, auditado e priorizando conta existente |
| PT-019 | credenciais e fluxo operacional de migrations | AT-006–AT-008 | separação comprovada entre aplicação, migration e manutenção |
| PT-020 | política de compatibilidade e recuperação de migrations | AT-007, AT-008 | validação prévia e resposta documentada a falha |

## Pendências técnicas herdadas da especificação funcional

| PEN | Situação após as ATs | Trabalho ainda necessário |
|---|---|---|
| PEN-022 — armazenamento da auditoria | AT-006 aprova PostgreSQL, append-only e separação de credenciais | formato físico, índices, volume e eventual particionamento |
| PEN-023 — consistência mutação/auditoria | AT-003 aprova transação única e rollback integral | provar comportamento com Prisma/PostgreSQL e falhas reais |
| PEN-024 — adulteração | AT-006 aprova privilégios restritos e reconhece limite contra administrador do banco | desenhar papéis, grants e verificação operacional |
| PEN-025 — expiração após 24 meses | AT-006 aprova expurgo automático controlado | escolher mecanismo, agendamento e interação com backups |
| PEN-026 — falhas e indisponibilidade | AT-003 aprova rollback, repetição limitada e reconciliação | classificar erros, limites e procedimento de commit indeterminado |
| PEN-027 — desempenho e consulta | AT-006 preserva consultas funcionais aprovadas | índices, paginação, capacidade e consultas SQL justificadas |

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
