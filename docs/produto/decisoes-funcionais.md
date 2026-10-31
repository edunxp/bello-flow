# Decisões funcionais do Bello

## Estados

- **Aprovada:** integra a especificação oficial.
- **Pendente:** requer decisão do responsável pelo produto e não define comportamento.
- **Substituída:** reservada para decisão futuramente substituída; nenhuma decisão está nesse estado.

## Registro consolidado

| ID | Estado | Decisão ou questão | Justificativa/motivação registrada | Requisitos impactados | Histórico |
|---|---|---|---|---|---|
| DEC-001 | **Aprovada** | Kanban colaborativo completo no MVP | Validar organização e colaboração cotidiana, não apenas estrutura visual | BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-030, BEL-031 | 2026-10-30 — registrada como aprovada |
| DEC-002 | **Aprovada** | Workspaces obrigatórios desde o MVP | Estabelecer Workspace como contexto funcional dos quadros | BEL-001, BEL-002, BEL-005, BEL-026, BEL-027, BEL-034–BEL-036 | 2026-10-30 — registrada como aprovada |
| DEC-003 | **Aprovada** | Feed colaborativo e auditoria separados | Evitar que apresentação colaborativa seja tratada como auditoria completa | BEL-031, BEL-032 | 2026-10-30 — registrada como aprovada |
| DEC-004 | **Aprovada** | Administrador, Membro e Observador como papéis iniciais | Estabelecer os papéis do MVP sem copiar permissões do Trello | BEL-027, BEL-028, BEL-030–BEL-032, BEL-036, BEL-037 | 2026-10-30 — registrada como aprovada |
| DEC-005 | **Aprovada** | Administração de Workspaces | Definir criação, administração mínima e proteção contra Workspace sem administrador, mantendo exclusão permanente fora do MVP | BEL-002, BEL-034–BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-006 | **Aprovada** | Participação explícita em Workspace e quadro | Separar os dois vínculos, impedir acesso implícito aos quadros e preservar autoria/histórico após remoção | BEL-002, BEL-021, BEL-026–BEL-028, BEL-032, BEL-035, BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — Modelo A aprovado pelo responsável pelo produto |
| DEC-007 | **Aprovada** | Matriz de permissões do quadro | Definir capacidades de Administrador, Membro e Observador e exigir autorização em toda operação | BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-026–BEL-032, BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — matriz aprovada pelo responsável pelo produto |
| DEC-008 | **Aprovada** | Governança administrativa sem acesso automático ao conteúdo | Separar papéis de Workspace e quadro, bem como autorização administrativa e autorização sobre conteúdo | BEL-001, BEL-026–BEL-028, BEL-032, BEL-034–BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — Modelo A aprovado pelo responsável pelo produto |
| DEC-009 | **Aprovada** | Feed colaborativo em níveis de cartão e quadro | Definir escopo, campos, acesso, ordenação e cobertura do feed sem transformá-lo em auditoria | BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-026, BEL-031 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-010 | **Aprovada** | Auditoria independente, com acesso controlado e retenção de 24 meses | Formalizar rastreabilidade de mutações e acessos negados, preservando separação do feed e dados protegidos | BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-015, BEL-021–BEL-024, BEL-026–BEL-028, BEL-030, BEL-032, BEL-034–BEL-036 | 2026-10-30 — criada como pendente; DEC-007/DEC-008 resolveram parte do acesso; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-011 | **Aprovada** | Datas e conclusão manual de cartões | Definir datas opcionais, estado explícito de conclusão, histórico de reabertura e critério de atraso sem vínculo automático à lista | BEL-012, BEL-024, BEL-031, BEL-032 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-012 | **Aprovada** | Arquivamento e restauração de quadros | Permitir retirada reversível da operação sem alterar estados internos, participantes ou papéis | BEL-001, BEL-005, BEL-014, BEL-031, BEL-032, BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-013 | **Aprovada** | Responsáveis múltiplos e elegibilidade por participação/papel | Restringir responsabilidade a colaboradores com escrita, remover atribuições após perda de acesso e preservar rastreabilidade | BEL-021, BEL-026–BEL-028, BEL-031, BEL-032, BEL-035 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-014 | **Aprovada** | Catálogo de etiquetas por Workspace | Compartilhar classificação entre quadros do mesmo Workspace sem ampliar acesso a conteúdo | BEL-002, BEL-011, BEL-020, BEL-022, BEL-031, BEL-032, BEL-034, BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-015 | **Aprovada** | Comentários, edição, remoção e moderação rastreável | Definir autoria, edição, tombstone de remoção e separação entre interface colaborativa e versões auditadas | BEL-023, BEL-030–BEL-032 | 2026-10-30 — criada como pendente; DEC-007 resolveu permissões básicas; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-016 | **Aprovada** | Ordenação concorrente consistente | Definir convergência funcional, preservação de operações independentes e correção explícita de rejeições sem escolher algoritmo | BEL-006–BEL-008, BEL-010, BEL-031, BEL-032 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-017 | **Aprovada** | Visibilidade privada por padrão e descoberta controlada | Evitar acesso implícito ao conteúdo, permitindo descoberta administrativa ou do Workspace sem participação automática | BEL-001, BEL-002, BEL-026–BEL-029, BEL-032, BEL-034, BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-018 | **Aprovada** | Movimento de cartões entre quadros do mesmo Workspace | Preservar identidade e conteúdo do cartão, com autorização nos dois quadros, confirmação de responsáveis incompatíveis e histórico protegido por evento | BEL-008, BEL-011, BEL-020–BEL-024, BEL-026–BEL-028, BEL-031, BEL-032, BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-019 | **Aprovada** | Governança de integrações externas e entregas posteriores | Fixar autorização, identidade, auditoria e proteção de segredos, mantendo API externa, webhooks, conectores e automações fora do MVP | BEL-031–BEL-033, BEL-036 | 2026-10-30 — criada como pendente; 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-020 | **Aprovada** | Identidade administrada do usuário | Definir criação restrita de contas, login, verificação, recuperação e preservação histórica da identidade sem cadastro público | BEL-021, BEL-023, BEL-026–BEL-028, BEL-031, BEL-032, BEL-034–BEL-036, BEL-038 | 2026-10-30 — aprovada pelo responsável pelo produto |
| DEC-021 | **Aprovada** | Inclusão direta e acompanhamento de convites/vínculos | Exigir conta verificada, separar inclusão direta de convite pendente e tornar concessões de participação rastreáveis | BEL-026, BEL-031, BEL-032, BEL-035, BEL-036, BEL-038 | 2026-10-30 — aprovada pelo responsável pelo produto |

