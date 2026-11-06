# AGENTS.md

## Escopo

Estas instruções se aplicam a todo o repositório Bello Flow.

Use KISS e YAGNI. Implemente apenas o necessário para o escopo autorizado,
preservando as decisões funcionais e arquiteturais aprovadas. Não antecipe fases,
funcionalidades ou infraestrutura futura.

Este arquivo estabelece regras permanentes de trabalho. O pedido de cada
atividade estabelece seu escopo temporário e as operações autorizadas. Pedidos
específicos não substituem silenciosamente decisões AT, DEC ou RN aprovadas. Em
caso de conflito material, apresente a evidência e solicite uma decisão antes de
alterar o contrato aprovado.

Para identificar o estado atual e o próximo objetivo, consulte
[docs/estado-do-projeto.md](docs/estado-do-projeto.md). Esse documento é
informativo e não substitui as fontes normativas aprovadas.

Antes de iniciar planejamento, inspeção, implementação, revisão ou publicação,
consulte o
[Fluxo de desenvolvimento ChatGPT + Codex](docs/operacao/fluxo-de-desenvolvimento.md).
Ele organiza as etapas e as entregas entre os participantes sem substituir as
fontes normativas, a autorização específica da atividade ou o
[Procedimento de Git e publicação](docs/operacao/git-e-publicacao.md).

## Fontes normativas

Antes de alterar comportamento, identifique as decisões e regras aplicáveis:

- arquitetura e organização:
  [docs/arquitetura/visao-geral.md](docs/arquitetura/visao-geral.md);
- decisões AT-001 a AT-010:
  [docs/arquitetura/decisoes-tecnicas.md](docs/arquitetura/decisoes-tecnicas.md);
- decisões funcionais DEC:
  [docs/produto/decisoes-funcionais.md](docs/produto/decisoes-funcionais.md);
- regras de negócio RN:
  [docs/produto/regras-de-negocio.md](docs/produto/regras-de-negocio.md);
- requisitos e escopo:
  [docs/produto/requisitos-funcionais.md](docs/produto/requisitos-funcionais.md) e
  [docs/produto/escopo-mvp.md](docs/produto/escopo-mvp.md);
- pendências técnicas:
  [docs/arquitetura/pendencias-tecnicas.md](docs/arquitetura/pendencias-tecnicas.md);
- segurança:
  [docs/arquitetura/seguranca-e-autorizacao.md](docs/arquitetura/seguranca-e-autorizacao.md);
- persistência e auditoria:
  [docs/arquitetura/persistencia-e-auditoria.md](docs/arquitetura/persistencia-e-auditoria.md);
- testes e prontidão:
  [docs/arquitetura/qualidade-e-testes.md](docs/arquitetura/qualidade-e-testes.md);
- PostgreSQL local:
  [docs/operacao/postgresql-local.md](docs/operacao/postgresql-local.md);
- bootstrap administrativo:
  [docs/operacao/bootstrap-administrativo.md](docs/operacao/bootstrap-administrativo.md).

Somente decisões e regras marcadas como aprovadas são normativas. Propostas,
pendências, inferências e documentos de reverse engineering não podem ser
tratados como comportamento aprovado.

Não altere silenciosamente uma AT, DEC, RN ou decisão de segurança. Se o pedido
entrar em conflito com uma decisão aprovada ou depender de uma pendência sem
resolução, apresente a evidência e solicite direção antes de alterar a parte
afetada.

Quando documentação, implementação e testes divergirem, investigue e registre a
divergência. Interrompa somente a parte afetada quando houver impacto material
nas decisões aprovadas, integridade, segurança ou comportamento solicitado. Não
bloqueie atividades independentes sem justificativa.

## Manutenção documental e marcos

- A documentação deve acompanhar o estado real da implementação sem confundir
  decisão aprovada, alteração local, commit local, publicação e validação do CI.
- Código, testes e documentação aplicável integram o mesmo ciclo. Antes do commit,
  consolide os documentos afetados com o estado real: implementado, validado
  localmente e aguardando commit ou publicação, sem antecipar sucesso do CI remoto.
