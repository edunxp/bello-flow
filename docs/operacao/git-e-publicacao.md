# Git e publicação

## Escopo

Este procedimento descreve a preparação de alterações, o commit local, a
publicação no GitHub e a verificação do CI do Bello Flow. Ele complementa as
regras permanentes de segurança e autorização do
[AGENTS.md](../../AGENTS.md).

Nenhuma etapa deste documento concede autorização por si só. Enquanto a
modalidade de branch curta não estiver ativa, a atividade precisa selecionar
explicitamente uma das modalidades abaixo. Depois da ativação, um ciclo pode
selecionar explicitamente a modalidade preparada na seção correspondente. Não
execute merge, rebase, pull, reset, force push ou reescrita de histórico
automaticamente.

## Modalidades de autorização

| Modalidade                   | Alterações e validações       | Commit local             | Push normal                       |
| ---------------------------- | ----------------------------- | ------------------------ | --------------------------------- |
| **Implementação**            | autorizado no escopo          | não autorizado           | não autorizado                    |
| **Implementação com commit** | autorizado no escopo          | autorizado no escopo     | não autorizado                    |
| **Publicação controlada**    | não autoriza novas alterações | não autoriza novo commit | autorizado para o commit aprovado |

Nas modalidades vigentes e em qualquer operação direta na `main`, a publicação
ocorre em atividade posterior ao commit e exige autorização separada e explícita
para push. Uma autorização apenas para commit permanece na segunda modalidade e
não permite push. Expressões ambíguas como “vamos em frente”, “continue” ou
equivalentes não selecionam a modalidade de publicação. Depois da ativação,
somente a autorização explícita de ciclo reúne commits e pushes normais na branch
`work/<incremento>`; integração e push na `main` continuam separados.

Durante a implementação, problemas técnicos rotineiros podem ser corrigidos e
revalidados autonomamente nos limites da autorização recebida. Após cada correção,
os gates afetados precisam ser reexecutados. Qualquer falha em validação
obrigatória que não tenha sido corrigida e revalidada impede staging e commit. Não
é permitido ignorar falhas para concluir a atividade nem reduzir testes,
cobertura ou verificações para obter aprovação. Bloqueios devem ser relatados com
a evidência disponível.

Depois da aprovação do commit ou durante publicação e CI, qualquer falha de
escopo, staging, divergência, autenticação, publicação ou CI interrompe a etapa e
deve ser reportada: a autorização de commit ou publicação não permite criar
correção, commit adicional, novo push, reexecução ou ampliação de escopo.

## Modalidade preparada — ciclo em branch curta

### Estado de adoção

Esta modalidade está em **preparação**: o CI aceita localmente pushes em
`work/**`, e o contrato operacional está documentado, mas essas alterações ainda
não foram publicadas nem validadas em uma branch real. Ela não concede autoridade
operacional nesta etapa.

A **ativação** exige cumulativamente:

1. publicação deste preparo na `main` pelo procedimento vigente;
2. CI da publicação aprovado nos jobs `Quality`, `API integration` e `Required`;
3. teste real autorizado em uma branch `work/**`, criada a partir da `main`
   publicada;
4. os três jobs aprovados no evento `push` e no SHA final exato dessa branch; e
5. formalização explícita de que a modalidade foi ativada.

Até a ativação, permanecem exclusivamente vigentes as modalidades e os
procedimentos atuais para trabalho direto na `main`. Esta seção não autoriza criar
branch, commit, push, integração ou limpeza.

### Teste controlado de ativação

Depois da publicação deste preparo e do CI aprovado na `main`, uma autorização
específica de teste pode permitir somente:

1. confirmar `main`, `origin/main`, árvore e índice limpos e registrar o SHA
   publicado;
2. criar `work/validacao-<identificador>` apontando diretamente para esse SHA;
3. executar um único push normal dessa branch, sem alteração ou novo commit;
4. localizar o workflow pelo evento `push`, pela branch e pelo mesmo SHA; e
5. exigir `completed/success` para o workflow, `Quality`, `API integration` e
   `Required`.

