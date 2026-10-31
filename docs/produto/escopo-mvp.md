# Escopo do MVP do Bello

## Objetivo

Validar um Kanban colaborativo completo em que participantes organizam trabalho dentro de Workspaces, colaboram em cartões e consultam feed e auditoria como conceitos separados.

O escopo é funcional. Não determina arquitetura, stack, persistência ou infraestrutura.

## Requisitos essenciais

O MVP contém 28 requisitos essenciais:

| Grupo | Requisitos | Resultado esperado |
|---|---|---|
| estrutura | BEL-001–BEL-005 | Workspace → Quadro → Lista → Cartão íntegro e utilizável |
| ordenação e fluxo | BEL-006–BEL-008, BEL-010, BEL-011 | ordem concorrente consistente; cartão movido entre listas e quadros do mesmo Workspace |
| ciclo de vida | BEL-012–BEL-014 | cartões, listas e quadros arquiváveis/restauráveis |
| colaboração | BEL-021–BEL-024 | responsáveis, etiquetas, comentários e datas/conclusão |
| participantes e papéis | BEL-026–BEL-028, BEL-030 | participação explícita; Administrador, Membro e Observador; autorização de conteúdo e comentários |
| rastreabilidade | BEL-031, BEL-032 | feed de cartão/quadro e auditoria formal independente com retenção de 24 meses |
| Workspaces | BEL-034–BEL-036 | criação e edição, participantes, administrador mínimo e governança sem acesso automático ao conteúdo |
| visibilidade | BEL-029 | privado por padrão; descoberta controlada sem acesso implícito ao conteúdo |
| identidade | BEL-038 | contas administradas, login, verificação, recuperação, desativação e preservação histórica |

BEL-035, BEL-036 e BEL-038 são essenciais. Inicialização da primeira conta, Administração Global, criação de quadros, papéis do Workspace, fronteira governança/conteúdo e matriz mínima de auditoria estão aprovados. Permanece aberta apenas a aplicabilidade futura de convites pendentes em PEN-034; a inclusão direta do MVP está definida.

## Candidatos ao MVP

Não restam requisitos classificados como candidatos: BEL-014 foi aprovado como essencial por DEC-012.

## Funcionalidades posteriores

| Requisito | Funcionalidade |
|---|---|
| BEL-009 | ordenação em massa por critérios |
| BEL-016 | arquivamento em massa de cartões da lista |
| BEL-017 | cópia de cartão |
| BEL-018 | cópia de lista |
| BEL-019 | cópia de quadro |
| BEL-025 | checklists |
| BEL-033 | integrações e notificações externas |

## Funcionalidades que necessitam decisão

| Requisito | Decisão necessária |
|---|---|
| BEL-015 | exclusão permanente e recuperação — decisão futura |
| BEL-020 | matriz de preservação de cópias e movimento de listas — decisão futura; movimento de cartão resolvido por DEC-018 |
| BEL-037 | existência futura de convidado — decisão futura |

## Decisões aprovadas que governam o MVP

- DEC-001 — Kanban colaborativo completo.
- DEC-002 — Workspaces obrigatórios.
- DEC-003 — feed colaborativo e auditoria separados.
- DEC-004 — Administrador, Membro e Observador.
- DEC-005 — administração de Workspaces.
- DEC-006 — participação explícita em Workspace e quadro.
- DEC-007 — matriz de permissões do quadro.
- DEC-008 — governança administrativa sem acesso automático ao conteúdo.
- DEC-009 — feed colaborativo em níveis de cartão e quadro.
- DEC-010 — auditoria independente, acesso controlado e retenção de 24 meses.
- DEC-011 — datas opcionais e conclusão manual independente da lista.
- DEC-012 — arquivamento e restauração de quadros.
- DEC-013 — responsáveis múltiplos, elegíveis por participação e papel.
- DEC-014 — catálogo de etiquetas do Workspace, refinado por PEN-028 quanto à administração global.
- DEC-015 — comentários, remoção representada e versões restritas à auditoria.
- DEC-016 — ordenação concorrente consistente.
- DEC-017 — visibilidade privada padrão e descoberta controlada.
- DEC-018 — movimento de cartões entre quadros do mesmo Workspace.
- DEC-019 — governança e calendário de integrações externas.
- DEC-020 — identidade administrada, verificação e preservação histórica.
- DEC-021 — inclusão direta de participantes verificados e acompanhamento condicional de convites.

