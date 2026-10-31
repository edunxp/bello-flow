# Permissões e restrições

## Funcionalidades catalogadas

| ID | Capacidade | Evidência |
|---|---|---|
| P01 | aplicar papel no quadro | [DOC] administrador, membro normal e observador possuem capacidades diferentes. ([Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/)) |
| P02 | aplicar visibilidade | [DOC] privado, Workspace, organização Enterprise e público são escopos documentados conforme contexto. ([Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/)) |
| P03 | configurar comentários | [DOC] quadro pode restringir comentários a conjuntos diferentes de participantes; opções dependem da visibilidade. ([Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/)) |
| P04 | gerir associação | [DOC/API] políticas determinam quem adiciona/remove membros; API expõe memberships do quadro. ([Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/), [Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/)) |

## Papéis e capacidades comprovadas

| Papel/contexto | Pode fazer | Não pode fazer / observação |
|---|---|---|
| administrador do quadro | [DOC] administrar quadro; fechar e, se era admin, reabrir | alterações administrativas são restritas conforme configuração/plano |
| membro normal | [DOC] ver e editar todos os cartões; adicionar/editar conteúdo sem restrições normais | só administrador remove usuários/altera certas configurações, salvo política que permita membros adicionarem/removerem |
| observador | [DOC] ver cartões, baixar anexos, comentar/votar se habilitado e exportar | não move/edita cartões, envia anexos, marca checklist nem muda configurações |
| convidado | [DOC] membro de quadro que não pertence ao Workspace | “convidado” descreve relação com Workspace, não substitui necessariamente o papel do quadro |
| visitante de quadro público | [DOC] pode visualizar pelo link | apenas membros editam; comentário/voto dependem de configuração |

Fontes: [Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/), [Observadores](https://support.atlassian.com/trello/docs/adding-observers-to-boards/), [Adicionar pessoas](https://support.atlassian.com/trello/docs/adding-people-to-a-board/), [Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/).

## Regras importantes

- [DOC] Membros normais do quadro podem ver e editar todos os cartões; a documentação consultada não descreve permissão por cartão. ([Adicionar pessoas](https://support.atlassian.com/trello/docs/adding-people-to-a-board/))
- [DOC] Opções de comentário incluem desabilitado, membros, membros e observadores, membros do Workspace e qualquer usuário Trello em quadro público, conforme disponibilidade. ([Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/))
- [DOC] Administrador pode definir se somente administradores ou todos os membros gerem associação. ([Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/))
- [DOC] Somente administradores podem alterar visibilidade; administradores de Workspace pagos podem ter capacidades adicionais. ([Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/))
- [API] Rotas de escrita de quadro/lista/cartão exigem escopo OAuth apropriado, como `write:board:trello`; isso não substitui a autorização do usuário sobre o recurso. ([Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/), [Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/))

## Restrições de plano, organização e capacidade

- [DOC] Observador é recurso de Premium. ([Observadores](https://support.atlassian.com/trello/docs/adding-observers-to-boards/))
- [DOC] Movimentos de cartões/listas podem ser impedidos para fora de Workspace Enterprise. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [API] Limites variam; o consumidor deve respeitar os valores e estados (`ok`, `warn`, `disabled`, `maxExceeded`) retornados pelo modelo. ([Limites](https://developer.atlassian.com/cloud/trello/guides/rest-api/limits/))
- [DOC] Recomendações de desempenho, como manter menos de 1.000 cartões abertos, não são limites rígidos da API. ([Quadro lento](https://support.atlassian.com/trello/docs/troubleshooting-a-slow-board/))

## Hipóteses e questões não confirmadas

- [UNK] Não foi construída matriz completa de todas as operações × papéis × planos.
- [UNK] Comportamento de usuários suspensos/desativados e transferência de propriedade precisa de investigação própria.
- [UNK] Não se presume que escopo OAuth suficiente conceda acesso a qualquer recurso.
- [UNK] Regras de visibilidade em todas as variantes Enterprise não foram exauridas.

## Recomendações preliminares para o Bello

- Começar a especificação por ações e recursos, não por telas: `pode(ator, operação, recurso)`.
- Distinguir papel no quadro, associação ao Workspace e visibilidade externa.
- Manter configuração de comentários e recursos condicionais como decisões de produto, não como consequência automática do modelo Trello.

