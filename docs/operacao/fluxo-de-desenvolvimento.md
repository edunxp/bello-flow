# Fluxo de desenvolvimento ChatGPT + Codex

## Escopo e precedência

Este procedimento organiza o planejamento, a implementação, a revisão e a
publicação do Bello Flow entre usuário, ChatGPT e Codex. Ele não aprova escopo,
não altera contratos AT, DEC, RN ou requisitos e não concede autorização
operacional por si só.

Devem ser observados em conjunto:

1. as regras permanentes do [AGENTS.md](../../AGENTS.md);
2. a autorização e o escopo temporários da atividade;
3. as fontes normativas aplicáveis ao comportamento; e
4. este fluxo operacional.

A atividade delimita as operações permitidas, mas não substitui silenciosamente
decisão normativa aprovada. Conflito material exige decisão antes da parte
afetada.

Para commit, push e CI, o
[Procedimento de Git e publicação](git-e-publicacao.md) é a fonte operacional
específica. Em caso de conflito, prevalece a regra mais específica e segura sem
alterar a precedência das fontes normativas.

## Responsabilidades

- O único responsável pelo repositório estabelece objetivos, prioridades, limites
  e autorizações. Agentes acessam a cópia local somente pelas ferramentas e
  permissões autorizadas para a atividade.
- O ChatGPT consolida escopo, arquitetura, restrições, critérios de aceite e
  decisões que precisam retornar ao usuário.
- O Codex inspeciona, implementa, valida e apresenta evidências dentro do escopo
  e da modalidade de autorização recebidos.
- A revisão independente é uma etapa distinta da implementação, baseada no diff,
  nas fontes primárias e nas evidências produzidas. Pode ser realizada pelo
  responsável ou por um agente que não tenha produzido a alteração revisada; não
  exige segundo mantenedor nem concede acesso adicional ao repositório.
- O responsável autoriza o objetivo e o escopo do ciclo e, após as evidências,
  aprova ou rejeita a integração do SHA final. A autorização explícita de
  integração permite o fast-forward e o push da `main` previstos no procedimento
  Git; não permite alterar o SHA aprovado.

## Trabalho pelo desktop e continuidade entre conversas

O Codex no aplicativo desktop é a interface de execução local adotada neste
fluxo. Planejamento, inspeção, implementação e validação podem ocorrer na mesma
conversa, dentro das autorizações recebidas. Não é necessário copiar prompts do
ChatGPT web para a CLI. Web e CLI continuam alternativas de trabalho; as
responsabilidades descritas neste procedimento não exigem interfaces separadas.

- Mantenha uma conversa por incremento para implementação, correções rotineiras,
  testes e documentação. Um novo objetivo pode iniciar outra conversa no mesmo
  projeto local.
- Ao iniciar ou retomar uma conversa, confirme o diretório e o estado Git e leia
  `AGENTS.md`, este fluxo e `docs/estado-do-projeto.md`. Preserve alterações
  locais preexistentes e não presuma que o histórico de outro chat esteja
  disponível ou que sincronizar a conversa conceda acesso à pasta local.
- Use a cópia existente do repositório no WSL quando essa for a cópia autorizada,
  inclusive para examinar alterações não commitadas. Confirme ambiente, acesso e
  versões exigidas antes de executar ferramentas.
- Decisões duráveis e evidências relevantes ficam nos documentos do repositório.
  Uma decisão discutida no web ou em outra conversa precisa ser confrontada com
  as fontes normativas antes de orientar alterações.
- A revisão independente usa um revisor que não tenha produzido a alteração,
  com acesso ao diff, contratos e evidências primárias. Uma conversa separada
  ajuda a organizar a revisão, mas não comprova independência por si só.
- Evite alterações simultâneas pela CLI e pelo desktop na mesma árvore de
  trabalho. Antes de mudar de interface, confirme branch, índice e arquivos
  pendentes.

Durante uma implementação autorizada, execute as alterações, correções rotineiras
e validações necessárias ao escopo sem nova aprovação de escopo por comando,
preservadas as confirmações técnicas exigidas pelas ferramentas. As interrupções
materiais continuam regidas pela seção de autonomia. Apresente uma
ação concreta e revisável ao solicitar a integração do SHA final na `main`.
Commits e pushes normais da branch fazem parte do ciclo autorizado, sem novas
solicitações de aprovação de escopo. A interface não altera os controles Git.

## Modelo operacional

O fluxo alvo organiza cada incremento nesta sequência:

1. O ChatGPT define objetivo, escopo, riscos e critérios de aceite com base na
   autorização da atividade e nas fontes normativas aplicáveis.
2. O Codex executa autonomamente implementação, testes, correções técnicas
   rotineiras e documentação dentro do escopo autorizado.
