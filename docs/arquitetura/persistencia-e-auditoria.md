# Persistência, transações e auditoria

## Escopo

Este documento detalha [AT-003](decisoes-tecnicas.md#at-003--consistência-transacional-e-auditoria-obrigatória), [AT-004](decisoes-tecnicas.md#at-004--ordenação-concorrente) e [AT-006](decisoes-tecnicas.md#at-006--proteção-e-retenção-da-auditoria).

## Responsabilidades de Prisma e PostgreSQL

| Componente | Responsabilidade |
|---|---|
| Prisma | acesso tipado padrão, contexto transacional, migrations administrativas e operações comuns |
| PostgreSQL | atomicidade, isolamento, restrições, bloqueios, persistência, privilégios e recuperação |
| SQL parametrizado | complemento localizado para bloqueios, recursos específicos ou desempenho comprovado |

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

O contrato está aprovado para implementação, ainda pendente. A persistência é
específica do domínio de recuperação e não antecipa outbox genérica.

#### Relações e estados

`password_recovery_request` representa o ingresso e o estado agregado. Possui
`recovery_request_id`, `account_id` nullable, estado, instantes de recebimento,
atualização e término, número corrente de tentativa e correlação de cancelamento.
Não persiste e-mail ou `email_key`.

`password_recovery_delivery_attempt` pertence a um request em relação um-para-
muitos. Possui `delivery_attempt_id`, ordinal entre 1 e 3, estado, agenda, lease,
instantes de confirmação de `SENDING`, aceitação e término e classe fechada de
falha. `UNIQUE(recovery_request_id, attempt_number)` impede repetição do ordinal.

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
limpeza e reinício do processo.

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
4. requests por UUID;
5. tentativas por UUID;
6. tokens por UUID;
7. sessões por UUID; e
8. auditoria.

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

`NOT_FOUND` exige marcador de operação conhecido e ausência simultânea de efeitos
em token, auditoria, credencial, requests, tentativas e sessões. O próprio
marcador de intenção não é efeito de negócio. Ausência decorrente de retenção e
limpeza legítimas não é `NOT_FOUND`; fora da janela probatória ou sem marca
conclusiva, o resultado é `UNKNOWN`. Qualquer evidência parcial ou divergente é
`INCONSISTENT`. Falha de consulta é `UNKNOWN`. Somente `COMPLETED` autoriza
sucesso; nenhum dos demais resultados é repetido por suposição.

Operações ainda reconciliáveis carregam proteção explícita contra limpeza. A
marca só é removida depois de reconciliação conclusiva e do início da janela de
retenção terminal.

#### Privilégios e fronteira de persistência

`bello_runtime` recebe somente as colunas necessárias, incluindo `SELECT` e
`UPDATE(password_hash, changed_at, changed_operation_id)` da credencial, sem
`INSERT`, `DELETE` ou atualização de e-mail. Requests, tentativas, tokens,
sessões e auditoria recebem grants mínimos para suas operações.

Grants por coluna não garantem atomicidade, ordem de locks, contagens ou conjunto
de evidências. Uma fronteira de persistência específica deve executar SQL
parametrizado e a única transação do reset, coberta por PostgreSQL real. Se grants
diretos permitirem violar invariantes ou não forem suficientes para a operação
atômica, uma função SQL restrita deve ser proposta e aprovada antes da
implementação; este contrato não a presume.

#### Retenção operacional

Requests, tentativas e operações de reset terminais resolvidos são elegíveis à
limpeza 30 dias depois de `terminal_at`. Tokens são elegíveis 30 dias depois do
mais recente entre expiração, consumo, invalidação e término resolvido do pai.
Não são elegíveis estados ativos, `UNKNOWN`, operações ainda reconciliáveis, pai
com filho protegido ou token potencialmente entregue ainda válido.

Depois de classificação conclusiva de `UNKNOWN`, inicia-se a janela de 30 dias.
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
- O limite de tentativas e os casos recuperáveis permanecem pendentes.

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
aprovado separado na F1-B.4.5, ainda sem implementação, e as evidências e demais
escopos remanescentes da pendência continuam abertos.

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