## Detalhamento das decisões aprovadas

### DEC-001 — Kanban colaborativo completo

- **Estado:** Aprovada
- **Decisão:** a primeira versão inclui quadros, listas, cartões, criação, edição, movimentação, ordenação manual, drag-and-drop, arquivamento, restauração, responsáveis, etiquetas, comentários, datas de início, vencimento e conclusão e histórico das atividades essenciais.
- **Limites:** não aprova automaticamente movimento entre quadros, cópia, exclusão permanente, checklists ou arquivamento de quadros.

### DEC-002 — Workspaces obrigatórios

- **Estado:** Aprovada
- **Decisão:** todo quadro deve estar associado a um Workspace e a estrutura é Workspace → Quadro → Lista → Cartão.
- **Limites:** administração, participantes e permissões entre níveis permanecem pendentes, embora BEL-035 e BEL-036 sejam essenciais ao MVP.

### DEC-003 — Feed colaborativo e auditoria separados

- **Estado:** Aprovada
- **Decisão:** BEL-031 representa feed colaborativo; BEL-032 representa auditoria. Um conceito não substitui nem implementa implicitamente o outro.
- **Limites:** cobertura, dados, acesso e retenção permanecem pendentes.

### DEC-004 — Três papéis iniciais

- **Estado:** Aprovada
- **Decisão:** Administrador, Membro e Observador integram o MVP.
- **Limites:** permissões específicas permanecem pendentes; Observador não equivale a convidado.

