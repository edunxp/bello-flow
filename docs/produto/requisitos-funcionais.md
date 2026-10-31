# Requisitos funcionais do Bello

## Convenções

Classificações:

- **Essencial para o MVP**
- **Candidato ao MVP**
- **Posterior**
- **Necessita decisão**

Rastreabilidade da origem:

- [ER-MAT](../../reverse-engineering/docs/boards-lists-cards/07-matriz-api-e-comportamentos.md): matriz funcional derivada do Trello;
- [ER-REL](../../reverse-engineering/docs/boards-lists-cards/04-relacionamentos-e-ciclo-de-vida.md): relações e ciclo de vida;
- [ER-HIST](../../reverse-engineering/docs/boards-lists-cards/05-eventos-e-historico.md): eventos e histórico;
- [ER-PERM](../../reverse-engineering/docs/boards-lists-cards/06-permissoes-e-restricoes.md): permissões;
- [ER-OPEN](../../reverse-engineering/docs/boards-lists-cards/08-questoes-em-aberto.md): lacunas da investigação;
- DEC: decisão registrada em [decisoes-funcionais.md](decisoes-funcionais.md);
- RN: regra aprovada em [regras-de-negocio.md](regras-de-negocio.md).

Um critério marcado como parcial não resolve as pendências associadas.
RN-010 aplica-se a todo o catálogo: pendências não constituem regras aprovadas.

## Identidade

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-038 | Administrar identidade, autenticação, verificação, recuperação e desativação de contas | **Essencial para o MVP** | Administrador Global ou inicialização controlada | RN-069–RN-072, RN-096, RN-116–RN-129 | DEC-020; resoluções de PEN-035–PEN-037 | nenhuma quanto ao núcleo funcional aprovado | primeira administração por inicialização controlada; depois só Administradores Globais gerem contas; sem cadastro público; continuidade global/recursos protegida; autenticação e mudanças de conta auditadas sem segredos |

## Estrutura e Workspaces

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-001 | Criar, consultar e editar nome e descrição de quadro dentro de um Workspace | **Essencial para o MVP** | BEL-002, BEL-034, BEL-036, BEL-038 | RN-001–RN-003, RN-017, RN-024, RN-054–RN-056, RN-060–RN-062, RN-077–RN-079, RN-083–RN-085, RN-107–RN-109 | ER-MAT B01–B03; DEC-001, DEC-002, DEC-007, DEC-008, DEC-012, DEC-017, DEC-020 | nenhuma quanto ao núcleo aprovado | participante ativo/verificado cria no Workspace, torna-se Administrador explícito; nome/descrição obrigatórios até 100/2.000; quadro nasce privado; governança segue lista fechada sem conteúdo |
| BEL-002 | Tornar Workspace obrigatório e manter a hierarquia Workspace → Quadro → Lista → Cartão | **Essencial para o MVP** | BEL-034 | RN-001, RN-002, RN-011, RN-014 | DEC-002, DEC-005, DEC-006 | nenhuma quanto à hierarquia | toda criação de quadro exige associação a Workspace; participação no quadro exige vínculo com esse Workspace |
| BEL-003 | Criar, consultar e renomear listas dentro de um quadro | **Essencial para o MVP** | BEL-001, BEL-027, BEL-028 | RN-001, RN-003, RN-017–RN-019, RN-022, RN-107–RN-109 | ER-MAT L01–L03; DEC-001, DEC-007 | nenhuma quanto ao núcleo aprovado | nome obrigatório até 100 caracteres, Unicode e repetível; Administrador/Membro criam e renomeiam; Observador visualiza |
| BEL-004 | Criar, consultar e editar título e conteúdo básico de cartões | **Essencial para o MVP** | BEL-003, BEL-027, BEL-028 | RN-001, RN-003, RN-017–RN-019, RN-022, RN-107–RN-109 | ER-MAT C01–C03; DEC-001, DEC-007 | nenhuma quanto ao núcleo aprovado | título obrigatório até 200 e descrição opcional até 20.000; Administrador/Membro criam/editam, Observador visualiza |
| BEL-005 | Garantir integridade da hierarquia Workspace → Quadro → Lista → Cartão | **Essencial para o MVP** | BEL-002–BEL-004 | RN-001, RN-002 | ER-REL; DEC-002 | comportamento de transferência entre pais depende de BEL-011/BEL-020 | quadro possui Workspace; lista possui quadro; cartão possui lista |
| BEL-034 | Criar, consultar e editar os dados básicos de um Workspace | **Essencial para o MVP** | BEL-038 | RN-001, RN-009, RN-011–RN-013, RN-098, RN-107–RN-109 | DEC-002, DEC-005, DEC-020 | nenhuma quanto ao núcleo aprovado | conta ativa/verificada cria Workspace; nome obrigatório até 100, descrição opcional até 2.000; criador é Administrador inicial; Workspace possui fuso regional; exclusão permanente não disponível |
| BEL-035 | Administrar participantes de um Workspace | **Essencial para o MVP** | BEL-034, BEL-038 | RN-009, RN-012, RN-014–RN-016, RN-024, RN-025, RN-073–RN-076, RN-080–RN-082, RN-117, RN-123–RN-125 | DEC-002, DEC-005, DEC-006, DEC-008, DEC-020, DEC-021 | aplicabilidade de convite pendente em PEN-034 | inclusão direta de conta verificada; papéis Administrador/Membro; último Administrador protegido; desativação exige sucessor ativo sem revelar conteúdo |
| BEL-036 | Definir e aplicar a relação de permissões entre Workspace e quadro | **Essencial para o MVP** | BEL-034, BEL-035, BEL-038 | RN-007, RN-009, RN-014, RN-022–RN-025, RN-028, RN-035, RN-073–RN-097, RN-117, RN-123–RN-129 | DEC-002, DEC-004–DEC-010, DEC-020, DEC-021 | nenhuma quanto à fronteira aprovada; integrações futuras seguem PEN-032 | papéis globais/Workspace/quadro são independentes; governança não concede conteúdo; Administrador Global não acessa conteúdo/auditoria de conteúdo por herança |

