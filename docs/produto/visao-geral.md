# Visão geral do produto Bello

## Propósito

O Bello é um produto de organização colaborativa de trabalho em formato Kanban. O MVP deverá permitir que pessoas organizem e acompanhem trabalho por meio de Workspaces, quadros, listas e cartões, com colaboração contextual e rastreabilidade funcional.

Este documento registra a visão funcional aprovada. Ele não define arquitetura, tecnologia, persistência ou implementação.

## Estrutura funcional

```text
Workspace
└── Quadro
    └── Lista ordenada
        └── Cartão ordenado
```

- Todo quadro deve estar associado a um Workspace.
- Uma lista pertence a um quadro.
- Um cartão pertence a uma lista.
- Workspaces fazem parte do MVP, com participação explícita, administrador mínimo e governança separada do acesso ao conteúdo.

Origem: [DEC-002](decisoes-funcionais.md#dec-002--workspaces-obrigatórios) e requisitos [BEL-002](requisitos-funcionais.md#bel-002) e [BEL-005](requisitos-funcionais.md#bel-005).

## Capacidades do MVP

O escopo aprovado inclui:

- identidade administrada, login por e-mail/senha, verificação e recuperação por e-mail;
- criação, consulta e edição de Workspaces, quadros, listas e cartões;
- ordenação manual de listas e cartões por drag-and-drop;
- movimentação de cartões entre listas do mesmo quadro;
- movimentação de cartões entre quadros ativos do mesmo Workspace;
- ordenação concorrente consistente, refletida sem recarregamento manual;
- arquivamento e restauração de cartões, listas e quadros;
- visibilidade privada padrão e descoberta controlada no Workspace;
- responsáveis por cartão;
- etiquetas;
- comentários;
- datas de início, vencimento e conclusão;
- participantes e os papéis Administrador, Membro e Observador;
- moderação de comentários por remoção confirmada e rastreável, sem reescrita;
- feed colaborativo;
- auditoria separada do feed.

O escopo detalhado e suas exceções estão em [escopo-mvp.md](escopo-mvp.md).

## Conceitos

### Identidade

Conta criada somente por Administrador Global, sem cadastro público. Em instalação nova, a primeira conta global surge por inicialização controlada, autorizada, não repetível e auditável. O acesso protegido exige conta ativa, e-mail único/verificado e login por e-mail/senha. Cada usuário mantém identificador interno imutável; desativação preserva autoria, comentários e histórico.

### Administrador Global

Papel da plataforma independente dos papéis de Workspace e quadro. Pode administrar contas e atribuições globais, mas não recebe participação, conteúdo ou auditoria de conteúdo por herança. Deve existir ao menos um Administrador Global ativo; desativar usuário que seja último Administrador de Workspace/quadro exige sucessor, sem revelar conteúdo privado.

### Workspace

Contêiner funcional obrigatório dos quadros. Qualquer usuário autenticado, ativo e verificado pode criá-lo e torna-se administrador inicial. Nome é obrigatório, descrição é opcional e administradores editam essas informações. O Workspace mantém ao menos um administrador, possui fuso regional de referência e não admite exclusão permanente no MVP.

### Quadro

Espaço de organização do trabalho dentro de um Workspace. Nome e descrição são obrigatórios. Qualquer participante ativo/verificado do Workspace pode criá-lo, tornando-se Administrador inicial por participação explícita; o quadro nasce privado.

### Lista

Contêiner ordenado de cartões dentro de um quadro. Representa uma etapa, agrupamento ou estado definido pelos usuários do Workspace.

### Cartão

Unidade de trabalho pertencente a uma lista. Pode possuir conteúdo, posição, responsáveis, etiquetas, comentários e datas.

### Participante

Pessoa associada explicitamente a um Workspace ou quadro. Participar de quadro exige vínculo com o Workspace, mas o vínculo com o Workspace não concede acesso automático aos quadros.

### Papel

Conjunto funcional de permissões atribuído em um escopo. Papéis de Workspace e quadro são separados. No quadro, o MVP possui Administrador, Membro e Observador, com matriz aprovada por DEC-007.

### Responsável

Participante do quadro com papel Administrador ou Membro associado a um cartão para representar responsabilidade. Um cartão pode ter zero ou múltiplos responsáveis. Perder acesso remove automaticamente as atribuições, preservando feed, auditoria, comentários e histórico.

### Datas e conclusão

Início e vencimento são datas civis opcionais no calendário do Workspace e, quando coexistem, vencimento não antecede início. O vencimento ocorre ao final do dia no fuso regional do Workspace. Todo cartão está Pendente ou Concluído; conclusão é manual e reabertura preserva o histórico. Atraso existe somente após o vencimento e enquanto Pendente.

### Etiqueta

Classificação pertencente ao Workspace, com nome obrigatório e cor opcional. Nomes são únicos no Workspace ignorando maiúsculas/minúsculas. Somente Administradores do Workspace administram o catálogo global; colaboradores do quadro aplicam/removem etiquetas nos cartões autorizados. O compartilhamento não concede acesso a cartões.

### Comentário

Conteúdo colaborativo de um cartão, com autor e data de criação. Edição própria mostra “Editado”; remoção mantém indicação sem conteúdo visível. Administrador de quadro modera terceiros removendo a visualização após confirmação e justificativa, sem reescrever ou restaurar no MVP. Versões anteriores ficam restritas à auditoria autorizada.

### Feed colaborativo

Apresentação de interações e alterações relevantes para colaboração, em ordem cronológica decrescente. Existe no nível do cartão, restrito àquele cartão, e do quadro, consolidando quadro, listas, cartões e participantes. Cada atividade identifica autor, data, operação e objeto relacionado. Administrador, Membro e Observador com acesso ao quadro podem consultar; quem não acessa o conteúdo não acessa o feed.

Eventos permanecem durante a vida útil da entidade, com navegação progressiva e filtro simples por tipo. Reordenações repetitivas podem ser resumidas visualmente sem eliminar auditoria. O feed reavalia acesso, usa marcadores genéricos para contexto histórico restrito e não expõe dados exclusivos da auditoria.

### Auditoria

Rastreabilidade formal e independente do feed. Toda mutação relevante efetivada e toda tentativa de acesso negada produzem registro com contexto funcional aprovado. Registros são preservados por 24 meses, não são editáveis por usuários comuns e correções geram novos eventos.

Administrador de quadro consulta a auditoria de seu quadro. Administrador de Workspace consulta eventos administrativos, mas não conteúdo privado sem participação e papel adequados; Administrador Global tampouco herda auditoria de conteúdo. A consulta é cronológica, filtrável e navegável até 24 meses. A matriz mínima define valores por entidade/operação/sensibilidade, preserva versões protegidas e audita autenticação sem senhas, tokens, códigos de recuperação ou segredos recuperáveis.

## Modelo de participação e governança

- Um usuário pode participar de múltiplos Workspaces.
- Workspace e quadro mantêm relações próprias de participantes.
- Participação no quadro exige participação no Workspace correspondente.
- Pertencer ao Workspace não concede acesso automático a quadros ou cartões.
- Administradores do Workspace gerenciam participantes do Workspace e a governança dos quadros vinculados.
- Administradores de quadro gerenciam participantes do quadro, desde que já pertençam ao Workspace.
- Remover participante do Workspace revoga acesso aos quadros vinculados, preservando comentários e histórico.
- Administração do Workspace ou do quadro não substitui participação explícita para acesso ao conteúdo.
- Os papéis do Workspace são Administrador e Membro; promoções/rebaixamentos são confirmados e não alteram papéis dos quadros.
- Inclusão de conta verificada é direta, sem aceite; a aplicabilidade de eventual convite pendente permanece delimitada em PEN-034.
- A governança sem participação limita-se a nome, descrição básica, visibilidade, participantes, papéis, arquivamento e restauração.
- Administração Global, administração de Workspace e papéis de quadro são independentes.
- Desativação de conta é bloqueada enquanto faltar sucessor ativo para qualquer último papel administrativo do usuário.

## Papéis do quadro

| Papel | Leitura | Conteúdo | Administração | Comentários | Auditoria |
|---|---|---|---|---|---|
| Administrador | quadro, listas, cartões e feed | cria, edita, move, ordena, arquiva, restaura; gerencia responsáveis/datas e aplica etiquetas | configurações, participantes e papéis | próprios; modera terceiros | consulta |
| Membro | quadro, listas, cartões e feed | cria, edita, move, ordena, arquiva, restaura; gerencia responsáveis/datas e aplica etiquetas | não administra | próprios | não consulta |
| Observador | quadro, listas, cartões e feed | somente leitura | não administra | não comenta | não consulta |

As mesmas restrições de autorização se aplicam a operações diretas por API, independentemente da interface.

## Princípios funcionais aprovados

1. O MVP é um Kanban colaborativo completo, conforme DEC-001.
2. Workspaces são obrigatórios, conforme DEC-002.
3. Feed colaborativo e auditoria são conceitos independentes, conforme DEC-003.
4. Administrador, Membro e Observador são os três papéis iniciais, conforme DEC-004.
5. Observador não deve ser confundido com convidado.
6. Administração de Workspaces segue DEC-005.
7. Participação em Workspace e quadro é explícita e separada, conforme DEC-006.
8. Permissões de quadro seguem DEC-007.
9. Governança administrativa não concede acesso automático ao conteúdo, conforme DEC-008.
10. Feed do cartão e feed do quadro seguem cobertura, acesso e apresentação de DEC-009.
11. Auditoria independente, acesso controlado e retenção de 24 meses seguem DEC-010.
12. Datas e conclusão manual seguem DEC-011, sem conclusão automática por movimento.
13. Arquivamento reversível de quadros segue DEC-012 sem alterar estados internos.
14. Responsáveis múltiplos e elegíveis seguem DEC-013.
15. Catálogo de etiquetas pertence ao Workspace; PEN-028 refinou DEC-014 e reservou sua administração global ao Administrador do Workspace.
16. Comentários, tombstone e versões auditadas seguem DEC-015.
17. Ordenação concorrente consistente segue DEC-016 sem fixar algoritmo ou protocolo.
18. Visibilidade privada padrão e descoberta sem acesso implícito seguem DEC-017.
19. Movimento de cartões entre quadros do mesmo Workspace segue DEC-018, preservando identidade e histórico com autorização por evento.
20. Integrações externas seguem DEC-019 e permanecem fora da implementação do MVP conforme o calendário aprovado.
21. Identidade administrada, sem cadastro público, segue DEC-020 e BEL-038.
22. Inclusão direta de participantes verificados e acompanhamento condicional de convites seguem DEC-021.
23. PEN-035/PEN-036 definem inicialização e continuidade da Administração Global sem acesso automático a conteúdo.
24. PEN-037 define a matriz funcional mínima de auditoria, mantendo acesso e armazenamento como conceitos distintos.
25. BEL-035 e BEL-036 integram o MVP; suas regras principais estão aprovadas, com lacunas residuais explícitas.
26. Uma pendência não constitui regra aprovada.

## Fronteiras atuais

Não estão aprovados para o MVP:

- cópia de cartões, listas ou quadros;
- movimento de listas entre quadros;
- exclusão permanente;
- checklists;
- ordenação automática ou em massa;
- API de integração externa, prevista para depois do MVP;
- webhooks, previstos para a segunda entrega;
- conectores, automações e importação do Trello, posteriores ou ainda em avaliação;
- suporte a convidado;
- visibilidade pública e acesso anônimo.

## Rastreabilidade

O levantamento de origem está preservado, sem alterações, em:

- [índice da engenharia reversa](../../reverse-engineering/docs/00-index.md);
- [matriz de comportamentos](../../reverse-engineering/docs/boards-lists-cards/07-matriz-api-e-comportamentos.md);
- [questões em aberto](../../reverse-engineering/docs/boards-lists-cards/08-questoes-em-aberto.md);
- [MVP preliminar anterior](../../reverse-engineering/docs/boards-lists-cards/09-escopo-mvp-bello.md).

As evidências do Trello são contexto e referência. As decisões funcionais do Bello estão registradas em [decisoes-funcionais.md](decisoes-funcionais.md).