Nota de evolução: os textos de DEC-002 e DEC-004 acima foram preservados como originalmente aprovados. Suas pendências de administração, participação e permissões foram posteriormente tratadas por DEC-005 a DEC-008; as lacunas residuais constam nas decisões e regras atuais.

### DEC-005 — Administração de Workspaces

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** qualquer usuário autenticado pode criar Workspace; o criador torna-se administrador inicial; nome é obrigatório e descrição opcional; administradores editam suas informações; deve existir ao menos um administrador; exclusão permanente fica fora do MVP.
- **Justificativa:** tornar BEL-034 e a administração mínima do Workspace executáveis sem antecipar política de retenção.
- **Requisitos impactados:** BEL-002, BEL-034, BEL-035, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.
- **Evolução:** criação de quadros e administração dos papéis do Workspace foram posteriormente definidas nas resoluções de PEN-018 e PEN-019.

### DEC-006 — Participação em Workspace e quadro

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** participação em Workspace e participação em quadro são relações explícitas e separadas; participar de quadro exige pertencer ao Workspace; pertencer ao Workspace não concede acesso ao conteúdo dos quadros.
- **Regras adicionais:** administradores do Workspace gerenciam seus participantes; administradores do quadro só adicionam quem já pertence ao Workspace; saídas voluntárias são permitidas sem deixar Workspace sem administrador; remoção do Workspace revoga acesso aos quadros vinculados e preserva comentários e histórico.
- **Justificativa:** permitir governança independente por quadro sem perder o vínculo organizacional do Workspace.
- **Requisitos impactados:** BEL-002, BEL-021, BEL-026, BEL-027, BEL-028, BEL-032, BEL-035, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — Modelo A aprovado.
- **Evolução:** o efeito da perda de acesso sobre atribuições de responsabilidade foi posteriormente definido em DEC-013.

### DEC-007 — Matriz de permissões

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** Administrador, Membro e Observador possuem a matriz de permissões registrada em regras de negócio; toda autorização deve ser validada independentemente da interface.
- **Justificativa:** estabelecer uma fronteira explícita entre administração, colaboração com escrita e observação somente leitura.
- **Requisitos impactados:** BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-026–BEL-032, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — matriz aprovada.
- **Evolução:** DEC-009/DEC-010 definiram feed/auditoria e a resolução de PEN-011 posteriormente delimitou a moderação, sem alterar as permissões básicas aprovadas.

### DEC-008 — Governança administrativa

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** papéis de Workspace e quadro são separados; administrar o Workspace ou a governança do quadro não concede acesso automático ao conteúdo; participação explícita com papel adequado é necessária para consultar ou modificar conteúdo.
- **Regras adicionais:** administradores do Workspace administram configurações, participantes e papéis dos quadros; administradores de quadro não herdam privilégios no Workspace; participantes comuns do Workspace não herdam acesso aos quadros; autoconcessão de participação por administrador de Workspace deve ser explícita, autorizada e auditada.
- **Justificativa:** separar governança administrativa de acesso operacional ao conteúdo.
- **Requisitos impactados:** BEL-001, BEL-026, BEL-027, BEL-028, BEL-032, BEL-034, BEL-035, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — Modelo A aprovado.
- **Evolução:** DEC-010 definiu a consulta administrativa da auditoria, e a resolução de PEN-021 posteriormente fixou a lista fechada de governança sem acesso ao conteúdo.