## Ordenação e movimentação

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-006 | Manter ordem manual persistente das listas, com drag-and-drop | **Essencial para o MVP** | BEL-003, BEL-027, BEL-028 | RN-003, RN-004, RN-017–RN-019, RN-022, RN-057–RN-059, RN-130 | ER-MAT L04; DEC-001, DEC-007, DEC-016 | mecanismo técnico de sincronização não definido | ordem consistente/refletida sem recarga; auditoria registra item/origem/destino/posição relativa, sem snapshot integral |
| BEL-007 | Manter ordem manual persistente dos cartões, com drag-and-drop | **Essencial para o MVP** | BEL-004, BEL-027, BEL-028 | RN-003, RN-004, RN-017–RN-019, RN-022, RN-057–RN-059, RN-130 | ER-MAT C04; DEC-001, DEC-007, DEC-016 | mecanismo técnico de sincronização não definido | ordem consistente, sem duplicação/perda; auditoria registra posição relativa relevante, sem snapshot integral |
| BEL-008 | Mover cartão entre listas do mesmo quadro | **Essencial para o MVP** | BEL-003, BEL-004, BEL-007, BEL-027, BEL-028 | RN-003, RN-004, RN-017–RN-019, RN-022, RN-040, RN-057–RN-059, RN-130 | ER-MAT C05; DEC-001, DEC-007, DEC-011, DEC-016 | mecanismo técnico de sincronização não definido | movimento preserva conclusão, não duplica/perde e audita item, origem, destino, posição relativa e resultado |
| BEL-009 | Ordenar cartões em massa por critérios | **Posterior** | BEL-007; BEL-024 se usar prazo | — | ER-MAT; comportamento Trello | critérios e desfazer não definidos | a definir antes de inclusão em escopo |
| BEL-010 | Aplicar resultado funcional consistente a movimentos e reordenações concorrentes | **Essencial para o MVP** | BEL-006–BEL-008 | RN-057–RN-059, RN-066, RN-125, RN-130 | ER-OPEN Q01/Q13; DEC-016, DEC-018 | algoritmo/protocolo não definidos | preserva operações independentes e administração mínima; movimentos auditam resultado/posição relativa sem snapshot completo |
| BEL-011 | Mover cartões entre quadros do mesmo Workspace | **Essencial para o MVP** | BEL-010, BEL-014, BEL-021–BEL-024, BEL-026–BEL-028, BEL-036 | RN-063–RN-066, RN-092–RN-094, RN-130 | ER-MAT C06; ER-OPEN Q18; DEC-018 | movimento de listas não aprovado | preserva conteúdo/histórico; protege contexto da origem; auditoria registra item, origem, destino, posição relativa e resultado sem snapshot integral |

