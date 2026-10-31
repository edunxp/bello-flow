# Quadros

## Objetivo e comportamento esperado

- [DOC] O quadro organiza trabalho em listas e cartões e pertence a um Workspace. ([Criar um quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/))
- [DOC] Um quadro novo recebe título e Workspace; a visibilidade pode ser configurada, e a documentação atual informa que o padrão de criação é visível ao Workspace. ([Criar um quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/))

## Operações comprovadas

| ID | Operação | Regra/evidência |
|---|---|---|
| B01 | criar | [API] `POST /boards`, com `name` obrigatório; aceita Workspace, preferências, fonte e opções de conteúdo. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |
| B02 | consultar | [API] consulta quadro, campos, listas, cartões, membros, ações e outros recursos aninhados. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |
| B03 | editar metadados | [API] atualização inclui propriedades do quadro; [DOC] título e descrição são editáveis. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/), [Customizar quadro](https://support.atlassian.com/trello/docs/create-and-customize-a-board/)) |
| B04 | fechar e reabrir | [DOC] fechar oculta e impede edição sem excluir; reabrir restaura o quadro. ([Fechar](https://support.atlassian.com/trello/docs/closing-a-board/), [Reabrir](https://support.atlassian.com/trello/docs/reopening-a-closed-board/)) |
| B05 | excluir | [API] existe `DELETE /boards/{id}`; [DOC] exclusão permanente está disponível a administradores autorizados. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/), [Customizar quadro](https://support.atlassian.com/trello/docs/create-and-customize-a-board/)) |
| B06 | copiar | [DOC] cópia inclui cartões e descrições, mas não comentários, atividade, membros dos cartões nem cartões arquivados. ([Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/)) |
| B07 | alterar visibilidade | [DOC] opções documentadas incluem privado, Workspace, organização (Enterprise) e público, conforme contexto/plano. ([Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/)) |
| B08 | gerir membros/papéis | [DOC] há administrador, membro normal e observador, além de estados/contextos como convidado. ([Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/), [Observadores](https://support.atlassian.com/trello/docs/adding-observers-to-boards/)) |
| B09 | consultar atividade | [DOC] menu oferece atividade e filtro de comentários; [API] ações do quadro são consultáveis. ([Menu](https://support.atlassian.com/trello/docs/the-board-menu/), [Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |

## Campos e propriedades públicas relevantes

| Campo/conceito | Estado documentado |
|---|---|
| identificador | [API] quadro possui ID e é endereçado por ID ou short link nas rotas. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |
| nome e descrição | [API] propriedades mutáveis; `name` é obrigatório na criação. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |
| Workspace | [API] `idOrganization` pode ser informado; [DOC] todo quadro pertence a Workspace. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/), [Criar](https://support.atlassian.com/trello/docs/creating-a-new-board/)) |
| fechado | [DOC] fechado fica oculto e sem edição, mas não excluído. ([Fechar](https://support.atlassian.com/trello/docs/closing-a-board/)) |
| preferências | [API] criação/atualização expõe, entre outras, nível de permissão e votação. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |
| listas/cartões/membros | [API] relações acessíveis por recursos aninhados. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |
| limites | [API] o modelo pode devolver estados e contagens de limites; valores não devem ser codificados como constantes. ([Limites](https://developer.atlassian.com/cloud/trello/guides/rest-api/limits/)) |

## Regras funcionais e ciclo de vida

- [DOC] Somente administradores do quadro e administradores de Workspace Premium podem fechar; outros membros recebem notificação. ([Fechar](https://support.atlassian.com/trello/docs/closing-a-board/))
- [DOC] Somente quem era administrador do quadro pode reabri-lo, com exceções documentadas para administradores de Workspace Premium. A reabertura pode escolher outro Workspace. ([Reabrir](https://support.atlassian.com/trello/docs/reopening-a-closed-board/))
- [DOC] Fechado não aparece na lista normal, não pode ser editado e não é excluído. ([Fechar](https://support.atlassian.com/trello/docs/closing-a-board/))
- [DOC] Quadros públicos são visíveis a quem tem o link, mas apenas membros podem editar. ([Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/))

## Histórico e relacionamentos

- [API] Ações do quadro podem incluir criação/atualização de quadro, lista e cartão, movimentos, cópias e mudanças de membros; recursos aninhados filtram alguns tipos. ([Action Types](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/))
- [API] Webhook de quadro pode receber diversas ações relacionadas a cartões/listas do quadro, mas exige autorização e não foi usado nesta análise. ([Webhooks](https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/))

## Hipóteses e questões não confirmadas

- [UNK] A documentação consultada não define atomicidade ao copiar, mover ou excluir árvores grandes.
- [UNK] Não está comprovado se a exclusão permanente de quadro preserva algum histórico acessível ao usuário/API.
- [UNK] Não está estabelecido quais preferências têm paridade total entre UI e API para todos os planos.

## Recomendações preliminares para o Bello

- Separar estados ativo, arquivado/fechado e excluído, com autorização explícita por operação.
- Especificar cópia como criação de nova árvore e declarar, campo a campo, o que será preservado.
- Decidir visibilidade, papéis e políticas de retenção somente após requisitos de produto e segurança.

