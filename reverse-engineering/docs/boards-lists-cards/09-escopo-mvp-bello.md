# Escopo preliminar do MVP Bello

## Status

Este documento é uma **recomendação de produto para validação**, não decisão arquitetural nem compromisso de entrega. Não escolhe stack, banco, algoritmo de ordenação ou modelo de eventos.

## Resultado que o MVP deve validar

Permitir que um pequeno grupo organize trabalho num quadro por listas e cartões, altere a ordem e o estado do trabalho e compreenda quem pode modificar o conteúdo.

## Núcleo candidato

| Capacidade | Motivo | Referência funcional |
|---|---|---|
| criar/consultar/renomear quadro | estabelece o espaço de trabalho | B01–B03 |
| criar/consultar/renomear/reordenar listas | estabelece o fluxo | L01–L04 |
| criar/consultar/editar/reordenar cartões | representa e prioriza trabalho | C01–C04 |
| mover cartão entre listas | atualiza estado de fluxo | C05 |
| arquivar e restaurar cartão/lista | remove sem perda imediata | C07–C08, L05–L06 |
| controle mínimo de membros e edição | colaboração segura | P01, P04 |
| atividade mínima de mutações essenciais | compreensão e suporte | H01, com contrato próprio do Bello |

## Candidatos fortes à primeira entrega, ainda não decididos

Responsáveis, etiquetas, comentários e prazos **não estão excluídos**. Devem ser avaliados como um pacote de utilidade cotidiana:

| Capacidade | Valor potencial | Custo/regra a validar |
|---|---|---|
| responsáveis (C13) | ownership do trabalho | associação, remoção e notificações |
| etiquetas (C14) | classificação visual | escopo por quadro e cópia/movimento |
| comentários (C15) | colaboração contextual | permissão, edição, histórico e moderação |
| datas e conclusão (C11–C12) | compromisso/priorização | fuso, lembretes, estado vencido/concluído |

Recomendação: testar duas variantes de protótipo — núcleo puro e núcleo com esse pacote — antes de congelar o MVP.

## Candidatos a etapa posterior

Esta lista também é preliminar:

- cópia de quadro/lista e matriz configurável de cópia (B06, L08);
- movimento entre quadros e restrições organizacionais (C06, L07);
- exclusão permanente e em cascata, até definir retenção (B05, C09 e exclusão de lista);
- checklists completos (C16), anexos, capas, votação e campos personalizados;
- observadores e matriz avançada de visibilidade/comentários (P02–P03);
- webhooks e integrações externas (H02);
- ordenação em massa por critérios, automações e visualizações avançadas.

“Posterior” significa menor prioridade inicial para validação, não exclusão do produto.

## Regras que o MVP não deve deixar implícitas

1. Uma lista pertence a exatamente um quadro ativo no contexto funcional; um cartão pertence a uma lista.
2. Ordem manual de listas e cartões é persistida, mas o algoritmo permanece em aberto.
3. Arquivar/restaurar é diferente de excluir; exclusão deve exigir autorização e confirmação.
4. Arquivar contêiner não precisa alterar o estado individual dos descendentes; a semântica deve ser escolhida e documentada.
5. Mover e copiar têm identidades e regras de preservação diferentes.
6. Toda mutação essencial deve identificar ator/sistema, instante, entidade e operação; anterior/posterior são opcionais por contrato, não presumidos.
7. A autorização deve ser verificada por operação e recurso, mesmo que a interface esconda o comando.

## Critérios de validação sugeridos

- Usuário cria quadro, listas e cartões e entende a hierarquia sem instrução externa.
- Reordenar e mover produz resultado previsível, inclusive após recarregar e em tentativa concorrente.
- Arquivar e restaurar não causa perda inesperada de conteúdo/relações.
- Permissões impedem escrita não autorizada e explicam por que uma ação está indisponível.
- Histórico mínimo responde “quem fez o quê e quando”; quando anterior/posterior não existir, a UI não inventa o dado.
- Usuários indicam se responsáveis, etiquetas, comentários e prazos são indispensáveis à primeira entrega.

## Decisões deliberadamente adiadas

- algoritmo de posição e política de conflitos;
- armazenamento, event sourcing, filas e formato físico do histórico;
- arquitetura, stack e infraestrutura;
- retenção de exclusões e conformidade;
- escopo definitivo da primeira entrega;
- paridade visual ou funcional total com Trello.

## Riscos do recorte

- Um núcleo sem comentários/responsáveis/prazos pode validar organização, mas não colaboração real.
- Implementar exclusão antes da política de retenção cria risco irreversível.
- Tratar feed como auditoria pode produzir lacunas silenciosas.
- Copiar o comportamento aparente de `pos` sem requisito de concorrência pode fixar prematuramente uma solução inadequada.