Esse teste não autoriza modificar arquivos, criar commit, integrar ou publicar na
`main`, publicar outra branch nem declarar a modalidade ativa. A remoção da branch
de validação exige autorização posterior e alvos exatos.

### Autorização do ciclo após a ativação

Uma única autorização explícita de ciclo deve registrar:

- objetivo, escopo e riscos aprovados;
- branch exclusiva `work/<incremento>`; e
- `BASE_MAIN_SHA`, obtido da `main` local e de `origin/main` sincronizadas.

Essa autorização permite criar a branch a partir de `BASE_MAIN_SHA`, alterar
somente o escopo aprovado, criar os commits locais necessários e executar pushes
normais somente para a branch autorizada. Correções técnicas rotineiras não exigem
nova autorização quando permanecem no escopo; os gates afetados precisam ser
reexecutados.

A autorização de ciclo não permite:

- integrar ou publicar diretamente na `main`;
- alterar ou publicar outra branch;
- force push, rebase automático ou reescrita de histórico;
- modificar contratos AT, DEC, RN ou políticas de segurança;
- ampliar escopo, aceitar risco novo ou introduzir dependência ou custo não
  aprovado; nem
- acessar ou alterar banco persistente ou privilégios não autorizados.

### CI e revisão da branch

Antes de solicitar integração:

1. confirme branch, working tree, índice, SHA local e SHA remoto da branch;
2. localize o workflow `CI` pelo evento `push`, branch `work/<incremento>`, SHA
   final exato e tentativa atual;
3. exija `completed/success` para o workflow e para `Quality`, `API integration` e
   `Required`;
4. trate ausência, cancelamento, skip ou conclusão diferente de `success` como
   bloqueio; e
5. realize revisão independente quando a mudança for de alto risco.

Pull request é opcional e não substitui a execução de `push` no SHA final da
branch. Nenhuma configuração paga de proteção de branch é requisito desta
modalidade. Falha não corrigida de gate obrigatório impede integração e não pode
ser ignorada por controle apenas operacional.

### Integração fast-forward autorizada

A integração exige autorização específica posterior; a autorização do ciclo não
a concede. Antes de integrar:

1. registre novamente a branch e seu SHA aprovado;
2. confirme árvore e índice limpos;
3. execute `git fetch --prune origin`, sem alterar commits locais;
4. exija que `origin/main` continue exatamente em `BASE_MAIN_SHA`;
5. exija que a branch autorizada esteja `0 behind / N ahead` de `origin/main`, com
   o SHA remoto igual ao SHA aprovado pelo CI; e
6. interrompa diante de avanço da `main`, divergência ou conjunto de commits
   diferente do autorizado, sem merge, rebase, pull ou correção automática.

Se todas as condições forem satisfeitas, a autorização de integração permite
somente o fast-forward da `main` até o SHA aprovado da branch e um único push
normal de `main` para `origin/main`. Não se cria merge commit nem se usa squash.
Depois do push, confirme o SHA remoto e a divergência `0 behind / 0 ahead` e exija
novo CI completo no SHA integrado da `main`.

Falha do CI final é reportada sem reescrita de histórico. Correção ou reversão usa
novo commit em ciclo autorizado posterior; nunca reset ou force push.

### Encerramento e limpeza

A branch local ou remota somente pode ser removida depois da sincronização da
`main`, do CI final aprovado e do encerramento do ciclo. A remoção exige
autorização específica, alvos exatos e confirmação de que pertencem ao ciclo; não
há limpeza ampla ou automática.

## Preparação

Antes de preparar um commit:

1. Identifique a branch, o `HEAD` e o estado da árvore:

   ```bash
   git branch --show-current
   git rev-parse HEAD
   git status --short --branch
   ```

   Quando a atividade definir branch ou `HEAD` esperados, exija correspondência
   exata antes de modificar, preparar ou publicar qualquer arquivo. Divergência
   interrompe a parte afetada e deve ser reportada.

2. Identifique separadamente arquivos modificados, staged e novos:

   ```bash
   git diff --name-status
   git diff --cached --name-status
   git ls-files --others --exclude-standard
   ```

