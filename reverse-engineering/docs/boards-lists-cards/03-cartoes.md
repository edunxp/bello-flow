# Cartões

## Objetivo e comportamento esperado

- [API] Cartão é a unidade fundamental de trabalho, existe no contexto de um quadro e pertence a uma lista. ([API Introduction](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/))
- [DOC] Pode representar trabalho com descrição, membros, etiquetas, datas, comentários, checklists e anexos. ([Adicionar e customizar](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/))

## Operações comprovadas

| ID | Operação | Regra/evidência |
|---|---|---|
| C01 | criar | [API] requer `idList`; aceita nome, descrição, posição, datas, membros e etiquetas. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C02 | consultar | [API] obtém cartão/campos e recursos relacionados. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C03 | editar conteúdo | [API] nome e descrição integram o contrato de atualização. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C04 | reposicionar na lista | [DOC] arrastar move entre topo/meio/fim; [API] `pos` é editável. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C05 | mover entre listas | [DOC/API] altera a lista do cartão. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C06 | mover entre quadros | [DOC/API] altera quadro/lista de destino, sujeito a regras de preservação e permissão. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C07 | arquivar | [DOC] sai do quadro ativo, permanece armazenado e restaurável. ([Arquivar/excluir](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/)) |
| C08 | restaurar | [DOC] cartão arquivado pode voltar ao quadro. ([Arquivar/excluir](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/)) |
| C09 | excluir | [API] existe `DELETE /cards/{id}`; [DOC] é permanente e exige arquivar primeiro na interface. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/), [Arquivar/excluir](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/)) |
| C10 | copiar | [DOC] permite escolher nome, itens mantidos e destino. ([Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/)) |
| C11 | gerir datas | [DOC/API] suporta data de início, prazo e horário; campos públicos incluem `start` e `due`. ([Datas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C12 | marcar prazo concluído | [DOC/API] conclusão é alternável e exposta em `dueComplete`. ([Datas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/), [Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)) |
| C13 | gerir responsáveis | [API] membros podem ser adicionados/removidos e são relações do cartão. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C14 | gerir etiquetas | [API] etiquetas podem ser adicionadas/removidas. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C15 | gerir comentários | [API] ações de comentário podem ser criadas, atualizadas e removidas. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| C16 | gerir checklists | [API] checklists e itens possuem operações próprias no cartão. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |

## Campos e propriedades públicas relevantes

| Grupo | Campos/conceitos documentados |
|---|---|
| identidade | [API] `id`, identificador curto/short link no objeto. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)) |
| conteúdo | [API] `name`, `desc`; descrição até 16.384 caracteres na definição publicada. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)) |
| localização | [API] `idBoard`, `idList`, `pos`. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| ciclo de vida | [API] `closed` indica cartão arquivado. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)) |
| datas | [API] `start`, `due`, `dueComplete`, `dateLastActivity`. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/), [Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)) |
| relações | [API] membros, etiquetas, anexos, checklists, ações, quadro e lista. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| apresentação | [API] `badges`, capa por `idAttachmentCover` e dados auxiliares de descrição. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)) |

## Regras funcionais

- [DOC] Cartão arquivado não é carregado na abertura normal do quadro, permanece indefinidamente e pode ser restaurado. ([Arquivar/excluir](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/))
- [DOC] Exclusão é permanente, requer confirmação e não pode ser desfeita. ([Arquivar/excluir](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/))
- [DOC] Movimento entre quadros preserva descrição, checklists, anexos e comentários, mas não histórico/atividade; remove membros que não pertencem ao quadro de destino. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [DOC] Cartões arquivados não geram notificações de prazo. ([Datas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/))
- [DOC] Marcar como concluído antes do prazo impede a automação “quando o cartão vencer” descrita pela fonte. ([Datas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/))

## Ordenação

- [API] `pos` aceita número ou texto nos contratos de criação/atualização. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/))
- [DOC] Ordenação em massa oferece critérios como alfabético, prazo e criação e não possui desfazer automático. ([Ordenar cartões](https://support.atlassian.com/trello/docs/sorting-lists/))
- [INF] Ordenar em massa provavelmente reescreve a ordem persistida dos cartões, pois a documentação exige reposição manual para desfazer; a mecânica exata não está publicada.
- [UNK] Estabilidade para empates, tratamento de valores nulos e algoritmo de posições são desconhecidos.

## Hipóteses e questões não confirmadas

- [UNK] A documentação não garante que `dateLastActivity` corresponda a uma ação consultável; na verdade, fornece contraexemplo em que muda sem ação. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/))
- [UNK] A lista exata de componentes selecionáveis em toda modalidade de cópia pode variar por interface/plano.
- [UNK] Retenção após exclusão e disponibilidade de backups internos não são contratos públicos.

## Recomendações preliminares para o Bello

- Considerar nome, localização, posição e estado como núcleo; avaliar descrição, responsáveis, etiquetas, comentários e datas juntos nos testes de valor do MVP.
- Projetar movimentação e cópia com matriz explícita de preservação.
- Não derivar auditoria somente de `updatedAt`/última atividade.

