# Relacionamentos e ciclo de vida

## Relações comprovadas

| Origem | Relação | Destino | Cardinalidade funcional |
|---|---|---|---|
| Workspace | contém | quadro | [DOC] um quadro pertence a um Workspace; um Workspace pode ter vários quadros. ([Criar quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/)) |
| quadro | contém e ordena | lista | [DOC/API] múltiplas listas por quadro. ([API Introduction](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/)) |
| lista | contém e ordena | cartão | [DOC/API] cartão requer lista. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| quadro | autoriza | membro | [DOC] membros possuem papéis e editam conforme permissão. ([Permissões](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/)) |
| cartão | relaciona | membro/etiqueta/checklist/anexo/ação | [API] recursos próprios ou aninhados. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/)) |
| ação | referencia | ator e entidades | [API] contém criador, data, tipo e dados relevantes. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)) |

## Estados e transições

```text
ATIVO --arquivar/fechar--> ARQUIVADO/FECHADO --restaurar/reabrir--> ATIVO
   └-------------------- exclusão autorizada --------------------> EXCLUÍDO

COPIAR: origem permanece; nasce uma nova entidade/árvore.
MOVER: a entidade permanece; muda o contêiner/posição.
```

O diagrama é uma normalização documental; não afirma o desenho interno do Trello.

## Arquivamento e restauração

- [DOC] Cartão arquivado deixa a visualização normal, permanece armazenado e pode ser restaurado. ([Arquivar cartões](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/))
- [DOC] Lista arquivada fica oculta junto com os cartões e pode ser restaurada. ([Arquivar listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/))
- [DOC] Quadro fechado fica oculto/não editável, não excluído, e pode ser reaberto por ator autorizado. ([Fechar](https://support.atlassian.com/trello/docs/closing-a-board/), [Reabrir](https://support.atlassian.com/trello/docs/reopening-a-closed-board/))
- [API] Arquivar contêiner não faz cascata do campo `closed` para cartões: um cartão pode manter `closed: false` num quadro/lista arquivado. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/))

## Exclusão

- [DOC] Excluir cartão é permanente e só aparece após arquivamento na interface descrita. ([Arquivar cartões](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/))
- [DOC] Excluir lista é permanente e elimina cartões abertos e arquivados nela. ([Arquivar listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/))
- [API] Há exclusão de cartão e quadro na API pública. ([Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/), [Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/))
- [UNK] Preservação de relações e histórico após exclusão permanente não é garantida pelas fontes; deve ser tratada como indisponível ao usuário, sem inferir apagamento físico interno.

## Movimento: identidade e preservação

- [DOC] Mover cartão/lista dentro ou entre quadros altera o destino. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [DOC] Entre quadros, descrição, checklists, anexos e comentários dos cartões são preservados; histórico/atividade não é; membros ausentes do destino são removidos. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [DOC] Restrições Enterprise podem impedir saída do Workspace. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- [UNK] A fonte chama a operação de movimento, mas a continuidade de todos os identificadores públicos e links não foi confirmada nesta fase.

## Cópia: nova entidade e preservação

| Cópia | Preserva segundo DOC | Não preserva segundo DOC |
|---|---|---|
| cartão | itens selecionados pelo usuário, nome configurável e destino | [UNK] não há matriz universal fechada na página |
| lista | cartões; neles descrição, checklists, anexos e comentários | histórico/atividade dos cartões |
| quadro | cartões e descrições | comentários, atividade dos cartões, membros dos cartões e cartões arquivados |

Fonte: [Copiar cartões, listas ou quadros](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/).

## Inferências e desconhecidos

- [INF] Arquivar o contêiner mascara descendentes sem necessariamente mudar o estado individual deles, coerente com a definição de `closed` do cartão.
- [UNK] Regras para etiquetas com nomes/IDs conflitantes no destino não estão suficientemente documentadas.
- [UNK] Não há garantia pública de transação atômica em cópias/movimentos de árvores.
- [UNK] Não foi confirmada preservação da posição exata após restauração.

## Recomendações preliminares para o Bello

- Publicar uma matriz de preservação própria antes de implementar cada operação.
- Manter tombstone/retensão e política de restauração como decisão futura de produto e conformidade.
- Exigir confirmação reforçada para exclusões em cascata e registrar quem iniciou a operação.