## Ciclo de vida

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-012 | Arquivar e restaurar cartões sem exclusão permanente | **Essencial para o MVP** | BEL-004, BEL-027, BEL-028 | RN-003, RN-005, RN-017–RN-019, RN-022, RN-042, RN-103, RN-105, RN-106 | ER-MAT C07/C08; DEC-001, DEC-007, DEC-011 | nenhuma quanto ao núcleo aprovado | restaura lista/posição anterior quando viável; lista arquivada exige restauração explícita ou outra lista ativa; preserva relações e gera feed/auditoria |
| BEL-013 | Arquivar e restaurar listas considerando seus cartões | **Essencial para o MVP** | BEL-003, BEL-012, BEL-027, BEL-028 | RN-003, RN-005, RN-017–RN-019, RN-022, RN-103–RN-106 | ER-MAT L05/L06; DEC-001, DEC-007 | nenhuma quanto ao núcleo aprovado | preserva estados; restaura apenas cartões não arquivados individualmente; recupera posição anterior ou válida mais próxima; gera feed/auditoria |
| BEL-014 | Arquivar e restaurar quadros | **Essencial para o MVP** | BEL-001, BEL-027, BEL-028, BEL-036 | RN-054–RN-056 | ER-MAT B04; DEC-012 | nenhuma quanto ao núcleo aprovado | Administrador de quadro/Workspace arquiva-restaura; arquivado sai dos ativos, permite consulta autorizada, bloqueia mutações, preserva estados/participantes/papéis e gera feed/auditoria |
| BEL-015 | Excluir permanentemente quadros, listas ou cartões | **Necessita decisão** | BEL-027, BEL-028, BEL-032 | RN-005 | ER-MAT B05/C09; ER-REL | retenção, recuperação, cascata, confirmação e autorização não definidas | nenhum critério aprovado |
| BEL-016 | Arquivar todos os cartões de uma lista em massa | **Posterior** | BEL-012, BEL-013 | RN-005 | ER-MAT L09 | confirmação e falha parcial não definidas | a definir antes de inclusão em escopo |

## Cópia e preservação

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-017 | Copiar cartão para uma lista escolhida | **Posterior** | BEL-004, BEL-020 | RP-003 | ER-MAT C10 | matriz de preservação não aprovada | a definir antes de inclusão em escopo |
| BEL-018 | Copiar lista e conteúdo selecionado | **Posterior** | BEL-003, BEL-017, BEL-020 | RP-003 | ER-MAT L08 | matriz de preservação não aprovada | a definir antes de inclusão em escopo |
| BEL-019 | Copiar quadro e conteúdo selecionado | **Posterior** | BEL-001, BEL-018, BEL-020 | RP-003 | ER-MAT B06 | matriz de preservação não aprovada | a definir antes de inclusão em escopo |
| BEL-020 | Definir matriz funcional de preservação para cópia e movimento | **Necessita decisão** | BEL-001, BEL-003, BEL-004, BEL-021–BEL-024 | RP-003, RN-064–RN-066 | ER-REL; ER-OPEN Q08–Q10; DEC-018 | movimento de cartões resolvido; cópias e movimento de listas permanecem sem decisão | para movimento de cartão: identidade, conteúdo, datas, conclusão, comentários, histórico e etiquetas preservados; responsáveis incompatíveis seguem confirmação |

