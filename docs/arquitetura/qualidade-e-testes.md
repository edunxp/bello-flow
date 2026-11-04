# Qualidade, testes e prontidão

## Escopo

Este documento detalha [AT-010](decisoes-tecnicas.md#at-010--observabilidade-testes-e-prontidão). O pipeline automatizado está versionado em [CI](../../.github/workflows/ci.yml); ferramentas e limiares operacionais de observabilidade permanecem nas pendências técnicas aplicáveis.

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
- limitação do login por identidade e IP confiável, incluindo reposição,
  normalização, reserva atômica, `429`, `Retry-After` e ausência de enumeração;
- sentinela compartilhada para e-mails não normalizáveis, sempre combinada com
  IP confiável, sem armazenamento do e-mail bruto, com teto, reposição e
  esgotamento compartilhado comprovados;
- concorrência Argon2id, fila FIFO, timeout, cancelamento, restituição e liberação
  únicas, saturação e recuperação dos mapas sem expulsão de buckets ativos;
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

Os testes da proteção de login usam relógio controlável e promises coordenadas,
sem sleeps. Eles comprovam os tetos de memória e concorrência, `503` localizado,
reinicialização do estado efêmero, configuração inválida e resistência a headers
de proxy forjados, sem repetir provas criptográficas já cobertas. Também
comprovam que a sentinela ocupa uma única posição, não debita buckets individuais
de identidades válidas, retorna `429` genérico quando esgotada e, quando admite a
tentativa, preserva verificação negativa, `401` genérico e auditoria funcional.

### Matriz obrigatória da F1-B.4.5

O contrato de recuperação está aprovado, mas os testes e a implementação ainda
estão pendentes. A entrega deve cobrir:

- unitários: DTOs exatos, normalização, Base64URL canônica, hash com separação de
  domínio, transições, leases, cooldown, quotas, três tentativas, três tokens
  ativos e classificação `COMPLETED`, `NOT_FOUND`, `INCONSISTENT` e `UNKNOWN`;
- HTTP de solicitação: `202` sem corpo para identidade existente, inexistente,
  inválida, inelegível, em cooldown, já pendente ou com teto de tokens; header,
  origem, media type, campos extras, `429`, `Retry-After`, `503` e ausência de
  segredos;
- HTTP de reset: `204` sem corpo; `newPassword`; token não canônico, inexistente,
  expirado, consumido, invalidado e corrida determinada com o mesmo `401`;
  `400`, `429`, `503` e ausência de qualquer `Set-Cookie`;
- cookie: sessão de outra conta preservada e sessão da conta redefinida revogada
  no PostgreSQL e posteriormente resolvida como inválida;
- entrega: três tentativas e tokens históricos distintos, falha determinada com
  retentativa, crash em `PREPARING` e `PREPARED`, `SENDING` confirmado antes da
  chamada, `UNKNOWN` sem reenvio e expiração natural do token;
- concorrência: claims simultâneos, criação de tokens sob teto, dois resets do
  mesmo token, reset contra login, solicitação e envio, sem deadlock e com a ordem
  única de locks;
- transação: rollback em cada escrita obrigatória; consumo, credencial,
  invalidações, cancelamentos, revogações e auditoria atômicos; zero, uma e várias
  sessões;
- reconciliação: commit indeterminado, evidência parcial, alteração posterior da
  credencial, marcador operacional através de reinício, metadado legitimamente
  retido ou eliminado e ausência de falso `NOT_FOUND` ou falso sucesso;
- PostgreSQL: migration e backfill sem UUID inventado, constraints, índices,
  grants por coluna, negação das demais operações e eventual função SQL restrita
  caso os grants diretos não sustentem os invariantes;
- auditoria: eventos apenas após avaliação funcional, atomicidade e ausência de
  crescimento imutável por quotas, supressões e entradas hostis;
- retenção: 30 dias somente após término resolvido, proteção de `UNKNOWN` e de
  operações reconciliáveis, ordem de limpeza, lotes, interrupção e retomada;
- operação: origem HTTPS, rota `/reset-password`, adapter controlado identificado
  como teste e inicialização produtiva indisponível sem resolução da PT-009; e
- regressão: login, sessão, logout, logout global, compensação pré-transmissão,
  quotas do login, CORS desabilitado e `/health/live` preservados.

Relógios e promises são controlados; crash e concorrência não usam sleeps como
prova. Transações, locks, constraints, privilégios, backfill, reconciliação e
limpeza exigem PostgreSQL real descartável.

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

O workflow versionado de CI executa os jobs obrigatórios `Quality`, `API integration` e `Required`. O procedimento de preparação, publicação e verificação está em [Git e publicação](../operacao/git-e-publicacao.md).

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