- Depois da publicação e da aprovação do CI, registre o resultado no relatório
  operacional. Não crie automaticamente outro commit apenas para inserir SHA ou
  número do CI; atualização documental posterior exige necessidade normativa ou
  operacional expressa, correção factual, mudança material do projeto ou
  consolidação periódica autorizada.
- Mudanças de comportamento devem revisar os documentos técnicos e as pendências
  afetadas, sem encerrar ou reclassificar uma pendência sem aprovação explícita.
- Registre nos documentos de estado os commits e as evidências de teste
  relevantes, preservando a rastreabilidade até as decisões aplicáveis.
- Não declare um incremento concluído e publicado antes das confirmações
  correspondentes. Uma implementação apenas local deve ser descrita como tal.
- Alteração, commit e publicação seguem a modalidade de autorização explícita da
  atividade, conforme a seção de autonomia operacional abaixo.
- Faça atualizações documentais proporcionais ao incremento, evitando duplicação,
  antecipação de fases e documentação sem necessidade concreta.

## Organização e arquitetura

O repositório é um monorepo npm:

- `apps/web`: Angular;
- `apps/api`: NestJS;
- `apps/api/prisma`: schema e migrations Prisma;
- `docs`: especificação funcional, arquitetura e operação;
- `infra/postgres`: provisionamento administrativo do PostgreSQL;
- `scripts`: validações compartilhadas.

Preserve o monólito modular aprovado. Módulos devem expor contratos e casos de
uso explícitos. Controladores não devem acessar diretamente estruturas internas
de outros módulos.

Prisma é o mecanismo padrão de persistência. SQL PostgreSQL direto é permitido
somente quando bloqueios, recursos específicos ou evidência de desempenho o
justificarem. Nesse caso, mantenha-o localizado, parametrizado e coberto por
testes PostgreSQL reais.

Evite abstrações genéricas, dependências, serviços distribuídos e refatorações
amplas sem necessidade comprovada.

## Escopo das alterações

- Modifique somente arquivos relacionados à atividade.
- Preserve alterações preexistentes do usuário.
- Não implemente funcionalidades de fases futuras.
- Não amplie o escopo para melhorias não solicitadas.
- Não feche ou reclassifique pendências técnicas sem aprovação explícita.
- Não repita auditorias já aprovadas, salvo quando uma mudança relevante exigir
  nova evidência.
- Não crie arquivos `AGENTS.md` adicionais sem diferenças reais e permanentes de
  instrução para o diretório.

## Autonomia operacional e autorizações

Uma tarefa de implementação previamente aprovada autoriza, dentro de seu escopo,
sem nova aprovação humana de escopo:

- ler e analisar o código;
- criar e modificar os arquivos relacionados à tarefa;
- executar formatação, lint, typecheck, build, testes unitários, cobertura e
  integração, inclusive reexecutá-los após correções;
- criar e utilizar PostgreSQL comprovadamente descartável e executar migrations
  exclusivamente nesse ambiente;
- realizar as inspeções operacionais necessárias; e
- remover somente os recursos temporários criados e identificados pela própria
  atividade.

Essa autorização inclui diagnosticar e corrigir problemas técnicos rotineiros,
reexecutar as validações afetadas e atualizar a documentação aplicável enquanto
a correção permanecer no objetivo, no contrato e nos riscos já aprovados. Não é
necessária uma nova rodada de autorização para cada correção desse tipo.

Cada atividade adota uma das seguintes modalidades de autorização:

- **Implementação:** autoriza somente as alterações e validações previstas. Não
  autoriza commit nem push.
- **Implementação com commit:** autoriza as alterações, validações e o commit
  local expressamente delimitado. Não autoriza push.
- **Publicação controlada:** autoriza somente o push normal de commit local já
  aprovado e a verificação remota correspondente. Não autoriza novo commit.

A publicação ocorre em atividade posterior ao commit e somente quando o pedido
autoriza explicitamente publicar ou realizar push. Expressões ambíguas como
“vamos em frente”, “continue” ou equivalentes não autorizam push. Autorização para
commit nunca implica autorização para publicação.

Essa autonomia não elimina confirmações técnicas exigidas pelo sandbox. Antes de
prosseguir, solicite aprovação humana quando for necessário modificar decisões
arquiteturais aprovadas, regras de negócio, contratos normativos ou políticas de
segurança; ampliar materialmente o escopo; introduzir dependência de produção não
aprovada; ou alterar privilégios permanentes fora do escopo expressamente
autorizado.