### DEC-009 — Feed colaborativo

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** o Bello possui feed do cartão, restrito às atividades daquele cartão, e feed do quadro, consolidando atividades do quadro, listas, cartões e participantes.
- **Conteúdo mínimo:** toda atividade exibida identifica autor, data, operação e objeto relacionado; movimentações identificam origem e destino quando disponíveis.
- **Acesso e apresentação:** Administrador, Membro e Observador consultam feed dos quadros aos quais têm acesso; usuários sem acesso ao conteúdo não consultam o feed; a ordem é cronológica decrescente.
- **Cobertura:** criação e alterações de cartão, movimento, reordenação, arquivo/restauração, responsáveis, etiquetas, datas/conclusão, comentários, além de criação/renomeação/arquivo de listas e participantes no feed do quadro.
- **Proteção:** o feed não expõe dados protegidos nem informações internas exclusivas da auditoria; eventos permanecem preservados quando o autor deixa o Workspace.
- **Agrupamento:** reordenações repetitivas devem ser resumidas na apresentação, sem eliminar registros obrigatórios de auditoria.
- **Justificativa:** oferecer contexto colaborativo relevante, navegável e separado da rastreabilidade formal.
- **Requisitos impactados:** BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-026, BEL-031.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.

### DEC-010 — Auditoria

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** toda mutação relevante efetivada produz auditoria independente do feed; o registro identifica operação, contexto, ator, momento e resultado, incluindo valores anterior/posterior quando aplicáveis e permitidos.
- **Integridade funcional:** usuários comuns não modificam registros; correções geram novos eventos; falha no registro obrigatório não pode ser apresentada silenciosamente como operação concluída.
- **Acessos negados:** tentativas são auditadas com contexto mínimo e sem informação sensível. Consultas comuns a quadros e cartões não precisam gerar auditoria no MVP.
- **Acesso:** Administrador de quadro consulta auditoria do seu quadro; Administrador de Workspace consulta auditoria administrativa do Workspace e quadros vinculados, sem detalhes privados de conteúdo quando não participa; auditoria de conteúdo exige participação explícita e papel Administrador no quadro; Membro e Observador não consultam auditoria.
- **Cobertura:** Workspaces, participantes, papéis/permissões, quadros, listas, cartões, movimentos/reordenações, responsáveis, etiquetas, datas, comentários, exclusões permanentes futuras e acessos negados.
- **Campos conceituais mínimos:** identificador do evento, data/hora, ator, Workspace, quadro quando aplicável, entidade/identificador afetados, operação, valores anterior/posterior quando aplicáveis, resultado, origem e correlação quando aplicáveis.
- **Proteção de dados:** senhas, tokens, credenciais e outros segredos nunca são armazenados; dados pessoais ou sensíveis são minimizados e protegidos conforme a finalidade.
- **Retenção:** 24 meses; arquivamento ou remoção de participantes não apaga auditoria; descarte após o prazo é controlado.
- **Justificativa:** garantir rastreabilidade formal de operações relevantes sem ampliar acesso a conteúdo privado.
- **Requisitos impactados:** BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-015, BEL-021–BEL-024, BEL-026–BEL-028, BEL-030, BEL-032, BEL-034–BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; DEC-007/DEC-008 resolveram parte do acesso; 2026-10-30 — aprovada.
- **Pendências técnicas futuras:** armazenamento, consistência entre mutação e auditoria, proteção contra adulteração, expiração/descarte, falhas/indisponibilidade e desempenho/consulta.
- **Evolução funcional:** a resolução de PEN-037 posteriormente definiu a matriz mínima obrigatória, a classificação dos valores e a auditoria de autenticação, mantendo as pendências técnicas acima.

### DEC-011 — Datas e conclusão

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** início e vencimento são opcionais; quando ambos existem, vencimento não antecede início; todo cartão está Pendente ou Concluído.
- **Conclusão:** é manual, independente de lista/posição e registra data, hora e usuário; reabrir retorna a Pendente e preserva conclusões anteriores no histórico sem mantê-las como estado atual.
- **Atraso:** cartão está atrasado somente quando Pendente e além do vencimento.
- **Acesso e ciclo de vida:** Administrador e Membro alteram datas/conclusão; Observador consulta; arquivo preserva datas/estado; alterações geram feed e auditoria.
- **Justificativa:** tornar conclusão um estado explícito e rastreável, sem acoplá-la ao desenho do quadro.
- **Requisitos impactados:** BEL-012, BEL-024, BEL-031, BEL-032.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.
- **Evolução e limites:** PEN-030 posteriormente definiu datas civis e fuso regional do Workspace; comportamento de notificações não foi definido e não há conclusão automática por movimento.

