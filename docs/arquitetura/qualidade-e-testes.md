# Qualidade, testes e prontidão

## Escopo

Este documento detalha [AT-010](decisoes-tecnicas.md#at-010--observabilidade-testes-e-prontidão). O pipeline automatizado está versionado em [CI](../../.github/workflows/ci.yml); ferramentas e limiares operacionais de observabilidade permanecem nas pendências técnicas aplicáveis.

## Estratégia de testes

| Nível              | Objetivo principal                                                         |
| ------------------ | -------------------------------------------------------------------------- |
| unitário           | regras de negócio, políticas, validações e transições isoladas             |
| integração         | Prisma/PostgreSQL, transações, privilégios, auditoria e concorrência reais |
| componente Angular | estados, interações, acessibilidade e apresentação autorizada              |
| E2E                | fluxos essenciais atravessando frontend, backend e PostgreSQL              |
| recuperação        | backup, WAL, restauração e metas operacionais                              |

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
as operações da F1-B.4.5.2, a admissão/capacidade da F1-B.4.5.3 e a
solicitação/classificação da F1-B.4.5.4 e a redefinição interna da F1-B.4.5.5
foram publicadas. O processamento da F1-B.4.5.6 também foi publicado; o provider
da F1-B.4.5.7 possui contrato e implementação publicados. HTTP público e demais
testes ponta a ponta continuam pendentes. A entrega completa deve cobrir:

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

A F1-B.4.5.3 foi publicada no commit
`47a6ae033f42d40b56c24bad82b454af0616e2ec`, após testes determinísticos que
comprovaram:

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

#### Evidências publicadas da F1-B.4.5.4

A implementação publicada no commit
`a57f718bf4efb74f2daa76c4b5127c9241d939be`, com CI `42069921440` aprovado,
preserva evidências separadas por camada.

Testes unitários NestJS, com mocks estritos e relógio controlado, devem comprovar:

- identidade canônica e uso da sentinela somente na admissão, sem persistência ou
  exposição de e-mail bruto;
- reserva antes do acesso ao banco, commit em `RECORDED`, refund idempotente
  somente após ausência de efeito comprovada e nenhuma chamada posterior quando a
  pré-admissão rejeitar;
- resultado interno opaco e comportamento indistinguível para identidade válida e
  elegível, inexistente, inválida, conta inelegível, cooldown, request pendente e
  teto de tokens;
- falha determinada, rollback confirmado, commit indeterminado e reconciliação,
  sem repetição automática nem decisão dupla da reserva; `UNKNOWN` persistente
  consome a reserva, retorna indisponibilidade e não é sucesso funcional; e
- ausência de processamento, token, e-mail, endpoint e alteração dos contratos de
  login.

Testes em PostgreSQL `18.6` real, comprovadamente descartável, devem validar:

- estrutura `RECEIVED` seguida de `PENDING` ou `SUPPRESSED` na mesma transação,
  constraints e instantes do banco, sem estado intermediário confirmado;
- conta elegível; conta inexistente; conta inativa, não verificada, desativada ou
  sem credencial; cooldown; request pendente; e zero, dois e três tokens ativos;
- cooldown desde `received_at` do request mais recente com evento correlacionado
  `AUTH_PASSWORD_RECOVERY_REQUESTED`, incluindo todos os estados posteriores,
  ativo imediatamente antes de dez minutos e expirado na igualdade, sem depender
  do estado atual; e teto de tokens com os predicados de expiração, consumo e
  invalidação;
- duas solicitações concorrentes da mesma conta serializadas pelo advisory lock,
  sem dois `PENDING`; contas distintas sem serialização global indevida; locks por
  UUID e ausência de deadlock;
- rollback forçado no insert, classificação e auditoria, sem request ou evento
  parcial;
- exatamente um `AUTH_PASSWORD_RECOVERY_REQUESTED` para `PENDING`, sequência e
  campos aprovados, e nenhum evento para `SUPPRESSED` ou cenários inelegíveis;
- reconciliação `RECORDED`, `INCONSISTENT` e `UNKNOWN`, incluindo commit
  indeterminado, auditoria ausente/duplicada e ausência de falso sucesso ou falsa
  prova de rollback;
- validação sem efeitos de UUID v4 não nulo para `recovery_request_id` e
  `audit_event_id`, chave canônica produzida pela normalização existente e nulo
  exclusivo para identidade não normalizável;
- owner, `SECURITY DEFINER`, `search_path`, objetos qualificados, ausência de SQL
  dinâmico, grants mínimos e negação de `EXECUTE` a `PUBLIC`, bootstrap e
  manutenção; e
- runtime sem `SELECT` ou DML direto em conta, credencial, requests, tokens e
  auditoria.

Testes de integração NestJS/PostgreSQL devem comprovar o encadeamento completo da
fronteira interna: normalização, reserva, chamada protegida, classificação,
commit/refund, reconciliação e anti-enumeração, além da compatibilidade com
F1-B.4.5.1–F1-B.4.5.3. Não há teste de provider, outbox, envio ou HTTP neste
incremento.

Promises e relógios são coordenados, sem sleeps arbitrários. O gate preserva
90% em lines, statements, functions e branches por aplicação e consolidado,
regressão de autenticação/admissão e os jobs `Quality`, `API integration` e
`Required`.

#### Evidências publicadas da F1-B.4.5.5

A implementação foi publicada no commit
`9ac023961b769b9e52c53d6799501df300c4ce3e`, com CI `42083803500` aprovado nos
jobs `Quality`, `API integration` e `Required`. A suíte inclui testes unitários,
integração NestJS e PostgreSQL `18.6` real descartável. A correção D1 testa
deterministicamente falhas locais no SHA-256 e em cada geração de UUID, com
refund único, estado `REFUNDED` e ausência de start, Argon2id, complete e
reconciliação.

Testes unitários NestJS, com mocks estritos e agendamento controlado, devem
comprovar:

- Base64URL canônica sem padding, tamanho decodificado de 32 bytes, rejeição de
  variantes e hash SHA-256 com o domínio publicado, sem retenção ou vazamento do
  token;
- validação da política da senha antes da intenção e nenhuma execução Argon2id
  para senha inválida, admissão rejeitada, token não resolvido ou `REJECTED`;
- reserva de admissão antes de qualquer `await`, quota de reset por IP e matriz
  F1-B.4.5.5/D1 de commit/refund, com exatamente uma decisão idempotente da
  reserva;
- mesma instância de `Argon2ExecutionService` entre login e reset, capacidade
  máxima, FIFO, timeout, cancelamento pré-aquisição e liberação após término real;
- mapeamento de falha anterior ao envio, rollback comprovado, commit
  indeterminado e reconciliação, sem repetição automática e com os mesmos IDs; e
- ausência de `account_id`, estado interno, token, hash, senha, PHC, contagens ou
  identificadores em resultado, erro, log e métrica.

A matriz F1-B.4.5.5/D1 exige testes dirigidos para:

- nenhuma reserva em rejeição de pré-admissão;
- refund em falha comprovadamente anterior ao envio do start e em rollback
  comprovado dessa fase sem `STARTED`;
- reserva ainda aberta durante retry transacional permitido, com os mesmos IDs,
  e uma única finalização depois do resultado conclusivo;
- commit para token malformado após admissão, start sem linha, `REJECTED` e
  `STARTED`;
- commit preservado em fila cheia, timeout, cancelamento pré-aquisição, falha
  síncrona ou assíncrona do Argon2id e falha de complete depois de `STARTED`;
- commit em `COMPLETED` e em reconciliação `COMPLETED`, `REJECTED`, `NOT_FOUND`,
  `INCONSISTENT` ou `UNKNOWN`, inclusive quando a observação falhar;
- nenhuma repetição automática ou refund após possível envio; e
- concorrência coordenada entre finalização da reserva, aquisição Argon2id e
  cancelamento, provando finalização única e regressão integral do login.

Testes em PostgreSQL `18.6` real, comprovadamente descartável, reutilizam as
suítes publicadas e acrescentam integração dirigida para:

- start válido, token não resolvido, expirado, consumido, invalidado, conta
  inelegível e corrida, verificando intenção antes do Argon2id;
- complete válido e rejeitado, consumo único, alteração atômica da credencial,
  invalidação dos demais tokens, cancelamentos, revogação de sessões, auditoria e
  marcador terminal;
- idempotência e concorrência para o mesmo token, mesma conta e contas distintas,
  ordem de locks, ausência de bypass e nenhum efeito parcial;
- rollback em start e complete; reconciliação observacional de `COMPLETED`,
  `REJECTED`, `NOT_FOUND`, `INCONSISTENT` e `UNKNOWN`; e
- owner, `SECURITY DEFINER`, `search_path`, assinaturas e `EXECUTE` mínimos, com
  negação de `SELECT` e DML sensível direto pelo runtime.

Testes de integração NestJS/PostgreSQL devem comprovar start → Argon2id →
complete, rejeição antes do hashing quando aplicável, indeterminação e
reconciliação em start e complete, mesmos IDs, ausência de repetição e efeitos
parciais, compatibilidade do login e capacidade Argon2id global. Tokens, PHCs e
senhas dos testes são sintéticos e nunca correspondem a credenciais reais.

Não há teste de geração/entrega, provider, outbox, HTTP, frontend, terminalização
ou retenção neste incremento. A cobertura permanece em no mínimo 90% para lines,
statements, functions e branches por aplicação e consolidado, sem redução de
gates; `Quality`, `API integration` e `Required` permanecem obrigatórios.

Na publicação, a API alcançou 94,67% de lines, 94,56% de statements, 97,13% de
functions e 92,56% de branches; o consolidado alcançou respectivamente 94,68%,
94,59%, 97,15% e 92,63%.

#### Critérios específicos da F1-B.4.5.6

O contrato está aprovado e a implementação está validada somente no working tree
local, ainda sem commit ou publicação. A aceitação exige testes unitários,
integração NestJS e PostgreSQL `18.6` real em banco
comprovadamente descartável para a seguinte matriz:

| Grupo                     | Evidência obrigatória                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fluxo nominal             | `PENDING → PREPARING → PREPARED → SENDING → SENT`; token CSPRNG de 32 bytes; Base64URL canônica; hash separado por domínio; link em memória; `SENDING` confirmado antes do adapter            |
| falha determinada         | `NOT_ACCEPTED` comprovado; token invalidado; tentativa `FAILED / DELIVERY_FAILURE`; backoff de 1 e 5 minutos; request `FAILED` depois da terceira tentativa                                   |
| tentativas e tokens       | no máximo três tentativas; token físico e identificador distintos por ordinal; um token por tentativa; nenhum ordinal reutilizado                                                             |
| perda em `PREPARED`       | token bruto irrecuperável; token persistido invalidado; `FAILED / PREPARATION_FAILURE`; ordinal consumido; novo token somente em nova tentativa                                               |
| `SENDING` e `UNKNOWN`     | lease expirado recupera somente para `UNKNOWN`; token preserva expiração natural; nenhum replay, reconciliação ou nova instância chama novamente o adapter                                    |
| crashes                   | falha antes e depois dos commits de claim, `PREPARING`, `PREPARED`, `SENDING` e terminalização; crash entre commit de `SENDING` e adapter; crash entre adapter e conclusão                    |
| commit indeterminado      | prova específica para cada uma das cinco operações; repetição somente da mutação comprovadamente segura; reconciliação nunca devolve `SEND_AUTHORIZED`                                        |
| lease e executor obsoleto | lease inicial e renovação única de 60 segundos; timeout de 10 segundos; lease expirado durante chamada; conclusão tardia; executor antigo bloqueado; nenhum terminal sobrescrito              |
| concorrência              | claims simultâneos, duas instâncias, envio contra solicitação, login, sessão e reset; ordem global de locks; ausência de deadlock e de envio duplicado                                        |
| teto de tokens            | até três tokens ativos por conta sob advisory lock compartilhado, inclusive sob claims e resets concorrentes                                                                                  |
| privilégios               | owner, `SECURITY DEFINER`, `search_path`, objetos qualificados, ausência de SQL dinâmico, `REVOKE` de `PUBLIC`, `EXECUTE` mínimo e negação de `SELECT account.email` e DML direto             |
| auditoria                 | `AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED` somente após `ACCEPTED`, atômico com `SENT`, matriz `INTERNAL_PROCESSOR` exata e ausência de token, hash, URL, e-mail, IP bruto, lease e erro integral |
| ativação                  | ausência e `disabled` não iniciam processamento; `controlled` somente em `NODE_ENV=test`; valor desconhecido ou `controlled` em development/production falha na inicialização                 |
| lifecycle                 | polling de 1 segundo somente após `NO_WORK` confirmado; lote máximo de 10; paralelismo 1; falha de infraestrutura não vira ociosidade; shutdown impede claims e chamadas não iniciadas        |
| regressão                 | autenticação, login, sessões, logout, logout global, solicitação de recuperação, reset, admissão, anti-enumeração, CORS desabilitado e `/health/live` preservados                             |

Dentro dessa matriz, as evidências dirigidas também devem comprovar:

- nas cinco operações, aquisição apenas das classes necessárias e preservação da
  ordem relativa advisory lock, `account`, `password_credential`, marcador de
  reset, request, tentativa, token, sessões e auditoria;
- request `PENDING` durante backoff, elegibilidade calculada pelo `terminal_at` da
  tentativa anterior mais 1 ou 5 minutos e ausência de nova tentativa
  `PREPARING` antes desse instante;
- `invalidated_operation_id = delivery_attempt_id` tanto na perda do token bruto
  em `PREPARED` quanto em `NOT_ACCEPTED`, incluindo repetição idempotente e rejeição
  de correlação divergente;
- nenhum `SEND_AUTHORIZED` exposto pelo adapter de persistência antes do commit ou
  autocommit confirmado, nenhuma transação caller-managed aberta durante a chamada
  externa e descarte da autorização diante de commit indeterminado; e
- eventos minimizados de aquisição, expiração e recuperação de lease observáveis
  sem `lease_id` ou identificador sensível, mantendo esses valores fora da
  auditoria e de logs sensíveis.

O adapter controlado é determinístico e não depende de serviço externo. Relógios,
promises, timeout, crashes e corridas são coordenados sem sleeps arbitrários como
prova. Os testes devem incluir resultado tardio concorrendo com recuperação: se a
conclusão vencer, a recuperação observa terminal; se `UNKNOWN` vencer, o resultado
tardio retorna terminal sem escrever.

Cada operação protegida deve provar cardinalidade de uma linha, idempotência,
rollback, commit indeterminado, ownership divergente, estado terminal e
inconsistência. `NO_WORK` só é aceito como retorno confirmado; erro de conexão,
timeout SQL e observação inconclusiva permanecem falha ou indeterminação.

Token, link e destinatário usados em teste são exclusivamente sintéticos e não
podem aparecer em logs, snapshots, mensagens de erro ou auditoria. A cobertura
permanece em no mínimo 90% em lines, statements, functions e branches para web,
API e consolidado, sem exclusões para atingir o gate. `Quality`, `API integration`
e `Required` continuam obrigatórios.

As evidências locais incluem 99 testes focais de módulo, configuração, adapter,
persistência e processador e 18 cenários PostgreSQL dirigidos para a F1-B.4.5.6.
Eles cobrem revalidação do claim sob concorrência, grafos incoerentes,
reconciliação terminal completa, fronteiras reais de commit e rollback, perdas de
conexão simuladas na camada de persistência, corrida terminal nos dois sentidos,
duas contas, elegibilidade e shutdown sob lock. A simulação de perda de conexão
não é apresentada como prova de qual resultado um commit real indeterminado teve;
a decisão permanece dependente da reconciliação persistida.

As migrations foram aplicadas do zero em `bello_dev` e `bello_test` dentro do
mesmo PostgreSQL `18.6` descartável e as regressões PostgreSQL aplicáveis foram
executadas nesse ambiente. A suíte unitária completa da API executou 663 testes e
alcançou 94,39% de statements, 91,94% de branches, 97,22% de functions e 94,64%
de lines. Web permaneceu em 100% nas quatro métricas; o consolidado alcançou
94,41% de statements, 92,00% de branches, 97,24% de functions e 94,64% de lines.
Esses resultados locais foram posteriormente publicados no commit
`601c92ab8f3922b5f0e2a03c432de5fc74c6258d` e validados pelo CI `42117321177`.

### Critérios específicos da F1-B.4.5.7

A implementação do adapter Resend usa testes unitários e contratuais com fake
HTTP exclusivamente local. CI não recebe credencial real, não acessa a
Resend e não envia mensagem. A validação operacional posterior da conta, domínio
e mensagem real é evidência separada e não integra o gate automatizado.

| Área                   | Evidência automatizada obrigatória                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| configuração           | `disabled` por ausência, três modos válidos, rejeição de modo desconhecido, `controlled` somente em teste, `resend` proibido em teste, requisitos fail-fast de chave, remetente e origem HTTPS, endpoint fixo e nenhuma exposição de segredo |
| autenticação e request | um `POST` para `/emails`, Bearer correto, JSON UTF-8, remetente, destinatário, assunto, partes texto/HTML e ausência de anexos, tags, metadata, tracking ou campo não aprovado                                                               |
| aceite                 | somente HTTP `200`, corpo integral, JSON válido e `id` string não vazio produz `ACCEPTED`; identificador não é persistido nem registrado                                                                                                     |
| falha determinada      | cada combinação HTTP + `name` da whitelist D3, com `name`, `message` e `statusCode` válidos e coerentes, produz `NOT_ACCEPTED`                                                                                                               |
| indeterminação         | combinação externa à whitelist, `409`, `5xx`, status inesperado, divergência de status, corpo ausente, parcial ou inválido, DNS, TLS, conexão, timeout, cancelamento e perda de resposta produzem `INDETERMINATE`                            |
| efeito único           | exatamente uma requisição por `SEND_AUTHORIZED`, redirects rejeitados, nenhum retry, sleep ou segunda chamada por `Retry-After`, timeout ou abort                                                                                            |
| link e mensagem        | texto contém URL exata, HTML usa escaping seguro e `href` equivalente após decodificação, assunto e texto mínimos, validade de 30 minutos e nenhum dado pessoal desnecessário                                                                |
| observabilidade        | somente provider, resultado, duração, status, tipo fechado, rate limiting e código seguro; chave, destinatário, token, hash, URL, conteúdo, payload, resposta, provider ID e mensagem externa integral ausentes                              |
| integração de módulo   | modo `resend` seleciona somente o adapter Resend atrás do port existente; `disabled` não inicia processamento e `controlled` preserva o comportamento de teste                                                                               |
| regressão              | todas as suites da F1-B.4.5.6, cinco operações PostgreSQL, lifecycle, concorrência, reconciliação, auditoria, autenticação e sessões permanecem aprovadas                                                                                    |

A whitelist automatizada é exatamente:

```text
400 validation_error
400 invalid_idempotency_key
401 missing_api_key
401 validation_error
403 restricted_api_key
403 suspended_api_key
404 not_found
405 method_not_allowed
422 invalid_attachment
422 missing_required_field
429 daily_quota_exceeded
429 monthly_quota_exceeded
429 rate_limit_exceeded
```

Teste parametrizado deve falhar se uma combinação for acrescentada ou removida
sem mudança normativa. O timeout total inicial de 10 segundos cobre conexão, TLS,
envio, headers e corpo e usa relógio controlado, sem sleep real. O fake comprova
contagem de chamadas e comportamento de resposta parcial ou tardia.

Casos `403 + invalid_permission`, `403 + validation_error`,
`422 + invalid_parameter` e `422 + missing_required_parameter` exercitam
explicitamente o resultado `INDETERMINATE`, pois não pertencem à whitelist.

A cobertura permanece em no mínimo 90% para lines, statements, functions e
branches em web, API e consolidado, sem exclusão artificial. `Quality`, `API
integration` e `Required` permanecem obrigatórios.

Na validação local da implementação, os 735 testes unitários da API foram
aprovados. A cobertura da API alcançou 94,48% de statements, 92,14% de branches,
97,34% de functions e 94,85% de lines. Os testes contratuais usam `fetch` nativo
contra servidor HTTP efêmero em loopback e comprovam request, redirect sem segunda
chamada, abort, truncamento e limite incremental de 64 KiB em respostas fixed e
chunked, sem rede externa.

Em PostgreSQL `18.6` descartável, 222 cenários aplicáveis foram aprovados na
validação inicial, inclusive os 18 da F1-B.4.5.6. Após a correção da leitura HTTP,
os 18 cenários da F1-B.4.5.6 foram reexecutados e aprovados; os recursos
temporários foram removidos ao final. A implementação foi publicada no commit
`af392b32d9bd72f57f8375334079043ac85d3603`, validado pelo CI `42152502439`.

O Web permaneceu em 100% nas quatro métricas. O consolidado alcançou 94,50% de
statements, 92,20% de branches, 97,36% de functions e 94,86% de lines; formatação,
lint, typecheck e builds de API e Web também foram aprovados pelo
`quality:local`.

Antes da ativação, procedimento manual autorizado e sanitizado deve comprovar
conta e MFA, plano e limites, subdomínio e DNS, DKIM/SPF e avaliação de DMARC,
remetente, chave mínima e segregada, TLS, retenção e jurisdição avaliadas,
`open_tracking=false`, `click_tracking=false`, ausência de pixel ou reescrita e
preservação da URL. A evidência registra somente resultados, nunca destinatário,
token, link, segredo, payload ou provider message ID.

### Critérios específicos da F1-B.4.5.8

A terminalização exige testes unitários, de lifecycle e PostgreSQL `18.6` real
descartável. Sleeps arbitrários não comprovam concorrência; as corridas usam
transações explícitas, locks, probes de `pg_stat_activity`, promises ou barreiras
controladas.

| Área             | Evidência obrigatória                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| limite funcional | `STARTED` antes da expiração nunca é selecionado; no instante e depois de `expires_at`, o `transaction_timestamp()` governa a elegibilidade sem tornar o tempo prova isolada            |
| trabalho ativo   | Argon2id em andamento antes da expiração permanece autorizado; retomada posterior nunca produz sucesso e segue a corrida aprovada entre `REJECTED` e `NOT_FOUND`                        |
| estados          | somente `STARTED → NOT_FOUND`; `UNKNOWN` intocado; terminal nunca reaberto; marcador ausente distinto de `NOT_FOUND`                                                                    |
| seleção          | exatamente uma linha; candidatos precedem inconsistências; ordem total por expiração/UUID ou atualização/UUID; somente ausência de ambas produz `NO_CANDIDATE`                          |
| justiça          | marcador inconsistente coexistindo com um ou vários candidatos não bloqueia progresso; lote cheio executa um probe booleano e sinaliza inconsistência em até dez terminalizações        |
| grafo            | token ausente, conta, request, tentativa, ordinal ou vínculo incompatível, consumo ou invalidação divergente produzem `INCONSISTENT`, nunca `NO_CANDIDATE`                              |
| probe            | `EXISTS` limitado usa o mesmo universo e predicados, não retorna UUID, não muta dados e não impede candidatos; backlog finito termina expondo a inconsistência pelo seletor             |
| mutação          | matriz completa dos cinco resultados cobre cada estado, ausência, instante de expiração, cardinalidade zero e combinação impossível; somente prova completa altera uma linha            |
| corridas         | conclusão antes/depois da expiração versus terminalização nas duas ordens; reconciliação nas duas ordens; duas instâncias e candidatos concorrentes                                     |
| efeitos          | nenhuma alteração de credencial, token, request, tentativa ou sessão e nenhum `audit_event` funcional na terminalização                                                                 |
| falhas           | crash antes e depois do possível commit, rollback em cada etapa, timeout, conexão perdida, observação falha e ausência de repetição cega                                                |
| idempotência     | repetição após observação conclusiva não duplica efeito nem timestamps; estado terminal retorna sem mutação                                                                             |
| locks            | advisory lock da conta, row locks na ordem global, revalidação depois da espera, ausência de deadlock e contas independentes concorrentes                                               |
| privilégios      | owner, `SECURITY DEFINER`, `search_path`, objetos qualificados, ausência de SQL dinâmico e shadowing, `REVOKE` e `EXECUTE` mínimo sem DML direto                                        |
| executor         | `disabled` por padrão, modo inválido fail-fast, `internal` explícito, teste sem worker ambiental, polling 60 s, lote dez, paralelismo um, timeouts 2 s/5 s e ausência de loop agressivo |
| lifecycle        | lote cheio, ociosidade, inconsistência, falha de infraestrutura, shutdown antes e durante chamada e múltiplas instâncias                                                                |
| observabilidade  | mapeamento exato de resultados, probe, commit indeterminado e falha para categorias fechadas; nenhum erro vira ociosidade; ausência de identificadores ou dados sensíveis               |
| retenção         | `terminal_at` somente em commit de `NOT_FOUND`, reconhecimento dentro dos 30 dias e proteção de `STARTED`, `UNKNOWN` e reconciliáveis; nenhum expurgo                                   |
| regressão        | intenção, conclusão, reconciliação, caso de uso, Argon2id, login, sessões, solicitação, entrega e Resend permanecem aprovados                                                           |

Testes parametrizados devem falhar se estado, resultado, categoria operacional,
cardinalidade, grant ou campo observável for ampliado sem mudança normativa. A
cobertura da matriz inclui `UNKNOWN`, `INCONSISTENT` persistido, `NOT_FOUND`
terminal, marcador ausente, `STARTED` antes/no instante/depois da expiração,
concorrência que zera o `UPDATE`, falha de leitura sem efeito inventado e todos os
mapeamentos operacionais. A cobertura permanece em no mínimo 90% para lines,
statements, functions e branches em API, Web e consolidado, sem exclusão
artificial. `Quality`, `API integration` e `Required` permanecem obrigatórios.

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
