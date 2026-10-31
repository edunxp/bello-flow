# Matriz de API e comportamentos

## Como ler

A matriz é o inventário canônico das **40 funcionalidades** identificadas. `DOC` representa comportamento de produto e `API` contrato público; nenhum item afirma equivalência com a implementação interna.

## Quadros — 9

| ID | Funcionalidade | DOC | API | Estado |
|---|---|---|---|---|
| B01 | criar quadro | [Criar](https://support.atlassian.com/trello/docs/creating-a-new-board/) | [POST board](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/) | comprovada |
| B02 | consultar quadro e filhos | — | [Boards](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/) | comprovada |
| B03 | editar nome/descrição | [Customizar](https://support.atlassian.com/trello/docs/create-and-customize-a-board/) | [PUT board](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/) | comprovada |
| B04 | fechar/reabrir | [Fechar](https://support.atlassian.com/trello/docs/closing-a-board/), [reabrir](https://support.atlassian.com/trello/docs/reopening-a-closed-board/) | [Boards](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/) | comprovada |
| B05 | excluir | [Customizar](https://support.atlassian.com/trello/docs/create-and-customize-a-board/) | [DELETE board](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/) | comprovada; retenção UNK |
| B06 | copiar | [Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/) | criação aceita fonte | comprovada |
| B07 | alterar visibilidade | [Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/) | preferências | comprovada |
| B08 | gerir membros/papéis | [Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/) | memberships | comprovada |
| B09 | consultar atividade | [Menu](https://support.atlassian.com/trello/docs/the-board-menu/) | ações do board | comprovada; cobertura parcial |

## Listas — 9

| ID | Funcionalidade | DOC | API | Estado |
|---|---|---|---|---|
| L01 | criar lista | [Criar quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/) | [Lists](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/) | comprovada |
| L02 | consultar lista/cartões/ações | — | [Lists](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/) | comprovada |
| L03 | renomear/editar | [Criar quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/) | [Lists](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/) | comprovada |
| L04 | reposicionar | [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/) | campo `pos` | comprovada; algoritmo UNK |
| L05 | arquivar | [Arquivar](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/) | campo `closed` | comprovada |
| L06 | restaurar | [Arquivar](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/) | campo `closed` | comprovada |
| L07 | mover entre quadros | [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/) | atualizar `idBoard` | comprovada |
| L08 | copiar | [Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/) | criação aceita fonte | comprovada |
| L09 | arquivar todos os cartões | [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/) | operação da lista | comprovada |

## Cartões — 16

| ID | Funcionalidade | DOC | API | Estado |
|---|---|---|---|---|
| C01 | criar | [Adicionar/customizar](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/) | [Cards](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/) | comprovada |
| C02 | consultar | — | [Cards](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/) | comprovada |
| C03 | editar nome/descrição | [Adicionar/customizar](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/) | [Cards](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/) | comprovada |
| C04 | reposicionar | [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/) | campo `pos` | comprovada; algoritmo UNK |
| C05 | mover entre listas | [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/) | atualizar `idList` | comprovada |
| C06 | mover entre quadros | [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/) | atualização do destino | comprovada |
| C07 | arquivar | [Arquivar](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/) | `closed` | comprovada |
| C08 | restaurar | [Arquivar](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/) | `closed` | comprovada |
| C09 | excluir | [Arquivar](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/) | DELETE card | comprovada; permanente na UI |
| C10 | copiar | [Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/) | criação/cópia | comprovada; matriz completa UNK |
| C11 | gerir datas | [Datas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/) | `start`, `due` | comprovada |
| C12 | marcar prazo concluído | [Datas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/) | `dueComplete` | comprovada |
| C13 | gerir responsáveis | — | membros do card | comprovada por API |
| C14 | gerir etiquetas | [Adicionar/customizar](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/) | labels do card | comprovada |
| C15 | gerir comentários | [Menu](https://support.atlassian.com/trello/docs/the-board-menu/) | comment actions | comprovada |
| C16 | gerir checklists | [Adicionar/customizar](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/) | checklists | comprovada |

## Histórico — 2

| ID | Funcionalidade | DOC | API | Estado |
|---|---|---|---|---|
| H01 | consultar feed de ações | [Menu](https://support.atlassian.com/trello/docs/the-board-menu/) | [Actions](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/) | comprovada; incompleta como auditoria |
| H02 | receber mudança por webhook | — | [Webhooks](https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/) | contrato comprovado; não observado |

## Permissões — 4

| ID | Funcionalidade | DOC | API | Estado |
|---|---|---|---|---|
| P01 | aplicar papel no quadro | [Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/) | memberships | comprovada |
| P02 | aplicar visibilidade | [Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/) | prefs | comprovada |
| P03 | configurar comentários | [Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/) | preferências | comprovada; opções contextuais |
| P04 | gerir associação | [Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/) | memberships | comprovada |

## Cobertura e cautelas

- [API] Rotas públicas não revelam toda a implementação interna.
- [UNK] Não foi feita chamada para confirmar exemplos, respostas ou erros.
- [UNK] A matriz não cobre anexos, automações e visualizações como áreas funcionais completas; aparecem apenas quando afetam o núcleo.