### DEC-013 — Responsáveis pelos cartões

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** cartão pode ter zero ou múltiplos responsáveis; somente participantes do quadro com papel Administrador ou Membro são elegíveis; ambos podem atribuir a si ou a outros elegíveis e remover atribuições.
- **Revogação:** perder acesso ao quadro remove automaticamente as atribuições, inclusive quando a perda decorre da saída/remoção do Workspace; feed e auditoria preservam a rastreabilidade e comentários/histórico não são excluídos.
- **Justificativa:** manter responsabilidade compatível com acesso efetivo ao trabalho.
- **Requisitos impactados:** BEL-021, BEL-026, BEL-027, BEL-028, BEL-031, BEL-032, BEL-035.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.
- **Evolução:** PEN-029 posteriormente definiu confirmação, remoção consistente das atribuições e preservação histórica no rebaixamento para Observador.

### DEC-014 — Etiquetas

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** o catálogo pertence ao Workspace; cada etiqueta tem nome obrigatório, cor opcional e pode ser usada por múltiplos cartões/quadros do mesmo Workspace; cartões aceitam múltiplas etiquetas.
- **Unicidade:** nomes são únicos no Workspace sem diferenciar maiúsculas/minúsculas; a mesma nomenclatura pode existir em Workspaces distintos.
- **Operações originalmente aprovadas:** Administradores e Membros criavam, editavam, aplicavam e removiam etiquetas conforme acesso; Observadores visualizavam.
- **Refinamento posterior:** a resolução de PEN-028 restringiu criação, edição e exclusão do catálogo global a Administradores do Workspace; Administradores e Membros de quadro aplicam e removem etiquetas em cartões autorizados.
- **Acesso e rastreabilidade:** catálogo compartilhado não concede acesso a cartões; criação, edição, exclusão e associações geram feed/auditoria aplicáveis.
- **Justificativa:** permitir classificação consistente entre quadros mantendo segregação de acesso.
- **Requisitos impactados:** BEL-002, BEL-011, BEL-020, BEL-022, BEL-031, BEL-032, BEL-034, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada; 2026-10-30 — refinada pela resolução de PEN-028, preservando o catálogo do Workspace e restringindo sua administração global.

### DEC-015 — Comentários

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** comentário pertence a cartão e registra autor, criação e conteúdo; Administrador/Membro comentam e operam seus comentários enquanto colaboram; Observador somente visualiza; Administrador de quadro modera terceiros.
- **Edição e remoção:** edição mantém criação, registra última alteração e mostra “Editado”; exclusão mantém indicação de remoção sem conteúdo visível.
- **Histórico e acesso:** edições, exclusões e moderações geram auditoria; versões anteriores ficam restritas à auditoria autorizada e não aparecem na interface colaborativa; remoção do usuário preserva comentários; retenção segue 24 meses.
- **Justificativa:** preservar continuidade da conversa e rastreabilidade sem expor versões anteriores no feed.
- **Requisitos impactados:** BEL-023, BEL-030, BEL-031, BEL-032.
- **Histórico:** 2026-10-30 — registrada como pendente; DEC-007 resolveu permissões básicas; 2026-10-30 — aprovada.
- **Evolução:** PEN-011 posteriormente definiu moderação como remoção da visualização colaborativa, sem reescrita nem restauração no MVP, com justificativa auditada.