3. O CI executa os gates obrigatórios e produz evidência vinculada ao SHA.
4. Uma revisão independente analisa diff, evidências, riscos e aderência
   normativa.
5. O responsável aprova a integração.
6. A integração é verificada pelo SHA exato, incluindo branch, estado remoto e
   CI aplicável.
7. O ciclo é encerrado com um resumo curto e a próxima ação.

Planejar ou revisar não autoriza implementar. Uma implementação autorizada em
branch exclusiva inclui commits, pushes normais da própria branch, correções
rotineiras e acompanhamento do CI. A integração na `main` permanece condicionada
à autorização explícita para o SHA final aprovado, conforme o
[Procedimento de Git e publicação](git-e-publicacao.md).

### Entregas verticais

O planejamento prioriza resultados utilizáveis que atravessem, quando aplicável,
Angular, API NestJS, PostgreSQL, autorização, auditoria e feed, testes e critérios
de aceitação. Uma branch curta representa uma entrega; subtarefas técnicas e
correções rotineiras permanecem no mesmo ciclo enquanto não alterarem escopo,
contrato ou risco aprovado.

Fundação horizontal é limitada ao que a entrega atual exige. Infraestrutura,
abstrações e mecanismos de escala futura não são antecipados sem necessidade
demonstrada. Evidências válidas são reutilizadas, e relatórios registram somente
decisões, achados e resultados materiais.

## Risco e proporcionalidade

| Risco     | Exemplos                                                                                  | Tratamento mínimo                                                                                              |
| --------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Baixo** | documentação e ajustes isolados                                                           | validação proporcional, inspeção do diff e evidência das fontes alteradas                                      |
| **Médio** | funcionalidades de aplicação e regras de negócio comuns                                   | testes aplicáveis, cobertura vigente, revisão de contratos e evidências do CI                                  |
| **Alto**  | autenticação, senhas, tokens, auditoria, privilégios, migrations sensíveis e concorrência | revisão independente e evidências técnicas específicas, inclusive PostgreSQL real descartável quando aplicável |

A classificação considera o maior risco material do conjunto alterado. Ela
define profundidade de evidência e revisão, não concede autorização adicional nem
reduz gates normativos.

## Autonomia e interrupções

Dentro de uma implementação autorizada, o Codex pode investigar, corrigir
problemas técnicos rotineiros, repetir testes afetados e manter a documentação
coerente sem solicitar autorização a cada iteração. A correção precisa permanecer
no objetivo, nos critérios de aceite, na arquitetura e nos privilégios aprovados.

Interrompa a parte afetada e solicite decisão diante de:

- conflito normativo;
- ampliação material do escopo;
- risco de segurança não mitigável;
- acesso ou alteração de banco persistente;
- mudança de privilégios não autorizada; ou
- dependência externa ou custo não aprovado.

Atividades independentes podem continuar quando permanecerem seguras e dentro do
escopo. Commit e push normal da branch integram o ciclo autorizado; integração
na `main` exige decisão explícita posterior.

## Confiabilidade das evidências