## Colaboração em cartões

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-021 | Adicionar e remover responsáveis dos cartões | **Essencial para o MVP** | BEL-004, BEL-026–BEL-028, BEL-035 | RN-003, RN-016–RN-019, RN-022, RN-043–RN-045, RN-089–RN-091 | ER-MAT C13; DEC-001, DEC-006, DEC-007, DEC-013 | nenhuma quanto ao núcleo aprovado | rebaixamento informa impacto, exige confirmação adicional, remove atribuições consistentemente e preserva história; promoção futura não restaura atribuições |
| BEL-022 | Criar e associar etiquetas aos cartões | **Essencial para o MVP** | BEL-002, BEL-004, BEL-027, BEL-028, BEL-034, BEL-036 | RN-003, RN-017–RN-019, RN-022, RN-046–RN-049, RN-086–RN-088, RN-107–RN-109 | ER-MAT C14; DEC-001, DEC-007, DEC-014 refinada por PEN-028 | nenhuma quanto ao núcleo aprovado | Administrador do Workspace gere catálogo; colaboradores de quadro aplicam/removem; nome obrigatório até 50 e único sem diferenciar caixa; exclusão confirmada preserva histórico |
| BEL-023 | Criar, editar e remover comentários em cartões | **Essencial para o MVP** | BEL-004, BEL-026–BEL-028, BEL-038 | RN-003, RN-016–RN-019, RN-021, RN-022, RN-050–RN-053, RN-094–RN-096, RN-101, RN-102, RN-107–RN-109, RN-127, RN-129 | ER-MAT C15; DEC-001, DEC-006, DEC-007, DEC-015, DEC-020 | nenhuma quanto ao núcleo aprovado | conteúdo/versões anteriores e novas ficam na auditoria altamente protegida; moderação registra justificativa sem expor texto no feed |
| BEL-024 | Gerenciar datas de início, vencimento e conclusão | **Essencial para o MVP** | BEL-004, BEL-027, BEL-028, BEL-034 | RN-003, RN-017–RN-019, RN-022, RN-039–RN-042, RN-098–RN-100 | ER-MAT C11/C12; DEC-001, DEC-007, DEC-011 | nenhuma quanto ao núcleo aprovado | datas civis no fuso regional do Workspace; vencimento no final do dia; atraso consistente; mudar fuso preserva data civil e instantes históricos |
| BEL-025 | Criar e acompanhar checklists | **Posterior** | BEL-004 | — | ER-MAT C16 | conteúdo, ordem e conclusão não definidos | a definir antes de inclusão em escopo |

## Participantes, papéis e autorização

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-026 | Adicionar e remover participantes de um quadro | **Essencial para o MVP** | BEL-001, BEL-035, BEL-036, BEL-038 | RN-003, RN-009, RN-014–RN-016, RN-020, RN-022–RN-025, RN-073–RN-076, RN-083–RN-085 | ER-MAT B08/P04; DEC-001, DEC-002, DEC-006–DEC-008, DEC-020, DEC-021 | convite pendente opcional em PEN-034; inclusão direta está aprovada | Administrador inclui diretamente conta verificada já pertencente ao Workspace; notifica destino/papel/responsável; impede identidade errada e audita |
| BEL-027 | Atribuir os papéis Administrador e Membro | **Essencial para o MVP** | BEL-026, BEL-036 | RN-007, RN-017, RN-018, RN-020, RN-022–RN-025, RN-080–RN-082, RN-089–RN-091 | ER-PERM; DEC-004, DEC-007, DEC-008 | nenhuma quanto aos papéis aprovados | papéis do quadro e Workspace permanecem separados; alterações confirmadas preservam Administrador mínimo e não concedem conteúdo por herança |
| BEL-028 | Atribuir o papel Observador, distinto de convidado | **Essencial para o MVP** | BEL-026, BEL-036 | RN-007, RN-008, RN-019, RN-022–RN-024 | ER-PERM; DEC-004, DEC-007, DEC-008 | nenhuma quanto ao caráter somente leitura | Observador visualiza quadro/listas/cartões/feed, não escreve nem consulta auditoria, inclusive por API; não é convidado |
| BEL-029 | Definir e aplicar visibilidade de Workspace/quadro | **Essencial para o MVP** | BEL-002, BEL-026–BEL-028, BEL-036 | RN-060–RN-062, RN-077, RN-083 | ER-MAT B07/P02; DEC-017 | visibilidade pública é posterior | quadro nasce privado; participante autorizado cria; visível no Workspace revela somente nome/descrição; mudança integra governança fechada e gera auditoria |
| BEL-030 | Aplicar autorização às operações de comentário | **Essencial para o MVP** | BEL-023, BEL-027, BEL-028 | RN-003, RN-007, RN-017–RN-019, RN-021, RN-022, RN-050–RN-053, RN-095–RN-097, RN-101, RN-102 | ER-MAT P03; DEC-001, DEC-004, DEC-007, DEC-015 | nenhuma quanto ao núcleo aprovado | Administrador modera terceiro por remoção confirmada, sem reescrita/restauração; justificativa e versão ficam na auditoria autorizada; feed não divulga texto |
| BEL-037 | Suportar convidado como relação distinta de Observador | **Necessita decisão** | BEL-035, BEL-036 | RN-008 | separação derivada de DEC-004 | existência futura, acesso e convite não definidos | convidado não integra o MVP atual; nenhum critério aprovado |

## Feed, auditoria e integrações