### DEC-012 — Arquivamento de quadros

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** Administrador de quadro arquiva/restaura; Administrador de Workspace também pode fazê-lo por governança sem adquirir acesso ao conteúdo.
- **Comportamento:** quadro arquivado sai da relação ativa, continua consultável por participantes autorizados e bloqueia alterações de listas, cartões, comentários, responsáveis, etiquetas associadas e datas.
- **Preservação:** listas/cartões mantêm estados individuais; participantes/papéis permanecem; restauração devolve disponibilidade operacional e estados anteriores.
- **Rastreabilidade:** arquivamento/restauração geram feed e auditoria; arquivar não é excluir permanentemente.
- **Justificativa:** permitir suspensão reversível do trabalho preservando estrutura e segregação administrativa.
- **Requisitos impactados:** BEL-001, BEL-005, BEL-014, BEL-031, BEL-032, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.

### DEC-016 — Ordenação concorrente

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** ordem de listas/cartões permanece consistente e é refletida aos participantes sem recarregamento manual; operações independentes concorrentes são preservadas sempre que possível.
- **Conflito:** para o mesmo item, prevalece a última operação confirmada pelo servidor; rejeição corrige/atualiza a interface e informa o usuário.
- **Integridade:** movimentações não duplicam nem perdem cartões; ordem final é persistida/reproduzida; operação altera somente o necessário.
- **Rastreabilidade:** movimentações efetivadas geram feed e auditoria; listas e cartões seguem comportamento equivalente respeitando diferenças.
- **Justificativa:** definir resultado funcional previsível sem selecionar algoritmo, sincronização ou tecnologia.
- **Requisitos impactados:** BEL-006, BEL-007, BEL-008, BEL-010, BEL-031, BEL-032.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.

### DEC-017 — Visibilidade padrão

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** Workspaces e quadros nascem privados; participação no Workspace não concede participação no quadro; visibilidade não altera papéis.
- **Descoberta:** quadro privado só é descoberto por participantes e Administradores de Workspace para governança; quadro visível no Workspace expõe somente nome/descrição básica a não participantes; conteúdo continua exigindo participação explícita.
- **Autorização:** somente Administradores autorizados de quadro/Workspace mudam visibilidade; URL/identificador não concede acesso.
- **Rastreabilidade e limite:** mudança gera auditoria; visibilidade pública e acesso anônimo ficam fora do MVP.
- **Justificativa:** adotar menor exposição padrão sem confundir descoberta com acesso ao conteúdo.
- **Requisitos impactados:** BEL-001, BEL-002, BEL-026–BEL-029, BEL-032, BEL-034, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.

### DEC-018 — Movimento entre quadros

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** Administrador/Membro movem cartões entre quadros ativos do mesmo Workspace nos quais têm escrita, com autorização em origem/destino.
- **Preservação:** identidade/ID, título, descrição, datas, conclusão, comentários, histórico e etiquetas são mantidos; consulta histórica continua autorizada por evento e não amplia acesso a dados privados da origem.
- **Responsáveis:** incompatíveis com destino são apresentados antes da operação e removidos somente após confirmação; cancelar impede o movimento.
- **Integridade e rastreabilidade:** movimento não duplica/perde cartão, respeita DEC-016 e gera feed/auditoria com origem/destino.
- **Justificativa:** permitir reorganização entre quadros sem converter movimento em cópia ou vazar histórico protegido.
- **Requisitos impactados:** BEL-008, BEL-011, BEL-020–BEL-024, BEL-026–BEL-028, BEL-031, BEL-032, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.
- **Evolução e limite:** PEN-031 posteriormente definiu marcadores genéricos para eventos históricos não autorizados; movimento de listas não foi aprovado por esta decisão.