Use exclusivamente **VERIFICADO**, **RELATADO**, **INFERIDO** e
**NÃO VERIFICADO**, com os significados definidos no
[AGENTS.md](../../AGENTS.md#relatório). Não crie classificações paralelas.

Código e contratos são fontes primárias de comportamento; logs, estado Git e CI
são fontes primárias das respectivas execuções e estados. Uma síntese pode
orientar a inspeção, mas não transforma conteúdo **RELATADO** em **VERIFICADO**.
Declarações de segurança, aprovação ou CI baseadas exclusivamente em sínteses
precisam manter a classificação correspondente à evidência disponível e declarar
essa limitação.

## Preparação — escopo e inspeção

1. O usuário define o objetivo, a prioridade e as operações autorizadas.
2. O ChatGPT identifica o escopo, as fontes normativas, as restrições
   arquiteturais e de segurança e os critérios de aceite.
3. A inspeção é incremental e proporcional à complexidade e ao risco da
   atividade. O Codex prioriza arquivos, módulos, contratos e dependências
   diretamente relacionados ao incremento e realiza inspeção somente leitura
   quando necessária para confirmar o estado real ou reduzir incerteza relevante.
4. Evidências de etapas anteriores são reutilizadas enquanto o componente e suas
   dependências relevantes não tiverem mudado. Inspeções gerais do repositório não
   são repetidas sem necessidade concreta, e decisões normativas publicadas não
   são reabertas sem evidência nova.
5. O escopo da inspeção somente é ampliado quando uma dependência,
   incompatibilidade ou risco tecnicamente identificado exigir evidência
   adicional.
6. Quando o contrato estiver aprovado, o escopo estiver claro e houver
   autorização de implementação, o trabalho pode seguir diretamente para
   implementação e testes, sem exigir uma etapa separada de inspeção para cada
   subincremento. Permanecem obrigatórias a leitura das instruções do agente e das
   fontes aplicáveis, além das validações proporcionais ao risco.
7. Reduzir inspeções repetitivas não reduz os testes necessários nem as garantias
   de segurança, cobertura mínima de 90% por métrica, PostgreSQL descartável e
   gates de CI definidos nas etapas seguintes.
8. Bloqueios materiais de arquitetura, segurança, integridade ou contrato retornam
   para decisão explícita antes da parte afetada. Atividades independentes podem
   continuar quando permanecerem seguras e autorizadas.

O resultado desta preparação deve classificar as afirmações relevantes como
**VERIFICADO**, **RELATADO**, **INFERIDO** ou **NÃO VERIFICADO**. Planejamento não
equivale a autorização de implementação, commit ou push.

## Etapa 1 — Implementação

1. O Codex implementa somente depois de receber autorização e somente no escopo
   aprovado.
2. Código e testes aplicáveis são produzidos no mesmo ciclo, conforme o contrato
   publicado.
3. Erros técnicos podem ser corrigidos durante a mesma atividade quando a correção
   for necessária ao objetivo, permanecer dentro do contrato aprovado e não
   ampliar arquitetura, requisitos ou privilégios.
4. Alteração de decisão normativa, política de segurança, requisito ou escopo
   material exige nova decisão antes da parte afetada.

KISS e YAGNI orientam a implementação: não antecipar fases, infraestrutura,
abstrações ou funcionalidades futuras.

## Etapa 2 — Validação técnica

1. O Codex executa validações e testes proporcionais ao risco e comprova a
   cobertura mínima vigente de 90% em lines, statements, functions e branches
   quando aplicável.
2. Garantias de transação, concorrência, locks, privilégios e migrations usam
   PostgreSQL real comprovadamente descartável. Testes destrutivos nunca usam
   banco persistente.
3. Regressões, lint, formatação, typecheck e build são executados conforme o risco
   e as regras de qualidade aplicáveis.
4. Evidências ainda válidas são reutilizadas; baterias completas não são repetidas
   sem mudança ou risco que as justifique.

## Etapa 3 — Revisão e correções locais

1. O Codex entrega relatório objetivo, com comandos executados, resultados e
   referências verificáveis.
2. O ChatGPT avalia aderência normativa, segurança, integridade, testes,
   cobertura, concorrência, riscos e limites do escopo. Essa avaliação durante a
   implementação não substitui a revisão independente exigida antes da
   integração no modelo alvo.
3. Quando a revisão depender do conteúdo exato, deve solicitar ou examinar diff,
   patch, arquivos e linhas relevantes.
4. Problemas locais e independentes podem ser reunidos em uma rodada consolidada
   de correção, desde que continuem autorizados e não alterem decisões aprovadas.
5. O Codex corrige os achados dentro do escopo autorizado e repete somente as
   validações afetadas até obter aprovação.
6. Bloqueios críticos exigem decisão explícita antes de implementação adicional.
7. O relatório do Codex não substitui evidência de execução, resultado de teste,
   estado Git, migration, código ou documento normativo.

A revisão deve priorizar evidências objetivas e achados acionáveis, evitando
relatórios extensos sem impacto na decisão.

## Etapa 4 — Consolidação documental

1. Antes do commit, o Codex atualiza os documentos aplicáveis ao incremento.
2. A documentação registra somente o estado comprovado: implementado, validado
   localmente e aguardando commit ou publicação.
3. Sucesso de CI remoto, SHA ainda inexistente e publicação ainda não realizada
   não são antecipados.
4. Documentação, código, testes e configurações estritamente necessárias formam o
   mesmo conjunto revisável e, quando aprovados, o mesmo commit.
5. Contratos normativos existentes são referenciados, não duplicados.
6. `docs/estado-do-projeto.md` concentra o estado factual corrente dos incrementos,
   incluindo SHA, branch, publicação e CI. Documentos normativos preservam
   decisões, invariantes, contratos, justificativas e referências sem replicar
   esses dados operacionais.

## Etapa 5 — Revisão final

1. Código, testes, documentação, evidências e estado Git são revisados em
   conjunto, com independência proporcional ao risco.
2. Somente após parecer favorável e CI aprovado no SHA final, o responsável
   pode autorizar sua integração na `main`. Commit e publicação da branch
   integram a execução do ciclo, sem aprovação separada por etapa.
3. Achado remanescente retorna à etapa aplicável sem ampliar automaticamente o
   escopo.

## Etapa 6 — Commit local

1. No ciclo autorizado, o Codex cria commits coerentes com código, testes,
   documentação aplicável e configurações estritamente necessárias, sem nova
   autorização de escopo por commit.
2. O staging é explícito e integralmente revisado conforme o
   [Procedimento de Git e publicação](git-e-publicacao.md).
3. O push normal da branch ocorre após as conferências da etapa seguinte;
   nenhuma dessas etapas autoriza integração na `main`.

## Etapa 7 — Publicação

1. No mesmo ciclo autorizado, o Codex confirma o commit revisado, atualiza as
   referências remotas e executa push normal somente da branch exclusiva, sem
   nova autorização de escopo para o push.
2. Antes do push, confirma branch, SHA, escopo, árvore limpa e divergência com
   `origin/main`.
3. Force push, force-with-lease, merge, rebase, pull e correções automáticas de
   divergência permanecem proibidos.
4. Depois do push, confirma o SHA remoto exato e a sincronização da branch.

## Etapa 8 — CI remoto

1. O Codex localiza o workflow pelo SHA exato, branch, evento e tentativa.
2. `Quality`, `API integration` e `Required` precisam terminar com `success`.
3. Enquanto houver job pendente, não presume aprovação. Falha da branch é
   reportada e, quando rotineira e dentro do escopo, corrigida, revalidada e
   publicada em novo SHA no mesmo ciclo. Falha do CI final da `main` é reportada
   e exige novo ciclo autorizado para correção.
4. Somente depois do sucesso remoto o incremento é classificado como publicado e
   validado.

## Etapa 9 — Encerramento

1. O resultado da publicação, o SHA e o CI são registrados no relatório
   operacional.
2. Não se exige automaticamente novo commit apenas para inserir SHA ou número da
   execução CI na documentação.
3. Atualização documental posterior ocorre somente por exigência normativa ou
   operacional expressa, correção factual, mudança material do estado do projeto
   ou consolidação periódica.
4. Quando necessária, essa atualização segue novamente as autorizações e regras
   Git aplicáveis.

## Relatório padronizado do Codex

O relatório é curto por padrão e contém: resultado; arquivos alterados; testes e
cobertura; riscos e achados; evidências; estado Git; e próxima ação. Commit, push,
merge e CI aparecem somente quando aplicáveis e com a autorização e a evidência
correspondentes.

Relatório extenso é reservado a risco alto, falha ou decisão material. Contratos
inteiros não são reproduzidos; use referências e registre apenas o impacto no
incremento. As afirmações relevantes seguem as classificações de confiabilidade
deste documento.

## Ciclo em branch curta

Para o único responsável pelo repositório, a modalidade usa uma branch
`work/<incremento>` por ciclo, criada a partir da `main` sincronizada. O
`BASE_MAIN_SHA` é registrado antes da criação. Uma autorização explícita de ciclo
delimita objetivo, escopo, riscos e branch e permite ao Codex alterar e validar o
escopo autorizado, incluindo staging explícito, commits, push normal da branch,
correções rotineiras e acompanhamento do CI, sem novas autorizações por etapa.
A integração fast-forward na `main` exige autorização explícita posterior para o
SHA final aprovado. Pull request permanece opcional.

Durante o ciclo, correções técnicas rotineiras, testes e documentação seguem com
autonomia dentro do escopo. A autorização não alcança outra branch, integração na
`main`, force push, rebase automático, contratos aprovados, ampliação de escopo,
banco persistente ou riscos novos.

O CI da branch é localizado pelo evento `push`, nome da branch e SHA final exato.
`Quality`, `API integration` e `Required` precisam terminar com `success`. Falha
obrigatória não corrigida impede integração. Mudança de alto risco exige revisão
independente antes da decisão do responsável.

A integração exige autorização específica e segue fast-forward only. Antes dela,
`origin/main` precisa continuar exatamente em `BASE_MAIN_SHA`, e a branch precisa
estar `0 behind / N ahead` da base. Divergência ou avanço da `main` interrompe o
fluxo sem rebase ou merge automático. Depois do fast-forward e do push normal
autorizado da `main`, o CI final é obrigatório no SHA integrado. A branch somente
pode ser removida após encerramento validado e autorização de limpeza.

### Estado de adoção

O ciclo em branch curta é o fluxo vigente, conforme a orientação do responsável.
A atividade autorizada inclui execução, commits, publicação e CI da própria
branch; não inclui integração na `main`. A integração do SHA final e eventual
limpeza da branch permanecem sujeitas às respectivas autorizações. O estado
factual dos incrementos fica no [estado do projeto](../estado-do-projeto.md).

## Diretrizes permanentes

- preservar KISS e YAGNI;
- tratar segurança, autorização, auditoria e dados sensíveis como restrições de
  primeira classe;
- não duplicar documentação normativa nem transformar proposta em decisão;
- limitar commits e pushes à branch e ao escopo do ciclo autorizado;
- não ampliar nem antecipar o escopo aprovado;
- preservar os gates de cobertura e CI vigentes; e
- preferir evidências objetivas a repetição de inspeções ou relatórios extensos.
