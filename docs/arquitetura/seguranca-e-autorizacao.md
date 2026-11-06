# Segurança e autorização

## Escopo

Este documento detalha as responsabilidades decorrentes de [AT-001](decisoes-tecnicas.md#at-001--autenticação-e-segurança-das-sessões), [AT-002](decisoes-tecnicas.md#at-002--autorização-centralizada), [AT-008](decisoes-tecnicas.md#at-008--bootstrap-e-migrations) e [AT-009](decisoes-tecnicas.md#at-009--e-mails-e-notificações). Ele não redefine os papéis funcionais.

## Identidade, senha e sessão

- Contas são criadas somente pela Administração Global ou, para a primeira conta, pelo bootstrap controlado.
- Não existe cadastro público.
- `account.id` UUID é o identificador técnico interno imutável; `account.email` e sua representação normalizada `account.email_key` são atributos distintos, únicos e igualmente imutáveis após a criação da conta no MVP.
- `email_verified_at` permanece estado separado do endereço, e a verificação inicial continua obrigatória antes do acesso protegido.
- A aplicação não oferece operação de alteração ou substituição de e-mail, e a credencial runtime do PostgreSQL não recebe `UPDATE` sobre `account.email` ou `account.email_key`.
- Desativação não libera nem transfere o endereço; eventual alteração ou substituição de e-mail permanece fora do MVP, sem procedimento excepcional definido nesta etapa.
- Senhas utilizam Argon2id e não podem ser recuperadas por administradores.
- Tentativas sem credencial real utilizam um PHC Argon2id sintético constante,
  gerado uma única vez de candidato aleatório descartado e com o mesmo perfil
  aprovado, para preservar o trabalho criptográfico negativo. Esse PHC não se
  vincula a conta, senha ou credencial real, não é persistido no PostgreSQL e
  nunca pode ser registrado em logs ou auditoria. O mecanismo reduz diferenças
  estruturais, mas não promete tempo constante.
- A sessão persistida é o estado revogável de autenticação.
- O Angular não recebe token de sessão para armazenamento em APIs JavaScript persistentes.
- Inatividade de 8 horas e vida absoluta de 7 dias são limites independentes; atingir qualquer deles invalida a sessão.
- Múltiplas sessões por usuário são permitidas, com revogação individual e encerramento global.
- Redefinição de senha ou desativação revoga todas as sessões existentes.
- Cookies, CSRF, origem e HTTPS formam controles complementares; nenhum deles substitui a autorização do recurso.

## Transporte HTTP, cookie, origem, CORS e CSRF

A PT-005 está resolvida pelo complemento aprovado de
[AT-001](decisoes-tecnicas.md#complemento-aprovado--resolução-da-pt-005), com
os seguintes contratos:

### Topologia e cookie

- Angular e NestJS compartilham uma origem pública. A aplicação ocupa `/`, a
  API funcional ocupa `/api`, `/health/live` permanece operacional e público,
  e o frontend usa URLs relativas.
- Produção usa proxy reverso. Desenvolvimento usa o proxy do Angular para
  preservar a mesma origem percebida pelo navegador.
- O cookie de produção chama-se `__Host-bello_flow_session` e possui
  `HttpOnly=true`, `Secure=true`, `SameSite=Lax`, `Path=/`, nenhum `Domain` e
  `Max-Age=604800` segundos.
- O prazo do cookie limita sua retenção no cliente, mas não autentica uma
  sessão inválida. PostgreSQL permanece como autoridade sobre revogação,
  inatividade de 8 horas e vida absoluta de 7 dias.
- O token de sessão não aparece em JSON, logs, métricas ou auditoria.

HTTPS local é preferido para validar o contrato de produção. Como conveniência,
HTTP pode ser usado somente em endereço loopback, com cookie de nome distinto,
como `bello_flow_session`, mantendo `HttpOnly`, `SameSite=Lax`, `Path=/` e
ausência de `Domain`; apenas esse perfil pode omitir `Secure`. A aplicação deve
recusar esse perfil fora do ambiente local. Testes HTTP locais sem TLS não
comprovam os atributos do cookie de produção.

### Origem pública, proxy e CORS

- Cada ambiente define uma origem pública canônica, comparada por esquema,
  host e porta exatos.
- A origem autorizada não é derivada de `Host` ou de `X-Forwarded-*` enviados
  pelo cliente.
- O proxy remove ou sobrescreve headers encaminhados. A aplicação confia
  somente no proxy conhecido e não habilita confiança irrestrita.
- A API same-origin não habilita CORS no MVP, não retorna
  `Access-Control-Allow-Origin` ou `Access-Control-Allow-Credentials`, não
  autoriza preflight de origens externas e não usa wildcard nem reflexão
  dinâmica de `Origin`.

### Requisições protegidas

- Toda chamada protegida da aplicação, inclusive GET autenticado, apresenta
  uma única ocorrência lógica de `X-Bello-Flow-Request` com valor exato `1`.
- Header ausente, duplicado, combinado ou com outro valor é rejeitado.
- Endpoints operacionais explicitamente públicos são dispensados e não
  resolvem sessão.
- Qualquer requisição protegida válida pode contar como atividade, inclusive
  GET e polling. A atualização respeita o intervalo mínimo existente de cinco
  minutos e nunca amplia a vida absoluta de sete dias.

Antes de qualquer método mutável:

1. validar `Origin` exatamente contra a origem pública configurada;
2. rejeitar `Origin: null`, valores múltiplos ou inválidos;
3. quando `Origin` estiver ausente, aceitar somente `Referer` válido cuja
   propriedade de origem da URL coincida exatamente, sem comparação textual
   por prefixo;
4. rejeitar quando nenhum sinal confiável estiver disponível;
5. exigir `application/json` quando o endpoint receber corpo JSON, sem criar
   exigência artificial de `Content-Type` para endpoints sem corpo; e
6. aplicar os mesmos controles ao login antes da autenticação.

Não há token CSRF persistido adicional nesta versão. Header customizado,
validação de origem, restrição de conteúdo, cookie e HTTPS formam a proteção
conjunta e não substituem autorização do recurso.

### Logout e entrega

- Logout confirma a revogação server-side antes de responder sucesso e limpa
  o cookie com nome, `Path` e escopo compatíveis.
- Sessão já inválida admite limpeza idempotente segura.
- Resultado indeterminado segue o contrato de reconciliação antes de qualquer
  classificação ou repetição.
- Depois de transmitir a resposta, o servidor não presume se o navegador
  recebeu ou armazenou o cookie. Fechamento posterior da conexão não comprova
  falha de entrega e não provoca revogação por suposição.

## Contratos HTTP de autenticação — D1–D5

As decisões D1–D5 abaixo permanecem normativas para a F1-B.4. A fundação e as
primitivas HTTP foram implementadas na F1-B.4.1, e os casos públicos de sessão e
o encapsulamento de D5 foram implementados na F1-B.4.2. A admissão protegida foi
publicada na F1-B.4.3. Controllers, endpoints de autenticação e a ligação das
políticas à fronteira HTTP foram publicados na F1-B.4.4 pelo commit
`d2343340a75ca6b15700e47738c8c34cbadc4202`, com a execução CI `41831592216`
aprovada nos jobs `Quality`, `API integration` e `Required`.

### Representação externa comum

Login e consulta de sessão retornam somente a identidade interna mínima:

```json
{
  "account": {
    "id": "7ceac8d7-f290-4e48-8b42-67e83c982548"
  }
}
```

O UUID é apenas ilustrativo. Token, `sessionId`, `operationId`, prazos e objetos
internos não integram o JSON. DTOs de resposta são construídos por seleção
explícita dos campos permitidos, nunca por serialização direta do resultado de
um serviço ou da persistência.

Erros usam o formato externo mínimo:

```json
{
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Authentication failed"
  }
}
```

Erros internos não são serializados diretamente. Corpos de erro não contêm
identificador de operação ou sessão, token, cookie, senha, credencial nem
detalhe operacional sensível.

|  HTTP | Código externo           | Aplicação                                                     |
| ----: | ------------------------ | ------------------------------------------------------------- |
| `400` | `INVALID_REQUEST`        | falha estrutural da requisição HTTP                           |
| `401` | `AUTHENTICATION_FAILED`  | rejeição determinada no login                                 |
| `401` | `UNAUTHENTICATED`        | ausência de sessão autenticada válida                         |
| `403` | `REQUEST_FORBIDDEN`      | rejeição dos controles de origem ou CSRF                      |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | media type incompatível com o corpo JSON exigido              |
| `429` | `RATE_LIMITED`           | admissão do login rejeitada pelos limites aprovados da PT-008 |
| `503` | `SERVICE_UNAVAILABLE`    | falha operacional ou resultado ainda indeterminado            |
| `500` | `INTERNAL_ERROR`         | falha interna não classificada                                |

O mesmo `AUTHENTICATION_FAILED` cobre identidade inexistente, senha incorreta,
conta inelegível e demais rejeições determinadas da credencial. O `401` não
revela existência, elegibilidade ou estado da conta, e o `503` não revela a
causa operacional. Para o login, limites, chaves, armazenamento, `Retry-After`
e `429` estão definidos no subconjunto aprovado da PT-008. Recuperação de senha
possui contrato separado na F1-B.4.5, implementado apenas nos incrementos
publicados F1-B.4.5.1–F1-B.4.5.5; os endpoints de recuperação permanecem futuros.

### `POST /api/auth/login`

- recebe um objeto JSON com exatamente `email` e `password`, ambos strings;
- não exige sessão prévia;
- antes da autenticação, exige uma única ocorrência lógica de
  `X-Bello-Flow-Request: 1`, origem ou `Referer` válidos conforme a PT-005 e
  media type `application/json`;
- retorna `400 INVALID_REQUEST` para estrutura HTTP, JSON, campos ou tipos
  inválidos e `415 UNSUPPORTED_MEDIA_TYPE` para media type inadequado;
- retorna `401 AUTHENTICATION_FAILED` para toda rejeição determinada da
  autenticação, sem distinguir a causa externamente;
- após autenticação e criação confirmadas, retorna `200 OK` com a identidade
  mínima e emite o cookie do perfil aplicável;
- nunca retorna token, `sessionId` ou `operationId`; e
- preserva a auditoria transacional de login bem-sucedido ou malsucedido, sem
  segredos.

Falha comprovada depois da criação da sessão e antes da transmissão da resposta
aciona a compensação de sessão não entregue. Depois do envio dos headers, o
servidor não presume falha de entrega nem revoga a sessão por fechamento da
conexão.

### `GET /api/auth/session`

- exige cookie de sessão válido e uma única ocorrência lógica de
  `X-Bello-Flow-Request: 1`;
- não exige `Origin`, `Referer`, corpo ou `Content-Type`;
- retorna `200 OK` com a mesma identidade mínima do login;
- retorna `401 UNAUTHENTICATED` quando não houver sessão autenticada válida;
- pode limpar cookie comprovadamente inválido; e
- pode contar como atividade, preservando o intervalo mínimo de cinco minutos,
  a inatividade de oito horas e a vida absoluta de sete dias.

A consulta e a atualização técnica de atividade não criam novo evento funcional
de auditoria.

### `POST /api/auth/logout`

- exige uma única ocorrência lógica de `X-Bello-Flow-Request: 1` e os controles
  de origem e CSRF da PT-005;
- não recebe corpo e não exige `Content-Type` artificial;
- com sessão válida, revoga a sessão atual e retorna `204 No Content` somente
  depois de confirmação ou reconciliação conclusiva;
- com cookie ausente ou sessão inválida, expirada ou já revogada, pode retornar
  `204 No Content` e limpar o cookie de forma idempotente; e
- não cria auditoria de logout quando nenhuma revogação foi efetivada.

A limpeza local do cookie não comprova, por si, revogação no PostgreSQL.

### `POST /api/auth/logout-all`

- exige sessão autenticada válida, uma única ocorrência lógica de
  `X-Bello-Flow-Request: 1` e os controles de origem e CSRF da PT-005;
- não recebe corpo e não exige `Content-Type` artificial;
- revoga todas as sessões da conta, preservando a auditoria na mesma transação;
- retorna `204 No Content` e limpa o cookie atual somente depois de confirmação
  ou reconciliação conclusiva; e
- retorna `401 UNAUTHENTICATED` quando não houver sessão válida, pois não existe
  identidade autenticada que permita garantir a revogação global.

### Resultado indeterminado e cookie

Uma operação indeterminada não é repetida automaticamente nem classificada por
suposição. Enquanto a revogação permanecer indeterminada, a API não declara
sucesso, não limpa o cookie e retorna `503 SERVICE_UNAVAILABLE` genérico. A
limpeza ocorre somente depois de revogação confirmada, reconciliação conclusiva
ou constatação segura de sessão já inválida nos casos idempotentes permitidos.

### Logs, auditoria e abuso

Rejeições isoladas por origem ou CSRF, realizadas na fronteira HTTP antes da
autenticação e da autorização funcional, produzem apenas logs técnicos
estruturados, minimizados e sem segredos. Elas não criam novos eventos
funcionais de auditoria nesta etapa. Essa classificação não altera a auditoria
aprovada de login, falha de login, logout, revogação global ou negativa
funcional de autorização. A admissão abusiva do login segue o subconjunto
aprovado da PT-008; outros tratamentos adicionais permanecem fora deste contrato.

### Encapsulamento da camada HTTP

A camada HTTP utiliza exclusivamente o contrato público de
`AuthenticationService`. A evolução pública mínima prevista compreende:

- `authenticateWithPassword`;
- `resolveAuthenticatedSession`;
- `logoutCurrentSession`;
- `logoutAllSessions`; e
- `revokeUndeliveredSession`, restrito à compensação necessária.

As assinaturas públicas foram implementadas na F1-B.4.2.
`AuthSessionPersistence` permanece interno ao módulo, e controllers não o
acessam diretamente. Essa fronteira não autoriza repositório genérico, nova
abstração ou dependência sem necessidade concreta.

## Proteção do login — subconjunto aprovado da PT-008

Este contrato foi implementado para `POST /api/auth/login` na F1-B.4.3 e ligado
à fronteira HTTP pela F1-B.4.4 publicada. Ele não cria quotas para consulta de
sessão, logout ou logout global e não rege recuperação de senha. O contrato da
recuperação foi posteriormente aprovado na F1-B.4.5, sem declarar implementação
ou processamento produtivo de e-mails.

### Admissão e token buckets

A admissão usa dois token buckets independentes e exige orçamento em ambos:

| Chave                  | Capacidade |                   Reposição | Sucesso confirmado        |
| ---------------------- | ---------: | --------------------------: | ------------------------- |
| identidade normalizada |   5 tokens | 1 token a cada 180 segundos | remove ou reseta o bucket |
| IP confiável           |  60 tokens |   1 token a cada 5 segundos | preserva o débito         |

A identidade usa exatamente a normalização de e-mail do serviço existente. O
bucket é criado da mesma forma para identidades existentes ou inexistentes, sem
consulta ao PostgreSQL para decidir a limitação. O IP é derivado exclusivamente
da cadeia de proxy confiável da PT-005; `X-Forwarded-For` fornecido diretamente
pelo cliente não é fonte confiável.

Quando o e-mail não puder ser normalizado, a admissão usa uma única chave
técnica sentinela compartilhada por todas essas entradas. A chave não contém nem
deriva do e-mail bruto, não consulta a existência da conta e sempre participa
junto com o bucket do IP confiável; a sentinela nunca substitui a proteção por
IP. Ela segue a mesma capacidade e reposição de uma identidade: 5 tokens e 1
token a cada 180 segundos.

A sentinela ocupa exatamente uma posição do mapa limitado a 16.000 identidades.
Identidades normalizadas válidas continuam com buckets individuais e não debitam
o orçamento da sentinela; inversamente, tentativas pela sentinela não consomem o
saldo individual dessas identidades. O esgotamento compartilhado retorna o mesmo
`429 RATE_LIMITED` genérico, combinado com o estado do bucket de IP e sem revelar
qual proteção limitou a requisição.

Uma entrada não normalizável admitida segue até a verificação Argon2id negativa.
Se funcionalmente avaliada, preserva a auditoria aprovada; rejeição determinada
usa o mesmo `401 AUTHENTICATION_FAILED` genérico. Rejeição `429` anterior à
avaliação continua sendo apenas técnica e não cria `AUTH_LOGIN_FAILED`.

Depois dos controles de origem, CSRF, conteúdo e estrutura da requisição, a
camada de admissão aplica reposição e reserva os dois tokens em uma única seção
síncrona, sem `await`, antes de PostgreSQL ou Argon2id. Se qualquer orçamento
estiver esgotado, nenhum bucket é debitado parcialmente e a autenticação não
começa. Requisições já limitadas não consomem token adicional nem deslocam o
próximo instante de reposição.

Cada reserva possui identidade própria. Restituição é idempotente, ocorre no
máximo uma vez e nunca eleva o bucket além de sua capacidade. Os resultados são:

| Conclusão                             | Identidade                           | IP                                   |
| ------------------------------------- | ------------------------------------ | ------------------------------------ |
| rejeição determinada da credencial    | confirma o consumo                   | confirma o consumo                   |
| autenticação confirmada               | remove ou reseta o bucket            | confirma o consumo                   |
| falha operacional                     | restitui a reserva                   | restitui a reserva                   |
| resultado indeterminado               | restitui sem repetir automaticamente | restitui sem repetir automaticamente |
| falha antes do início da autenticação | restitui a reserva                   | restitui a reserva                   |

### Resposta de limite

O limite responde `429` com corpo invariável:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

`Retry-After` contém segundos inteiros até o próximo token disponível. Quando os
dois buckets estiverem esgotados, usa-se a maior espera. Corpo, header, log e
métrica não revelam qual identidade ou IP causou a rejeição. Depois de `429`, a
API não consulta o banco nem executa Argon2id.

### Memória, remoção e saturação

O estado é local e efêmero na única instância do backend. Os mapas possuem
capacidades independentes de até 16.000 identidades, incluindo a única posição
da sentinela quando criada, e 4.000 IPs, totalizando no máximo 20.000 entradas.
Reinicialização da instância zera os contadores.

Um bucket somente pode ser removido quando, após aplicar sua reposição, estiver
integralmente recuperado, sem reserva aberta e sem outra obrigação ou restrição
pendente. Buckets parcialmente consumidos, esgotados ou associados a autenticação
em andamento não são removidos. A limpeza normal é preguiçosa e incremental, com
trabalho limitado; uma varredura completa é admitida excepcionalmente diante de
saturação.

Para admitir chave nova, a camada remove primeiro somente entradas elegíveis. Se
o mapa continuar cheio, rejeita apenas aquela requisição com
`503 SERVICE_UNAVAILABLE`, restitui eventual reserva provisória e não cria bucket
parcial nem inicia autenticação. Buckets existentes continuam operando. É
proibido expulsar bucket restritivo, operar somente com um dos limites ou ativar
indisponibilidade global apenas porque um mapa atingiu sua capacidade.

O `503` permanece genérico e não inclui `Retry-After` quando não houver previsão
confiável de recuperação, nem dados pessoais ou identificadores internos.

### Capacidade de Argon2id

No máximo duas autenticações protegidas executam simultaneamente. Até quatro
requisições adicionais aguardam em fila FIFO por prazo positivo de no máximo um
segundo. A fila é amortecimento limitado, não garantia de execução; fila
ilimitada e repetição automática são proibidas. Fila cheia, timeout ou falha de
aquisição retornam `503 SERVICE_UNAVAILABLE` sem iniciar autenticação.

Aquisição, timeout e cancelamento são transições mutuamente exclusivas. Uma
requisição expirada ou cancelada não recebe vaga depois. Reserva anterior ao
início é restituída no máximo uma vez, e cada vaga adquirida é liberada exatamente
uma vez. Desconexão após o início do trabalho nativo não antecipa a liberação: a
vaga permanece ocupada até o término real do trabalho protegido.

Configuração pode escolher valores menores dentro destes intervalos: até 16.000
identidades, até 4.000 IPs, concorrência de 1 a 2, fila de 0 a 4 e timeout
positivo de até um segundo. Valor fora do intervalo impede a inicialização.
Aumento futuro requer evidência de capacidade e desempenho vinculada à PT-016.

### Auditoria e minimização

Um `429` anterior à avaliação da credencial é rejeição técnica de admissão, não
login funcionalmente avaliado. Ele produz somente log técnico ou métrica sem
e-mail, IP bruto, chave de bucket, senha, token ou cookie e não cria
`AUTH_LOGIN_FAILED`. Essa distinção não altera RN-128: login bem-sucedido ou
malsucedido que efetivamente alcance o serviço de autenticação preserva a
auditoria funcional aprovada.

### Critérios mínimos de teste

Os testes futuros devem comprovar:

- capacidade, reposição, teto e reset distintos dos dois buckets;
- normalização idêntica para variações da mesma identidade e tratamento
  indistinguível de conta existente ou inexistente;
- chave sentinela única para todas as entradas não normalizáveis, sem e-mail
  bruto, sempre combinada com IP e ocupando uma única posição do mapa;
- capacidade 5, reposição de 180 segundos e esgotamento compartilhado com `429`
  genérico, sem consumo do saldo individual de identidades normalizadas;
- tentativa não normalizável admitida executando verificação negativa e mantendo
  o `401` e a auditoria funcional aplicáveis, sem auditoria funcional no `429`;
- reserva conjunta sem débito parcial, restituição idempotente e ausência de
  saldo acima da capacidade sob concorrência;
- `429`, `Retry-After`, ausência de banco/Argon2id e ausência de auditoria
  funcional para tentativa não avaliada;
- concorrência máxima, FIFO, fila cheia, timeout, cancelamento, liberação única
  e desconexão posterior ao início;
- remoção apenas de bucket recuperado, limpeza incremental e excepcional,
  saturação localizada, recuperação de capacidade e teto estrito dos mapas;
- ausência de expulsão de bucket ativo ou degradação para somente um limite;
- IP derivado de proxy conhecido e resistência a headers encaminhados forjados;
- reinicialização do estado efêmero, configuração inválida impedindo startup e
  isolamento entre a camada de admissão e `AuthSessionPersistence`.

Relógio controlável e promises coordenadas substituem esperas reais. Esses
testes não repetem provas criptográficas existentes e preservam o gate mínimo
de 90% em lines, statements, functions e branches.

## Recuperação de senha — contrato aprovado da F1-B.4.5

O contrato abaixo está aprovado para implementação. A fundação PostgreSQL da
F1-B.4.5.1, a camada transacional F1-B.4.5.2, a admissão/capacidade da
F1-B.4.5.3 e os casos de uso internos F1-B.4.5.4–F1-B.4.5.5 foram publicados.
O processamento da F1-B.4.5.6 foi implementado e publicado no commit
`601c92ab8f3922b5f0e2a03c432de5fc74c6258d`, com CI `42117321177` aprovado. A
F1-B.4.5.7 possui contrato normativo e implementação publicados, mas validação
operacional do provider, HTTP e disponibilidade produtiva permanecem pendentes.
Ele detalha AT-001, AT-003 e AT-009, resolve normativamente a PT-007 e o recorte
de recuperação da PT-008 e preserva a PT-009 aberta.

### Identidade e anti-enumeração

- `account.id` UUID permanece a identidade técnica. E-mail e `email_key`
  continuam imutáveis.
- A entrada é normalizada com a mesma regra do login e resolvida inicialmente por
  `email_key`. A persistência recebe somente `account_id` nullable; e-mail bruto e
  chave normalizada não são gravados na recuperação.
- Toda solicitação admitida cria um request `RECEIVED`. Entrada inválida ou conta
  inexistente usa `account_id` nulo e segue resposta indistinguível.
- Classificação posterior revalida conta ativa, e-mail verificado, ausência de
  desativação, credencial presente, cooldown e teto de tokens ativos, levando a
  `PENDING` ou `SUPPRESSED` sem mudar a resposta HTTP.
- Não há promessa de tempo constante, mas testes devem excluir diferença prática
  explorável entre entradas inválidas, inexistentes, inelegíveis, em cooldown e
  elegíveis.

### `POST /api/auth/password-recovery`

- recebe objeto JSON com exatamente `email`, string;
- exige `X-Bello-Flow-Request: 1`, origem ou `Referer` válido e
  `application/json`, antes do caso de uso;
- usa somente `request.ip` após a configuração de proxy confiável;
- estrutura, campo adicional, ausência ou tipo incorreto retornam `400
INVALID_REQUEST`;
- e-mail string semanticamente inválido não retorna `400` e segue a resposta
  anti-enumeração;
- solicitação admitida e persistida ou reconciliada retorna `202 Accepted` sem
  corpo, inclusive para conta inexistente, inelegível, em cooldown, já pendente
  ou com três tokens ativos;
- limite de admissão retorna `429 RATE_LIMITED` com `Retry-After`;
- falha operacional ou resultado ainda indeterminado retorna `503
SERVICE_UNAVAILABLE`.

### `POST /api/auth/password-reset`

- recebe objeto JSON com exatamente `token` e `newPassword`, ambos strings;
- exige os mesmos controles mutáveis da PT-005 e não exige sessão;
- DTO ou nova senha fora da política retorna `400 INVALID_REQUEST`;
- token string não canônico, inexistente, expirado, consumido, invalidado,
  associado a conta inelegível ou perdido em corrida determinada retorna o mesmo
  `401 AUTHENTICATION_FAILED`;
- limite retorna `429 RATE_LIMITED`; falha operacional ou indeterminação retorna
  `503 SERVICE_UNAVAILABLE`;
- redefinição confirmada ou reconciliada retorna `204 No Content` sem corpo;
- o endpoint não lê, emite nem limpa cookie de sessão. O cookie presente pode
  pertencer a outra conta. Todas as sessões da conta redefinida são revogadas no
  PostgreSQL; eventual cookie dessa conta será posteriormente resolvido como
  sessão inválida pelo contrato existente.

Erros preservam os envelopes e mensagens invariáveis já aprovados. Token, senha,
PHC, link e identificadores internos nunca integram respostas.

### Quotas e capacidade

| Endpoint e chave                                    | Capacidade |                 Reposição |
| --------------------------------------------------- | ---------: | ------------------------: |
| solicitação por identidade normalizada ou sentinela |          3 | 1 token a cada 10 minutos |
| solicitação por IP confiável                        |         30 |        1 token por minuto |
| reset por IP confiável                              |         60 | 1 token a cada 5 segundos |

- A solicitação reserva simultaneamente identidade/sentinela e IP antes do banco;
  não há débito parcial.
- A sentinela é única, não contém nem deriva do e-mail bruto e sempre é combinada
  ao IP.
- Mapas aceitam até 16.000 identidades, incluindo a sentinela, e 4.000 IPs.
  Somente buckets integralmente recuperados podem ser removidos. Saturação sem
  entrada elegível retorna `503` localizado.
- Cooldown persistente por conta é de 10 minutos.
- `Retry-After` usa a maior espera aplicável. `429` não consulta PostgreSQL, não
  executa Argon2id e não produz auditoria funcional.
- O reset não possui bucket por token: aleatoriedade de 256 bits, IP, uso único,
  expiração, lock da conta e capacidade Argon2id são os controles aprovados.
- Login e reset compartilham o limite global de duas execuções Argon2id, fila FIFO
  de quatro e espera máxima de um segundo. As quotas próprias do login não mudam.

### F1-B.4.5.3 — admissão e capacidade compartilhada

Este incremento foi implementado e publicado pelo commit
`47a6ae033f42d40b56c24bad82b454af0616e2ec`, com CI `42050631222` aprovado. Ele
materializa somente as quotas efêmeras já aprovadas e a capacidade Argon2id
global, sem expor endpoint ou executar caso de uso, PostgreSQL, outbox ou e-mail.

- A admissão de solicitação reserva identidade normalizada ou sentinela e IP em
  uma única seção síncrona, antes de qualquer `await`, sem débito parcial.
- A admissão do reset reserva somente o bucket de IP aprovado; não existe bucket
  por token.
- A sentinela é única, ocupa uma posição do limite de identidades, não contém nem
  deriva do e-mail bruto e nunca substitui o bucket de IP.
- Os mapas permanecem efêmeros e locais à instância única. Somente entradas
  integralmente recuperadas e sem reserva podem ser removidas; saturação rejeita
  somente a nova chave com `503`, sem degradar buckets existentes.
- Esgotamento usa `429 RATE_LIMITED` e o maior `Retry-After` aplicável, sem revelar
  qual chave limitou a requisição. Pré-admissão rejeitada não consulta banco, não
  executa Argon2id e não produz auditoria funcional.
- A fila Argon2id é única para login e reset, FIFO, limitada a quatro esperas e
  duas execuções. Cancelamento antes da aquisição, timeout e aquisição são
  mutuamente exclusivos; trabalho iniciado ocupa a vaga até seu término real.
- Admissão e capacidade são responsabilidades internas separáveis. Serviços
  existentes de autenticação e futuros serviços de recuperação consomem seus
  resultados sem acesso direto aos mapas ou à fila; a forma concreta dessa
  separação não é prescrita.
- O comportamento publicado do login permanece integralmente preservado,
  incluindo quotas próprias, sentinela, resultados, restituições, erros,
  cancelamento e ausência de quotas em sessão e logout.

A F1-B.4.5.3 não define persistência, cooldown, classificação funcional,
processamento, provider ou resposta HTTP da recuperação e não encerra a PT-008.

### F1-B.4.5.4 — solicitação e classificação publicadas

Este contrato técnico, incluindo D1–D3, foi implementado e publicado no commit
`a57f718bf4efb74f2daa76c4b5127c9241d939be`, com CI `42069921440` aprovado. O
incremento termina na classificação persistente e não expõe endpoint, gera token,
cria tentativa de entrega ou chama provider.

#### Ordem e anti-enumeração

1. A fronteira interna aceita apenas a string de identidade e o IP já determinado
   pela infraestrutura confiável. Validação estrutural pode falhar; invalidade
   semântica do e-mail continua no fluxo anti-enumeração.
2. A identidade é normalizada pela regra canônica existente. Identidade não
   normalizável usa a sentinela apenas na admissão; o PostgreSQL recebe chave
   normalizada ou nulo, nunca e-mail bruto nem a sentinela.
3. A reserva conjunta de identidade/sentinela e IP ocorre antes de qualquer
   `await`. Rejeição por quota ou saturação termina antes do PostgreSQL.
4. A função protegida registra e classifica a solicitação em uma transação. O
   resultado interno confirmado é apenas `RECORDED`; existência da conta,
   `PENDING`, `SUPPRESSED`, cooldown, request pendente e teto de tokens não são
   expostos ao consumidor.
5. Registro confirmado confirma a reserva; falha anterior ao envio da operação
   ou rollback confirmado a restitui uma única vez. Commit indeterminado exige
   reconciliação pelo mesmo `recovery_request_id`, sem repetição automática. Se o
   resultado continuar `UNKNOWN` depois dela, a reserva é consumida e o caller
   recebe indisponibilidade; isso não declara sucesso funcional.

O futuro contrato HTTP já aprovado continua uniforme: identidade inexistente,
inválida ou inelegível, cooldown, request pendente, teto de tokens e supressão
confirmada resultam no mesmo `202` sem corpo. Somente admissão rejeitada pode
produzir `429`; saturação, falha operacional ou indeterminação produzem `503`.
Nenhum resultado, erro, log ou métrica contém e-mail, `email_key`, sentinela,
`account_id`, motivo de supressão ou contagens internas.

#### Segurança da persistência e auditoria

- O runtime invoca somente funções `SECURITY DEFINER` de assinatura exata. O
  owner é o migrator; `search_path` é fixo; objetos são qualificados; SQL
  dinâmico é proibido; `PUBLIC`, bootstrap e manutenção não recebem `EXECUTE`.
  Não há DML nem leitura sensível direta do runtime.
- Uma consulta otimista por `email_key` pode descobrir a conta candidata, mas não
  decide elegibilidade. Conta conhecida é serializada pelo advisory lock comum e
  revalidada sob row locks na ordem global. Conta inexistente não recebe lock
  artificial nem identificador persistido.
- Somente a transição elegível a `PENDING` grava
  `AUTH_PASSWORD_RECOVERY_REQUESTED`, atomicamente com o request. Como a chamada
  é anônima, `actor_account_id` é nulo; a conta conhecida aparece somente como
  `entity_id`. O request ID ocupa `operation_id` e `correlation_id`, sequência
  `1`; `context`, `before_data` e `after_data` são nulos.
- `RECEIVED`, `SUPPRESSED`, quota, saturação, conta inexistente ou inelegível,
  cooldown, request pendente, teto de tokens, rollback e falha operacional não
  geram evento funcional. Rollback nunca deixa request ou auditoria parcial.

O cooldown de dez minutos usa `received_at` do request mais recente que tenha o
evento correlacionado `AUTH_PASSWORD_RECOVERY_REQUESTED`, prova de que alcançou
`PENDING`. O estado atual não substitui essa prova: estados posteriores,
inclusive terminais, permanecem no cálculo. A verificação ocorre sob o advisory
lock da conta; a janela está ativa antes de `received_at + 10 minutes` e expira na
igualdade. A retenção operacional de 30 dias não remove a prova dentro dessa
janela.

### F1-B.4.5.5 — fronteira interna de redefinição publicada

O caso de uso interno foi publicado no commit
`9ac023961b769b9e52c53d6799501df300c4ce3e`, com CI `42083803500` aprovado nos
jobs `Quality`, `API integration` e `Required`. Ele recebe token, nova senha e IP
confiável, sem sessão.
A estrutura e a política da senha são validadas antes da admissão e de qualquer
efeito. A admissão reserva o bucket de reset por IP antes de `await`; `429` ou
saturação terminam sem PostgreSQL, Argon2id ou auditoria funcional.

Depois da admissão, o token aceita somente Base64URL canônica sem padding de 43
caracteres que decodifique exatamente 32 bytes. O hash usa separação de domínio
`SHA-256("bello-flow/password-reset/v1\0" || token_bytes)`. O token bruto e a
nova senha permanecem apenas na memória necessária ao caso de uso; token, hash,
senha e PHC não integram logs, erros, métricas, auditoria ou resultados.

A intenção PostgreSQL deve estar confirmada em `STARTED` antes do trabalho
Argon2id. Token não resolvido ou `REJECTED` retorna negativa funcional opaca sem
hashing. O PHC usa exclusivamente o perfil publicado e o executor global do
login: duas execuções, fila FIFO de quatro e espera máxima de um segundo. Timeout
ou cancelamento antes da aquisição não inicia o hash; trabalho iniciado conserva
a vaga até terminar e não promete cancelamento nativo.

A conclusão protegida continua autoridade sobre consumo único, credencial,
outros tokens, requests, tentativas, sessões e auditoria. Apenas `COMPLETED`
comprovado — diretamente ou por reconciliação — autoriza sucesso. Token inválido,
expirado, consumido, invalidado, conta inelegível, corrida determinada e
`REJECTED` são a mesma negativa; `NOT_FOUND`, `INCONSISTENT`, `UNKNOWN` e falha de
observação são indisponibilidade fail-closed. Nenhuma mutação é repetida depois de
possível envio sem classificação conclusiva, e todos os retries permitidos
reutilizam o mesmo `reset_operation_id` e IDs de auditoria.

O adapter recebe somente `EXECUTE` nas funções já publicadas. Ele não lê tabelas,
não expõe `account_id`, estados internos, contagens, hashes ou PHC e não amplia
grants. O incremento não lê, emite ou limpa cookie; a revogação permanece efeito
atômico do PostgreSQL e será observada posteriormente pelo fluxo de sessão.

A reserva de reset possui disposição própria. Pré-admissão rejeitada não cria
reserva. Falha comprovadamente anterior ao envio do start ou rollback comprovado
dessa transação, sem `STARTED`, autoriza refund idempotente. Token malformado
depois da admissão, token não resolvido, `REJECTED`, `STARTED`, falha de aquisição
ou execução Argon2id depois do start, `COMPLETED` e qualquer resultado após
possível envio confirmam o consumo.

`NOT_FOUND`, `INCONSISTENT`, `UNKNOWN` ou falha da própria reconciliação consomem
a reserva e retornam indisponibilidade, sem repetição automática. Exceção
genérica, timeout, transporte, cancelamento ou perda de conexão não comprovam
rollback. A reserva é finalizada uma única vez; commit significa tentativa
admitida consumida, não sucesso, validade do token ou existência da conta. A
matriz do login permanece inalterada.

A preparação local posterior à admissão está protegida separadamente da chamada
de start. Falha no SHA-256, nos UUIDs ou na montagem da entrada faz refund uma
única vez, sem PostgreSQL, Argon2id, complete ou reconciliação. Uma vez que o
start possa ter sido enviado, esse tratamento não se aplica: a reserva é
consumida e a classificação permanece conservadora.

### F1-B.4.5.6 — Processador de Entrega com Adapter Controlado

O contrato deste incremento está aprovado, implementado e publicado no commit
`601c92ab8f3922b5f0e2a03c432de5fc74c6258d`. Ele liga
somente solicitações `PENDING` ao processamento interno, ao token just-in-time e
ao adapter técnico. Não cria endpoint, frontend, provider produtivo, fila externa,
outbox genérica, retenção ou disponibilidade de recuperação em produção.

#### Autorização de envio e resultado externo

`PREPARED → SENDING` é uma transição protegida e confirmada antes do efeito
externo. Somente a primeira transição recém-confirmada pode devolver
`SEND_AUTHORIZED`, junto do e-mail destinatário minimizado para o adapter. Esse
retorno é efêmero e não repetível: nova chamada em `SENDING` devolve
`ALREADY_SENDING`, sem destinatário e sem autorização, e reconciliação é sempre
observacional.

O adapter recebe somente `recipientEmail`, `recoveryUrl`, `expiresAt` e `signal`,
não acessa PostgreSQL e devolve uma destas classificações:

- `ACCEPTED`: o provider controlado confirmou aceite; autoriza `SENT` e a
  auditoria correspondente;
- `NOT_ACCEPTED`: há prova de que não ocorreu aceite; autoriza falha determinada,
  invalidação e backoff aplicável; ou
- `INDETERMINATE`: houve timeout, exceção inesperada, cancelamento, perda de
  resposta ou outra situação sem prova de ausência de aceite; autoriza somente
  `UNKNOWN`.

`AbortSignal` limita a espera local, mas não prova cancelamento no provider. Não
há garantia exactly-once. Depois de `SENDING`, crash, commit indeterminado ou
recuperação de lease não autoriza nova chamada externa. Resultado tardio só pode
concluir `SENDING` ainda pertencente ao mesmo lease e nunca sobrescreve terminal.

#### Ativação e lifecycle

`BELLO_PASSWORD_RECOVERY_DELIVERY_MODE` aceita `disabled` ou `controlled`; sua
ausência equivale a `disabled`. `controlled` é aceito exclusivamente com
`NODE_ENV=test`. Valor desconhecido ou modo controlado em `development` ou
`production` impede a inicialização. Esse fail-fast é a barreira verificável que
impede o adapter técnico de representar provider produtivo; PT-009 permanece
aberta.

No modo controlado, um processador NestJS interno usa loop simples, sem scheduler
ou dependência nova, com paralelismo 1 por instância, polling ocioso de 1 segundo
e no máximo 10 claims por ciclo. Somente `NO_WORK` confirmado representa
ociosidade. Erro de infraestrutura, timeout e resultado desconhecido permanecem
falha ou indeterminação e não provocam loop imediato nem envio presumido.

Shutdown impede novos claims e novas chamadas ainda não iniciadas. Chamada já
iniciada espera somente até o timeout controlado de 10 segundos e sua interrupção
não é reclassificada como prova de não aceite. Múltiplas instâncias dependem dos
locks PostgreSQL aprovados; não se introduzem leader election, heartbeat
distribuído ou coordenação externa.

#### Link, memória e logs

O link é construído exclusivamente como
`{BELLO_PUBLIC_ORIGIN}/reset-password#token={encodeURIComponent(base64url_token)}`.
`BELLO_PUBLIC_ORIGIN` é a origem canônica confiável já validada no bootstrap; não
se usam `Host` nem headers encaminhados. Token e link existem apenas em memória e
somente o hash separado por domínio é persistido.

Token, hash, link, destinatário, IP bruto e erro integral do adapter são proibidos
em logs, exceções, métricas e auditoria. Valores e identificadores de lease não
integram auditoria nem logs que possam expor dados operacionais sensíveis. Eventos
minimizados de aquisição, expiração e recuperação podem ser observados em logs ou
métricas sem `lease_id`, destinatário ou outro identificador sensível, preservando
a política operacional já aprovada. A operação protegida não amplia `SELECT
account.email`; o e-mail existe somente no retorno original de `SEND_AUTHORIZED`.

#### Matriz de auditoria do aceite

`AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED` ocorre exclusivamente depois de
`ACCEPTED`, na mesma transação de `SENT`. `INTERNAL_PROCESSOR` é a origem normativa
do processador interno:

| Campo              | Valor aprovado                         |
| ------------------ | -------------------------------------- |
| `actor_account_id` | `NULL`                                 |
| `origin`           | `INTERNAL_PROCESSOR`                   |
| `scope`            | `SECURITY`                             |
| `operation`        | `AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED` |
| `result`           | `SUCCESS`                              |
| `entity_type`      | `ACCOUNT`                              |
| `entity_id`        | `account_id`                           |
| `operation_id`     | `delivery_attempt_id`                  |
| `correlation_id`   | `recovery_request_id`                  |
| `sequence`         | `1`                                    |
| `before_data`      | `NULL`                                 |
| `after_data`       | `NULL`                                 |
| `context`          | `NULL`                                 |

`SENT` e o evento comprovam aceite pelo provider, não entrega ao destinatário.
Não se cria evento de entrega sem evidência própria.

### Token, link e disponibilidade

- cada tentativa gera just-in-time 32 bytes de CSPRNG e Base64URL canônica sem
  padding;
- a validação persiste somente 32 bytes derivados por
  `SHA-256("bello-flow/password-reset/v1\0" || token_bytes)`;
- token é de uso único e expira 30 minutos após a geração;
- valor bruto e link existem somente na memória entre `PREPARED` e a chamada ao
  provider; não são persistidos, criptografados para recuperação, registrados ou
  reconstruídos;
- a URL usa exclusivamente a origem pública confiável e a rota frontend
  `/reset-password`; a F1-B.4.5.6 aprovou o transporte do token no fragmento e sua
  remoção do histórico após a captura;
- adapter controlado pode validar tecnicamente o fluxo em testes, mas não
  representa provider real nem disponibilidade produtiva;
- a F1-B.4.5.7 aprova Resend e o contrato técnico do adapter produtivo, mas a
  PT-009 permanece aberta. Produção exige implementação, credenciais e domínio
  reais, validação operacional e autorização específica de ativação.

### Entrega e `UNKNOWN`

Uma solicitação possui até três tentativas e cada tentativa até um token.
`SENDING` deve estar confirmado no PostgreSQL antes da chamada externa. Falha
determinada pode gerar nova tentativa depois de 1 e 5 minutos. Crash em
`PREPARED`, antes de `SENDING`, permite invalidar o token comprovadamente não
enviado.

Crash, timeout ou perda de conexão depois de `SENDING` produz `UNKNOWN`. Esse
estado não é reenviado automaticamente, não exige recuperar o token bruto, não
inventa aceitação ou entrega e não invalida o token potencialmente entregue. O
token conserva sua expiração natural. Nova solicitação legítima permanece
possível segundo quotas, cooldown, request pendente e teto de três tokens ativos.

### Logs e auditoria

`RECEIVED`, `SUPPRESSED`, quotas, claims, leases, saturação, falhas técnicas e
entradas que não alcançaram avaliação funcional são metadados operacionais, logs
ou métricas minimizados. Eles não criam auditoria funcional imutável.

Os eventos funcionais são `AUTH_PASSWORD_RECOVERY_REQUESTED`, quando solicitação
elegível chega a `PENDING`; `AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED`, quando o
provider aceita o envio; `AUTH_PASSWORD_RESET_SUCCEEDED`, no reset confirmado; e
`AUTH_PASSWORD_RESET_REJECTED`, somente quando token resolve uma conta e alcança
avaliação funcional determinada. Token aleatório não resolvido não cria auditoria
imutável. Cada evento participa da mesma transação de sua mutação local.

Os eventos usam somente conta conhecida, `recovery_request_id`,
`delivery_attempt_id` ou `reset_operation_id`, resultado e contagens mínimas. Não
contêm e-mail, IP bruto, chave de bucket, senha, PHC, token, hash, link, corpo HTTP
ou erro completo do provider. `SENT` significa aceitação pelo provider, não
entrega ao destinatário; não existe evento de entrega sem evidência própria.

### F1-B.4.5.7 — Provider Resend e barreiras de ativação

O contrato aprovado usa exclusivamente a API HTTPS da Resend em
`https://api.resend.com/emails`, com Bearer API key de `sending access` restrita ao
subdomínio, cliente HTTP nativo do Node e nenhuma dependência do SDK. Não há
fallback, segundo provider, webhook, idempotency key ou provider message ID
persistido. O adapter permanece atrás do port da F1-B.4.5.6.

#### Configuração segura

`BELLO_PASSWORD_RECOVERY_DELIVERY_MODE` aceita `disabled`, `controlled` e
`resend`. Ausência preserva `disabled`; modo desconhecido falha na inicialização;
`controlled` só existe em `NODE_ENV=test`; e `resend` é proibido nesse ambiente.
O modo `resend` exige `BELLO_PASSWORD_RECOVERY_RESEND_API_KEY` não vazia e sem
whitespace ou caracteres de controle, `BELLO_PASSWORD_RECOVERY_FROM_ADDRESS`
sintaticamente válido e `BELLO_PUBLIC_ORIGIN` HTTPS válido.

O endpoint é constante e não pode ser substituído por variável. Credenciais são
distintas por ambiente, entregues somente ao processo necessário e armazenadas
fora do código. Erros e logs não revelam valor, prefixo, tamanho ou presença
parcial do segredo. `disabled` é kill switch explícito mesmo quando a infraestrutura
injeta credenciais, e nenhum modo possui fallback silencioso.

A implementação publicada aplica essas barreiras no bootstrap, seleciona o
adapter Resend somente no modo explícito e mantém `disabled` como padrão. Essa
evidência sintética não comprova chave, remetente, domínio ou conta reais.

#### Classificação conservadora e efeito externo

`ACCEPTED` exige HTTP `200`, resposta integral, JSON válido e `id` string não
vazio. O identificador é descartado e comprova aceite síncrono, nunca entrega.
`NOT_ACCEPTED` exige JSON integral com `name`, `message` e `statusCode`, igualdade
entre `statusCode` e HTTP e uma combinação da whitelist normativa da
[F1-B.4.5.7](decisoes-tecnicas.md#contrato-aprovado--f1-b457-provider-produtivo-e-configuração-operacional).
O texto variável de `message` não participa da classificação nem é registrado.

Qualquer combinação externa à whitelist, `409`, `5xx`, resposta parcial ou
inválida, divergência de status, DNS, TLS, interrupção de conexão, timeout,
cancelamento ou perda de resposta é `INDETERMINATE`. O timeout total inicial é de
10 segundos e cobre conexão, TLS, envio, headers e leitura; redirects são
rejeitados. Há exatamente uma requisição por `SEND_AUTHORIZED`, sem retry do
cliente, SDK ou adapter. `Retry-After` pode produzir somente observabilidade
sanitizada. Abort local não comprova rollback remoto, e `UNKNOWN` não é reenviado.

A implementação limita a leitura incremental da resposta a 64 KiB efetivamente
recebidos. Excesso, UTF-8 inválido, truncamento ou falha do stream são
`INDETERMINATE`; o conteúdo externo não integra logs ou erros.

#### Mensagem, link e tracking

O remetente visível é `Bello Flow`, com endereço configurado no subdomínio
transacional verificado. A mensagem local em português usa assunto `Redefina sua
senha no Bello Flow`, partes texto e HTML UTF-8, validade de 30 minutos, orientação
para ignorar solicitação desconhecida e somente o link canônico já aprovado. Não
inclui nome, workspace, IP, identificadores internos, anexos, imagens externas,
template remoto, tags ou metadata desnecessária.

Texto preserva a URL exata; HTML usa escaping de atributo e precisa resultar no
mesmo `href` depois da decodificação. Encurtadores, redirects e reescrita são
proibidos. O subdomínio exclusivo mantém `open_tracking=false` e
`click_tracking=false`. Tracking é configurado e comprovado operacionalmente no
domínio, não pelo runtime; omitir campos no payload não prova desativação, e a
chave de envio não recebe administração de domínio.

#### Dados externos e PT-009

Segundo a documentação oficial consultada, conteúdo de mensagens e logs são
armazenados nos Estados Unidos por 30 dias em Free, Pro e Scale, backups por 7
dias, e a região de envio não muda a residência. O link completo pode ser tratado
e retido externamente; a expiração do token em 30 minutos não equivale ao prazo de
retenção. Não armazenamento de conteúdo depende de elegibilidade e contratação e
não é presumido.

Ativação exige comprovação sanitizada de titularidade da conta, MFA, plano,
custos, quotas, DNS, DKIM, SPF, avaliação de DMARC, remetente, chave mínima e
segregada, secret manager, rotação, revogação, TLS, conectividade, DPA,
subprocessadores, jurisdição, retenção, tracking desativado e mensagem real sem
pixel ou reescrita. Avaliação operacional e jurídica aplicável precisa aceitar ou
mitigar o tratamento externo antes da ativação. PT-009 permanece aberta; aprovação
normativa, implementação e publicação não declaram disponibilidade produtiva.

### Fronteira PostgreSQL da F1-B.4.5.2

Este recorte foi implementado e publicado. Ele contém somente intenção,
conclusão, reconciliação, grants, testes PostgreSQL e a adequação do advisory lock
do login. Não publica endpoint, não processa e-mail, não gera nem entrega token e
não resolve a PT-009. Fixtures inseridas pelo migrator são preparação técnica de
teste e não representam fluxo produtivo.

O runtime acessa as operações protegidas por funções `SECURITY DEFINER` estritas.
O migrator atual pode ser owner; `search_path` é fixado em `pg_catalog, public,
pg_temp`, objetos são qualificados, argumentos são validados e não há SQL
dinâmico. A função auxiliar que deriva a chave não integra a superfície do
runtime. O runtime recebe apenas `EXECUTE` na aquisição do lock e nas operações de
intenção, conclusão e reconciliação exclusivamente observacional. `PUBLIC`,
bootstrap e manutenção não recebem `EXECUTE`, e não se concede novo DML sensível
direto ao runtime. Não existe função de fechamento, overload de reconciliação com
modo mutável ou superfície runtime para terminalização irreversível sem efeitos
nesta fase.

O lock é derivado internamente a partir de UUID v4 canônico em minúsculas, domínio
UTF-8 `bello:auth:account:`, SHA-256, primeiros oito bytes e `bigint` signed
big-endian. Caller não fornece a chave de serialização. Login antigo e funções
novas precisam produzir a mesma chave antes de o login migrar para a aquisição
SQL.

Na intenção, a descoberta inicial do token não bloqueia linha. Depois dela, a
função adquire o advisory lock da conta, bloqueia e revalida conta e credencial,
resolve e bloqueia explicitamente o token e somente então insere o marcador. Isso
faz com que os locks implícitos das FKs imediatas para conta e token alcancem
linhas já protegidas. A conclusão conserva a ordem global com marcador existente;
a exceção de criação é segura somente porque todo writer do token usa antes a
mesma chave advisory da conta e tokens não são compartilhados entre contas.

Token não canônico ou aleatório que não resolva linha/conta não cria marcador nem
auditoria funcional. Token conhecido já expirado, consumido ou invalidado,
corrida perdida depois da intenção, inelegibilidade da conta e divergência da
correlação da credencial são rejeições funcionais determinadas: terminalizam o
marcador em `REJECTED`, geram exatamente um `AUTH_PASSWORD_RESET_REJECTED` e não
consomem, invalidam, cancelam, revogam ou alteram credencial. Falha operacional
não é rejeição e retorna ao caso de uso como indeterminação ou indisponibilidade,
sem auditoria funcional inventada.

A ausência de `password_credential` para a conta de um token conhecido é a
exceção operacional fail-closed anterior à intenção. Como não existe
`changed_operation_id` real a correlacionar, a função não cria marcador, não
produz `AUTH_PASSWORD_RESET_REJECTED`, não altera token, conta, credencial ou
sessão e não inventa identificador. O caso de uso futuro o traduz em falha
operacional uniforme, sem revelar a existência da conta; diagnóstico técnico
eventual usa somente código estável e não registra identificadores ou segredos.

Cada reset resolvido possui exatamente um evento terminal na sequência `1`. Em
sucesso, usa `AUTH_PASSWORD_RESET_SUCCEEDED`/`SUCCESS`; em rejeição,
`AUTH_PASSWORD_RESET_REJECTED`/`DENIED`. `operation_id` e `correlation_id` são o
`reset_operation_id`; ator e entidade são a conta resolvida; o contexto contém
somente `reason = PASSWORD_RESET` e as contagens de sessões revogadas, tokens
invalidados, requests cancelados e tentativas canceladas, inclusive quando zero.
Rejeição possui as quatro contagens em zero. `before_data` e `after_data` são
nulos. Nenhum campo contém senha, PHC, token, hash, e-mail, IP ou link.

`COMPLETED` é o único resultado que autoriza sucesso de redefinição. `REJECTED`
autoriza somente a negativa funcional uniforme. `NOT_FOUND` exige ausência
comprovada de todos os efeitos e da auditoria; não pode ocultar rejeição nem
operação concorrente. Evidência parcial ou contraditória é `INCONSISTENT`; falha
de consulta, retenção, evidência insuficiente ou resultado ainda incerto é
`UNKNOWN`. Nenhum resultado indeterminado é repetido automaticamente.

Conclusão aceita mutação somente a partir de `STARTED`. `COMPLETED` e `REJECTED`
admitem retorno idempotente apenas com suas evidências completas. `NOT_FOUND`,
`INCONSISTENT` e `UNKNOWN` produzem `RECONCILIATION_REQUIRED`, falha operacional
sem efeito e sem nova rejeição funcional; chamada tardia nunca reabre marcador
terminal. Depois de possível envio de `COMMIT`, o caller não repete conclusão e
usa reconciliação.

A reconciliação nunca converte `STARTED` ou `UNKNOWN` sem efeitos em `NOT_FOUND`:
Argon2id em andamento, idade, timeout, reinício, advisory lock disponível e
ausência de efeitos não provam abandono. Ela não altera marcador, auditoria nem
efeitos de negócio. `NOT_FOUND` somente é reconhecido a partir de marcador já
terminal e evidências coerentes; o runtime não produz nova terminalização desse
estado na F1-B.4.5.2. Crash ou intenção aparentemente abandonada permanece
`STARTED` ou `UNKNOWN`, sem recuperação automática pela F1-B.4.5.2. O contrato da
F1-B.4.5.8 abaixo define a autoridade futura de terminalização, mas sua
implementação ainda não foi iniciada e não declara disponibilidade produtiva.

Os predicados físicos, contagens, cadeia de alterações posteriores e política de
retry estão em
[persistência e auditoria](persistencia-e-auditoria.md#operações-transacionais-da-f1-b452).

### F1-B.4.5.8 — terminalização segura de intenções abandonadas

O contrato aprovado autoriza somente `STARTED → NOT_FOUND`. `UNKNOWN` continua
fail-closed e nenhum estado terminal é reaberto. Marcador terminal `NOT_FOUND`
significa intenção conhecida, encerrada sem efeito funcional e ainda dentro da
janela probatória; marcador ausente continua observação insuficiente, `REJECTED`
continua negativa funcional auditada e `UNKNOWN` continua indeterminação.

O `expires_at` do token vinculado é o limite funcional. Antes dele, Argon2id ainda
pode produzir hash apto à conclusão e a intenção nunca é elegível. Depois dele,
conclusão revalida o token e não pode produzir sucesso. Expiração, idade, timeout,
reinício ou advisory lock livre, isoladamente, não autorizam terminalização: são
obrigatórios marcador `STARTED`, `terminal_at` nulo, grafo íntegro, ausência total
de efeitos e auditoria e revalidação sob a ordem global de locks.

A seleção observacional prioriza `CANDIDATE`, ordenado por expiração e UUID; sem
candidato, retorna a primeira `INCONSISTENT` por atualização e UUID; somente a
ausência de ambos produz `NO_CANDIDATE`. Vínculo quebrado, token ausente, ordinal
incompatível, consumo ou invalidação divergente nunca são convertidos em
ociosidade. Depois de cada lote cheio, um probe booleano limitado sinaliza a
existência de inconsistência mesmo sob fluxo contínuo, sem retornar UUID, bloquear
candidatos ou reparar dados.

A função mutável recebe somente UUID v4 de operação, descobre internamente a conta
e a chave de serialização e retorna resultado fechado. As três interfaces usam
`SECURITY DEFINER`, owner migrator, `search_path` protegido, objetos qualificados,
nenhum SQL dinâmico e `EXECUTE` exclusivo do runtime. Não há DML sensível direto,
role ou credencial nova, e a reconciliação observacional não é usada como reparo.

Conclusão e terminalização adquirem os mesmos locks. Se conclusão confirmar
primeiro, produz `COMPLETED` ou `REJECTED`; se terminalização confirmar primeiro,
`NOT_FOUND` cerca a conclusão tardia, que falha sem tocar credencial, tokens ou
sessões. Duas instâncias podem concorrer, mas somente uma atualização condicional
vence. Commit indeterminado é observado pelo ID conhecido e não repetido por
suposição; falha de observação permanece indeterminada.

Marcador ausente é `NOT_OBSERVED`; `STARTED` íntegro antes da expiração e
`UNKNOWN` íntegro são `NOT_ELIGIBLE`; `COMPLETED`, `REJECTED` e `NOT_FOUND`
coerentes são `ALREADY_TERMINAL`; estado persistido `INCONSISTENT` ou evidência
contraditória é `INCONSISTENT`. Somente atualização confirmada de um `STARTED`
íntegro e expirado é `TERMINALIZED`. Falha SQL não recebe classificação funcional.

Não se adicionam lease, heartbeat, ownership ou fencing numérico, pois não existe
reassunção do hash. O fence é a transição terminal sob locks depois da perda
objetiva da aptidão do token. Pausa ou crash antes da expiração preservam
`STARTED`; retomada posterior à expiração nunca recupera autorização de sucesso.

O executor interno usa
`BELLO_PASSWORD_RESET_TERMINALIZER_MODE=disabled|internal`, com `disabled` por
padrão, ativação explícita, polling de 60 segundos, lote dez, paralelismo um,
`lock_timeout` de dois segundos e `statement_timeout` de cinco segundos. Testes não
iniciam worker por configuração ambiental; shutdown impede novos ciclos e aguarda
a operação ativa conservadoramente. Não há fila, scheduler, leader election ou
plataforma nova.

`NOT_FOUND` não gera auditoria funcional. Logs e métricas comuns usam somente
categorias fechadas, duração e contagens; proíbem senha, PHC, token ou hash, e-mail,
link, IP bruto, payload, credencial, `reset_operation_id` e demais identificadores
sensíveis. A janela de 30 dias começa apenas no `terminal_at` confirmado; este
incremento não remove dados nem altera a PT-009 ou a disponibilidade produtiva.

Implementação local: a migration F1-B.4.5.8 aplica `SECURITY DEFINER`, owner do
migrator, `search_path` protegido, objetos qualificados, revogação de `PUBLIC`,
bootstrap e manutenção e `EXECUTE` exclusivo do runtime nas três interfaces. O
runtime continua sem DML direto. Essa evidência foi validada em PostgreSQL 18.6
descartável, mas ainda não foi publicada nem validada por CI remoto.

## Fluxo de uma requisição protegida

1. Validar transporte seguro e o header obrigatório; em operação mutável,
   validar também origem, proteção CSRF e tipo de conteúdo aplicável.
2. Resolver a sessão persistida sem registrar seu identificador em logs; um
   endpoint operacional público não executa esta etapa.
3. Validar expiração por inatividade e absoluta.
4. Validar conta ativa e e-mail verificado quando exigido.
5. Carregar o estado atual necessário à política do domínio.
6. Avaliar ação, recurso, participação e papel, com negação por padrão.
7. Para mutação sensível, repetir a validação relevante dentro da transação.
8. Auditar a negativa quando funcionalmente relevante, sem revelar conteúdo privado.

## Escopos de autorização

| Escopo               | Exemplos de autoridade                                                            | Não concede automaticamente                                 |
| -------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Global               | administrar contas e atribuição de Administrador Global                           | participação em Workspace, quadro ou auditoria de conteúdo  |
| Workspace            | participantes, papéis, fuso, etiquetas globais e governança autorizada de quadros | listas, cartões, comentários, feed ou auditoria de conteúdo |
| Governança de quadro | dados básicos, visibilidade, participantes, papéis e arquivamento                 | conteúdo sem participação explícita                         |
| Conteúdo de quadro   | listas, cartões e colaboração conforme papel                                      | administração global ou do Workspace                        |
| Auditoria            | consulta do escopo administrativo ou de conteúdo autorizado                       | dados fora do contexto e da permissão atuais                |

Essas fronteiras implementam DEC-006, DEC-007 e DEC-008, além de RN-083–RN-085 e RN-124.

## Serviço central de políticas

O serviço central deve:

- organizar políticas por domínio, evitando uma matriz monolítica desconectada do recurso;
- receber contexto explícito de usuário, ação e recurso;
- consultar papéis e vínculos atuais no backend;
- produzir apenas as informações necessárias para permitir, negar ou aplicar redação;
- ser reutilizado por HTTP, serviços internos, WebSocket, feed e auditoria;
- restringir a consulta na origem, em vez de carregar dados proibidos para filtrá-los depois;
- diferenciar 404 de 403 conforme o risco de revelar a existência do recurso;
- não manter cache persistente de permissões entre requisições no MVP.

## WebSocket

A autenticação inicial do WebSocket não autoriza indefinidamente a conexão. Inscrições são avaliadas por quadro, e sessão, conta, participação e papel precisam ser reavaliados quando aplicável. Remoção, desativação ou mudança de papel invalida as inscrições afetadas antes de novas entregas protegidas.

## Bootstrap e recuperação administrativa

- A primeira conta é criada por CLI administrativa não pública.
- A execução é autorizada pelo responsável pela instalação e protegida contra concorrência.
- Identidade, papel global, estado de conclusão e auditoria inicial formam uma unidade atômica.
- A origem administrativa precisa ser rastreável mesmo sem uma conta autora anterior.
- O bootstrap comum não pode ser reutilizado quando já houver Administração Global ativa.
- Recuperação emergencial é um procedimento offline separado, controlado e auditado, priorizando a recuperação de conta existente.
- A recuperação não concede participação em Workspaces ou quadros.

O comando, formato de autorização e mecanismo operacional da CLI serão definidos posteriormente.

## Tokens de verificação e recuperação

- O valor enviado é aleatório, de uso único e limitado no tempo.
- A estrutura de validação persiste somente hash suficiente para verificar a apresentação futura.
- Verificação expira em 24 horas; recuperação de senha expira em 30 minutos.
- Recuperação não confirma publicamente a existência da conta.
- Redefinição bem-sucedida revoga sessões e produz auditoria sem o token.
- Logs, feed e auditoria não registram o valor do link, cookie ou token.

A F1-B.4.5 detalha geração just-in-time sem persistir token ou link recuperável;
a geração e o processamento foram publicados pela F1-B.4.5.6. O contrato Resend
da F1-B.4.5.7 está implementado e publicado, mas não foi validado
operacionalmente; a
[PT-009](pendencias-tecnicas.md#pendências-operacionais) permanece aberta.

## Respostas e minimização

- Negativas usam 404 quando revelar a existência for indevido e 403 nas demais situações.
- Mensagens de recuperação mantêm resposta externa indistinguível para contas existentes e inexistentes.
- Consultas administrativas não retornam conteúdo usado apenas para decidir autorização.
- Auditoria de negativa registra contexto mínimo e autorizado.
- Logs técnicos não substituem auditoria e não devem conter conteúdo sensível desnecessário.

## Rastreabilidade

- [BEL-026–BEL-032, BEL-035, BEL-036 e BEL-038](../produto/requisitos-funcionais.md)
- [DEC-006–DEC-010, DEC-017, DEC-020 e DEC-021](../produto/decisoes-funcionais.md)
- [RN-007–RN-009, RN-017–RN-025, RN-083–RN-097 e RN-116–RN-129](../produto/regras-de-negocio.md)
