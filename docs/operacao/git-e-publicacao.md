# Git e publicação

## Escopo

Este procedimento descreve a preparação de alterações, o commit local, a
publicação no GitHub e a verificação do CI do Bello Flow. Ele complementa as
regras permanentes de segurança e autorização do
[AGENTS.md](../../AGENTS.md).

Nenhuma etapa deste documento autoriza uma atividade por si só. Uma atividade de
implementação autorizada é executada em branch exclusiva `work/<incremento>`,
com autonomia para alterações, validações, staging explícito, commits, push normal
da própria branch e acompanhamento do CI. A integração e publicação na `main`
exigem autorização explícita posterior para o SHA final aprovado.

## Modalidades de autorização

| Modalidade | Operações permitidas | Limite |
| --- | --- | --- |
| **Planejamento ou revisão** | inspeção e entregáveis autorizados, somente leitura quando assim delimitado | não autoriza implementar, commit ou push |
| **Ciclo em branch curta** | implementação, documentação, testes, correções rotineiras, staging explícito, commits, push normal da branch e acompanhamento do CI | não autoriza integrar ou publicar na `main` |
| **Integração autorizada** | fast-forward da `main` até o SHA aprovado, push normal da `main` e acompanhamento do CI final | não autoriza novos commits ou alteração do SHA aprovado |

Uma instrução mais restritiva da atividade, como somente leitura ou proibição de
commit ou push, continua obrigatória. A autorização do ciclo não dispensa os
controles técnicos nem permite ampliar escopo, alterar contratos aprovados,
acessar banco persistente ou aceitar risco novo.

Durante a implementação e o CI da branch, problemas técnicos rotineiros podem
ser diagnosticados, corrigidos e revalidados autonomamente no escopo aprovado.
Commits adicionais e novos pushes normais da correção ficam na mesma branch.
Qualquer falha obrigatória não corrigida e revalidada impede staging do conjunto
afetado e integração. Não reduza testes, cobertura ou gates para obter aprovação.

Divergência da base, falha de autenticação, alteração inesperada do staging ou
ampliação material do escopo interrompem a parte afetada e são reportadas, sem
merge, rebase, pull, reset, force push ou reescrita automática de histórico.
Durante a integração e o CI final da `main`, qualquer falha é reportada sem novo
commit, push ou reexecução não autorizados; correção exige novo ciclo autorizado.

## Ciclo em branch curta

### Estado de adoção

O ciclo em branch curta é o fluxo vigente, conforme a orientação do responsável.
A execução normal na branch inclui commit e push; a autorização humana posterior
fica na integração do SHA final na `main`. As evidências dos incrementos ficam no
[estado do projeto](../estado-do-projeto.md).

### Autorização do ciclo

Antes de iniciar, registre:

- objetivo, escopo e riscos da atividade autorizada;
- branch exclusiva `work/<incremento>`; e
- `BASE_MAIN_SHA`, obtido da `main` local e de `origin/main` sincronizadas.

A autorização permite criar a branch a partir de `BASE_MAIN_SHA` e conduzir o
ciclo até a publicação da branch com CI aprovado, sem novas autorizações para
cada comando, correção rotineira, commit ou push dentro do escopo. Preserve as
confirmações técnicas exigidas pelas ferramentas.

A autorização de ciclo não permite integrar ou publicar diretamente na `main`,
alterar outra branch, force push, rebase automático, reescrita de histórico,
mudança não aprovada de contratos AT, DEC, RN ou políticas de segurança,
ampliação de escopo, custo ou dependência não aprovados, nem acesso ou alteração
de banco persistente ou privilégios não autorizados.

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

Execute esta seção dentro do ciclo em branch curta autorizado, após as
validações aplicáveis. Commit local da branch não exige autorização adicional,
mas continua limitado ao escopo e ao staging explicitamente revisado.

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