3. Confronte cada caminho com o escopo autorizado. Preserve modificações
   preexistentes do usuário e não misture arquivos não relacionados.
4. Verifique se há credenciais, secrets, URLs com credenciais, chaves privadas,
   dados pessoais ou hashes ligados a senhas reais. Não imprima valores
   sensíveis durante a inspeção.
5. Execute as validações e os testes previstos pela atividade e confirme
   `git diff --check` antes do staging.
6. Confirme que código, testes, documentação aplicável e configurações necessárias
   representam juntos o estado implementado e validado, sem antecipar publicação
   ou sucesso do CI.
7. Exclua do conjunto pretendido artefatos gerados ou temporários, como `dist`,
   `coverage`, logs, caches e arquivos de editor.
8. Para arquivos novos, valide também o conteúdo que ainda não aparece no
   `git diff` convencional.

Se a árvore contiver alterações inesperadas, não as descarte. Isole os arquivos
autorizados quando isso for seguro; caso contrário, interrompa a parte afetada e
relate a divergência.

## Commit

Execute esta seção somente na modalidade **Implementação com commit**.

1. Confirme os caminhos autorizados e adicione-os explicitamente. Evite
   `git add .`, `git add -A` ou outro staging amplo quando houver qualquer risco
   de incluir material não relacionado:

   ```bash
   git add <caminho-autorizado> [<outro-caminho-autorizado>...]
   ```

2. Revise integralmente o staging e confirme a ausência de segredos:

   ```bash
   git diff --cached --stat
   git diff --cached --check
   git diff --cached --name-status
   ```

3. Confirme que arquivos novos necessários foram incluídos, que nenhum caminho
   indevido está staged e que não restou arquivo relacionado fora do staging:

   ```bash
   git status --short --branch
   git diff --name-status
   git ls-files --others --exclude-standard
   ```

4. Crie um único commit com a mensagem autorizada e coerente com a alteração:

   ```bash
   git commit -m "<mensagem-autorizada>"
   ```

5. Confirme o hash, os caminhos efetivamente incluídos e o estado final:

   ```bash
   git rev-parse HEAD
   git show --stat --oneline --summary HEAD
   git status --short --branch
   ```

Se o staging contiver um arquivo inesperado, interrompa antes do commit e relate
o caminho. Não remova alterações do usuário para ajustar o staging.

## Publicação

Execute esta seção somente na modalidade **Publicação controlada**, em atividade
posterior à criação e aprovação do commit local.

1. Confirme a branch, o commit autorizado e a árvore limpa:

   ```bash
   git branch --show-current
   git rev-parse HEAD
   git status --porcelain=v1
   ```

2. Atualize somente as referências remotas, sem alterar commits ou a branch
   local:

   ```bash
   git fetch --prune origin
   ```

3. Verifique divergência e os commits que seriam publicados:

   ```bash
   git rev-list --left-right --count origin/main...main
   git log --oneline origin/main..main
   ```

   O hash autorizado precisa estar no conjunto a publicar, e nenhum commit não
   autorizado pode acompanhá-lo. Se a branch remota tiver avançado, se houver
   divergência ou se o conjunto diferir do autorizado, interrompa sem executar
   merge, rebase, pull ou push. Para um único commit novo criado sobre `main`
   previamente sincronizada, a divergência obrigatória antes do push é exatamente
   `0 behind / 1 ahead`.

4. Publique sem force push e somente para a branch autorizada:

   ```bash
   git push origin main
   ```

5. Confirme localmente a sincronização e consulte a referência remota:

   ```bash
   git rev-parse HEAD
   git rev-parse origin/main
   git rev-list --left-right --count origin/main...main
   git ls-remote --heads origin refs/heads/main
   git status --short --branch
   ```

   A referência remota deve apontar para o SHA autorizado, `HEAD` e `origin/main`
   devem coincidir, a comparação deve indicar `0 behind / 0 ahead` e o working
   tree deve permanecer limpo. Se qualquer evidência divergir, não inicie a
   verificação de CI como se a publicação estivesse confirmada.

