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

| HTTP | Código externo | Aplicação |
|---:|---|---|
| `400` | `INVALID_REQUEST` | falha estrutural da requisição HTTP |
| `401` | `AUTHENTICATION_FAILED` | rejeição determinada no login |
| `401` | `UNAUTHENTICATED` | ausência de sessão autenticada válida |
| `403` | `REQUEST_FORBIDDEN` | rejeição dos controles de origem ou CSRF |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | media type incompatível com o corpo JSON exigido |
| `429` | `RATE_LIMITED` | admissão do login rejeitada pelos limites aprovados da PT-008 |
| `503` | `SERVICE_UNAVAILABLE` | falha operacional ou resultado ainda indeterminado |
| `500` | `INTERNAL_ERROR` | falha interna não classificada |

O mesmo `AUTHENTICATION_FAILED` cobre identidade inexistente, senha incorreta,
conta inelegível e demais rejeições determinadas da credencial. O `401` não
revela existência, elegibilidade ou estado da conta, e o `503` não revela a
causa operacional. Para o login, limites, chaves, armazenamento, `Retry-After`
e `429` estão definidos no subconjunto aprovado da PT-008. Recuperação de senha
possui contrato separado na F1-B.4.5, ainda não implementado.

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

| Chave | Capacidade | Reposição | Sucesso confirmado |
|---|---:|---:|---|
| identidade normalizada | 5 tokens | 1 token a cada 180 segundos | remove ou reseta o bucket |
| IP confiável | 60 tokens | 1 token a cada 5 segundos | preserva o débito |

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

| Conclusão | Identidade | IP |
|---|---|---|
| rejeição determinada da credencial | confirma o consumo | confirma o consumo |
| autenticação confirmada | remove ou reseta o bucket | confirma o consumo |
| falha operacional | restitui a reserva | restitui a reserva |
| resultado indeterminado | restitui sem repetir automaticamente | restitui sem repetir automaticamente |
| falha antes do início da autenticação | restitui a reserva | restitui a reserva |

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

O contrato abaixo está aprovado para implementação, mas ainda não foi
implementado. Ele detalha AT-001, AT-003 e AT-009, resolve normativamente a
PT-007 e o recorte de recuperação da PT-008 e preserva a PT-009 aberta.

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

| Endpoint e chave | Capacidade | Reposição |
|---|---:|---:|
| solicitação por identidade normalizada ou sentinela | 3 | 1 token a cada 10 minutos |
| solicitação por IP confiável | 30 | 1 token por minuto |
| reset por IP confiável | 60 | 1 token a cada 5 segundos |

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
  `/reset-password`; recomenda-se transportar o token no fragmento e removê-lo do
  histórico após a captura;
- adapter controlado pode validar tecnicamente o fluxo em testes, mas não
  representa provider real nem disponibilidade produtiva;
- a PT-009 permanece aberta. Produção exige provider, timeout, credenciais e
  política de erros aprovados.

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

| Escopo | Exemplos de autoridade | Não concede automaticamente |
|---|---|---|
| Global | administrar contas e atribuição de Administrador Global | participação em Workspace, quadro ou auditoria de conteúdo |
| Workspace | participantes, papéis, fuso, etiquetas globais e governança autorizada de quadros | listas, cartões, comentários, feed ou auditoria de conteúdo |
| Governança de quadro | dados básicos, visibilidade, participantes, papéis e arquivamento | conteúdo sem participação explícita |
| Conteúdo de quadro | listas, cartões e colaboração conforme papel | administração global ou do Workspace |
| Auditoria | consulta do escopo administrativo ou de conteúdo autorizado | dados fora do contexto e da permissão atuais |

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

A F1-B.4.5 detalha geração just-in-time sem persistir token ou link recuperável.
Implementação e evidência permanecem pendentes, e o provider produtivo continua
na [PT-009](pendencias-tecnicas.md#pendências-operacionais).

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

