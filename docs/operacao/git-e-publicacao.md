# Git e publicação

## Escopo

Este procedimento descreve a preparação de alterações, o commit local, a
publicação no GitHub e a verificação do CI do Bello Flow. Ele complementa as
regras permanentes de segurança e autorização do
[AGENTS.md](../../AGENTS.md).

Nenhuma etapa deste documento concede autorização por si só. A atividade precisa
selecionar explicitamente uma das modalidades abaixo. Não execute merge, rebase,
pull, reset, force push ou reescrita de histórico automaticamente.

## Modalidades de autorização

| Modalidade | Alterações e validações | Commit local | Push normal |
|---|---|---|---|
| **Implementação** | autorizado no escopo | não autorizado | não autorizado |
| **Implementação com commit** | autorizado no escopo | autorizado no escopo | não autorizado |
| **Implementação com publicação** | autorizado no escopo | autorizado no escopo | autorizado no escopo |

A modalidade **Implementação com publicação** somente se aplica quando o pedido
da atividade autorizar explicitamente publicação ou push. Nesse caso, commit e
push normal podem ocorrer em sequência, sem uma segunda autorização entre eles,
desde que todas as verificações deste procedimento sejam bem-sucedidas. Uma
autorização apenas para commit permanece na segunda modalidade e não permite
push. Expressões ambíguas como “vamos em frente”, “continue” ou equivalentes não
selecionam a modalidade com publicação.

Qualquer falha de escopo, validação, staging, divergência, autenticação,
publicação ou CI interrompe o fluxo e deve ser reportada. A autorização original
não permite corrigir automaticamente a falha, criar commits adicionais nem
ampliar o escopo.

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
6. Exclua do conjunto pretendido artefatos gerados ou temporários, como `dist`,
   `coverage`, logs, caches e arquivos de editor.
7. Para arquivos novos, valide também o conteúdo que ainda não aparece no
   `git diff` convencional.

Se a árvore contiver alterações inesperadas, não as descarte. Isole os arquivos
autorizados quando isso for seguro; caso contrário, interrompa a parte afetada e
relate a divergência.

## Commit

Execute esta seção somente nas modalidades **Implementação com commit** ou
**Implementação com publicação**.

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

Execute esta seção somente na modalidade **Implementação com publicação**, depois
de criar e identificar o commit autorizado. Se todas as condições abaixo forem
satisfeitas, prossiga do commit para o push sem solicitar autorização
intermediária.

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
