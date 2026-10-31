# Questões em aberto

## Priorização

`Alta` afeta semântica do núcleo/MVP; `Média` afeta fidelidade ou evolução; `Baixa` pode aguardar áreas posteriores.

| ID | Prioridade | Classificação | Questão | Evidência necessária |
|---|---|---|---|---|
| Q01 | Alta | UNK | Qual é a semântica desejada de ordenação concorrente no Bello? | pesquisa de uso e testes de cenários; não depende de copiar Trello |
| Q02 | Média | UNK | Quando e como o Trello renumera/compacta `pos`? | documentação oficial adicional ou observação autorizada; não necessária para escolher Bello agora |
| Q03 | Alta | UNK | Quais campos anterior/posterior precisam existir no histórico do Bello? | requisitos de auditoria e privacidade |
| Q04 | Alta | UNK | Qual retenção e restaurabilidade deve existir após exclusão? | requisitos legais/produto e análise de risco |
| Q05 | Alta | UNK | Responsáveis, etiquetas, comentários e prazos entram na primeira entrega? | protótipo/teste com usuários e priorização de produto |
| Q06 | Alta | UNK | Qual matriz mínima de papéis e operações atende o Bello? | personas, modelo de colaboração e segurança |
| Q07 | Média | UNK | Restauração recupera a posição anterior no Trello em todos os casos? | DOC adicional ou OBS controlada |
| Q08 | Média | UNK | IDs/links permanecem iguais em todo movimento entre quadros? | API oficial explícita ou OBS autorizada |
| Q09 | Média | UNK | Como etiquetas são reconciliadas ao mover/copiar entre quadros? | DOC/API específica e cenários controlados |
| Q10 | Média | UNK | Qual é a matriz completa de preservação de cópia de cartão por interface/plano? | DOC adicional e OBS autorizada |
| Q11 | Média | UNK | Quais ações continuam acessíveis após exclusão de entidade e por quanto tempo? | garantia oficial de retenção; não inferir por amostra |
| Q12 | Média | UNK | Há ordenação total garantida entre ações ou apenas ordem de consulta? | contrato oficial de consistência/paginação |
| Q13 | Média | UNK | Como conflitos de edição/movimento simultâneo aparecem ao usuário? | observação multiusuário autorizada ou documentação |
| Q14 | Média | UNK | Quais limites efetivos o produto deve impor? | telemetria futura e requisitos; API manda ler limites retornados |
| Q15 | Baixa | UNK | Quais recursos condicionais por plano precisam de equivalente? | definição comercial do Bello |
| Q16 | Média | UNK | Exclusão de lista tem equivalente direto e documentado na API pública? | confirmação oficial; a referência de listas consultada não mostra DELETE direto |
| Q17 | Alta | UNK | Feed colaborativo e auditoria serão um ou dois produtos no Bello? | requisitos de acesso, retenção e integridade |
| Q18 | Alta | UNK | O MVP precisa de cópia e movimento entre quadros ou apenas dentro do quadro? | validação de fluxos essenciais |

## Inconsistências e limites encontrados

### Histórico não equivale a todas as mudanças

- [API] Alguns tipos enviados a webhook não aparecem nos recursos aninhados de ações. ([Action Types](https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/))
- [API] Algumas mudanças atualizam `dateLastActivity` sem criar ação. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/))
- Consequência: [INF] nem feed nem timestamp isolado permitem reconstrução completa.

### Arquivamento de contêiner não é cascata de estado

- [API] Um cartão pode ter `closed: false` estando em lista/quadro arquivado. ([Object Definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/))
- Consequência: [INF] “visível/ativo” depende do cartão e de seus ancestrais.

### Mover preserva conteúdo, não histórico no destino

- [DOC] Descrição, checklists, anexos e comentários são preservados em movimento entre quadros, mas atividade não. ([Mover](https://support.atlassian.com/trello/docs/moving-cards-or-lists/))
- Questão: [UNK] onde e por quanto tempo a atividade anterior permanece consultável.

### UI e API não são perfeitamente simétricas

- [DOC] A UI documenta excluir lista após arquivamento. ([Arquivar listas](https://support.atlassian.com/trello/docs/archiving-lists-deleting-lists/))
- [API] A referência de listas consultada documenta arquivar, mover e atualizar, mas não foi encontrada operação direta de exclusão de lista. ([Lists API](https://developer.atlassian.com/cloud/trello/rest/api-group-lists/))
- Consequência: [UNK] não presumir que toda ação da UI tenha endpoint público equivalente.

## Investigações futuras seguras

1. Revisar documentação oficial por tema, registrando data e versão da página.
2. Criar roteiros OBS sem dados pessoais para ordenação, restauração, concorrência e matriz de cópia, somente se autorizados.
3. Comparar resultados observados com DOC/API sem acessar implementação proprietária.
4. Converter decisões do Bello em ADRs apenas após validação; nenhuma decisão arquitetural é tomada aqui.