| ID | Descrição funcional | Classificação | Dependências | Regras | Origem e decisões | Pendências | Critérios de aceite disponíveis |
|---|---|---|---|---|---|---|---|
| BEL-031 | Apresentar feed colaborativo em níveis de cartão e quadro | **Essencial para o MVP** | mutações cobertas; BEL-027, BEL-028, BEL-036, BEL-038 | RN-003, RN-006, RN-017–RN-019, RN-026–RN-031, RN-038, RN-041, RN-042, RN-045, RN-049, RN-052, RN-053, RN-056, RN-059, RN-066, RN-067, RN-076, RN-079, RN-088, RN-091–RN-094, RN-100, RN-102, RN-106, RN-110–RN-112 | ER-HIST H01; DEC-001, DEC-003, DEC-007, DEC-009, DEC-011–DEC-021 | nenhuma quanto ao núcleo aprovado | retenção pela vida da entidade; navegação progressiva e filtro por tipo; ordem estável; autorização atual e marcadores históricos; sem dados exclusivos da auditoria |
| BEL-032 | Registrar e permitir consulta autorizada da auditoria formal | **Essencial para o MVP** | mutações cobertas; BEL-027, BEL-028, BEL-036, BEL-038 | RN-006, RN-016–RN-025, RN-029, RN-031–RN-068, RN-071, RN-072, RN-076, RN-079, RN-082–RN-085, RN-088, RN-091–RN-097, RN-100, RN-102, RN-106, RN-113–RN-130 | ER-HIST; DEC-003, DEC-006–DEC-021; resolução de PEN-037 | pendências técnicas PEN-022–PEN-027 | matriz mínima explícita; autenticação e contas auditadas sem segredos; acessos separados; versões protegidas; movimentos sem snapshot integral; retenção 24 meses |
| BEL-033 | Disponibilizar integrações externas autorizadas e rastreáveis | **Posterior** | BEL-031, BEL-032, BEL-036 | RN-067, RN-068 | ER-HIST H02; DEC-019 | concessão/revogação em PEN-032 e importação em PEN-033; nenhuma tecnologia escolhida | identidade/autorização/auditoria/feed/proteção de segredos obrigatórias; API externa pós-MVP; webhooks segunda entrega; importação/conectores/automações posteriores |

## Rastreabilidade transversal de feed e auditoria

| Cobertura | Requisitos de origem | Feed | Auditoria |
|---|---|---|---|
| identidade | BEL-038 | autoria histórica conforme evento colaborativo | RN-032–RN-038, RN-069–RN-072, RN-095–RN-097, RN-116–RN-129 |
| Workspace e governança | BEL-034–BEL-036 | RN-076, RN-079 quando aplicáveis ao feed | RN-032–RN-038, RN-076, RN-079, RN-082–RN-085, RN-095–RN-097, RN-117, RN-123–RN-129 |
| quadro e participantes | BEL-001, BEL-026–BEL-028 | RN-026–RN-030, RN-076, RN-079, RN-091 | RN-032–RN-038, RN-076, RN-079, RN-082–RN-085, RN-091 |
| listas | BEL-003, BEL-013 | RN-026–RN-030 | RN-032–RN-038, RN-126, RN-127, RN-129, RN-130 |
| cartões, movimento e ordem | BEL-004, BEL-006–BEL-008, BEL-012 | RN-026–RN-031 | RN-031–RN-038, RN-126, RN-127, RN-129, RN-130 |
| responsáveis, etiquetas e datas/conclusão | BEL-021, BEL-022, BEL-024 | RN-026–RN-030, RN-041, RN-042, RN-045, RN-049, RN-088–RN-091, RN-100 | RN-032–RN-049, RN-088–RN-091, RN-095–RN-100 conforme a entidade |
| comentários | BEL-023, BEL-030 | RN-026–RN-030, RN-050–RN-052, RN-094, RN-101, RN-102 | RN-032–RN-038, RN-051–RN-053, RN-094–RN-097, RN-101, RN-102 |
| exclusão permanente futura | BEL-015 | não aprovada para o feed | RN-033 quando a funcionalidade existir |
| arquivamento e visibilidade de quadro | BEL-014, BEL-029 | RN-054–RN-056 | RN-056, RN-062 |
| movimento entre quadros | BEL-010, BEL-011 | RN-059, RN-066, RN-092–RN-094 | RN-059, RN-066, RN-092–RN-097 |
| integrações externas futuras | BEL-033 | RN-067 quando colaborativamente relevante | RN-067, RN-068 |

## Resumo quantitativo

| Classificação | Quantidade |
|---|---:|
| Essencial para o MVP | 28 |
| Candidato ao MVP | 0 |
| Posterior | 7 |
| Necessita decisão | 3 |
| **Total** | **38** |

