# Levantamento funcional do Trello para o Bello

## Escopo

Esta documentação descreve quadros, listas e cartões a partir de documentação pública oficial do Trello. Ela é uma especificação funcional de reconstrução limpa: não reproduz código proprietário, não resulta de chamadas autenticadas e não pretende revelar a implementação interna do Trello.

Versão do levantamento: 2026-10-30.

## Classificação das afirmações

- **DOC** — comportamento declarado pela documentação oficial de uso.
- **API** — contrato exposto pela documentação oficial da API pública.
- **OBS** — comportamento observado diretamente em cenário controlado e documentado.
- **INF** — inferência apoiada em evidência, mas não confirmada pela fonte.
- **UNK** — questão desconhecida ou evidência insuficiente.

Não foram coletadas evidências **OBS** nesta fase. Uma afirmação sem marcador não deve ser interpretada como comportamento do Trello; em particular, textos sob “Bello” são recomendações preliminares.

## Documentos

1. [Metodologia e evidências](01-metodologia-e-evidencias.md)
2. [Visão geral](boards-lists-cards/00-visao-geral.md)
3. [Quadros](boards-lists-cards/01-quadros.md)
4. [Listas](boards-lists-cards/02-listas.md)
5. [Cartões](boards-lists-cards/03-cartoes.md)
6. [Relacionamentos e ciclo de vida](boards-lists-cards/04-relacionamentos-e-ciclo-de-vida.md)
7. [Eventos e histórico](boards-lists-cards/05-eventos-e-historico.md)
8. [Permissões e restrições](boards-lists-cards/06-permissoes-e-restricoes.md)
9. [Matriz de API e comportamentos](boards-lists-cards/07-matriz-api-e-comportamentos.md)
10. [Questões em aberto](boards-lists-cards/08-questoes-em-aberto.md)
11. [Escopo preliminar do MVP Bello](boards-lists-cards/09-escopo-mvp-bello.md)

## Resultado resumido

Foram catalogadas **40 funcionalidades** rastreáveis na matriz: 9 de quadros, 9 de listas, 16 de cartões, 2 de histórico e 4 de permissões. A contagem representa capacidades funcionais, não telas, endpoints ou histórias de usuário.

### Fatos comprovados do Trello

- [DOC] Um quadro contém listas, e listas contêm cartões. ([Criar um quadro](https://support.atlassian.com/trello/docs/creating-a-new-board/))
- [API] Quadro, lista e cartão são recursos relacionados e consultáveis por rotas próprias e aninhadas. ([Introdução à API](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/), [recursos aninhados](https://developer.atlassian.com/cloud/trello/guides/rest-api/nested-resources/))
- [DOC] Arquivamento/fechamento é reversível; exclusão é permanente nas interfaces documentadas. Cópia e movimentação entre quadros têm regras explícitas de preservação. ([Cartões](https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/), [listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/), [quadros](https://support.atlassian.com/trello/docs/closing-a-board/), [cópia](https://support.atlassian.com/trello/docs/copying-cards-lists-or-boards/))
- [API] O histórico público é composto por objetos `Action`, mas não é uma trilha de auditoria completa. ([Definições](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/), [tipos de ação](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/))

### Hipóteses não confirmadas

- [UNK] A estratégia interna usada para gerar ou compactar valores numéricos de `pos` não é descrita nas fontes consultadas.
- [UNK] Não está estabelecido que toda mudança relevante preserve valores anterior e posterior.
- [UNK] Retenção, imutabilidade e completude histórica internas não são especificadas pela API pública.

### Recomendações preliminares para o Bello

- Tratar ciclo de vida, autorização, ordenação e histórico como domínios explícitos.
- Manter o MVP como hipótese de produto; responsáveis, etiquetas, comentários e prazos continuam candidatos à primeira entrega.
- Adiar decisões de persistência, arquitetura e stack até validar os fluxos essenciais com usuários.