Interrompa a parte afetada diante de conflito normativo, ampliação material de
escopo, risco de segurança não mitigável, acesso ou alteração de banco
persistente, mudança de privilégios não autorizada ou dependência externa ou
custo não aprovado. Continue somente atividades independentes que permaneçam
seguras e autorizadas.

Exigem autorização específica e separada: commit e publicação conforme as
modalidades acima; reescrita de histórico Git; acesso ou alteração de bancos
persistentes;
exclusão de recursos preexistentes ou cuja propriedade não esteja comprovada;
operações administrativas reais; e uso de recursos externos ou credenciais não
autorizados. A publicação controlada não autoriza force push, rebase, merge,
pull, reescrita de histórico nem correções ou commits adicionais fora do escopo.

Preserve o sandbox e os controles de execução. Não crie regras `allow` amplas,
não armazene credenciais em regras do Codex, não execute limpeza Docker global,
confirme identidade e propriedade antes de remover recursos temporários e não use
credenciais de bancos persistentes em testes. Autorização operacional não implica
aprovação de mudança arquitetural.

Estas regras complementam as demais instruções deste arquivo e o
[Procedimento de Git e publicação](docs/operacao/git-e-publicacao.md). Em caso de
conflito, aplique a restrição mais específica e segura, sem alterar a precedência
das fontes normativas já estabelecida.

## Segurança e dados sensíveis

Nunca exponha ou versione credenciais reais, hashes associados a senhas reais ou
outros segredos, incluindo:

- senhas;
- cookies ou identificadores de sessão;
- tokens;
- códigos de recuperação;
- secrets;
- chaves privadas;
- URLs de banco contendo credenciais.

Hashes sintéticos são permitidos exclusivamente em testes, desde que não tenham
relação com contas, senhas ou credenciais reais.

Excepcionalmente, um PHC Argon2id sintético e constante pode ser usado
exclusivamente para verificação negativa de autenticação. Nesse uso operacional,
o PHC deve seguir o perfil criptográfico aprovado, não possuir vínculo com contas,
senhas ou credenciais reais, não ser persistido no PostgreSQL, não ser registrado
em logs ou auditoria, não ser tratado como segredo operacional e nunca autorizar
autenticação.

Não registre valores sensíveis em logs, mensagens de erro, stdout, stderr,
fixtures, auditoria ou relatórios.

Arquivos `.env` locais não devem ser versionados. Use os arquivos `.example`
somente como modelos sem credenciais reais.

Preserve a negação de acesso por padrão e a separação entre Administração
Global, Workspace, governança de quadro, conteúdo e auditoria.

## PostgreSQL, credenciais e migrations

Mantenha separadas as credenciais:

- `DATABASE_URL`: runtime normal da API;
- `MIGRATION_DATABASE_URL` e `SHADOW_DATABASE_URL`: migrations;
- `BOOTSTRAP_DATABASE_URL`: CLI administrativa de bootstrap;
- credencial de manutenção: operações administrativas específicas de auditoria.

Não crie fallback entre essas credenciais. Não entregue credenciais de migration,
bootstrap ou manutenção ao processo HTTP normal.

Testes automatizados executados pelo Codex não podem acessar nem modificar bancos
PostgreSQL persistentes. Para integração, use exclusivamente PostgreSQL
descartável, com identidade e isolamento comprovados antes da execução e limpeza
limitada ao alvo criado pelo teste.

Operações administrativas reais somente podem ocorrer com autorização específica
e seguindo o procedimento operacional correspondente. Não execute comandos
destrutivos sobre volumes ou bancos sem autorização específica. Não use
`docker compose down --volumes` como procedimento comum.

Não altere migrations já aprovadas, grants, roles, funções protegidas ou
privilégios sem discussão e autorização explícitas. Para uma migration nova:

1. confirme que ela pertence ao escopo;
2. gere o artefato sem aplicá-lo ao banco persistente;
3. revise o SQL;
4. valide em PostgreSQL descartável;
5. preserve a separação entre runtime, migration, bootstrap e manutenção.

