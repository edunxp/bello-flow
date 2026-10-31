# Qualidade, testes e prontidão

## Escopo

Este documento detalha [AT-010](decisoes-tecnicas.md#at-010--observabilidade-testes-e-prontidão). Ferramentas específicas ainda não foram escolhidas.

## Estratégia de testes

| Nível | Objetivo principal |
|---|---|
| unitário | regras de negócio, políticas, validações e transições isoladas |
| integração | Prisma/PostgreSQL, transações, privilégios, auditoria e concorrência reais |
| componente Angular | estados, interações, acessibilidade e apresentação autorizada |
| E2E | fluxos essenciais atravessando frontend, backend e PostgreSQL |
| recuperação | backup, WAL, restauração e metas operacionais |

A cobertura global mínima é 90% e precisa gerar relatório. Esse número não substitui os cenários críticos nem autoriza omitir testes por serem difíceis.

## Cenários críticos obrigatórios

- login, expiração, logout, revogação global e redefinição de senha;
- negação por padrão e segregação entre papéis global, Workspace e quadro;
- respostas 404/403 sem vazamento de existência ou conteúdo;
- ausência de acesso automático de administradores ao conteúdo;
- rollback da mutação quando auditoria ou feed obrigatório falha;
- reconciliação de commit indeterminado e prevenção de duplicidade;
- concorrência de movimentações no mesmo item e em itens independentes;
- nenhum cartão duplicado ou perdido após movimento/rebalanceamento;
- movimento entre quadros com autorização em origem e destino;
- revisão e recuperação por HTTP após perda de notificação WebSocket;
- revogação de acesso em conexão WebSocket ativa;
- append-only da auditoria pela credencial operacional;
- redação de valores protegidos conforme o contexto atual;
- retenção e expurgo controlado da auditoria;
- bootstrap único sob concorrência e recuperação emergencial controlada;
- processamento posterior de e-mail, expiração e uso único de tokens;
- desativação sem deixar escopo administrativo sem sucessor;
- restauração mensal e verificação dos objetivos RPO/RTO.

## Integração com PostgreSQL real

Testes críticos não devem substituir o PostgreSQL por implementação em memória. Devem validar:

- atomicidade e rollback;
- isolamento e bloqueios;
- restrições e privilégios;
- idempotência e correlação;
- ordenação e rebalanceamento;
- consultas e redação de auditoria;
- migrations quando forem criadas;
- comportamento de falhas recuperáveis.

## Frontend Angular

Os testes do Angular cobrem componentes e fluxos E2E essenciais, incluindo:

- drag-and-drop confirmado, rejeitado e corrigido;
- atualização recebida por WebSocket;
- reconexão e recuperação de diferença de revisão;
- estados de leitura do Observador;
- ausência de controles não autorizados sem tratar ocultação visual como segurança;
- mensagens de validação e conflito;
- sessão expirada ou revogada.

## CI

Antes de incorporar alterações à branch principal, o pipeline precisa concluir com sucesso:

- validações de código;
- verificação de tipos;
- testes automatizados;
- relatório de cobertura;
- build do Angular e do NestJS;
- cenários críticos aplicáveis ao conjunto alterado.

A ferramenta, os estágios físicos e a política detalhada de execução permanecem pendentes. Nenhuma configuração de CI foi criada nesta etapa.

## Observabilidade

Logs estruturados incluem horário, nível, módulo, operação e correlação, sem senhas, cookies, tokens ou conteúdo sensível desnecessário. Métricas e alertas essenciais cobrem aplicação, banco, WebSocket, notificações, disco, certificados e backups.

Atividade responde se o processo está funcionando; prontidão responde se pode receber tráfego com segurança. Uma plataforma complexa de observabilidade não é obrigatória no MVP.

## Critérios de prontidão

Uma entrega somente está pronta quando houver evidência de:

- requisitos e critérios funcionais do escopo atendidos;
- políticas de segurança e autorização testadas;
- transações e auditoria íntegras;
- concorrência e sincronização recuperáveis;
- migrations e compatibilidade verificadas;
- backup e restauração operacionalmente testados;
- healthchecks, logs, métricas e alertas essenciais ativos;
- cobertura mínima atingida e cenários críticos aprovados;
- ausência de defeitos críticos conhecidos;
- pendências aceitas explicitamente para a entrega.

## Rastreabilidade

- todos os 28 requisitos essenciais descritos em [escopo-mvp.md](../produto/escopo-mvp.md);
- ênfase em BEL-010, BEL-032, BEL-036 e BEL-038;
- DEC-003, DEC-007, DEC-010, DEC-016 e DEC-020;
- RN-007–RN-010, RN-032–RN-038, RN-057–RN-059 e RN-126–RN-130.

