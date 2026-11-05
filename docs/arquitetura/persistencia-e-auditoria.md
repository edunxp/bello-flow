# Persistência, transações e auditoria

## Escopo

Este documento detalha [AT-003](decisoes-tecnicas.md#at-003--consistência-transacional-e-auditoria-obrigatória), [AT-004](decisoes-tecnicas.md#at-004--ordenação-concorrente) e [AT-006](decisoes-tecnicas.md#at-006--proteção-e-retenção-da-auditoria).

## Responsabilidades de Prisma e PostgreSQL

| Componente        | Responsabilidade                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Prisma            | acesso tipado padrão, contexto transacional, migrations administrativas e operações comuns |
| PostgreSQL        | atomicidade, isolamento, restrições, bloqueios, persistência, privilégios e recuperação    |
| SQL parametrizado | complemento localizado para bloqueios, recursos específicos ou desempenho comprovado       |

Prisma não substitui garantias do banco. SQL específico deve permanecer encapsulado no módulo responsável, parametrizado, testado com PostgreSQL real e executado no mesmo contexto transacional quando fizer parte da operação.

## Fronteira transacional das mutações

Uma mutação auditável segue esta fronteira conceitual:

1. Receber identificador único da operação e contexto autenticado.
2. Iniciar uma transação curta.
3. Revalidar autorização, elegibilidade, estado e revisões relevantes.
4. Executar a alteração de negócio.
5. Gravar a auditoria obrigatória.
6. Gravar o feed obrigatório, quando aplicável.
7. Atualizar revisões aplicáveis.
8. Confirmar a transação.
9. Somente após commit confirmado, sinalizar WebSocket e processadores externos.

Falha dos passos obrigatórios anteriores ao commit provoca rollback. O identificador único permite reconciliar um resultado de commit indeterminado antes de repetir. Uma repetição precisa revalidar o estado e não pode duplicar efeitos.

### Autenticação HTTP e resultado indeterminado

Nos contratos HTTP de autenticação da F1-B.4, a camada pública preserva essa
fronteira sem expor identificadores internos. Operação indeterminada não é
repetida automaticamente, não é apresentada como sucesso e retorna erro externo
genérico enquanto a reconciliação não for conclusiva. Em revogação ainda
indeterminada, o cookie não é limpo.

Quando uma sessão foi criada e sua falha de entrega é comprovada antes da
transmissão da resposta, a compensação de sessão não entregue permanece uma
revogação auditável e reconciliável. Depois do envio dos headers, fechamento da
conexão não constitui evidência de falha de entrega e não autoriza compensação
por suposição.

### Recuperação de senha da F1-B.4.5

O contrato está aprovado. A fundação física da F1-B.4.5.1, as operações da
F1-B.4.5.2, a admissão/capacidade da F1-B.4.5.3 e a solicitação/classificação da
F1-B.4.5.4 e o caso de uso de redefinição F1-B.4.5.5 foram publicados; os demais
incrementos continuam pendentes. A persistência é específica do domínio de
recuperação e não antecipa outbox genérica.

#### Relações e estados

`password_recovery_request` representa o ingresso e o estado agregado. Possui
`recovery_request_id`, `account_id` nullable, estado, instantes de recebimento,
atualização e término, número corrente de tentativa e correlação de cancelamento.
Não persiste e-mail ou `email_key`.

`password_recovery_delivery_attempt` pertence a um request em relação um-para-
muitos. Possui `delivery_attempt_id`, ordinal entre 1 e 3, estado, agenda, lease,
instantes de confirmação de `SENDING`, aceitação e término e classe fechada de
falha. `UNIQUE(recovery_request_id, attempt_number)` impede repetição do ordinal.
Na F1-B.4.5.2, passou a possuir também `cancelled_operation_id UUID`: ele é
obrigatório somente em `CANCELLED` e nulo em todos os demais estados. Essa
adequação foi implementada e publicada.

`password_reset_token` pertence a uma única tentativa, e cada tentativa possui no
máximo um token. Possui hash único de 32 bytes, conta, criação, expiração, consumo
e invalidação com seus operation IDs. A unicidade é em `delivery_attempt_id`, não
em `recovery_request_id`, permitindo um token distinto por retentativa.

`password_reset_operation` é o marcador operacional mínimo de reconciliação.
Possui `reset_operation_id`, conta, token, correlação esperada da credencial,
estado de reconciliação, início, atualização e término. Ele é criado somente
depois de um token resolver uma conta e antes do Argon2id; não contém token, hash,
senha ou e-mail. A transação do reset leva o marcador a `COMPLETED`. Falha de
conexão permite registrar ou preservar `UNKNOWN`, protegendo as evidências contra
limpeza e reinício do processo. A F1-B.4.5.2 acrescentou `REJECTED` como estado
terminal para rejeição funcional determinada após a resolução da conta; o estado
foi implementado e publicado na camada transacional.

Requests admitem `RECEIVED`, `SUPPRESSED`, `PENDING`, `PREPARING`, `PREPARED`,
`SENDING`, `SENT`, `FAILED`, `UNKNOWN` e `CANCELLED` como estado agregado.
Tentativas admitem `PREPARING`, `PREPARED`, `SENDING`, `SENT`, `FAILED`, `UNKNOWN`
e `CANCELLED`. Constraints vinculam leases e instantes aos estados compatíveis.

#### Claim, geração e envio

O processador seleciona candidato sem manter lock, inicia transação, adquire
primeiro o advisory lock da conta e volta a bloquear request e tentativa para
revalidar estado e lease. Conta nula é apenas suprimida e não alcança token,
credencial ou sessão.

Sob o lock da conta, tokens ativos são bloqueados por UUID e contados. Novo token
somente é criado quando houver menos de três tokens não expirados, não consumidos
e não invalidados. Todos os caminhos de geração obedecem a esse lock; constraint
isolada não substitui a garantia concorrente.

Token é gerado em `PREPARING`; seu hash e `PREPARED` são confirmados sem chamada
externa. `SENDING` e `delivery_attempt_id` precisam de commit confirmado antes do
provider. Argon2id e provider nunca executam com transação aberta.

Lease expirado em `PREPARING` sem token permite retomar. Lease expirado em
`PREPARED` permite invalidar o token comprovadamente não apresentado e criar nova
tentativa. Depois de `SENDING`, qualquer resultado externo indeterminado leva a
`UNKNOWN`, sem reenvio automático, recuperação do token bruto, confirmação
artificial ou invalidação operacional. O token expira naturalmente; novas
solicitações legítimas continuam sujeitas a quotas, cooldown e teto de tokens.

#### Ordem de locks e reset

Operações com conta conhecida adquirem:

1. advisory lock derivado de `account.id`;
2. conta;
3. credencial;
4. marcador de reset existente por UUID, quando aplicável;
5. requests por UUID;
6. tentativas por UUID;
7. tokens por UUID;
8. sessões por UUID; e
9. auditoria.

Login, criação de token, claim, conclusão de envio e reset compartilham essa
ordem. Conflito recuperável admite no máximo duas novas tentativas completas,
sempre com nova validação. Timeout, deadlock esgotado ou falha não recuperável não
produzem sucesso aparente.

O hash Argon2id da nova senha é calculado antes da transação, sob a capacidade
global. Depois dele e dos locks, conta, credencial, token e precondição da
credencial são revalidados. Em uma única transação, o reset:

1. consome o token apresentado;
2. atualiza `password_hash`, `changed_at` e `changed_operation_id`;
3. invalida os demais tokens aplicáveis;
4. cancela requests e tentativas pendentes;
5. revoga as sessões existentes com `PASSWORD_RESET`; e
6. grava a auditoria obrigatória.

#### Correlação, backfill e reconciliação

Cada request usa `recovery_request_id`, cada tentativa `delivery_attempt_id` e
cada reset `reset_operation_id`. A credencial recebe
`changed_operation_id UUID NOT NULL` como correlação explícita da última mudança.

O backfill usa somente o `operation_id` do bootstrap `COMPLETED` cujo
`initial_account_id` corresponda à credencial. A migration deve abortar diante de
qualquer credencial sem origem comprovável, sem gerar ou inferir UUID. A função de
bootstrap deve passar a preencher a nova coluna. Código versionado permite
inspecionar essa hipótese; conteúdo e comportamento definitivos exigem
PostgreSQL descartável.

`COMPLETED` exige conjunto coerente de token consumido, auditoria de sucesso,
invalidações, cancelamentos, sessões e credencial. Se a credencial ainda aponta
para `reset_operation_id`, a prova é direta. Se houve alteração posterior, o
token consumido e o evento transacional preservam a prova histórica, e a
correlação corrente também precisa apontar para evento posterior válido. A
auditoria histórica isolada nunca basta.

Zero, uma ou várias sessões são reconciliadas pela contagem auditada e pelas
linhas revogadas com o operation ID. Sessões já revogadas não são reatribuídas;
sessões legitimamente criadas depois da mudança não tornam o reset inconsistente.

`REJECTED` exige marcador terminal e exatamente uma auditoria de rejeição
coerente, sem qualquer efeito de reset bem-sucedido atribuído à operação.
`NOT_FOUND` exige marcador conhecido já terminal nesse estado e ausência
simultânea de efeitos em token, auditoria, credencial, requests, tentativas e
sessões. A reconciliação da F1-B.4.5.2 não produz essa terminalização. O próprio
marcador de intenção não é efeito de negócio, mas ausência de efeitos isolada
nunca prova abandono. Ausência decorrente de retenção e limpeza legítimas não é
`NOT_FOUND`; fora da janela probatória ou sem marca conclusiva, o resultado é
`UNKNOWN`. Qualquer evidência parcial ou divergente é `INCONSISTENT`. Falha de
consulta é `UNKNOWN`. Somente `COMPLETED` autoriza sucesso; `REJECTED` autoriza
apenas a negativa funcional uniforme e nenhum resultado é repetido por suposição.

Operações ainda reconciliáveis carregam proteção explícita contra limpeza. A
marca só é removida depois de reconciliação conclusiva e do início da janela de
retenção terminal.

#### Privilégios e fronteira de persistência

Grants por coluna não garantem atomicidade, ordem de locks, contagens ou conjunto
de evidências. A F1-B.4.5.2 aprova funções SQL restritas como fronteira de
persistência: o runtime não recebe novo DML sensível direto em credencial,
requests, tentativas, tokens ou operações de reset. Os acessos existentes
necessários ao login não são removidos neste incremento. SQL parametrizado,
transação única e testes PostgreSQL reais permanecem obrigatórios.

#### Operações protegidas da F1-B.4.5.6

O contrato está aprovado, mas ainda não implementado. A F1-B.4.5.6 acrescentará
somente cinco operações específicas de entrega. Elas são a única fronteira de
mutação do processador: runtime não recebe `SELECT` amplo em `account` nem DML
direto em request, tentativa, token ou auditoria.

Todas as funções retornam exatamente uma linha para uma invocação válida,
inclusive `NO_WORK`, ownership obsoleto e estado terminal. Zero ou mais de uma
linha são violação de contrato e não podem ser convertidos em sucesso. UUIDs são
v4, hashes possuem exatamente 32 bytes e resultados desconhecidos falham
fechados.

| Operação                               | Entradas mínimas                                                                   | Saída mínima                                                                                      | Efeito transacional                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `claim_password_recovery_delivery`     | IDs estáveis de tentativa proposta e lease                                         | resultado, `recovery_request_id`, `delivery_attempt_id`, ordinal, lease e prazo quando aplicáveis | seleciona e revalida candidato, cria ou retoma `PREPARING`, recupera lease expirado ou confirma ausência de trabalho |
| `prepare_password_recovery_delivery`   | attempt, lease, `token_id`, hash separado por domínio e expiração                  | resultado e identificadores esperados, sem token bruto                                            | sob teto de tokens, persiste hash e expiração e muda `PREPARING → PREPARED`                                          |
| `confirm_password_recovery_sending`    | attempt e lease                                                                    | resultado; e-mail e expiração somente em `SEND_AUTHORIZED`                                        | muda `PREPARED → SENDING`, confirma `sending_confirmed_at` e renova uma única vez o lease                            |
| `complete_password_recovery_delivery`  | attempt, lease, resultado externo e `audit_event_id` quando aplicável              | resultado terminal e próximo instante elegível quando aplicável                                   | conclui `SENT`, `FAILED` ou `UNKNOWN`, com invalidação, backoff e auditoria conforme o resultado                     |
| `reconcile_password_recovery_delivery` | request, attempt, lease, token e operação esperados conforme a fronteira observada | `OBSERVED` com estado minimizado, `NOT_FOUND`, `INCONSISTENT` ou `UNKNOWN`                        | nenhuma mutação; compara somente evidências persistidas                                                              |

##### Claim e recuperação

`claim_password_recovery_delivery` faz seleção otimista fora do lock somente para
encontrar candidato. Dentro da transação, adquire somente as classes necessárias,
sempre na ordem relativa global: advisory lock da conta, `account`,
`password_credential`, marcador de reset quando aplicável,
`password_recovery_request`, `password_recovery_delivery_attempt` e
`password_reset_token`. Sessões e auditoria não são adquiridas pelo claim. Estado,
lease, elegibilidade e contagens são então revalidados. Seus resultados são:

- `CLAIMED`: nova tentativa em `PREPARING`, com lease inicial de 60 segundos;
- `RESUMED_PREPARING`: tentativa sem token retomada com ownership válido;
- `RECOVERED_PREPARED`: token bruto perdido foi invalidado, a tentativa recebeu
  `FAILED / PREPARATION_FAILURE` e a request recebeu backoff ou `FAILED` terminal;
- `RECOVERED_SENDING_UNKNOWN`: `SENDING` expirado foi terminalizado como
  `UNKNOWN`, sem novo ownership de envio;
- `NO_WORK`: nenhuma request elegível depois da revalidação confirmada; ou
- `INCONSISTENT`: evidência física incompatível com as invariantes.

Em `RECOVERED_PREPARED`, a tentativa é terminalizada com `terminal_at` igual ao
instante PostgreSQL da transação. Depois da tentativa 1, a request permanece
`PENDING` e a próxima tentativa somente se torna elegível quando esse
`terminal_at + INTERVAL '1 minute'` for alcançado; depois da tentativa 2, o mesmo
cálculo usa `terminal_at + INTERVAL '5 minutes'`. O claim deriva a elegibilidade
do `terminal_at` persistido da tentativa anterior e só então cria a próxima
tentativa em `PREPARING`, com novo `delivery_attempt_id`, novo ordinal e
`scheduled_at` igual ao instante da nova transação. Não se usa `updated_at` como
instante futuro nem se cria coluna adicional para backoff. A tentativa 3 termina
a request como `FAILED`.

O token é invalidado na mesma transação com `invalidated_operation_id` igual ao
`delivery_attempt_id` da tentativa que o criou. Ambos são UUID v4, a coluna de
invalidação não é única e o índice existente permite a reconciliação por essa
correlação. Repetição coerente observa o mesmo valor; token já consumido,
invalidado por outra operação ou com correlação divergente é inconsistente e não
é sobrescrito. O ordinal encerrado nunca é reutilizado.

`NO_WORK` somente pode resultar de commit confirmado da função. Erro de conexão,
timeout, cardinalidade inválida ou observação inconclusiva não são `NO_WORK`.

##### Preparação

`prepare_password_recovery_delivery` exige `PREPARING`, mesmo lease e ownership
vigente. Ela adquire, conforme necessário, advisory lock da conta, `account`,
`password_credential`, marcador de reset quando aplicável, request, tentativa e
tokens por UUID, preservando a ordem global. Depois revalida o ownership, bloqueia
os tokens ativos, confirma o teto inferior a três, cria um único token físico para
a tentativa e grava `PREPARED` atomicamente. Resultados:

- `PREPARED`, para a primeira gravação confirmada;
- `ALREADY_PREPARED_MATCHING`, somente quando attempt, lease, `token_id` e hash
  são exatamente os mesmos;
- `STALE_OWNER`, para lease divergente;
- `ALREADY_TERMINAL`; ou
- `INCONSISTENT`.

O token bruto nunca entra na função. Commit indeterminado é reconciliado pelo
mesmo attempt, lease, `token_id` e hash. `PREPARING` com mesmo lease e ausência
comprovada de token permite repetir a mesma preparação; qualquer outra divergência
proíbe repetição automática. Depois de reinício que perdeu o token bruto já
preparado, a recuperação ocorre somente após lease e segue o consumo de tentativa
descrito acima.

##### Confirmação de `SENDING`

`confirm_password_recovery_sending` exige `PREPARED`, mesmo lease vigente e token
ativo. Na mesma transação, grava `SENDING`, `sending_confirmed_at` e renova o lease
uma única vez para 60 segundos. Seus resultados são:

- `SEND_AUTHORIZED`: existe somente na primeira transição recém-confirmada e no
  retorno original depois do commit; contém e-mail e expiração necessários ao
  adapter, mas não token ou link;
- `ALREADY_SENDING`: observação sem e-mail e sem autorização;
- `STALE_OWNER`;
- `ALREADY_TERMINAL`; ou
- `INCONSISTENT`.

Se o commit for indeterminado, `PREPARED` com o mesmo lease permite repetir a
transição. `SENDING` comprova que a fronteira foi ou pode ter sido atravessada e
proíbe chamada externa. Nem replay nem reconciliação recriam `SEND_AUTHORIZED`.

A função SQL pode produzir sua linha antes do commit da transação que a chamou.
Por isso, somente o adapter de persistência pode expor `SEND_AUTHORIZED` ao
processador, e apenas depois de confirmar o commit ou autocommit da transição
`PREPARED → SENDING`. Na fronteira da chamada externa não pode existir transação
caller-managed ainda aberta. Resultado recebido internamente antes do commit não
autoriza envio; se o commit for indeterminado, o adapter descarta essa autorização
efêmera e executa somente reconciliação observacional. Replay que observa
`SENDING` devolve `ALREADY_SENDING`, sem destinatário, e reconciliação nunca produz
`SEND_AUTHORIZED`.

##### Conclusão

`complete_password_recovery_delivery` aceita somente um resultado externo já
classificado:

- `ACCEPTED` muda `SENDING → SENT`, terminaliza a request e grava
  `AUTH_PASSWORD_RECOVERY_SEND_ACCEPTED` na mesma transação;
- `NOT_ACCEPTED` muda a tentativa para `FAILED / DELIVERY_FAILURE`, invalida o
  token com `invalidated_operation_id = delivery_attempt_id` e mantém a request
  `PENDING` até `terminal_at + 1 minute` ou `terminal_at + 5 minutes`, conforme o
  ordinal; depois da tentativa 3, termina a request como `FAILED`; e
- `INDETERMINATE` muda tentativa e request para `UNKNOWN`, preserva o token e sua
  expiração natural.

Na invalidação por `NOT_ACCEPTED`, repetição coerente preserva o mesmo
`delivery_attempt_id`; token consumido, já invalidado por outra operação ou com
correlação divergente não é sobrescrito e produz resultado inconsistente.

A conclusão exige o mesmo lease, mas pode chegar depois de seu instante nominal
se a tentativa ainda estiver em `SENDING` e o ownership não tiver sido substituído.
Conclusão e recuperação adquirem os mesmos locks. A primeira terminalização
confirmada prevalece; `SENT`, `FAILED`, `UNKNOWN` e `CANCELLED` devolvem
`ALREADY_TERMINAL` e nunca são sobrescritos.

Commit indeterminado é repetível somente como mutação SQL quando a reconciliação
comprovar `SENDING` com o mesmo lease e o executor ainda possuir o resultado
externo. O adapter nunca é repetido. Estado terminal coerente comprova a conclusão;
evidência parcial é `INCONSISTENT` e falha de observação é `UNKNOWN`.

##### Reconciliação, idempotência e privilégios

`reconcile_password_recovery_delivery` é somente leitura, pode ser repetida e não
retorna e-mail. Ela nunca concede autorização externa, renova lease, invalida
token, corrige estado ou terminaliza tentativa. `OBSERVED` inclui apenas os IDs,
estado, ownership e marcadores necessários à fronteira consultada.

As cinco funções são `SECURITY DEFINER`, pertencem ao migrator, fixam
`search_path` protegido, qualificam todos os objetos, validam argumentos e não
usam SQL dinâmico. `PUBLIC`, bootstrap e manutenção não recebem `EXECUTE`; o papel
runtime recebe somente os `EXECUTE` necessários. Cada operação adquire somente as
classes necessárias, preservando esta ordem relativa global sem inversão:
advisory lock da conta; `account`; `password_credential`; marcador de
reset quando aplicável; `password_recovery_request` por UUID;
`password_recovery_delivery_attempt` por UUID; `password_reset_token` por UUID;
sessões por UUID quando aplicável; e auditoria. Classe não necessária é omitida,
mas nenhuma classe posterior é adquirida antes de uma classe anterior necessária.

Falhas transacionais comprovadamente revertidas podem seguir a política limitada
de retry já aprovada, reutilizando os mesmos IDs e revalidando todo o estado.
Timeout, perda de conexão ou commit indeterminado nunca são tratados como rollback
por tipo de exceção. Lease e hash permanecem somente nos campos operacionais
previstos; token bruto, link, e-mail, IP bruto, lease e erro completo do adapter
nunca integram auditoria, e token bruto ou link nunca são persistidos.

#### Contrato publicado da F1-B.4.5.4

A estrutura publicada permite registrar e classificar a solicitação sem nova
coluna: `password_recovery_request` já possui `recovery_request_id`, `account_id`
nullable, `state`, `received_at`, `updated_at`, `terminal_at`,
`current_attempt_number` e `cancelled_operation_id`; as constraints aceitam
`RECEIVED`, `PENDING` e `SUPPRESSED`; e o índice
`(account_id, received_at DESC, recovery_request_id)` sustenta a consulta por
conta e tempo. Nenhum e-mail ou `email_key` é persistido.

##### Interface e resultados

A assinatura aprovada para o planejamento do incremento é:

```text
request_password_recovery(
  recovery_request_id uuid,
  audit_event_id uuid,
  normalized_email_key text
) RETURNS TABLE (outcome text)
```

Os dois IDs são UUID v4 não nulos reservados pelo NestJS e validados antes de
qualquer efeito, repetindo a política das funções publicadas. O parâmetro `text`
é fisicamente compatível com `account.email_key VARCHAR(254)`.
`normalized_email_key` é a chave canônica produzida por
`normalizeAccountEmail`, ou nulo para entrada não normalizável; o PostgreSQL não
normaliza novamente nem aceita uma normalização alternativa. A função rejeita
chave presente fora dos limites canônicos e nunca recebe e-mail bruto.
`RECORDED` é o único resultado funcional: ele não revela conta, estado ou motivo.
Argumento inválido, inconsistência e indisponibilidade usam erros internos
estáveis e minimizados.

A função insere `RECEIVED` com o instante do PostgreSQL e, sem sair da transação,
classifica para `PENDING` ou `SUPPRESSED`. `SUPPRESSED` preenche `terminal_at`;
`PENDING` preserva `terminal_at` nulo. Ambos mantêm
`current_attempt_number = 0` e `cancelled_operation_id` nulo. Conta inexistente
fica com `account_id` nulo; quando a conta é localizada, `account_id` é preservado
inclusive na supressão, sem ser devolvido ao caller.

Para resultado de commit indeterminado, a assinatura observacional aprovada é:

```text
reconcile_password_recovery_request(
  recovery_request_id uuid
) RETURNS TABLE (outcome text)
```

`RECORDED` exige um request fisicamente coerente e, para `PENDING`, exatamente um
evento `AUTH_PASSWORD_RECOVERY_REQUESTED` coerente; para `SUPPRESSED`, exige
ausência desse evento. Evidência parcial ou contraditória é `INCONSISTENT`.
Request ausente, falha de consulta ou evidência insuficiente é `UNKNOWN`, porque
ausência não prova rollback nem autoriza repetição. A reconciliação é somente
leitura e não transforma `RECEIVED`, não classifica nem cria auditoria.

`recovery_request_id` funciona como chave de idempotência e reconciliação. Uma
repetição da função mutável com ID existente não refaz classificação, cooldown ou
contagem: retorna `RECORDED` apenas quando o conjunto já persistido é coerente e,
caso contrário, sinaliza `RECONCILIATION_REQUIRED`. Depois de commit possivelmente
enviado, o caller executa a função observacional antes de qualquer nova mutação.
O argumento da reconciliação também é UUID v4 não nulo e é validado antes da
consulta.

Na fronteira NestJS, falha anterior ao envio ou rollback comprovado restitui a
reserva. `RECORDED` consome a reserva. Se a operação foi enviada e a reconciliação
permanece `UNKNOWN`, a reserva também é consumida, o resultado externo permanece
indisponível e nenhuma mutação é repetida. Esse consumo é proteção de admissão,
não evidência de commit nem sucesso funcional.

##### Classificação e concorrência

Entrada nula ou que não resolve `account.email_key` termina `SUPPRESSED` com
`account_id` nulo. Para conta candidata, a consulta inicial é apenas otimista. A
função então adquire o advisory lock derivado da conta e segue a ordem global:

1. conta;
2. credencial;
3. requests por `recovery_request_id`;
4. tokens por `password_reset_token_id`; e
5. auditoria, depois da inserção do novo request.

O advisory lock vem antes dos row locks. Classes não tocadas são omitidas, nunca
reordenadas. A conta e a credencial são revalidadas após o lock. Conta não
`ACTIVE`, sem `email_verified_at`, com `deactivated_at`, sem credencial, em
cooldown, com request pendente ou com três tokens ativos termina `SUPPRESSED`.
Request pendente é `PENDING`, `PREPARING`, `PREPARED` ou `SENDING`. Token ativo
tem `expires_at` futuro e `consumed_at` e `invalidated_at` nulos. Os conjuntos são
bloqueados por UUID antes da decisão; writers futuros de token obedecem ao mesmo
advisory lock, impedindo ultrapassagem concorrente do teto.

O cooldown de dez minutos usa o `received_at` do request mais recente que tenha
alcançado `PENDING`. A prova física é a existência do evento
`AUTH_PASSWORD_RECOVERY_REQUESTED` com `operation_id` e `correlation_id` iguais ao
`recovery_request_id`, sequência `1` e conta coerente. O estado atual do request
não é usado como atalho: `PREPARING`, `PREPARED`, `SENDING`, `SENT`, `FAILED`,
`UNKNOWN` e `CANCELLED` continuam contando quando possuem essa prova; `RECEIVED`
ou `SUPPRESSED` sem o evento não contam. Sob o advisory lock, o cooldown está
ativo enquanto o instante único da transação for anterior à soma de `received_at`
com dez minutos; na igualdade, expirou.

Requests terminais somente são elegíveis à limpeza 30 dias depois de
`terminal_at`, e a auditoria funcional possui retenção de 24 meses. Portanto, o
request e sua prova permanecem fisicamente disponíveis durante toda a janela de
dez minutos. A futura limpeza continua proibida de remover história ainda
necessária ao cooldown.

##### Auditoria e privilégios

Somente `PENDING` cria um `audit_event` na mesma transação: evento reservado pelo
caller, sequência `1`, `actor_account_id = NULL`, origem `HTTP_API`, escopo
`SECURITY`, operação `AUTH_PASSWORD_RECOVERY_REQUESTED`, resultado `SUCCESS`,
`entity_type = ACCOUNT` e `entity_id = account_id`. `operation_id` e
`correlation_id` recebem `recovery_request_id`; `before_data`, `after_data` e
`context` são nulos. `SUPPRESSED`, ausência ou inelegibilidade de conta, cooldown,
request pendente e teto de tokens não geram evento. Qualquer falha desfaz request
e auditoria em conjunto.

As duas funções são `SECURITY DEFINER`, owned pelo migrator, com `search_path`
fixado em `pg_catalog`, `public` e `pg_temp`, objetos qualificados e sem SQL
dinâmico. A migration publicada revoga `EXECUTE` de `PUBLIC`, runtime, bootstrap
e manutenção e concede ao runtime somente `EXECUTE` nas assinaturas exatas. Nenhum
novo `SELECT`, `INSERT`, `UPDATE` ou `DELETE` direto é concedido sobre conta,
credencial, requests, tokens ou auditoria.

O recorte foi publicado no commit
`a57f718bf4efb74f2daa76c4b5127c9241d939be`. Ele não cria outbox, token,
tentativa, claim, lease, processamento ou acesso de provider.

#### Integração publicada da F1-B.4.5.5

A integração NestJS foi publicada no commit
`9ac023961b769b9e52c53d6799501df300c4ce3e`, com CI `42083803500` aprovado nos
jobs `Quality`, `API integration` e `Required`. Ela não altera migrations,
funções ou grants.

O adapter NestJS da redefinição reutiliza, sem redefinir ou sobrecarregar, as três
operações publicadas da F1-B.4.5.2:

```text
start_password_reset_operation(
  reset_operation_id uuid,
  audit_event_id uuid,
  presented_token_hash bytea
) RETURNS TABLE (account_id uuid, state text)

complete_password_reset_operation(
  reset_operation_id uuid,
  audit_event_id uuid,
  new_password_hash text
) RETURNS TABLE (
  account_id uuid,
  state text,
  revoked_session_count bigint,
  invalidated_token_count bigint,
  cancelled_request_count bigint,
  cancelled_attempt_count bigint
)

reconcile_password_reset_operation(
  reset_operation_id uuid
) RETURNS text
```

`reset_operation_id` e os dois IDs de auditoria são UUID v4 reservados uma única
vez por execução lógica. O hash do token possui 32 bytes; o PHC obedece exatamente
ao perfil Argon2id `v=19`, `m=65536`, `t=3`, `p=1`, salt de 16 bytes e hash de
32 bytes. A implementação valida esses valores antes do SQL e o PostgreSQL os
revalida antes dos efeitos. O adapter pode usar `account_id`, estado e contagens
somente para validar cardinalidade e contrato da função; eles não atravessam o
caso de uso nem autorizam decisão fora do resultado normativo.

##### Mapeamento e indeterminação

- Intenção sem linha significa token não resolvido e negativa funcional sem
  marcador ou auditoria. `STARTED` confirma a intenção e permite Argon2id;
  `REJECTED` é negativa funcional determinada. Qualquer cardinalidade, estado ou
  vínculo diferente é falha operacional.
- Conclusão `COMPLETED` autoriza sucesso e `REJECTED` autoriza somente negativa
  funcional. Ambas exigem uma linha e evidências comprovadas pela própria função.
- Reconciliação expõe `COMPLETED`, `REJECTED`, `NOT_FOUND`, `INCONSISTENT` e
  `UNKNOWN`. Somente `COMPLETED` é sucesso; `REJECTED` é negativa; os três demais
  resultados são indisponibilidade fail-closed.
- Falha anterior ao envio é determinada localmente. Rollback só é classificado
  quando houver prova específica de que a instrução não foi efetivada. Timeout,
  conexão, cancelamento, erro genérico ou falha depois do possível envio exigem
  reconciliação e proíbem repetição automática.
- Os retries PostgreSQL estreitos já aprovados reutilizam os mesmos IDs e a
  transação completa. Não há retry novo no caso de uso nem nova tentativa de
  token por suposição.

O mapeamento por fase é:

| Evidência protegida                                            | Decisão do caso de uso                  |
| -------------------------------------------------------------- | --------------------------------------- |
| start retorna zero linhas ou `REJECTED`                        | `AUTHENTICATION_FAILED`, sem Argon2id   |
| start retorna `STARTED`                                        | executar Argon2id e tentar complete     |
| complete retorna `COMPLETED`                                   | `COMPLETED`                             |
| complete retorna `REJECTED`                                    | `AUTHENTICATION_FAILED`                 |
| reconciliação retorna `COMPLETED`                              | `COMPLETED`                             |
| reconciliação retorna `REJECTED`                               | `AUTHENTICATION_FAILED`                 |
| reconciliação retorna `NOT_FOUND`, `INCONSISTENT` ou `UNKNOWN` | `SERVICE_UNAVAILABLE`, sem nova mutação |
| falha de observação ou resultado fora do contrato              | `SERVICE_UNAVAILABLE`, sem nova mutação |

Em indeterminação do start, o adapter reconcilia antes de qualquer Argon2id. Um
marcador ainda `STARTED` é observado como `UNKNOWN` e, portanto, não autoriza o
hashing nesta execução. Em indeterminação do complete, somente `COMPLETED`
reconciliado autoriza sucesso. Esse mapeamento não revela se o token resolveu uma
conta nem expõe o estado PostgreSQL ao consumidor.

Uma intenção confirmada precede o cálculo Argon2id, que ocorre fora de transação.
A conclusão usa o mesmo marcador e preserva a ordem global de locks. A função
atômica continua responsável por consumo do token, credencial, invalidações,
cancelamentos, sessões, auditoria e terminalização. O caso de uso não escreve nem
lê diretamente essas tabelas e não produz reparação para `STARTED` ou `UNKNOWN`.

As funções permanecem `SECURITY DEFINER`, owned pelo migrator, com `search_path`
protegido e `EXECUTE` somente para `bello_runtime`; `PUBLIC`, bootstrap e
manutenção continuam sem execução e nenhuma tabela sensível recebe grant novo.
Este incremento não requer migration nem altera privilégios publicados.

##### Reserva efêmera do reset

A reserva é finalizada no primeiro limite conclusivo do caso de uso. Token
malformado após admissão e start sem linha consomem a tentativa como negativa
opaca. `REJECTED` consome como negativa determinada. `STARTED` consome a reserva
antes da aquisição Argon2id; falha ou rollback posterior não a reabre.
`COMPLETED` também permanece consumido.

Falha comprovadamente anterior ao envio do start ou rollback confirmado dessa
transação autoriza refund somente se `STARTED` não foi confirmado. Depois de
possível envio, a reserva é consumida antes da reconciliação e permanece assim
para `COMPLETED`, `REJECTED`, `NOT_FOUND`, `INCONSISTENT`, `UNKNOWN`, falha da
observação ou resultado fora do contrato. A decisão é idempotente e não depende
de exceção genérica. Consumo da quota não comprova efeito PostgreSQL nem sucesso
funcional e não autoriza repetir mutação.

Nos retries estreitos já publicados para a transação de start, rollback
intermediário não finaliza a reserva. Ela permanece aberta e os mesmos IDs são
reutilizados até o resultado conclusivo da política limitada. Somente então há
um commit ou refund, nunca ambos.

Falhas locais na preparação do start — derivação SHA-256, geração dos UUIDs ou
montagem da entrada — são classificadas antes da chamada mutável e fazem refund
exatamente uma vez. O tratamento de possível envio permanece em bloco separado,
impedindo que falha indeterminada seja convertida em rollback ou repetição segura.

#### Operações transacionais da F1-B.4.5.2

##### Escopo e interfaces

Este recorte contém somente intenção, conclusão, reconciliação, advisory lock,
grants e testes PostgreSQL. Não contém endpoint HTTP, quotas, geração ou entrega
produtiva de token, processamento de e-mail, provider ou frontend. Fixtures
criadas pelo migrator servem apenas para preparar o grafo relacional dos testes e
não demonstram o fluxo funcional que as produzirá.

As interfaces conceituais aprovadas são:

- `auth_account_advisory_lock_key(account_id uuid) RETURNS bigint` deriva a
  chave, não bloqueia e é auxiliar interna sem `EXECUTE` do runtime;
- `acquire_auth_account_advisory_xact_lock(account_id uuid) RETURNS void` adquire
  o lock transacional e integra a superfície mínima usada pelo runtime no login e
  nas operações protegidas;
- `start_password_reset_operation(reset_operation_id uuid, audit_event_id uuid,
presented_token_hash bytea)` recebe IDs UUID v4 previamente reservados e o hash
  apresentado de 32 bytes, resolve o token sem expor o hash persistido, adquire o
  lock e repete as validações. Retorna `account_id` e estado quando houver conta:
  token não resolvido retorna zero linhas, sem marcador ou auditoria; token
  resolvido e elegível persiste e retorna `STARTED`; token resolvido já expirado,
  consumido, invalidado ou cuja inelegibilidade da conta seja determinada
  persiste `REJECTED` e a auditoria correspondente. Esses retornos não criam
  novos estados físicos. Excepcionalmente, token conhecido vinculado a conta sem
  `password_credential` é inconsistência operacional anterior à intenção: a
  função falha de modo estável e sem efeitos, não cria marcador nem auditoria,
  não inventa `expected_changed_operation_id` e não o classifica como
  `INCONSISTENT` persistente;
- `complete_password_reset_operation(reset_operation_id uuid, audit_event_id
uuid, new_password_hash text)` recebe somente a operação iniciada, o novo PHC
  Argon2id no perfil aprovado e o ID reservado do evento, revalida todo o estado
  pelo marcador e retorna `COMPLETED` ou `REJECTED`, além das quatro contagens,
  quando houver conclusão funcional determinada; e
- `reconcile_password_reset_operation(reset_operation_id uuid)` retorna
  `COMPLETED`, `REJECTED`, `NOT_FOUND`, `INCONSISTENT` ou `UNKNOWN` sem alterar o
  marcador nem qualquer evidência ou efeito de negócio.

As assinaturas físicas podem usar `RETURNS TABLE` para os identificadores e
contagens não secretos necessários, mas não retornam PHC, hash ou token. IDs
nulos, UUID que não seja v4, hash com tamanho diferente de 32 bytes, PHC fora do
perfil aprovado, marcador divergente ou combinação de argumentos inconsistente
são rejeitados antes de qualquer efeito. Instantes são obtidos do PostgreSQL, não
do caller. A repetição da intenção com o mesmo `reset_operation_id` e token
retorna o estado já comprovado sem novo efeito; divergência de vínculo persistido
é erro e, se já houver auditoria, o `audit_event_id` também deve coincidir.
Em `STARTED`, a conclusão pode processar depois dos locks e revalidações. Em
`COMPLETED` ou `REJECTED`, retorna idempotentemente o resultado funcional já
terminal somente depois de comprovar internamente as evidências correspondentes e
sem novo efeito. Marcador ausente ou em `NOT_FOUND`, `INCONSISTENT` ou `UNKNOWN`
não permite alteração nem retorna linha funcional: sinaliza a falha operacional
estável `RECONCILIATION_REQUIRED`, que não é estado persistente nem rejeição de
token e exige reconciliação. Nenhuma chamada tardia reabre marcador terminal. Commit
indeterminado também exige reconciliação antes de qualquer nova conclusão.

##### Advisory lock e ordem global

A derivação PostgreSQL reproduz byte a byte o algoritmo existente: UUID v4 em
representação canônica minúscula, domínio UTF-8 `bello:auth:account:`, SHA-256,
primeiros oito bytes e interpretação `bigint` signed big-endian. Chave fornecida
pelo caller nunca é autoridade de serialização. A função SQL e o TypeScript antigo
devem produzir a mesma chave, permitindo que transações em andamento durante a
mudança continuem mutuamente exclusivas sem dual-lock. Os vetores normativos
existentes são:

- `00000000-0000-4000-8000-000000000000` → `5305774703633831484`; e
- `00000000-0000-4000-8000-000000000003` → `-9219222644233059831`.

Uma consulta otimista pode localizar o hash do token para descobrir a conta, mas
não adquire row lock. Conclusão, reconciliação e operações sobre marcador já
existente seguem:

1. advisory lock da conta;
2. conta;
3. credencial;
4. marcadores por `reset_operation_id`;
5. requests por `recovery_request_id`;
6. tentativas por `delivery_attempt_id`;
7. tokens por `password_reset_token_id`;
8. sessões por `id`; e
9. auditoria.

Linhas da mesma classe são bloqueadas por UUID crescente. Após o advisory lock, a
operação repete resolução, pertencimento, estado, prazo e precondições; nenhuma
decisão usa apenas a consulta otimista.

A intenção possui ordem física específica porque a FK imediata do marcador
referencia o token. Ela executa, na mesma transação:

1. descoberta otimista do token, sem row lock, apenas para obter a conta candidata;
2. advisory lock da conta;
3. lock e revalidação da conta e da credencial;
4. nova resolução e lock explícito do token por `password_reset_token_id`;
5. validação de pertencimento, prazo, estado e
   `expected_changed_operation_id`; e
6. `INSERT` de `password_reset_operation`.

O `INSERT` ocorre somente depois do lock explícito do token, portanto os locks
implícitos das FKs para conta e token recaem sobre linhas já bloqueadas pela
transação. Essa exceção não inverte a conclusão: operações da mesma conta são
serializadas antes por uma única chave advisory, tokens não são compartilhados
entre contas e todo writer que cria, consome ou invalida token deve adquirir essa
mesma chave. Dentro de cada conjunto, UUIDs permanecem crescentes. A intenção não
bloqueia requests ou tentativas porque não os modifica; qualquer inconsistência
entre token, tentativa e request faz a operação falhar sem inserir o marcador.
Manutenção continua usando `SKIP LOCKED`: se remover legitimamente o token antes
da revalidação, a intenção não insere marcador; se a intenção bloquear primeiro,
a limpeza pula a linha e respeita a proteção do marcador reconciliável.

Na conclusão, as atualizações não alteram chaves das FKs de requests, tentativas,
tokens, credencial ou sessões. A inserção de auditoria referencia a conta já
bloqueada; `cancelled_operation_id` e os demais operation IDs são correlações UUID
sem FK. Portanto, nenhum lock implícito conhecido exige antecipar uma classe
posterior da ordem global; essa hipótese permanece critério obrigatório de teste
contra o PostgreSQL real.

##### Intenção, aplicabilidade e conclusão

A intenção `STARTED` contém conta, token e
`expected_changed_operation_id` observada sob lock e é confirmada antes do
Argon2id. Argon2id ocorre sem transação aberta; sua futura ligação ao serviço deve
usar a capacidade global compartilhada com o login. A conclusão usa o mesmo
`reset_operation_id` em todas as tentativas transacionais.

No instante único da transação de conclusão:

- a conta é elegível somente com `status = ACTIVE`, `email_verified_at` não nulo,
  `deactivated_at` nulo e uma credencial presente;
- o token apresentado é aplicável somente se pertence à conta e ao marcador, não
  expirou e não possui consumo ou invalidação;
- outros tokens são aplicáveis somente quando pertencem à conta, diferem do token
  apresentado, ainda não expiraram e não possuem consumo ou invalidação;
- requests são canceláveis quando pertencem à conta, não são o ancestral do token
  apresentado e estão em `RECEIVED`, `PENDING`, `PREPARING` ou `PREPARED`;
- tentativas são canceláveis quando pertencem a request cancelável e estão em
  `PREPARING` ou `PREPARED`;
- requests e tentativas em `SENDING`, estados terminais ou já correlacionados a
  outra operação são preservados; `SENDING` mantém a evidência da chamada externa
  já iniciada e termina posteriormente como `SENT`, `FAILED` ou `UNKNOWN`; e
- sessões são aplicáveis quando pertencem à conta e `revoked_at IS NULL`, mesmo
  que seu prazo de autenticação já tenha expirado. Sessões já revogadas e sessões
  legitimamente criadas depois da transação são preservadas.

O reset nunca sobrescreve `consumed_operation_id`,
`invalidated_operation_id`, `cancelled_operation_id` ou
`revoked_operation_id` existente. Em uma transação, ele consome o token
apresentado, atualiza `password_hash`, `changed_at` e `changed_operation_id`,
invalida os demais tokens aplicáveis, cancela requests e tentativas aplicáveis,
revoga sessões aplicáveis com `PASSWORD_RESET`, grava a auditoria e terminaliza o
marcador. Qualquer falha provoca rollback integral.

Ao levar request aplicável de `RECEIVED`, `PENDING`, `PREPARING` ou `PREPARED` a
`CANCELLED`, a mesma atualização preenche `updated_at`, `terminal_at` e
`cancelled_operation_id` com o instante PostgreSQL e a operação do reset,
preservando `account_id`, `received_at` e `current_attempt_number`. Ao levar
tentativa de `PREPARING` ou `PREPARED` a `CANCELLED`, preenche `terminal_at` e o
novo `cancelled_operation_id`, limpa `lease_id` e `lease_expires_at` e preserva
`scheduled_at`; `sending_confirmed_at`, `accepted_at` e `failure_class` devem
permanecer nulos. O instante terminal precisa ser igual ou posterior a
`received_at` no request e a `scheduled_at` na tentativa. Qualquer linha que não
satisfaça mais o predicado de estado após o lock é preservada; linha que ainda
esteja em estado aplicável, mas viole as demais precondições, aborta a transação
como inconsistente. Nenhuma é forçada a atravessar as constraints.

Token conhecido já expirado, consumido ou invalidado antes de uma intenção
viável, token que perde corrida depois de `STARTED`, conta que se torna inelegível
ou divergência de `changed_operation_id` produzem `REJECTED`, auditoria de
negativa e zero efeitos de sucesso. Falha operacional não é rejeição funcional;
preserva `STARTED` ou `UNKNOWN` e não cria auditoria funcional por suposição.
Para a intenção ainda não registrada, a ausência da própria linha de
`password_credential` é a exceção fail-closed: não há correlação legítima para o
campo `expected_changed_operation_id NOT NULL`, portanto a transação falha antes
do marcador e da auditoria. A resposta externa futura permanece indistinguível e
o diagnóstico técnico não inclui token, hash, conta, e-mail ou outro segredo.

##### Auditoria da operação

Cada `reset_operation_id` possui exatamente um evento funcional terminal na
sequência `1`:

- sucesso: `operation = AUTH_PASSWORD_RESET_SUCCEEDED`, `result = SUCCESS`;
- rejeição: `operation = AUTH_PASSWORD_RESET_REJECTED`, `result = DENIED`.

Nos dois casos, `operation_id` e `correlation_id` são o
`reset_operation_id`; `actor_account_id` e `entity_id` são o `account_id`
resolvido; `entity_type = ACCOUNT`; `origin = HTTP_API`; `scope = SECURITY`; e o
contexto contém exatamente `reason = PASSWORD_RESET`,
`revoked_session_count`, `invalidated_token_count`,
`cancelled_request_count` e `cancelled_attempt_count`. As quatro contagens são
inteiros não negativos e permanecem presentes quando zero. Em rejeição todas são
zero. `before_data` e `after_data` são nulos. Senha, PHC, token, hash, e-mail, IP,
link e corpo HTTP não são persistidos.

Assim, os campos conceituais exigidos são `operation_id`, `correlation_id`,
`account_id`, `operation`, `result`, `reason`, `revoked_session_count`,
`invalidated_token_count`, `cancelled_request_count` e
`cancelled_attempt_count`. No schema publicado, `account_id` é representado pela
igualdade de `actor_account_id` e `entity_id`, e `reason` e as quatro contagens
ficam no `context`; não se aprova coluna duplicada para esses valores.

##### Matriz de reconciliação

- `COMPLETED` exige marcador terminal coerente, exatamente um token consumido
  pela operação, exatamente um evento de sucesso, credencial direta ou cadeia
  posterior válida e igualdade entre as quatro contagens auditadas e as linhas
  correlacionadas. Não pode existir evento de rejeição da mesma operação.
- `REJECTED` exige marcador terminal e exatamente um evento de rejeição, com as
  quatro contagens zero e ausência de consumo, mudança de credencial,
  invalidação, cancelamento ou revogação atribuídos à operação.
- `NOT_FOUND` exige marcador conhecido já terminal nesse estado, janela probatória
  vigente e ausência comprovada de qualquer efeito ou auditoria. O marcador de
  intenção não é efeito, mas sua mera idade, ausência de efeitos ou aquisição do
  advisory lock nunca prova abandono. A F1-B.4.5.2 reconhece esse estado físico,
  mas não produz nova terminalização `NOT_FOUND` pelo runtime.
- `INCONSISTENT` exige evidência positiva parcial ou contraditória: marcador e
  efeitos divergentes, conta/token incompatíveis, auditoria sem conjunto
  transacional, contagem diferente das linhas, correlação sobrescrita ou sucesso
  e rejeição simultâneos.
- `UNKNOWN` cobre falha ou timeout da consulta, operação ainda concorrente,
  ausência do marcador exigido, evidência insuficiente, metadado removido por
  retenção ou cadeia histórica que já não possa ser comprovada.

A reconciliação localiza o marcador sem lock apenas para descobrir a conta; se ele
não existir, retorna `UNKNOWN`. Com conta conhecida, adquire o mesmo advisory lock,
bloqueia conta, credencial, marcador e demais linhas na ordem global, revalida o
vínculo do marcador e só então lê o conjunto lógico consistente de evidências.
Assim, nenhuma transação que cumpra o protocolo pode confirmar commit concorrente
durante a classificação. Ela não transforma ausência de visibilidade em ausência
de efeito. Estado terminal e auditoria histórica isolados nunca comprovam sucesso.
Nenhuma classificação indeterminada autoriza repetição.

A reconciliação é exclusivamente observacional: não altera marcador, auditoria,
token, credencial, requests, tentativas ou sessões. Marcador `STARTED` ou `UNKNOWN`
sem evidência conclusiva permanece `UNKNOWN`, inclusive enquanto o Argon2id estiver
em andamento fora de transação. Idade, timeout, reinício do processo, advisory
lock disponível ou ausência de linhas correlacionadas não autorizam `NOT_FOUND`.
Evidência positiva parcial ou contraditória continua `INCONSISTENT`; marcador
terminal só retorna sua classificação depois da prova completa correspondente.

Não existe função PostgreSQL de fechamento nem overload de reconciliação com modo
mutável na F1-B.4.5.2. O estado físico `NOT_FOUND` é preservado e pode ser
reconhecido somente quando o marcador já estiver terminal nesse estado e sua
ausência de efeitos for coerente. O protocolo autorizado que poderá produzir essa
terminalização fica adiado para incremento futuro anterior à disponibilização
produtiva completa e deverá definir sua própria autoridade e coordenação
persistente antes de receber grants. Até lá, crash ou abandono aparente preserva
`STARTED` ou `UNKNOWN` e não possui recuperação automática.

Após commit indeterminado da conclusão, não há fechamento nem retry automático: a
reconciliação espera o advisory lock e procura o conjunto completo de evidências.
Se o resultado continuar incerto, retorna `UNKNOWN`.

Se a credencial ainda aponta para a operação consultada, a correlação é direta.
Se aponta para reset posterior, a prova começa na operação consultada e localiza,
sem ciclos, exatamente um próximo marcador `COMPLETED` cujo
`expected_changed_operation_id` seja o elo corrente. A cadeia avança em ordem
temporal estritamente crescente até o `changed_operation_id` atual. Cada elo exige
token consumido e auditoria de sucesso coerentes; zero ou mais de um sucessor
dentro da janela probatória é contraditório. Elo ausente por retenção produz
`UNKNOWN`; elo ausente sem retenção ou elo presente e divergente produz
`INCONSISTENT`. A operação de bootstrap é origem válida apenas quando comprovada
pelo singleton concluído e não pode aparecer como alteração posterior a um reset.
Outra origem futura de mudança de credencial precisa de contrato próprio antes de
integrar essa cadeia.

##### Isolamento e retry

`READ COMMITTED` é o padrão da operação, condicionado à prova do advisory lock,
dos row locks, das revalidações e da ausência de phantoms relevantes. São
elegíveis a retry automático somente:

- `40001` (`serialization_failure`);
- `40P01` (`deadlock_detected`); e
- `55P03` (`lock_not_available`) quando comprovadamente originado por
  `lock_timeout` ao adquirir um dos locks aprovados, depois de rollback
  confirmado.

Cada retry reutiliza `reset_operation_id` e identificadores reservados, repete a
transação inteira e todas as precondições e admite no máximo duas novas tentativas
além da primeira. Violação de constraint, `57014` por statement timeout ou
cancelamento, erro não classificado e falha operacional não são retry automático.
Erro de conexão, classe `08`, encerramento administrativo ou qualquer falha depois
do possível envio de `COMMIT` é commit indeterminado e exige reconciliação
conclusiva antes de nova tentativa.

##### Privilégios

O migrator atual pode ser owner das cinco funções; nenhuma nova role é criada. As
cinco funções usam `SECURITY DEFINER`,
`SET search_path = pg_catalog, public, pg_temp`, nomes qualificados, validação
estrita e nenhum SQL dinâmico. `PUBLIC`, bootstrap e manutenção não recebem
`EXECUTE`. O runtime recebe somente `EXECUTE` em aquisição, intenção, conclusão e
reconciliação observacional; a função que apenas deriva a chave permanece interna
ao owner. Não existe função de fechamento, overload com modo mutável ou grant
runtime capaz de terminalizar intenção sem efeitos.

As novas tabelas e colunas sensíveis não recebem DML direto do runtime neste
incremento. A função de intenção não retorna o hash persistido, e conclusão e
reconciliação não retornam PHC ou hash. Os acessos diretos preexistentes exigidos
pelo login não são ampliados nem removidos pela F1-B.4.5.2.

#### Retenção operacional

Requests, tentativas e operações de reset terminais resolvidos são elegíveis à
limpeza 30 dias depois de `terminal_at`. Tokens são elegíveis 30 dias depois do
mais recente entre expiração, consumo, invalidação e término resolvido do pai.
Não são elegíveis estados ativos, `UNKNOWN`, operações ainda reconciliáveis, pai
com filho protegido ou token potencialmente entregue ainda válido.

Depois que uma operação antes `UNKNOWN` alcança classificação terminal conclusiva,
inicia-se a janela de 30 dias.
Limpeza usa credencial de manutenção, lotes limitados, `SKIP LOCKED` e ordem
operações resolvidas, tokens, tentativas e requests, respeitando as referências.
Cada lote registra período, quantidades e resultado sem PII. Falha é retomável e
não remove registros sem confirmação. Auditoria funcional permanece sujeita aos
24 meses, separada dessa retenção operacional.

## Isolamento, bloqueios e repetição

- O nível de isolamento será escolhido por classe de operação, após validação técnica.
- Bloqueios são pontuais e não devem abranger o quadro inteiro sem justificativa.
- Recursos múltiplos são bloqueados em ordem determinística.
- Conflitos recuperáveis admitem quantidade limitada de novas tentativas.
- Cada nova tentativa repete autorização e pré-condições, não apenas as instruções SQL.
- Erros não recuperáveis ou repetição esgotada retornam resultado explícito, sem sucesso aparente.
- Fora dos recortes que possuem contrato específico, o limite de tentativas e os
  casos recuperáveis permanecem pendentes; a F1-B.4.5.2 usa a política definida
  acima sem encerrar integralmente a PT-003.

## Ordenação de listas e cartões

### Estado aprovado

- posições esparsas;
- backend como autoridade;
- revisão granular do item e do contêiner;
- revisão monotônica de quadro separada para sincronização;
- vizinhos informados como intenção de posicionamento;
- rebalanceamento restrito ao contêiner;
- bloqueios determinísticos;
- última operação confirmada prevalece no mesmo item.

### Movimento dentro da transação

O backend valida origem, destino, vizinhos, estado de arquivamento, permissões e revisões. A posição final é calculada sobre o estado transacional atual, e não aceita cegamente a posição produzida pelo cliente.

Movimentos entre contêineres bloqueiam somente os recursos necessários e em ordem estável. Movimentos entre quadros também aplicam DEC-018: autorização em ambos, confirmação de responsáveis incompatíveis, preservação de identidade e histórico e proteção do contexto de origem.

O rebalanceamento pode modificar chaves físicas, mas não a ordem funcional. A representação da chave e o limiar de rebalanceamento ainda serão validados.

## Auditoria obrigatória

A auditoria implementa a matriz funcional de RN-126–RN-130 e PEN-037. Cada evento possui, no mínimo, os campos funcionais aprovados aplicáveis, incluindo identificação, instante, ator ou origem, operação, resultado, contexto e correlação.

Armazenamento e consulta são controles distintos:

- valores anteriores e novos são gravados seletivamente pela matriz;
- versões de descrições e comentários pertencem à auditoria de conteúdo protegida;
- senhas, tokens, cookies e credenciais não são armazenados;
- consultas reavaliam permissão atual e contexto original;
- campos são omitidos ou redigidos sem alterar o registro original;
- Administrador Global e Administrador de Workspace não herdam auditoria de conteúdo.

Rejeições isoladas de origem ou CSRF na fronteira HTTP, anteriores à
autenticação e à autorização funcional, geram somente logs técnicos estruturados
e sem segredos nesta etapa. Elas não criam nova classificação funcional de
auditoria. Permanecem obrigatórios os eventos aprovados de login, falha de login,
logout, revogação global e negativas funcionais de autorização. O subconjunto de
admissão abusiva do login está aprovado na PT-008; a recuperação possui contrato
aprovado separado na F1-B.4.5, fundação PostgreSQL publicada na F1-B.4.5.1 e
operações publicadas na F1-B.4.5.2; casos de uso e demais evidências da pendência
continuam abertos.

No subconjunto aprovado de proteção do login, uma requisição rejeitada com `429`
antes de alcançar `AuthenticationService` é rejeição técnica de admissão e não
uma tentativa de credencial avaliada. Ela produz somente log técnico ou métrica
minimizada e não cria `AUTH_LOGIN_FAILED`. Essa distinção preserva RN-128: todo
login bem-sucedido ou malsucedido efetivamente avaliado continua sujeito à
auditoria funcional existente. Limitação, saturação ou capacidade não registram
e-mail, IP bruto, chave de bucket, senha, token ou cookie.

## Proteção append-only

- A credencial operacional insere e consulta apenas o necessário e não altera ou remove eventos.
- Expurgo e manutenção usam credencial administrativa separada.
- A aplicação comum não executa DDL sobre a auditoria.
- Correções funcionais produzem novos eventos.
- A proteção reduz alterações acidentais ou pela aplicação comprometida, mas não garante inviolabilidade diante de administrador privilegiado do banco.
- Verificação criptográfica adicional não integra o MVP.

## Retenção e expurgo

- O prazo é de 24 meses pelo instante de ocorrência.
- O expurgo é automático, agendado e controlado.
- Cada execução registra período tratado, quantidade e resultado.
- Falhas precisam ser observáveis e retomáveis sem remoção indiscriminada.
- Backups e restaurações precisam ser compatíveis com retenção e acesso restrito.

O formato físico, a estratégia de particionamento e o mecanismo concreto de expurgo permanecem pendentes. Particionamento não é obrigatório sem volume que o justifique.

## Consultas

As consultas funcionais seguem DEC-010 e RN-113–RN-115: ordem cronológica decrescente estável, filtros aprovados, navegação progressiva e redação contextual. Índices, paginação física e SQL especializado serão definidos a partir do modelo e de medições.

## Rastreabilidade

- **Ordenação:** BEL-006–BEL-011; DEC-016 e DEC-018; RN-057–RN-066 e RN-130.
- **Feed:** BEL-031; DEC-009; RN-026–RN-031 e RN-110–RN-112.
- **Auditoria:** BEL-032; DEC-010; RN-032–RN-038, RN-095–RN-097 e RN-113–RN-130.
- **Pendências de origem:** PEN-022–PEN-027 e PEN-037.