Mutações auditáveis devem preservar a transação única entre alteração de
negócio e auditoria obrigatória. Um resultado de commit indeterminado não pode ser
classificado por suposição nem repetido automaticamente.

## Desenvolvimento e qualidade

Use as versões e o gerenciador definidos no `package.json` e no lockfile. Não
atualize dependências fora do escopo.

Comandos principais, executados na raiz:

- `npm run format:check`;
- `npm run lint`;
- `npm run typecheck`;
- `npm run test`;
- `npm run test:coverage`;
- `npm run build`;
- `npm run quality:local`.

Escolha validações proporcionais à alteração. Execute o gate completo quando o
risco ou a preparação para versionamento exigir.

Testes unitários cobrem regras, políticas e validações isoladas. Garantias de
transação, concorrência, locks, privilégios, migrations e comportamento do
PostgreSQL não devem ser comprovadas apenas com mocks ou banco em memória.

O gate de cobertura não pode ser reduzido ou contornado. Preserve o mínimo de
90% em lines, statements, functions e branches para web, API e resultado
consolidado. Não exclua código da cobertura apenas para atingir o threshold.

Preserve os jobs obrigatórios do CI:

- `Quality`;
- `API integration`;
- `Required`.

Não enfraqueça gates, testes críticos ou proteções do pipeline para fazê-lo
passar.

## Git

- Não descarte alterações do usuário.
- Não use comandos destrutivos, force push ou reescrita de histórico sem
  autorização inequívoca.
- Não inclua arquivos temporários, gerados, relatórios de cobertura, builds ou
  secrets.
- Não execute `git commit` fora da modalidade **Implementação com commit**.
- Não execute `git push` sem a modalidade **Publicação controlada** explicitamente
  autorizada para a atividade.
- Autorização para commit não implica autorização para push. A publicação trata
  somente commit local já aprovado e permanece condicionada ao
  [Procedimento de Git e publicação](docs/operacao/git-e-publicacao.md).

Sempre que a atividade envolver preparação de commit, publicação ou verificação
de CI, consulte e siga o
[Procedimento de Git e publicação](docs/operacao/git-e-publicacao.md).

## Relatório

O relatório é curto por padrão e informa objetivamente:

- resultado;
- arquivos criados, alterados ou removidos;
- testes, cobertura e demais validações aplicáveis;
- riscos e achados;
- evidências relevantes;
- estado final do Git; e
- próxima ação, incluindo a confirmação sobre commit e push.

Amplie o relatório somente quando risco, falha ou decisão material exigir. Não
reproduza contratos inteiros: referencie a fonte normativa e registre apenas o
impacto pertinente ao incremento.

Classifique afirmações relevantes pela melhor evidência disponível:

- **VERIFICADO**: examinado diretamente na fonte primária correspondente, como
  código, contrato normativo, log, estado Git ou execução de CI;
- **RELATADO**: informado por terceiro ou síntese, sem conferência direta da fonte
  primária;
- **INFERIDO**: interpretação técnica ainda não comprovada;
- **NÃO VERIFICADO**: sem evidência suficiente ou sem acesso à fonte necessária.

Não declare aprovação com base exclusiva em conteúdo **RELATADO** sem explicitar
a limitação. Não reclassifique conteúdo **RELATADO** como **VERIFICADO** sem
examinar diretamente a fonte primária correspondente. Declarações de segurança,
aprovação ou CI baseadas exclusivamente em sínteses devem permanecer
**RELATADO** ou **NÃO VERIFICADO**, conforme a evidência disponível, e explicitar
essa limitação. Código e contratos são fontes primárias de comportamento; logs,
Git e CI são fontes primárias de suas respectivas execuções e estados. Decisões e
evidências ainda necessárias devem aparecer como riscos, achados ou próxima ação,
sem criar uma classificação paralela.

## Instruções específicas da atividade

O pedido atual define o escopo temporário, os entregáveis e as operações
autorizadas, enquanto este arquivo preserva as regras permanentes do projeto.

Se a conclusão exigir autoridade adicional, mudança arquitetural ou expansão
material do escopo, pare antes da parte afetada e solicite autorização. Continue
atividades independentes que permaneçam seguras e dentro do escopo.