Nunca use `--force` ou `--force-with-lease`. Push rejeitado ou divergência
inesperada deve ser reportado sem merge, rebase, pull ou novo commit automático.

## GitHub Actions

Após confirmar a publicação e a sincronização da branch:

1. Registre o SHA publicado e localize o workflow `CI` filtrando por esse SHA
   exato. Não selecione uma execução apenas por ser a mais recente. Confirme na
   execução encontrada:
   - `head_sha` igual ao SHA publicado;
   - branch `main`;
   - workflow `CI`;
   - evento de push correspondente;
   - tentativa atual da execução, quando houver reexecuções.
2. Registre o identificador e o link da execução. Se ainda não houver workflow
   para o SHA, aguarde aproximadamente 15 segundos antes de consultar novamente.
3. Consulte o estado do workflow e dos jobs obrigatórios:
   - `Quality`;
   - `API integration`;
   - `Required`.
4. Enquanto o workflow ou qualquer job estiver `queued` ou `in_progress`, não o
   classifique como aprovado ou reprovado. Consulte novamente em intervalos
   moderados, aproximadamente a cada 15 segundos, evitando polling contínuo ou
   consultas em rajada.
5. Continue até obter estado terminal para o workflow e para os três jobs. Não
   imponha um timeout de apenas um minuto. Se indisponibilidade de rede,
   autenticação, limitação da ferramenta ou interrupção do ambiente impedir a
   continuidade, registre o último estado observado e classifique a verificação
   como não concluída, sem presumir o resultado.
6. Declare sucesso somente quando:
   - o workflow estiver `completed` com conclusão `success`;
   - `Quality` estiver `completed` com conclusão `success`;
   - `API integration` estiver `completed` com conclusão `success`;
   - `Required` estiver `completed` com conclusão `success`.
7. Em caso de conclusão diferente de `success`, informe o job, sua conclusão,
   a etapa ou evidência disponível e o link da execução. Não altere código,
   configuração ou dados e não reexecute o workflow automaticamente.

Use o cliente GitHub configurado no ambiente ou a API do GitHub em modo somente
leitura. Durante o acompanhamento, não crie commits, não modifique arquivos, não
execute novos pushes e não use force push. Não declare sucesso com base apenas no
resultado do `git push`.

Se o ambiente não tiver acesso ao GitHub Actions, informe explicitamente que o CI
não pôde ser verificado e forneça apenas as evidências locais e o último estado
remoto comprovado.

O relatório final da publicação deve conter:

- SHA publicado;
- resultado do push;
- confirmação do commit remoto, sincronização da branch e working tree;
- status e conclusão de `Quality`, `API integration` e `Required`;
- status e conclusão do workflow `CI`;
- link da execução;
- limitações ou pendências de verificação.

Esse relatório encerra a publicação. Não se cria automaticamente outro commit
apenas para registrar SHA ou número do CI na documentação. Atualização documental
posterior exige necessidade normativa ou operacional expressa, correção factual,
mudança material do projeto ou consolidação periódica e segue nova autorização
Git.

## Situações excepcionais

| Situação                                | Comportamento seguro                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Branch diferente da autorizada          | Interromper commit ou publicação e informar a branch encontrada.                              |
| Working tree com alterações inesperadas | Preservar os arquivos; isolar apenas o conjunto autorizado quando for comprovadamente seguro. |
| `HEAD` diferente do commit autorizado   | Não publicar e apresentar os dois hashes.                                                     |
| Falha de autenticação no GitHub         | Não trocar credenciais, não expor tokens e relatar a falha.                                   |
| Push rejeitado                          | Não forçar, mesclar ou rebasear; atualizar as referências e relatar a divergência.            |
| CI reprovado                            | Relatar workflow, job, etapa e evidência sem correção automática.                             |
| CI não verificável                      | Declarar a limitação; não presumir aprovação.                                                 |

Em todas as situações, preserve o histórico e as alterações locais. Não crie
rotinas automáticas que executem operações destrutivas.