### DEC-019 — Integrações externas

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** integração possui identidade rastreável, autorização explícita equivalente à operação do usuário, auditoria, feed quando colaborativamente relevante, proteção de credenciais e possibilidade de revogação administrativa.
- **Falhas e eventos:** falha externa não modifica silenciosamente operação concluída; webhooks futuros incluem evento/contexto autorizado sem dados indevidos; conectores/automações respeitam consistência, autorização e auditoria.
- **Entrega:** API externa após MVP; webhooks na segunda entrega; importação autorizada do Trello será avaliada posteriormente; conectores e automações são posteriores.
- **Separação:** API de integração externa não se confunde com APIs internas da aplicação.
- **Justificativa:** estabelecer guardrails funcionais antes de qualquer escolha técnica ou entrega de integração.
- **Requisitos impactados:** BEL-031, BEL-032, BEL-033, BEL-036.
- **Histórico:** 2026-10-30 — registrada como pendente; 2026-10-30 — aprovada.
- **Limite:** REST, GraphQL, mensageria, autenticação e demais tecnologias não foram escolhidas.

### DEC-020 — Identidade administrada

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** somente a administração autorizada do Bello cria contas; não existe cadastro público; login usa e-mail e senha; e-mail é obrigatório, único e deve ser verificado antes do acesso protegido; recuperação de senha ocorre por e-mail.
- **Identidade:** cada usuário possui identificador técnico interno único e imutável, independente do e-mail; alteração de e-mail exige verificação do novo endereço.
- **Ciclo de vida:** desativação preserva identidade, autoria, comentários e histórico; exclusão definitiva depende de política posterior; auditoria preserva a identidade histórica dos autores.
- **Justificativa:** tornar participantes, autoria, autorização, recuperação e auditoria funcionalmente executáveis sem abrir cadastro público nem escolher solução técnica.
- **Requisitos impactados:** BEL-021, BEL-023, BEL-026–BEL-028, BEL-031, BEL-032, BEL-034–BEL-036, BEL-038.
- **Histórico:** 2026-10-30 — aprovada pelo responsável pelo produto.
- **Evolução:** PEN-035 posteriormente definiu a inicialização controlada do primeiro Administrador Global; PEN-036 definiu administração global de contas, continuidade administrativa e independência de papéis/conteúdo.

### DEC-021 — Inclusão direta e acompanhamento de convites/vínculos

- **Estado:** Aprovada
- **Data de aprovação:** 2026-10-30
- **Decisão:** participantes devem possuir conta previamente cadastrada e verificada; Administradores do Workspace incluem usuários no Workspace e Administradores de quadro incluem participantes elegíveis já pertencentes ao Workspace; a inclusão é direta, sem aceite obrigatório.
- **Notificação e rastreabilidade:** a notificação identifica responsável, destino e papel concedido; inclusões e alterações relevantes respeitam feed e auditoria e não podem vincular identidade incorreta nem ultrapassar permissões.
- **Convites pendentes:** quando aplicáveis a um fluxo futuramente delimitado, possuem estados Pendente, Aceito, Recusado, Cancelado e Expirado, expiram após sete dias e não podem ser duplicados para o mesmo destinatário/recurso; vínculos ativados não expiram.
- **Justificativa:** permitir participação imediata de contas verificadas e preservar rastreabilidade sem presumir aceite obrigatório.
- **Requisitos impactados:** BEL-026, BEL-031, BEL-032, BEL-035, BEL-036, BEL-038.
- **Histórico:** 2026-10-30 — aprovada pelo responsável pelo produto.
- **Pendência:** PEN-034 deve definir quando existe convite pendente, pois o fluxo aprovado de inclusão de contas existentes é direto.

Nota de evolução: DEC-003 permanece inalterada e é detalhada por DEC-009 e DEC-010. As pendências históricas de cobertura do feed e da auditoria registradas em DEC-007/DEC-008 foram resolvidas nos limites expressamente aprovados acima.

## Política de alteração

Ao alterar uma decisão, deve-se:

1. manter o identificador original;
2. registrar data, estado anterior, estado novo e justificativa;
3. atualizar requisitos e regras impactados;
4. não apagar o histórico anterior;
5. marcar como “Substituída” quando uma nova decisão tomar seu lugar.