4. Crie um commit com mensagem coerente com o conjunto revisado:

   ```bash
   git commit -m "<mensagem-do-commit>"
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

O push normal da branch exclusiva integra o ciclo autorizado, após revisão do
commit e das verificações abaixo. O push da `main` somente é permitido como parte
da integração explicitamente autorizada para o SHA final aprovado.

### Publicação controlada da branch curta

Publique somente a branch `work/<incremento>` do ciclo autorizado e registre o
SHA exato publicado. Não é necessária autorização adicional para esse push.

1. Confirme branch, base, commit e árvore limpa:

   ```bash
   git branch --show-current
   git rev-parse HEAD
   git rev-parse origin/main
   git status --porcelain=v1
   ```

   A branch deve ser exatamente `work/<incremento>`, e `origin/main` deve
   continuar em `BASE_MAIN_SHA`. Divergência interrompe a publicação sem merge,
   rebase ou pull automático.

2. Atualize referências e inspecione exatamente o conjunto da branch:

   ```bash
   git fetch --prune origin
   git rev-parse origin/main
   git rev-list --left-right --count origin/main...work/<incremento>
   git log --oneline origin/main..work/<incremento>
   git ls-remote --heads origin refs/heads/work/<incremento>
   ```

   A branch deve estar `0 behind / N ahead` da base e conter somente os commits
   autorizados. Reconfirme `origin/main` igual a `BASE_MAIN_SHA` depois do fetch.
   Se a referência remota já existir, confirme que não avançou nem divergiu do
   histórico local antes do novo push:

   ```bash
   git rev-list --left-right --count origin/work/<incremento>...work/<incremento>
   git log --oneline origin/work/<incremento>..work/<incremento>
   ```

3. Publique somente a referência autorizada, sem force push:

   ```bash
   git push origin refs/heads/work/<incremento>:refs/heads/work/<incremento>
   ```

4. Confirme o SHA remoto exato e a árvore local:

   ```bash
   git rev-parse HEAD
   git rev-parse origin/work/<incremento>
   git ls-remote --heads origin refs/heads/work/<incremento>
   git status --short --branch
   ```

   O SHA local, a referência remota consultada e o commit autorizado precisam
   coincidir. Esse push não autoriza integração ou publicação na `main`.

### Publicação controlada da `main`

Esta subseção aplica-se somente à integração fast-forward já autorizada.
Não trabalhe diretamente na `main` nem substitua o push e o CI da branch curta.

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
   merge, rebase, pull ou push. A divergência deve ser `0 behind / N ahead`,
   contendo exatamente os commits da branch aprovada para integração.

4. Publique sem force push e somente para a `main` autorizada:

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
inesperada deve ser reportado sem merge, rebase, pull ou correção automática do
histórico.

## GitHub Actions

Após confirmar a publicação e a sincronização da branch:

1. Registre o SHA publicado e localize o workflow `CI` filtrando por esse SHA
   exato. Não selecione uma execução apenas por ser a mais recente. Confirme na
   execução encontrada:
   - `head_sha` igual ao SHA publicado;
   - branch exatamente igual à referência publicada: `work/<incremento>` para o
     CI da branch ou `main` para o CI final;
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
   a etapa ou evidência disponível e o link da execução. Na branch do ciclo,
   diagnostique e corrija falhas rotineiras dentro do escopo, revalide e publique
   a correção por novo commit e push normal; acompanhe o CI do novo SHA. Não
   repita um workflow inalterado para tentar obter aprovação. Na `main`, pare
   e reporte; correção exige novo ciclo autorizado.

Use o cliente GitHub configurado no ambiente ou a API do GitHub em modo somente
leitura. Durante cada execução acompanhada, preserve o SHA observado. Se houver
correção autorizada no ciclo da branch, registre a falha antes de produzir o novo
SHA e retome o acompanhamento para ele. Não use force push nem declare sucesso
com base apenas no resultado do `git push`.

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
mudança material do projeto ou consolidação periódica e segue o escopo do ciclo
autorizado e seus controles Git.

## Situações excepcionais

| Situação                                | Comportamento seguro                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Branch diferente da autorizada          | Interromper commit ou publicação e informar a branch encontrada.                              |
| Working tree com alterações inesperadas | Preservar os arquivos; isolar apenas o conjunto autorizado quando for comprovadamente seguro. |
| `HEAD` diferente do commit autorizado   | Não publicar e apresentar os dois hashes.                                                     |
| Falha de autenticação no GitHub         | Não trocar credenciais, não expor tokens e relatar a falha.                                   |
| Push rejeitado                          | Não forçar, mesclar ou rebasear; atualizar as referências e relatar a divergência.            |
| CI reprovado                            | Na branch, relatar e corrigir falhas rotineiras no escopo; na main, reportar e exigir novo ciclo autorizado. |
| CI não verificável                      | Declarar a limitação; não presumir aprovação.                                                 |

Em todas as situações, preserve o histórico e as alterações locais. Não crie
rotinas automáticas que executem operações destrutivas.
