# Visão geral: quadros, listas e cartões

## Modelo funcional comprovado

```text
Workspace
└── Quadro
    ├── Lista ordenada
    │   └── Cartão ordenado
    ├── membros/papéis
    ├── preferências/visibilidade
    └── ações (histórico público parcial)
```

- [DOC] Todo quadro pertence a um Workspace e pode conter múltiplas listas; uma lista contém cartões. ([Criar um quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/))
- [API] Cartões são recursos fundamentais, porém existem no contexto de um quadro e pertencem a uma lista por `idList`; listas pertencem a um quadro por `idBoard`. ([Introdução](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/), [Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/))
- [API] Recursos aninhados permitem consultar listas e cartões de um quadro e ações de quadro/lista/cartão. ([Recursos aninhados](https://developer.atlassian.com/cloud/trello/guides/rest-api/nested-resources/))

## Invariantes funcionais documentados

- [API] Criar cartão exige uma lista de destino; criar lista exige um quadro de destino. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/), [Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/))
- [DOC] Mover altera a localização do mesmo item; copiar cria outro item e permite escolher destino. As fontes descrevem preservação diferente para cada operação. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/), [Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/))
- [API] `closed` representa arquivamento do cartão; arquivar lista/quadro não altera necessariamente `closed` dos cartões descendentes. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/))
- [DOC] Exclusão de cartão/lista exige arquivamento prévio na interface documentada e é permanente. ([Cartões](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/), [Listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/))

## Ordenação: fatos e limites

- [DOC] Listas podem ser rearranjadas no quadro, e cartões podem ser adicionados/movidos no topo, no meio ou no fim de uma lista. ([Criar quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/), [Adicionar e customizar](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/))
- [API] Listas e cartões expõem `pos`, aceitando valor numérico ou textual nos contratos de criação/atualização. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/), [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/))
- [DOC] Uma lista de cartões pode ser ordenada em massa por critérios como ordem alfabética, prazo e data de criação; não há desfazer automático dessa ordenação. ([Ordenar cartões](https://support.atlassian.com/trello/docs/sorting-lists/))
- [INF] `pos` funciona como chave de ordenação relativa no contrato público, porque é editável e acompanha operações de reposicionamento. A estratégia interna que atribui os números não foi documentada.
- [UNK] Não se sabe quando o Trello renumera posições, como resolve escritas concorrentes ou se usa indexação fracionária internamente.

## Fronteiras desta área

Etiquetas, responsáveis, comentários, anexos, checklists e datas são propriedades/capacidades de cartões e aparecem no levantamento porque influenciam regras, cópia, movimento e MVP. Automações, Power-Ups, visualizações avançadas e Inbox não são detalhados nesta fase.

## Recomendações futuras para o Bello

- Definir contratos funcionais independentes para hierarquia, posição, ciclo de vida, autorização e eventos.
- Tratar ordenação manual e “ordenar por critério” como operações diferentes.
- Não escolher agora algoritmo de posição, banco, barramento de eventos ou modelo de consistência.

