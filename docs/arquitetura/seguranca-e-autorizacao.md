# Segurança e autorização

## Escopo

Este documento detalha as responsabilidades decorrentes de [AT-001](decisoes-tecnicas.md#at-001--autenticação-e-segurança-das-sessões), [AT-002](decisoes-tecnicas.md#at-002--autorização-centralizada), [AT-008](decisoes-tecnicas.md#at-008--bootstrap-e-migrations) e [AT-009](decisoes-tecnicas.md#at-009--e-mails-e-notificações). Ele não redefine os papéis funcionais.

## Identidade, senha e sessão

- Contas são criadas somente pela Administração Global ou, para a primeira conta, pelo bootstrap controlado.
- Não existe cadastro público.
- A identidade interna imutável é distinta do e-mail mutável.
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

A representação segura do link nas solicitações de envio persistidas ainda precisa de detalhamento; ver [pendências técnicas](pendencias-tecnicas.md).

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

