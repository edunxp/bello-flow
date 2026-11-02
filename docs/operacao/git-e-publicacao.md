# Git e publicação

## Escopo

Este procedimento descreve a preparação de alterações, o commit local, a
publicação no GitHub e a verificação do CI do Bello Flow. Ele complementa as
regras permanentes de segurança e autorização do
[AGENTS.md](../../AGENTS.md).

Commit e push são autorizações distintas. Nenhuma etapa deste documento concede
autorização por si só. Não execute merge, rebase, reset, force push ou reescrita
de histórico automaticamente.

## Preparação

Antes de preparar um commit:

1. Identifique a branch, o `HEAD` e o estado da árvore:

   ```bash
   git branch --show-current
   git rev-parse HEAD
   git status --short --branch
   ```

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
5. Exclua do conjunto pretendido artefatos gerados ou temporários, como `dist`,
   `coverage`, logs, caches e arquivos de editor.
6. Para arquivos novos, valide também o conteúdo que ainda não aparece no
   `git diff` convencional.

Se a árvore contiver alterações inesperadas, não as descarte. Isole os arquivos
autorizados quando isso for seguro; caso contrário, interrompa a parte afetada e
relate a divergência.

## Commit

Execute esta seção somente após autorização específica para commit.

1. Confirme os caminhos autorizados e adicione-os explicitamente. Evite
   `git add .`, `git add -A` ou outro staging amplo quando houver qualquer risco
   de incluir material não relacionado:

   ```bash
   git add <caminho-autorizado> [<outro-caminho-autorizado>...]
   ```

2. Revise integralmente o staging:

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

Execute esta seção somente após autorização específica para publicar um commit
identificado.

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
   merge, rebase ou push.

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

Nunca use `--force` ou `--force-with-lease` como recuperação automática de uma
publicação rejeitada.

## GitHub Actions

Após uma publicação bem-sucedida:

1. Localize a execução do workflow `CI` associada ao hash publicado.
2. Confirme que o `head_sha` da execução é exatamente o commit autorizado.
3. Aguarde o estado terminal e verifique individualmente:
   - `Quality`;
   - `API integration`;
   - `Required`.
4. Registre o resultado de cada job e forneça o link da execução, quando
   disponível.

Use o cliente GitHub configurado no ambiente ou a API do GitHub em modo somente
leitura. Não declare sucesso com base apenas no resultado do `git push`. Se o CI
falhar, apresente o job, a etapa e a evidência disponível sem alterar código ou
reexecutar o workflow automaticamente.

Se o ambiente não tiver acesso ao GitHub Actions, informe explicitamente que o CI
não pôde ser verificado e forneça apenas as evidências locais disponíveis.

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