## Situação das decisões principais

DEC-001 a DEC-021 estão aprovadas. As pendências remanescentes são lacunas específicas, técnicas ou requisitos posteriores, não decisões principais em aberto.

## Critérios gerais de validação

Os critérios abaixo decorrem de decisões aprovadas:

- todo quadro criado está associado a um Workspace;
- somente Administradores Globais criam contas após a inicialização excepcional da primeira conta; não existe cadastro público;
- primeira conta Administrador Global é criada por inicialização controlada, autorizada, não repetível e rastreável;
- somente Administradores Globais criam, desativam, reativam contas e gerem a atribuição global;
- sempre existe ao menos um Administrador Global ativo e apto;
- login usa e-mail/senha; e-mail é único e verificado; recuperação ocorre por e-mail;
- conta possui identificador interno imutável e desativação preserva autoria/histórico;
- desativação é bloqueada quando o usuário for último Administrador ativo de Workspace/quadro sem sucessor;
- papel global não concede participação, conteúdo ou auditoria de conteúdo em Workspace/quadro;
- qualquer usuário autenticado, ativo e verificado pode criar Workspace e torna-se administrador inicial;
- Workspace possui nome obrigatório, descrição opcional e pelo menos um administrador;
- Workspace possui fuso regional de referência;
- exclusão permanente de Workspace não está disponível no MVP;
- Workspace e quadro possuem participações explícitas e separadas;
- participar de quadro exige vínculo com o Workspace, sem acesso implícito aos quadros por pertencer ao Workspace;
- remover participante do Workspace revoga seu acesso aos quadros e preserva comentários e histórico;
- inclusão de participante com conta verificada é direta, sem aceite; eventual convite pendente é separado e ainda depende de PEN-034;
- papéis do Workspace são Administrador e Membro, com promoção/rebaixamento confirmado e Administrador mínimo preservado;
- qualquer participante ativo/verificado do Workspace pode criar quadro e torna-se Administrador inicial por vínculo explícito;
- nome e descrição do quadro são obrigatórios e o quadro nasce privado;
- listas e cartões mantêm seus relacionamentos hierárquicos;
- listas e cartões podem ser reordenados manualmente por drag-and-drop;
- cartão pode ser movido entre listas do mesmo quadro;
- cartões e listas podem ser arquivados/restaurados preservando estados; posições anteriores são recuperadas quando válidas e restauração de cartão não restaura lista automaticamente;
- quadro arquivado sai dos ativos, permanece consultável por autorizados, bloqueia mutações e preserva listas, cartões, participantes e papéis;
- Administrador de Workspace arquiva/restaura por governança sem obter acesso operacional ao conteúdo;
- cartão pode possuir responsáveis, etiquetas, comentários e datas;
- cartão possui estado Pendente ou Concluído, alterado manualmente e independentemente da lista;
- concluir registra data/hora/usuário; reabrir preserva conclusões anteriores no histórico;
- cartão está atrasado somente quando Pendente e depois do vencimento;
- somente Administrador/Membro participantes podem ser responsáveis; perda de acesso remove atribuições automaticamente;
- catálogo de etiquetas pertence ao Workspace e somente seu Administrador o cria/edita/exclui; colaboradores de quadro aplicam/removem sem ampliar acesso;
- comentário removido/moderado permanece indicado sem conteúdo visível; moderação não reescreve nem restaura no MVP e exige justificativa auditada;
- versões anteriores de comentários ficam somente na auditoria autorizada, não no feed;
- Administrador, Membro e Observador são papéis distintos;
- Administrador e Membro podem modificar conteúdo; Observador permanece somente leitura, inclusive por API;
- Administrador do quadro gerencia configurações, participantes e papéis e consulta auditoria;
- Membro não administra configurações/participantes e não consulta auditoria;
- Observador não comenta, não administra e não consulta auditoria; não é tratado como convidado;
- todo Workspace e todo quadro mantêm pelo menos um administrador;
- administração de Workspace e governança de quadro não concedem acesso automático ao conteúdo; a lista fechada de governança cobre nome, descrição básica, visibilidade, participantes, papéis, arquivamento e restauração;
- autorização efetiva considera o escopo da operação e é validada independentemente da interface;
- alterações de participantes/papéis e ações administrativas do Workspace sobre quadros geram auditoria;
- autoconcessão de participação por Administrador de Workspace é explícita, autorizada e auditada;
- feed do cartão mostra apenas o cartão e feed do quadro consolida listas, cartões e participantes;
- itens do feed identificam autor, data, operação e objeto relacionado, em ordem cronológica decrescente;
- Administrador, Membro e Observador com acesso consultam o feed; usuários sem acesso ao conteúdo não consultam;
- reordenações repetitivas podem ser resumidas no feed sem eliminar eventos obrigatórios da auditoria;
- toda mutação relevante efetivada e acesso negado geram auditoria conforme DEC-010;
- Administrador de quadro consulta auditoria do quadro; Membro e Observador não consultam;
- Administrador de Workspace sem participação consulta apenas eventos administrativos, não conteúdo privado;
- auditoria é preservada por 24 meses, consultável com filtros/navegação progressiva, não é editável/exportável no MVP e correções geram novos eventos;
- valores auditados seguem matriz mínima por entidade/operação/campo/sensibilidade; apresentação reavalia acesso e redige/omite campos protegidos;
- login, falha de login, recuperação de senha e alteração de e-mail são auditados sem segredos recuperáveis;
- títulos, descrições e comentários preservam versões anteriores/novas somente na auditoria de conteúdo autorizada;
- movimentos/reordenações auditam item, origem, destino e posição relativa, sem snapshot completo da ordem do quadro;
- auditoria não armazena senhas, tokens, credenciais ou outros segredos;
- feed colaborativo e auditoria são apresentados como conceitos distintos e independentes;
- feed é preservado pela vida útil da entidade, sem expiração por idade, e permanece independente da retenção de 24 meses da auditoria;
- ordem concorrente é consistente, refletida sem recarga, preserva operações independentes e não duplica/perde cartões;
- conflito no mesmo item usa a última operação confirmada; rejeição corrige a interface e informa o usuário;
- Workspaces e quadros nascem privados; visibilidade no Workspace revela apenas nome/descrição a não participantes;
- conhecer URL/identificador não concede acesso; visibilidade pública/anônima fica fora do MVP;
- movimento entre quadros exige escrita em origem/destino ativos do mesmo Workspace;
- movimento preserva identidade, conteúdo, datas, conclusão, comentários, histórico e etiquetas;
- responsáveis incompatíveis são removidos somente após informação e confirmação; cancelar impede o movimento;
- histórico movido continua sujeito a autorização atual por contexto; evento restrito vira marcador genérico e não amplia acesso à origem;
- comentários atuais acompanham cartão movido, enquanto versões históricas permanecem na auditoria autorizada;
- datas de cartão são civis no calendário/fuso regional do Workspace; vencimento ocorre ao final do dia e mudança de fuso preserva data civil/instantes históricos;
- limites e obrigatoriedade de Workspace, quadro, lista, cartão, comentário e etiqueta seguem RN-107–RN-109;
- integrações externas obedecem às mesmas autorizações, possuem identidade, geram auditoria/feed aplicável e protegem segredos;
- API externa é pós-MVP e webhooks pertencem à segunda entrega;
- nenhuma regra ainda pendente é simulada como se estivesse aprovada.

Lacunas residuais serão acrescentadas somente após decisões específicas. Pendências técnicas de auditoria, sincronização e integrações não autorizam escolha de solução nesta especificação.

## Fora do escopo desta especificação

- decisões técnicas ou arquiteturais;
- banco de dados, tabelas ou migrations;
- protocolos de integração;
- escolha de tecnologia;
- equivalência integral com o Trello;
- regras comerciais ou planos;
- estratégia técnica de armazenamento, consistência, proteção contra adulteração, expiração, falhas e desempenho da auditoria.

## Rastreabilidade

- requisitos: [requisitos-funcionais.md](requisitos-funcionais.md);
- regras: [regras-de-negocio.md](regras-de-negocio.md);
- decisões: [decisoes-funcionais.md](decisoes-funcionais.md);
- origem: [reverse-engineering/docs](../../reverse-engineering/docs/00-index.md).

