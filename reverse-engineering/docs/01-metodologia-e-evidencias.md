# Metodologia e evidências

## Método

O levantamento usa somente páginas públicas oficiais nos domínios `developer.atlassian.com` e `support.atlassian.com`. Nenhuma chamada autenticada foi executada, nenhum aplicativo foi iniciado e o arquivo `reverse-engineering/original/app.asar` não foi alterado nem relido nesta fase.

Cada afirmação funcional recebe uma classificação:

| Código | Autoridade | Uso neste levantamento |
|---|---|---|
| DOC | documentação oficial de produto/suporte | comportamento prometido ao usuário |
| API | referência/guia oficial da API | modelo e operação publicamente expostos |
| OBS | observação controlada | nenhuma nesta fase |
| INF | dedução limitada | interpretação que exige validação |
| UNK | desconhecido | lacuna explícita |

Uma página de suporte pode mudar com planos e evolução do produto. Uma rota pública demonstra um contrato de integração, não a implementação interna nem, isoladamente, a experiência completa da interface.

## Critério de comprovação

- Uma capacidade é “comprovada” quando há fonte DOC ou API diretamente relacionada.
- Divergências DOC/API são preservadas, não harmonizadas por suposição.
- Ausência numa resposta ou lista pública não prova inexistência interna.
- Recomendações do Bello aparecem em seção própria e não usam os marcadores DOC/API.
- Campos “anterior” e “posterior” do histórico só são afirmados quando a fonte mostra sua presença; nunca são elevados a garantia universal.

## Catálogo de fontes oficiais

| ID | Fonte | Evidência principal |
|---|---|---|
| S01 | [Using Trello](https://support.atlassian.com/trello/docs/using-trello/) | índice funcional oficial |
| S02 | [API Introduction](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/) | modelo geral, ações e paginação |
| S03 | [Boards API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/) | operações e campos de quadros |
| S04 | [Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/) | operações e campos de listas |
| S05 | [Cards API](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/) | operações e campos de cartões |
| S06 | [Nested Resources](https://developer.atlassian.com/cloud/trello/guides/rest-api/nested-resources/) | relações e filtros aninhados |
| S07 | [Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/) | objetos `Action` e `Card` |
| S08 | [Action Types](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/) | cobertura e exclusões do histórico |
| S09 | [Webhooks](https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/) | eventos de mudança e cobertura por modelo |
| S10 | [Criar um quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/) | composição e criação |
| S11 | [Mover cartões ou listas](https://support.atlassian.com/trello/docs/moving-cards-or-lists/) | movimento e preservação |
| S12 | [Copiar cartões, listas ou quadros](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/) | semântica de cópia |
| S13 | [Arquivar/excluir cartões](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/) | ciclo de vida de cartão |
| S14 | [Arquivar/excluir listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/) | ciclo de vida de lista |
| S15 | [Fechar quadro](https://support.atlassian.com/trello/docs/closing-a-board/) | fechamento e autorização |
| S16 | [Reabrir quadro](https://support.atlassian.com/trello/docs/reopening-a-closed-board/) | restauração de quadro |
| S17 | [Permissões do quadro](https://support.atlassian.com/trello/docs/changing-permissions-on-a-board/) | papéis e configurações |
| S18 | [Observadores](https://support.atlassian.com/trello/docs/adding-observers-to-boards/) | papel somente leitura |
| S19 | [Visibilidade](https://support.atlassian.com/trello/docs/changing-the-visibility-of-a-board/) | escopos de acesso |
| S20 | [Limites da API](https://developer.atlassian.com/cloud/trello/guides/rest-api/limits/) | limites devolvidos pelos modelos |
| S21 | [Ordenar cartões](https://support.atlassian.com/trello/docs/sorting-lists/) | ordenação em massa |
| S22 | [Datas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/) | início, prazo e conclusão |
| S23 | [Menu do quadro](https://support.atlassian.com/trello/docs/the-board-menu/) | feed de atividade |

## Limitações e cobertura

- [UNK] Não houve validação em conta, plano, navegador ou aplicativo em execução.
- [UNK] As páginas não constituem especificação completa de todas as regras internas.
- [API] Limites podem variar por quadro/conta, e clientes devem usar os valores retornados em vez de constantes. ([S20](https://developer.atlassian.com/cloud/trello/guides/rest-api/limits/))
- [DOC] Recursos e permissões podem depender do plano, como o papel de observador. ([S18](https://support.atlassian.com/trello/docs/adding-observers-to-boards/))

## Regra de manutenção

Ao adicionar uma afirmação, deve-se incluir marcador e link oficial na mesma linha ou no mesmo parágrafo. Evidência observacional futura deverá registrar data, ambiente, pré-condições, passos e resultado, sem credenciais ou dados pessoais.

