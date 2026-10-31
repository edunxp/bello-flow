# Listas

## Objetivo e comportamento esperado

- [DOC] Listas estruturam um quadro e contêm cartões; podem ser adicionadas, renomeadas e rearranjadas. ([Criar um quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/))
- [API] Uma lista pertence a um quadro e expõe seus cartões e ações por recursos próprios. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/))

## Operações comprovadas

| ID | Operação | Regra/evidência |
|---|---|---|
| L01 | criar | [API] requer `name` e `idBoard`; aceita `pos` e lista-fonte. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| L02 | consultar | [API] permite obter lista, quadro, cartões e ações. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| L03 | renomear/editar | [API] atualização aceita `name`, `closed`, `idBoard`, `pos` e `subscribed`. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| L04 | reposicionar | [DOC] pode ser arrastada/rearranjada; [API] `pos` é mutável. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/), [Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| L05 | arquivar | [DOC] fica oculta com seus cartões; [API] `closed` pode ser definido. ([Arquivar listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/), [Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| L06 | restaurar | [DOC] lista arquivada pode ser restaurada pelo arquivo do quadro. ([Arquivar listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/)) |
| L07 | mover entre quadros | [API] `idBoard` pode ser atualizado; [DOC] conteúdo é preservado com exceções de associação de membros e histórico. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/), [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/)) |
| L08 | copiar | [DOC] copia os cartões e, neles, checklists, anexos, comentários e descrição; não copia histórico/atividade. ([Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/)) |
| L09 | arquivar todos os cartões | [API/DOC] há operação de arquivamento em massa. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/), [Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/)) |

## Campos e propriedades

| Campo | Evidência |
|---|---|
| `id` | [API] identifica a lista nas rotas. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| `name` | [API] obrigatório na criação e editável. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| `idBoard` | [API] quadro pai, obrigatório na criação e alterável para mover. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| `closed` | [API] controla o estado arquivado. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| `pos` | [API] posição editável, numérica ou textual no contrato. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |
| `subscribed` | [API] estado de acompanhamento editável. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/)) |

## Regras funcionais

- [DOC] Arquivar a lista oculta seus cartões, mas permite restaurar a lista. ([Arquivar listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/))
- [DOC] Excluir uma lista pela interface requer arquivá-la primeiro; a exclusão é permanente e remove cartões abertos e arquivados contidos nela. ([Arquivar listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/))
- [DOC] Ao mover lista para outro quadro, descrições, checklists, anexos e comentários dos cartões são preservados, mas o histórico/atividade dos cartões não; membros dos cartões que não pertencem ao destino são removidos. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [DOC] Movimentação para fora de um Workspace Enterprise pode ser bloqueada. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))

## Ordenação

- [DOC] O usuário pode arrastar listas para mudar a ordem no quadro. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [API] Atualizar `pos` altera a posição declarada da lista. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/))
- [INF] A ordem visual persistente é representável pelo conjunto de valores `pos`; a fórmula de geração desses valores não é pública.
- [UNK] Resolução de conflitos e renumeração não estão documentadas.

## Hipóteses e questões não confirmadas

- [UNK] A API de listas não documenta uma rota direta de exclusão equivalente à exclusão permanente apresentada pela interface; não se deve presumir paridade operacional.
- [UNK] Não está claro se restaurar uma lista sempre conserva exatamente sua posição anterior.
- [UNK] A preservação de etiquetas em cópia/movimento entre quadros não ficou inequívoca nas fontes consultadas.

## Recomendações preliminares para o Bello

- Modelar arquivo/restauração da lista sem alterar silenciosamente o estado próprio dos cartões.
- Tornar operações em massa explícitas, confirmáveis e auditáveis.
- Adiar a escolha do algoritmo de `pos`; primeiro definir semântica de concorrência e estabilidade.

