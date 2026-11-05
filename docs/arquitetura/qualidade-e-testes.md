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

O contrato de recuperação está aprovado, e a fundação PostgreSQL da F1-B.4.5.1 e
as operações da F1-B.4.5.2 foram publicadas. Casos de uso, admissão da
recuperação, processamento, HTTP e demais testes continuam pendentes. A entrega
completa deve cobrir:

- unitários: DTOs exatos, normalização, Base64URL canônica, hash com separação de
  domínio, transições, leases, cooldown, quotas, três tentativas, três tokens
  ativos e classificação `COMPLETED`, `REJECTED`, `NOT_FOUND`, `INCONSISTENT` e
  `UNKNOWN`;
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

#### Critérios específicos da F1-B.4.5.2

A F1-B.4.5.2 é aceita somente com PostgreSQL `18.6` real em banco
comprovadamente descartável e deve validar:

- equivalência byte a byte entre os vetores TypeScript e SQL do advisory lock,
  incluindo chave positiva e negativa, UUID canônico, concorrência entre aquisição
  antiga/nova, timeout e liberação após rollback;
- owner, `SECURITY DEFINER`, `search_path`, qualificação, ausência de SQL dinâmico,
  negação de shadowing por `pg_temp`, `REVOKE` de `PUBLIC`, bootstrap e manutenção
  e `EXECUTE` mínimo do runtime;
- ausência de novo `SELECT` ou DML direto do runtime em hash de recuperação,
  credencial e tabelas de recuperação, preservando somente acessos anteriores do
  login;
- intenção confirmada antes do Argon2id e nenhuma transação aberta durante o
  cálculo; reconciliação durante esse intervalo retorna `UNKNOWN` sem
  terminalizar; fixture com PHC sintético comprova apenas a fronteira PostgreSQL;
- ordem física da intenção com descoberta otimista, advisory lock, conta,
  credencial, token explícito e somente então `INSERT` do marcador, incluindo os
  locks implícitos das FKs, concorrência contra writers antigos e novos e
  interação com limpeza por `SKIP LOCKED`;
- rollback integral por falha controlada em consumo, credencial, invalidação,
  cancelamento de request, cancelamento de tentativa, revogação de sessão,
  auditoria e terminalização;
- consumo único sob dois resets concorrentes, reset contra login e operações em
  contas independentes, sem deadlock e com row locks ordenados por UUID;
- zero, uma e várias sessões, contagens auditadas inclusive zero, preservação de
  sessões previamente revogadas e não atribuição de sessões posteriores ao reset;
- `REJECTED` para token conhecido expirado, previamente consumido ou invalidado,
  corrida perdida, inelegibilidade e divergência da credencial; token não
  resolvido sem marcador/auditoria; falha operacional sem falsa rejeição;
- matriz de conclusão por estado: mutação a partir de `STARTED`, retorno
  idempotente comprovado para `COMPLETED`/`REJECTED` e falha operacional
  `RECONCILIATION_REQUIRED`, sem efeito, para
  `NOT_FOUND`/`INCONSISTENT`/`UNKNOWN`;
- correlação direta de cancelamento de request e tentativa, preservação de
  `SENDING` e estados terminais, não sobrescrita de correlações anteriores e
  preenchimento/limpeza de todos os campos exigidos pelas constraints de
  `CANCELLED`;
- matriz completa de `COMPLETED`, `REJECTED`, `NOT_FOUND`, `INCONSISTENT` e
  `UNKNOWN`, auditoria isolada insuficiente, evidência parcial, retenção e
  alteração posterior da credencial por cadeia válida;
- assinatura observacional de
  `reconcile_password_reset_operation(reset_operation_id uuid)`, ausência de
  função de fechamento e de overload com modo mutável, e
  negação de `EXECUTE` runtime em qualquer função capaz de terminalizar intenção
  sem efeitos;
- reconciliação de `STARTED` e `UNKNOWN` sem qualquer alteração do marcador ou das
  evidências; idade, timeout, reinício, lock livre, ausência de efeitos e Argon2id
  ainda em andamento permanecem `UNKNOWN` e nunca geram `NOT_FOUND`;
- reconhecimento de fixture terminal `NOT_FOUND` preparada pelo migrator somente
  quando a ausência de efeitos for coerente, sem tratar a fixture como fluxo
  funcional ou conceder ao runtime capacidade de produzi-la;
- retries apenas para `40001`, `40P01` e `55P03` de `lock_timeout` comprovado,
  no máximo duas novas tentativas completas, e nenhuma repetição de conexão ou
  commit indeterminado antes da reconciliação; e
- regressão de bootstrap, criação/resolução de sessão, login, falha de login,
  logout, logout global e reconciliação já publicada.

Fixtures montadas pelo migrator não contam como evidência de request, claim,
geração de token, entrega ou provider. O gate preserva mínimo de 90% em lines,
statements, functions e branches por aplicação e consolidado e os jobs
obrigatórios `Quality`, `API integration` e `Required`. Testes automatizados não
acessam banco persistente e a limpeza é restrita aos recursos comprovadamente
criados pela própria execução.

#### Critérios específicos da F1-B.4.5.3

A F1-B.4.5.3 é aceita somente com testes determinísticos que comprovem:

- capacidade `3` e reposição de dez minutos para identidade ou sentinela da
  solicitação, `30` e um minuto para seu IP e `60` e cinco segundos para o IP do
  reset, sem bucket por token;
- reserva simultânea de identidade/sentinela e IP sem débito parcial, inclusive
  sob concorrência, e restituição idempotente sem exceder a capacidade;
- normalização idêntica para variações da mesma identidade e sentinela única para
  entradas não normalizáveis, sem armazenar ou revelar e-mail bruto;
- `Retry-After` inteiro correspondente à maior espera aplicável, sem revelar qual
  bucket limitou a requisição;
- ausência de PostgreSQL, Argon2id e auditoria funcional depois de `429` ou `503`
  de pré-admissão;
- limites estritos de 16.000 identidades e 4.000 IPs, remoção apenas de bucket
  recuperado, limpeza incremental, saturação localizada e ausência de expulsão de
  entrada restritiva;
- duas execuções Argon2id globais para login e reset, fila FIFO de quatro e espera
  máxima de um segundo, sem ultrapassagem que produza starvation indevida;
- exclusão mútua entre aquisição, timeout e cancelamento, retirada de espera ainda
  não admitida e liberação única somente após o trabalho iniciado terminar;
- preservação integral das quotas, respostas, cancelamentos, concorrência e
  resultados publicados do login, incluindo configuração válida e fail-fast; e
- relógio controlável e promises coordenadas, sem sleeps como prova.

Os testes não precisam de PostgreSQL porque o incremento não executa persistência.
Permanecem obrigatórios lint, typecheck, testes unitários, build, cobertura mínima
de 90% em lines, statements, functions e branches por aplicação e consolidado e
os jobs `Quality`, `API integration` e `Required`. Esta evidência cobre somente o
recorte de admissão/capacidade e não encerra a PT-008 integralmente.

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

