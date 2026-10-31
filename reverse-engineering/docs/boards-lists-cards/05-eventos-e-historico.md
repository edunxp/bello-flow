# Eventos e histórico de alterações

## Conclusão principal

- [API] `Action` é o registro público de uma atividade: contém `id`, `data`, `date`, `idMemberCreator` e `type`. `data` carrega informações relevantes ao tipo. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/))
- [API] Isso **não constitui uma auditoria completa**: recursos aninhados filtram tipos de ação, e algumas mudanças atualizam `dateLastActivity` sem criar uma ação consultável. ([Action Types](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/), [Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/))

## Funcionalidades catalogadas

| ID | Capacidade | Evidência |
|---|---|---|
| H01 | consultar feed de ações | [API] quadro, lista e cartão expõem recursos de ações; paginação de ações usa o ID final como parâmetro `before`. ([API Introduction](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/)) |
| H02 | receber mudança por webhook | [API] webhook entrega `action`, modelo observado e metadados do webhook quando o modelo muda; exige autorização e não foi chamado. ([Webhooks](https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/)) |

## Estrutura detalhada esperável por evento

| Informação solicitada | Disponibilidade documentada | Limite |
|---|---|---|
| ator | [API] `idMemberCreator`; exemplo também mostra `memberCreator` | pode haver diferenças por tipo/projeção; não presumir dados pessoais completos |
| data/hora | [API] `date` | formato ISO aparece no exemplo; política de fuso/exibição não foi investigada |
| entidade | [API] referências em `data` podem incluir quadro, lista, cartão ou outro modelo | o conjunto depende do tipo de ação |
| operação | [API] `type`, por exemplo `updateCard`, `createList`, `copyCard` | tipos retornados variam por recurso/canal |
| valor anterior | [API] `data.old` aparece em certas atualizações | não é garantido em toda ação/campo |
| valor posterior | [API] aparece na entidade/dados atuais do exemplo | não existe contrato universal de par anterior/posterior |

Fonte da estrutura e do exemplo de alteração de prazo: [Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/).

## Exemplo normalizado, sem dados reais

```text
ator:             Action.idMemberCreator
data:             Action.date
entidade:         Action.data.card/list/board/... (quando presente)
operação:         Action.type
valor_anterior:   Action.data.old.<campo> (quando presente)
valor_posterior:  Action.data.<entidade>.<campo> ou dado específico (quando presente)
```

Este mapeamento descreve possibilidades do contrato, não campos obrigatórios de toda ação.

## Tipos e cobertura

- [API] A lista oficial inclui, entre outros, criação de quadro/lista/cartão, cópia de quadro/cartão, exclusão de cartão, comentários, membros, anexos, checklists e movimentos entre quadros. ([Action Types](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/))
- [API] Tipos como `updateCheckItem` podem ser enviados por webhook e ainda assim não aparecer em `/cards/{id}/actions` ou `/boards/{id}/actions`. ([Action Types](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/))
- [API] Webhooks de cartão, lista e quadro têm matrizes diferentes de tipos disparados. ([Webhooks](https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/))
- [DOC] O menu do quadro mostra atividade e permite filtrar comentários, carregando entradas mais antigas sob demanda. ([Menu do quadro](https://support.atlassian.com/trello/docs/the-board-menu/))

## Relação com movimentação, cópia e exclusão

- [DOC] Mover cartões/listas entre quadros não leva o histórico/atividade do cartão ao destino, apesar de preservar conteúdo selecionado. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [DOC] Copiar lista não copia histórico/atividade dos cartões; copiar quadro não copia atividade. ([Copiar](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/))
- [API] Existem tipos de ação para cópia e movimentos de/para quadros. ([Action Types](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/))
- [UNK] As fontes não estabelecem se ou por quanto tempo ações ligadas a entidades permanentemente excluídas continuam consultáveis.

## Paginação, retenção e consistência

- [API] A documentação recomenda paginar ações com `before` usando o ID da última ação recebida. ([API Introduction](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/))
- [UNK] Não foi encontrada garantia de retenção indefinida, imutabilidade, ordenação total global ou entrega exatamente uma vez.
- [UNK] Não foi comprovado que o histórico permita reconstruir integralmente qualquer estado anterior.
- [INF] Como canais têm coberturas diferentes, conciliar feed e webhook exigiria deduplicação por identidade da ação; isso é necessidade potencial de integração, não comportamento interno comprovado.

## Recomendações preliminares para o Bello

- Definir um evento de domínio próprio com: ID, ator (ou sistema), instante, entidade, operação, anterior/posterior opcionais, causa/correlação e versão do esquema.
- Declarar campo a campo quando anterior/posterior existe; não fabricar valores ausentes.
- Separar feed colaborativo de trilha de auditoria. Seus requisitos de retenção, acesso e integridade podem ser diferentes.
- Decidir posteriormente cobertura, retenção, anonimização e semântica de entrega.

