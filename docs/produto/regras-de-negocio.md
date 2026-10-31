# Regras de negócio do Bello

## Convenções

As regras estão separadas por estado:

- **Aprovada**: obrigatória para a especificação atual.
- **Proposta**: recomendação ainda não aprovada.
- **Pendente**: assunto que exige decisão; não define comportamento.

Somente regras da seção “Regras aprovadas” podem ser tratadas como comportamento oficial do Bello.

## Regras aprovadas

### RN-001 — Hierarquia funcional

- **Estado:** Aprovada
- **Regra:** a estrutura funcional é Workspace → Quadro → Lista → Cartão.
- **Origem:** DEC-002.
- **Requisitos:** BEL-002, BEL-005.

### RN-002 — Associação obrigatória do quadro

- **Estado:** Aprovada
- **Regra:** todo quadro deve estar associado a um Workspace.
- **Origem:** DEC-002.
- **Requisitos:** BEL-001, BEL-002.

### RN-003 — Escopo colaborativo do MVP

- **Estado:** Aprovada
- **Regra:** o MVP inclui quadros, listas, cartões, criação, edição, movimentação, ordenação manual, drag-and-drop, arquivamento, restauração, responsáveis, etiquetas, comentários, datas e histórico das atividades essenciais.
- **Origem:** DEC-001.
- **Requisitos:** BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024 e BEL-031.

### RN-004 — Ordenação manual

- **Estado:** Aprovada
- **Regra:** listas e cartões devem permitir ordenação manual por drag-and-drop e a ordem resultante deve permanecer disponível em consultas posteriores.
- **Origem:** DEC-001 e matriz BEL aprovada.
- **Requisitos:** BEL-006, BEL-007.

### RN-005 — Arquivamento e restauração

- **Estado:** Aprovada
- **Regra:** cartões e listas devem poder ser arquivados e restaurados. Arquivamento não é sinônimo de exclusão permanente.
- **Origem:** DEC-001 e matriz BEL aprovada.
- **Requisitos:** BEL-012, BEL-013, BEL-015.
- **Evolução:** arquivamento de quadros foi definido por DEC-012; estados descendentes e restauração de listas/cartões foram posteriormente definidos em RN-103 a RN-106.

### RN-006 — Separação entre feed e auditoria

- **Estado:** Aprovada
- **Regra:** feed colaborativo e auditoria são conceitos funcionais distintos e possuem requisitos próprios, sem sobreposição conceitual.
- **Origem:** DEC-003.
- **Requisitos:** BEL-031, BEL-032.

### RN-007 — Papéis iniciais

- **Estado:** Aprovada
- **Regra:** o MVP deve considerar os papéis Administrador, Membro e Observador.
- **Origem:** DEC-004.
- **Requisitos:** BEL-027, BEL-028.
- **Evolução:** as permissões específicas foram aprovadas posteriormente por DEC-007 e estão em RN-015 a RN-020.

### RN-008 — Observador distinto de convidado

- **Estado:** Aprovada
- **Regra:** Observador é um papel do MVP; convidado é um conceito separado e não está aprovado para o MVP.
- **Origem:** DEC-004.
- **Requisitos:** BEL-028, BEL-037.

### RN-009 — Administração de Workspace no MVP

- **Estado:** Aprovada
- **Regra:** administração de participantes de Workspace e definição da relação de permissões entre Workspace e quadro são necessárias ao MVP.
- **Origem:** ajuste aprovado após DEC-002.
- **Requisitos:** BEL-035, BEL-036.
- **Evolução:** as regras funcionais foram parcialmente consolidadas por DEC-005, DEC-006 e DEC-008; lacunas remanescentes continuam explícitas.

### RN-010 — Governança de pendências

- **Estado:** Aprovada
- **Regra:** nenhuma decisão ou regra pendente pode ser tratada como comportamento aprovado do Bello.
- **Origem:** orientação do responsável pelo produto.
- **Requisitos:** todos.

### RN-011 — Criação e informações do Workspace

- **Estado:** Aprovada
- **Regra:** qualquer usuário autenticado pode criar um Workspace; o criador torna-se seu administrador inicial; nome é obrigatório e descrição é opcional; administradores podem editar essas informações.
- **Origem:** DEC-005.
- **Requisitos:** BEL-002, BEL-034.

### RN-012 — Continuidade administrativa do Workspace

- **Estado:** Aprovada
- **Regra:** um Workspace deve manter pelo menos um administrador. Saída, remoção ou alteração de papel não pode deixá-lo sem administrador.
- **Origem:** DEC-005, DEC-006.
- **Requisitos:** BEL-035, BEL-036.

### RN-013 — Exclusão de Workspace fora do MVP

- **Estado:** Aprovada
- **Regra:** exclusão permanente de Workspace não integra o MVP até definição da política de retenção.
- **Origem:** DEC-005.
- **Requisitos:** BEL-034.

### RN-014 — Participações explícitas e separadas

- **Estado:** Aprovada
- **Regra:** Workspace e quadro mantêm relações próprias de participantes; participar de quadro exige pertencer ao Workspace, mas pertencer ao Workspace não concede acesso ao quadro.
- **Origem:** DEC-006, DEC-008.
- **Requisitos:** BEL-002, BEL-026, BEL-035, BEL-036.

### RN-015 — Administração de participantes

- **Estado:** Aprovada
- **Regra:** administradores do Workspace podem adicionar e remover participantes do Workspace; administradores de quadro podem adicionar ao quadro apenas usuários que já pertençam ao Workspace.
- **Origem:** DEC-006.
- **Requisitos:** BEL-026, BEL-035, BEL-036.

### RN-016 — Saída, remoção e preservação

- **Estado:** Aprovada
- **Regra:** participantes podem sair voluntariamente de quadros ou Workspaces sem violar a exigência de administrador mínimo; remover alguém do Workspace revoga seu acesso aos quadros vinculados, preservando comentários e histórico já produzidos.
- **Origem:** DEC-006.
- **Requisitos:** BEL-021, BEL-023, BEL-026, BEL-032, BEL-035.
- **Evolução:** perda de acesso e responsabilidades foi definida por DEC-013/RN-045; rebaixamento para Observador foi posteriormente definido em RN-090 a RN-092.

### RN-017 — Permissões do Administrador de quadro

- **Estado:** Aprovada
- **Regra:** Administrador de quadro visualiza quadro, listas, cartões e feed; edita configurações; gerencia participantes e papéis; cria, edita, move, ordena, arquiva e restaura listas e cartões; gerencia responsáveis e datas; aplica/remove etiquetas em cartões autorizados; cria, edita e exclui comentários próprios; modera comentários de terceiros; consulta auditoria. Administração do catálogo global de etiquetas segue RN-086.
- **Origem:** DEC-007.
- **Requisitos:** BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-026, BEL-027, BEL-030–BEL-032.

### RN-018 — Permissões do Membro de quadro

- **Estado:** Aprovada
- **Regra:** Membro visualiza quadro, listas, cartões e feed; cria, edita, move, ordena, arquiva e restaura listas e cartões; gerencia responsáveis e datas; aplica/remove etiquetas em cartões autorizados; cria, edita e exclui comentários próprios; não administra configurações, participantes ou catálogo global de etiquetas e não consulta auditoria.
- **Origem:** DEC-007.
- **Requisitos:** BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-027, BEL-030–BEL-032.
- **Complemento:** Membro pode editar e arquivar cartões criados por outros membros.

### RN-019 — Permissões do Observador de quadro

- **Estado:** Aprovada
- **Regra:** Observador visualiza quadro, listas, cartões e feed; não cria, modifica, movimenta, arquiva ou restaura conteúdo; não comenta; não altera participantes, responsáveis, etiquetas ou datas; não consulta auditoria.
- **Origem:** DEC-007.
- **Requisitos:** BEL-028, BEL-030–BEL-032.
- **Complemento:** a restrição somente leitura também se aplica a chamadas diretas à API.

### RN-020 — Continuidade administrativa do quadro

- **Estado:** Aprovada
- **Regra:** todo quadro mantém pelo menos um administrador; ninguém pode remover o próprio papel ou outro administrador quando isso deixar o quadro sem administrador; Membros não promovem a si mesmos nem outros participantes.
- **Origem:** DEC-007.
- **Requisitos:** BEL-026, BEL-027, BEL-036.

### RN-021 — Comentários e moderação

- **Estado:** Aprovada
- **Regra:** Administradores e Membros criam, editam e excluem os próprios comentários; Administradores moderam comentários de terceiros com preservação da rastreabilidade; Observadores não comentam.
- **Origem:** DEC-007.
- **Requisitos:** BEL-023, BEL-030, BEL-032.
- **Evolução:** DEC-015 definiu o marcador sem conteúdo e RN-100 a RN-102 posteriormente delimitaram a moderação.

### RN-022 — Validação obrigatória de autorização

- **Estado:** Aprovada
- **Regra:** a autorização deve ser validada pelo backend em toda operação, independentemente de controles da interface.
- **Origem:** DEC-007.
- **Requisitos:** BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-026–BEL-032, BEL-034–BEL-036.

### RN-023 — Governança sem acesso automático ao conteúdo

- **Estado:** Aprovada
- **Regra:** papéis de Workspace e quadro são atribuídos separadamente; administrar Workspace ou governança do quadro não concede acesso ao conteúdo; consultar ou modificar conteúdo exige participação explícita no quadro com papel correspondente.
- **Origem:** DEC-008.
- **Requisitos:** BEL-026–BEL-028, BEL-036.

### RN-024 — Escopos administrativos

- **Estado:** Aprovada
- **Regra:** administradores do Workspace podem administrar configurações, participantes e papéis de quadros vinculados sem acesso operacional automático; administradores de quadro não herdam administração do Workspace; participantes comuns do Workspace não herdam acesso aos quadros.
- **Origem:** DEC-008.
- **Requisitos:** BEL-001, BEL-026–BEL-028, BEL-034–BEL-036.

### RN-025 — Auditoria administrativa

- **Estado:** Aprovada
- **Regra:** alterações de participantes e papéis e ações administrativas de administradores do Workspace sobre quadros geram auditoria. Autoconcessão de participação por administrador do Workspace deve ser explícita, autorizada e auditada.
- **Origem:** DEC-007, DEC-008.
- **Requisitos:** BEL-026, BEL-027, BEL-032, BEL-035, BEL-036.

### RN-026 — Níveis e escopo do feed

- **Estado:** Aprovada
- **Regra:** o feed do cartão contém exclusivamente atividades relacionadas ao cartão; o feed do quadro consolida atividades do quadro, de suas listas, cartões e participantes.
- **Origem:** DEC-009.
- **Requisitos:** BEL-031.

### RN-027 — Conteúdo e ordenação do feed

- **Estado:** Aprovada
- **Regra:** cada atividade exibida identifica autor, data, operação e objeto relacionado; movimentações identificam origem e destino quando disponíveis; a apresentação segue ordem cronológica decrescente.
- **Origem:** DEC-009.
- **Requisitos:** BEL-031.

### RN-028 — Acesso e preservação do feed

- **Estado:** Aprovada
- **Regra:** Administrador, Membro e Observador consultam o feed dos quadros aos quais possuem acesso; quem não possui permissão sobre o conteúdo não consulta seu feed; eventos históricos permanecem preservados quando o autor deixa o Workspace.
- **Origem:** DEC-009; em conformidade com DEC-006 a DEC-008.
- **Requisitos:** BEL-026–BEL-028, BEL-031, BEL-035, BEL-036.

### RN-029 — Proteção e separação do feed

- **Estado:** Aprovada
- **Regra:** o feed não expõe informações protegidas nem dados internos exclusivos da auditoria e não substitui a auditoria formal.
- **Origem:** DEC-009, DEC-010.
- **Requisitos:** BEL-031, BEL-032.

### RN-030 — Cobertura do feed

- **Estado:** Aprovada
- **Regra:** o feed cobre criação de cartão; alterações de título/descrição; movimento entre listas; reordenação; arquivamento/restauração; responsáveis; etiquetas; datas/conclusão; criação/alterações de comentários; e, no feed do quadro, criação/renomeação/arquivamento de listas e alterações de participantes.
- **Origem:** DEC-009.
- **Requisitos:** BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-021–BEL-024, BEL-026, BEL-031.

### RN-031 — Resumo visual sem perda de auditoria

- **Estado:** Aprovada
- **Regra:** reordenações repetitivas são resumidas na apresentação do feed para reduzir excesso visual; esse agrupamento não descarta nem consolida registros obrigatórios da auditoria.
- **Origem:** DEC-009, DEC-010.
- **Requisitos:** BEL-006, BEL-007, BEL-031, BEL-032.

### RN-032 — Produção e conteúdo mínimo da auditoria

- **Estado:** Aprovada
- **Regra:** toda mutação relevante efetivada produz registro de auditoria com operação, contexto, ator, momento e resultado; valores anteriores e posteriores são registrados quando aplicáveis e permitidos pela política de dados.
- **Origem:** DEC-010.
- **Requisitos:** BEL-032 e requisitos de mutação cobertos por RN-033.

### RN-033 — Cobertura da auditoria

- **Estado:** Aprovada
- **Regra:** a auditoria cobre criação/alteração de Workspaces; participação; papéis/permissões; criação/alteração de quadros; criação/edição/arquivamento de listas e cartões; movimento/reordenação; responsáveis; etiquetas; datas; criação/edição/exclusão/moderação de comentários; exclusões permanentes quando disponíveis; e acessos negados.
- **Origem:** DEC-010.
- **Requisitos:** BEL-001, BEL-003, BEL-004, BEL-006–BEL-008, BEL-012, BEL-013, BEL-015, BEL-021–BEL-024, BEL-026, BEL-027, BEL-030, BEL-032, BEL-034–BEL-036.

### RN-034 — Campos conceituais da auditoria

- **Estado:** Aprovada
- **Regra:** cada registro possui identificador único, data/hora, ator, Workspace, quadro quando aplicável, entidade e identificador afetados, operação e resultado; valores anterior/posterior, origem e identificador de correlação são incluídos quando aplicáveis.
- **Origem:** DEC-010.
- **Requisitos:** BEL-032.

### RN-035 — Acesso à auditoria

- **Estado:** Aprovada
- **Regra:** Administrador de quadro consulta auditoria do quadro; Administrador de Workspace consulta eventos administrativos do Workspace e quadros vinculados sem acesso automático a detalhes privados; auditoria de conteúdo exige participação explícita e papel Administrador no quadro; Membro e Observador não consultam auditoria.
- **Origem:** DEC-010, respeitando DEC-006 a DEC-008.
- **Requisitos:** BEL-027, BEL-028, BEL-032, BEL-035, BEL-036.

### RN-036 — Integridade funcional e falhas de auditoria

- **Estado:** Aprovada
- **Regra:** usuários comuns não modificam registros; correções geram novos eventos sem sobrescrever anteriores; falha no registro obrigatório não pode passar silenciosamente como operação concluída; tentativa de acesso negada é auditada com contexto mínimo e sem informação sensível.
- **Origem:** DEC-010.
- **Requisitos:** BEL-032.

### RN-037 — Retenção e preservação da auditoria

- **Estado:** Aprovada
- **Regra:** registros são preservados por 24 meses; arquivamento ou remoção de participantes não os apaga automaticamente; descarte após o prazo deve ser controlado.
- **Origem:** DEC-010.
- **Requisitos:** BEL-032.

### RN-038 — Minimização, segredos e independência da auditoria

- **Estado:** Aprovada
- **Regra:** auditoria permanece independente do feed; nunca armazena senhas, tokens, credenciais ou outros segredos; dados pessoais/sensíveis são minimizados e protegidos conforme a finalidade; consultas comuns a cartões e quadros não precisam gerar auditoria no MVP.
- **Origem:** DEC-010.
- **Requisitos:** BEL-031, BEL-032.

### RN-039 — Datas opcionais e coerência temporal

- **Estado:** Aprovada
- **Regra:** início e vencimento do cartão são opcionais; quando ambos existem, vencimento não pode ser anterior ao início.
- **Origem:** DEC-011.
- **Requisitos:** BEL-024.

### RN-040 — Estado de conclusão manual

- **Estado:** Aprovada
- **Regra:** todo cartão possui estado Pendente ou Concluído; conclusão é manual e independente da lista e da posição; mover cartão nunca conclui automaticamente.
- **Origem:** DEC-011.
- **Requisitos:** BEL-008, BEL-024.

### RN-041 — Registro e reabertura da conclusão

- **Estado:** Aprovada
- **Regra:** concluir registra data, hora e usuário; reabrir retorna a Pendente e preserva conclusões anteriores no histórico, sem tratá-las como estado atual.
- **Origem:** DEC-011.
- **Requisitos:** BEL-024, BEL-031, BEL-032.

### RN-042 — Atraso, acesso e arquivamento

- **Estado:** Aprovada
- **Regra:** cartão está atrasado somente quando Pendente e após o vencimento; Administrador e Membro alteram datas/conclusão, Observador consulta; arquivamento preserva datas e estado; alterações geram feed e auditoria.
- **Origem:** DEC-011.
- **Requisitos:** BEL-012, BEL-024, BEL-031, BEL-032.

### RN-043 — Elegibilidade e cardinalidade de responsáveis

- **Estado:** Aprovada
- **Regra:** cartão pode ter zero ou múltiplos responsáveis; somente participantes do quadro com papel Administrador ou Membro são elegíveis; Observador não pode ser responsável.
- **Origem:** DEC-013.
- **Requisitos:** BEL-021, BEL-026–BEL-028.

### RN-044 — Gestão e autoatribuição

- **Estado:** Aprovada
- **Regra:** Administrador e Membro adicionam/removem responsáveis e podem atribuir cartões a si mesmos.
- **Origem:** DEC-013.
- **Requisitos:** BEL-021, BEL-027.

### RN-045 — Revogação e rastreabilidade de atribuições

- **Estado:** Aprovada
- **Regra:** perda de acesso ao quadro remove automaticamente as atribuições, inclusive quando causada por saída/remoção do Workspace; feed e auditoria registram atribuição/remoção; histórico e comentários não são excluídos.
- **Origem:** DEC-006, DEC-013.
- **Requisitos:** BEL-021, BEL-026, BEL-031, BEL-032, BEL-035.

### RN-046 — Catálogo de etiquetas do Workspace

- **Estado:** Aprovada
- **Regra:** cada etiqueta pertence a um único Workspace, possui nome obrigatório e cor opcional; um Workspace possui múltiplas etiquetas e cartões usam múltiplas etiquetas do próprio Workspace.
- **Origem:** DEC-014.
- **Requisitos:** BEL-002, BEL-022, BEL-034.

### RN-047 — Unicidade dos nomes de etiquetas

- **Estado:** Aprovada
- **Regra:** nomes de etiquetas são únicos dentro do Workspace ignorando maiúsculas/minúsculas; a mesma nomenclatura pode existir em Workspaces diferentes.
- **Origem:** DEC-014.
- **Requisitos:** BEL-022, BEL-034.

### RN-048 — Compartilhamento sem ampliação de acesso

- **Estado:** Aprovada
- **Regra:** etiqueta pode ser usada em cartões de diferentes quadros do Workspace, mas catálogo e alterações não concedem acesso a quadros ou cartões; permissões e segregação existentes continuam obrigatórias.
- **Origem:** DEC-014, respeitando DEC-006 a DEC-008.
- **Requisitos:** BEL-022, BEL-036.

### RN-049 — Operações, propagação e exclusão de etiquetas

- **Estado:** Aprovada
- **Regra:** somente Administradores do Workspace criam, editam ou excluem etiquetas globais; Administradores e Membros de quadro aplicam/removem etiquetas em cartões autorizados; Observadores visualizam; mudar nome/cor atualiza cartões associados; excluir exige confirmação, remove associações sem excluir cartões, preserva histórico e gera feed/auditoria aplicáveis.
- **Origem:** DEC-014, refinada pela resolução de PEN-028.
- **Requisitos:** BEL-022, BEL-031, BEL-032.
- **Histórico:** a redação original atribuía criação/edição global a Administradores e Membros conforme acesso; PEN-028 restringiu a administração global ao Administrador do Workspace sem alterar a aplicação em cartões autorizados.

### RN-050 — Identidade, acesso e autoria do comentário

- **Estado:** Aprovada
- **Regra:** comentário pertence a um cartão e registra autor, data de criação e conteúdo; Administrador e Membro comentam; Observador apenas visualiza; acesso ao comentário segue acesso ao cartão/quadro.
- **Origem:** DEC-015.
- **Requisitos:** BEL-023, BEL-030.

### RN-051 — Edição do comentário próprio

- **Estado:** Aprovada
- **Regra:** autor pode editar comentário próprio enquanto tiver permissão de colaboração; comentário editado mostra “Editado”, preserva criação e registra a última alteração.
- **Origem:** DEC-015.
- **Requisitos:** BEL-023, BEL-030, BEL-032.

### RN-052 — Remoção representada sem conteúdo

- **Estado:** Aprovada
- **Regra:** autor pode excluir comentário próprio enquanto tiver permissão; comentário excluído permanece representado por indicação de remoção, sem conteúdo visível; remover o autor do quadro/Workspace não exclui comentários anteriores.
- **Origem:** DEC-006, DEC-015.
- **Requisitos:** BEL-023, BEL-030, BEL-031, BEL-032.

### RN-053 — Moderação, versões e auditoria de comentários

- **Estado:** Aprovada
- **Regra:** Administrador de quadro modera comentários de terceiros; edição, exclusão e moderação geram auditoria com minimização/acesso; versões anteriores ficam somente na auditoria autorizada, não no feed/interface colaborativa, e seguem retenção de 24 meses.
- **Origem:** DEC-010, DEC-015.
- **Requisitos:** BEL-023, BEL-030, BEL-031, BEL-032.
- **Evolução:** o escopo operacional foi posteriormente definido em RN-101 e RN-102 pela resolução de PEN-011.

### RN-054 — Arquivamento e consulta do quadro

- **Estado:** Aprovada
- **Regra:** Administrador de quadro arquiva/restaura; quadro arquivado sai da relação ativa, permanece consultável por participantes autorizados e não equivale a exclusão permanente.
- **Origem:** DEC-012.
- **Requisitos:** BEL-014.

### RN-055 — Imutabilidade operacional e preservação do quadro arquivado

- **Estado:** Aprovada
- **Regra:** quadro arquivado não aceita alterações de listas, cartões, comentários, responsáveis, etiquetas associadas ou datas; listas/cartões preservam estados individuais e participantes/papéis permanecem; restaurar recupera disponibilidade operacional e estados anteriores.
- **Origem:** DEC-012.
- **Requisitos:** BEL-003, BEL-004, BEL-012–BEL-014, BEL-021–BEL-024, BEL-026–BEL-028.

### RN-056 — Governança e rastreabilidade do arquivamento

- **Estado:** Aprovada
- **Regra:** Administrador de Workspace pode arquivar/restaurar quadro por governança sem acesso automático ao conteúdo; arquivamento/restauração geram feed e auditoria.
- **Origem:** DEC-008, DEC-012.
- **Requisitos:** BEL-014, BEL-031, BEL-032, BEL-036.

### RN-057 — Consistência visível da ordenação concorrente

- **Estado:** Aprovada
- **Regra:** ordem de listas/cartões permanece consistente para participantes; movimentações confirmadas são refletidas sem recarregamento manual e a ordem final persiste/reaparece em consultas.
- **Origem:** DEC-016.
- **Requisitos:** BEL-006–BEL-008, BEL-010.

### RN-058 — Preservação e resolução funcional de concorrência

- **Estado:** Aprovada
- **Regra:** cada movimento altera apenas o necessário; operações concorrentes em itens diferentes são preservadas sempre que possível; no mesmo item prevalece a última operação confirmada pelo servidor.
- **Origem:** DEC-016.
- **Requisitos:** BEL-006–BEL-008, BEL-010.

### RN-059 — Rejeição e integridade da ordenação

- **Estado:** Aprovada
- **Regra:** operação rejeitada atualiza/corrige a interface e informa o usuário; simultaneidade não duplica nem perde cartões; movimentos efetivados geram feed/auditoria; comportamento é equivalente para listas/cartões conforme suas diferenças.
- **Origem:** DEC-016.
- **Requisitos:** BEL-006–BEL-008, BEL-010, BEL-031, BEL-032.

### RN-060 — Visibilidade privada padrão

- **Estado:** Aprovada
- **Regra:** Workspaces e quadros são criados privados por padrão; participação no Workspace não concede acesso automático a quadros; visibilidade não altera papéis.
- **Origem:** DEC-017.
- **Requisitos:** BEL-002, BEL-026–BEL-029, BEL-034, BEL-036.

### RN-061 — Descoberta sem acesso ao conteúdo

- **Estado:** Aprovada
- **Regra:** quadro privado é descoberto apenas por participantes e Administradores do Workspace para governança; quadro visível no Workspace expõe nome/descrição básica a participantes do Workspace sem conceder conteúdo; URL/ID nunca concede acesso.
- **Origem:** DEC-017, respeitando DEC-006 e DEC-008.
- **Requisitos:** BEL-001, BEL-026, BEL-029, BEL-036.

### RN-062 — Alteração e limites de visibilidade

- **Estado:** Aprovada
- **Regra:** somente Administradores autorizados de quadro/Workspace alteram visibilidade; mudanças geram auditoria; visibilidade pública e acesso anônimo ficam fora do MVP.
- **Origem:** DEC-017.
- **Requisitos:** BEL-029, BEL-032, BEL-036.

### RN-063 — Autorização e escopo do movimento entre quadros

- **Estado:** Aprovada
- **Regra:** Administrador/Membro move cartão somente entre quadros ativos do mesmo Workspace nos quais possui escrita, com autorização em origem e destino; quadro arquivado não pode ser origem operacional nem destino.
- **Origem:** DEC-012, DEC-018.
- **Requisitos:** BEL-011, BEL-014, BEL-026–BEL-028, BEL-036.

### RN-064 — Identidade e conteúdo preservados no movimento

- **Estado:** Aprovada
- **Regra:** movimento preserva identidade/ID, título, descrição, datas, conclusão, comentários, histórico e etiquetas do catálogo compartilhado do Workspace.
- **Origem:** DEC-014, DEC-018.
- **Requisitos:** BEL-011, BEL-020, BEL-022–BEL-024.

### RN-065 — Responsáveis incompatíveis no destino

- **Estado:** Aprovada
- **Regra:** responsáveis sem elegibilidade no destino são apresentados ao usuário e removidos somente após confirmação; cancelar a confirmação cancela todo o movimento.
- **Origem:** DEC-013, DEC-018.
- **Requisitos:** BEL-011, BEL-021, BEL-026–BEL-028.

### RN-066 — Histórico, acesso e integridade do movimento

- **Estado:** Aprovada
- **Regra:** histórico permanece no cartão com autorização avaliada por evento; movimento não amplia acesso a informação privada da origem, não duplica/perde cartão, respeita concorrência e gera feed/auditoria com origem/destino.
- **Origem:** DEC-009, DEC-010, DEC-016, DEC-018.
- **Requisitos:** BEL-010, BEL-011, BEL-031, BEL-032, BEL-036.
- **Evolução:** RN-093 e RN-094 posteriormente definiram autorização por contexto, marcadores genéricos e proteção das versões históricas.

### RN-067 — Autorização, identidade e proteção das integrações

- **Estado:** Aprovada
- **Regra:** integração tem identidade rastreável, autorização explícita equivalente à operação de usuário, não acessa dados sem autorização, gera auditoria/feed aplicável e não expõe credenciais/segredos em interface, feed ou auditoria.
- **Origem:** DEC-019.
- **Requisitos:** BEL-031–BEL-033, BEL-036.

### RN-068 — Revogação, falhas e escopo de entrega das integrações

- **Estado:** Aprovada
- **Regra:** autorizado administrativo pode revogar integração; falha externa não altera silenciosamente operação concluída; API externa é pós-MVP, webhooks são da segunda entrega, importação do Trello será avaliada, conectores/automações são posteriores; API externa não se confunde com APIs internas.
- **Origem:** DEC-019.
- **Requisitos:** BEL-033.
- **Limite:** tecnologia/protocolo não definidos; webhooks futuros devem respeitar contexto autorizado e minimização.

### RN-069 — Criação administrativa e acesso da conta

- **Estado:** Aprovada
- **Regra:** somente a administração autorizada do Bello cria contas; não existe cadastro público; login utiliza e-mail e senha; somente conta ativa com e-mail verificado acessa recursos protegidos.
- **Origem:** DEC-020.
- **Requisitos:** BEL-038 e requisitos protegidos que dependem de usuário autenticado.
- **Evolução:** inicialização e autoridade foram posteriormente definidas pelas resoluções de PEN-035/PEN-036 em RN-116 a RN-125.

### RN-070 — E-mail, verificação e recuperação

- **Estado:** Aprovada
- **Regra:** e-mail é obrigatório e único; verificação é obrigatória; recuperação de senha ocorre por e-mail; alterar o endereço exige verificar o novo e-mail antes de sua efetivação para acesso.
- **Origem:** DEC-020.
- **Requisitos:** BEL-038.

### RN-071 — Identidade interna e desativação

- **Estado:** Aprovada
- **Regra:** usuário possui identificador técnico interno único e imutável, independente do e-mail; desativação preserva identidade, autoria, comentários e histórico e impede acesso protegido enquanto perdurar.
- **Origem:** DEC-020.
- **Requisitos:** BEL-023, BEL-031, BEL-032, BEL-038.

### RN-072 — Exclusão e identidade histórica

- **Estado:** Aprovada
- **Regra:** exclusão definitiva de conta depende de política posterior; auditoria e demais históricos autorizados preservam a identidade histórica dos autores.
- **Origem:** DEC-020.
- **Requisitos:** BEL-031, BEL-032, BEL-038.

### RN-073 — Elegibilidade e inclusão direta de participantes

- **Estado:** Aprovada
- **Regra:** somente conta previamente cadastrada, ativa e verificada pode ser incluída; Administrador do Workspace inclui diretamente no Workspace e Administrador de quadro inclui diretamente participante elegível que já pertença ao Workspace, sem aceite obrigatório.
- **Origem:** DEC-006, DEC-021.
- **Requisitos:** BEL-026, BEL-035, BEL-036, BEL-038.

### RN-074 — Notificação e segurança da inclusão

- **Estado:** Aprovada
- **Regra:** notificação de inclusão identifica responsável, destino e papel concedido; a operação não pode vincular identidade incorreta nem conceder acesso fora das permissões aprovadas.
- **Origem:** DEC-021.
- **Requisitos:** BEL-026, BEL-035, BEL-036.

### RN-075 — Estados dos convites pendentes

- **Estado:** Aprovada
- **Regra:** quando um fluxo aplicável gerar convite pendente, seus estados de acompanhamento incluem Pendente, Aceito, Recusado, Cancelado e Expirado; convite pendente expira após sete dias e vínculo ativado não expira.
- **Origem:** DEC-021.
- **Requisitos:** BEL-026, BEL-035.
- **Limite:** o fluxo que efetivamente utiliza convite pendente permanece em PEN-034; inclusão direta não exige aceite.

### RN-076 — Unicidade e rastreabilidade de convites/vínculos

- **Estado:** Aprovada
- **Regra:** não podem existir convites pendentes duplicados para o mesmo destinatário e recurso; inclusões, notificações e alterações relevantes produzem auditoria e feed quando aplicável.
- **Origem:** DEC-009, DEC-010, DEC-021.
- **Requisitos:** BEL-026, BEL-031, BEL-032, BEL-035.

### RN-077 — Criação e dados obrigatórios do quadro

- **Estado:** Aprovada
- **Regra:** qualquer participante autenticado, ativo e verificado de um Workspace pode criar quadro nesse Workspace; nome e descrição são obrigatórios; o quadro nasce privado.
- **Origem:** resolução de PEN-018, em conformidade com DEC-002, DEC-017 e DEC-020.
- **Requisitos:** BEL-001, BEL-029, BEL-034, BEL-036, BEL-038.

### RN-078 — Administrador inicial explícito do quadro

- **Estado:** Aprovada
- **Regra:** todo quadro mantém administrador; seu criador torna-se Administrador inicial por participação explícita, sem herança do papel de Workspace; criação e concessão devem ocorrer consistentemente.
- **Origem:** resolução de PEN-018, respeitando DEC-007 e DEC-008.
- **Requisitos:** BEL-001, BEL-026, BEL-027, BEL-036.

### RN-079 — Rastreabilidade da criação do quadro

- **Estado:** Aprovada
- **Regra:** criação do quadro e concessão do Administrador inicial produzem auditoria e eventos de feed aplicáveis.
- **Origem:** resolução de PEN-018, DEC-009 e DEC-010.
- **Requisitos:** BEL-001, BEL-031, BEL-032.

### RN-080 — Papéis do Workspace

- **Estado:** Aprovada
- **Regra:** os papéis do Workspace são Administrador e Membro; Administrador pode promover Membro e rebaixar outro Administrador.
- **Origem:** resolução de PEN-019.
- **Requisitos:** BEL-035, BEL-036.

### RN-081 — Confirmação e continuidade administrativa do Workspace

- **Estado:** Aprovada
- **Regra:** promoção e rebaixamento exigem confirmação explícita; autorrebaixamento só é permitido quando existir outro Administrador ativo; o último Administrador não perde a função sem sucessor.
- **Origem:** resolução de PEN-019, complementando DEC-005 e DEC-006.
- **Requisitos:** BEL-035, BEL-036.

### RN-082 — Consistência e rastreabilidade dos papéis do Workspace

- **Estado:** Aprovada
- **Regra:** alteração registra ator, participante, papel anterior, novo papel e momento; concorrência não pode deixar o Workspace sem Administrador; a operação não altera papéis dos quadros nem concede acesso automático ao conteúdo.
- **Origem:** resolução de PEN-019, DEC-008 e DEC-010.
- **Requisitos:** BEL-032, BEL-035, BEL-036.

### RN-083 — Lista fechada de governança do quadro

- **Estado:** Aprovada
- **Regra:** governança e conteúdo possuem autorizações independentes; sem participar do quadro, Administrador do Workspace pode gerir somente nome, descrição básica, visibilidade, participantes, papéis, arquivamento e restauração.
- **Origem:** resolução de PEN-021, refinando DEC-008.
- **Requisitos:** BEL-001, BEL-014, BEL-026–BEL-029, BEL-036.

### RN-084 — Fronteira do conteúdo do quadro

- **Estado:** Aprovada
- **Regra:** listas, cartões, comentários, feed e auditoria de conteúdo exigem participação explícita e papel apropriado; operações não listadas em RN-083 como governança também exigem participação no quadro.
- **Origem:** resolução de PEN-021, DEC-008 e DEC-010.
- **Requisitos:** BEL-003, BEL-004, BEL-023, BEL-031, BEL-032, BEL-036.

### RN-085 — Autoconcessão e respostas administrativas

- **Estado:** Aprovada
- **Regra:** Administrador do Workspace pode adicionar a si próprio explicitamente ao quadro com auditoria; respostas administrativas não revelam, nem indiretamente, conteúdo privado.
- **Origem:** resolução de PEN-021, DEC-008 e DEC-010.
- **Requisitos:** BEL-026, BEL-032, BEL-036.

### RN-086 — Administração global do catálogo de etiquetas

- **Estado:** Aprovada
- **Regra:** catálogo pertence ao Workspace; somente Administradores do Workspace criam, editam ou excluem etiquetas globais.
- **Origem:** resolução de PEN-028, refinando expressamente DEC-014.
- **Requisitos:** BEL-022, BEL-034, BEL-036.

### RN-087 — Uso e consulta das etiquetas

- **Estado:** Aprovada
- **Regra:** Administradores e Membros de quadro aplicam/removem etiquetas em cartões autorizados; Observadores visualizam; participantes do Workspace consultam o catálogo sem obter acesso a cartões privados ou associações protegidas.
- **Origem:** resolução de PEN-028, DEC-014.
- **Requisitos:** BEL-022, BEL-027, BEL-028, BEL-036.

### RN-088 — Alteração e exclusão global de etiquetas

- **Estado:** Aprovada
- **Regra:** nomes permanecem únicos no Workspace sem diferenciar caixa; nome/cor alterados refletem-se nos cartões; exclusão exige confirmação, remove associações sem excluir cartões, preserva histórico e produz feed/auditoria sem revelar dados privados.
- **Origem:** resolução de PEN-028, DEC-009, DEC-010 e DEC-014.
- **Requisitos:** BEL-022, BEL-031, BEL-032.

### RN-089 — Preparação do rebaixamento para Observador

- **Estado:** Aprovada
- **Regra:** somente Administrador autorizado altera papel no quadro; antes de rebaixar para Observador, identifica atribuições existentes, informa sua quantidade e explica que serão removidas sem excluir cartões; cartões só são identificados para quem possui acesso ao conteúdo.
- **Origem:** resolução de PEN-029, DEC-007 e DEC-013.
- **Requisitos:** BEL-021, BEL-027, BEL-028, BEL-036.

### RN-090 — Confirmação e consistência do rebaixamento

- **Estado:** Aprovada
- **Regra:** quando houver atribuições afetadas, confirmação adicional é obrigatória; confirmada a operação, remoções e novo papel são efetivados consistentemente, sem estado parcial; falha mantém a situação anterior.
- **Origem:** resolução de PEN-029.
- **Requisitos:** BEL-021, BEL-027, BEL-028.

### RN-091 — Revalidação e rastreabilidade do rebaixamento

- **Estado:** Aprovada
- **Regra:** impacto alterado durante a operação exige revalidação e nova confirmação; alteração e remoções geram feed/auditoria; histórico, comentários e autoria permanecem; promoção futura não restaura atribuições; último Administrador continua protegido.
- **Origem:** resolução de PEN-029, DEC-009, DEC-010 e DEC-013.
- **Requisitos:** BEL-021, BEL-026–BEL-028, BEL-031, BEL-032.

### RN-092 — Autorização histórica após movimento

- **Estado:** Aprovada
- **Regra:** movimento não elimina histórico; cada evento preserva contexto de autorização da origem e é consultado com permissões atuais sobre esse contexto; não existe acesso retroativo ao quadro de origem.
- **Origem:** resolução de PEN-031, DEC-008 e DEC-018.
- **Requisitos:** BEL-011, BEL-031, BEL-032, BEL-036.

### RN-093 — Marcadores históricos e cronologia

- **Estado:** Aprovada
- **Regra:** eventos autorizados podem ser exibidos; evento não autorizado aparece como marcador genérico sem dados privados; a cronologia é preservada e a autorização é reavaliada em cada consulta, conforme os controles próprios de feed e auditoria.
- **Origem:** resolução de PEN-031, DEC-009, DEC-010 e DEC-018.
- **Requisitos:** BEL-011, BEL-031, BEL-032, BEL-036.

### RN-094 — Comentários no cartão movimentado

- **Estado:** Aprovada
- **Regra:** comentários atuais acompanham o cartão e são acessíveis a participantes autorizados do destino; versões históricas permanecem protegidas pela autorização de auditoria de conteúdo.
- **Origem:** resolução de PEN-031, DEC-015 e DEC-018.
- **Requisitos:** BEL-011, BEL-023, BEL-031, BEL-032.

### RN-095 — Matriz seletiva de valores auditados

- **Estado:** Aprovada
- **Regra:** auditoria registra metadados mínimos e valores anteriores/novos seletivamente por matriz de entidade, operação, campo e sensibilidade; cobre conteúdo, moderação, concessão de acesso e governança.
- **Origem:** política aprovada de valores e redação, complementando DEC-010.
- **Requisitos:** BEL-001, BEL-023, BEL-026, BEL-030, BEL-032, BEL-035, BEL-036.
- **Evolução:** o preenchimento concreto foi aprovado na resolução de PEN-037 e consta na matriz funcional mínima após RN-130; nenhum valor fora dela pode ser presumido sem nova classificação.

### RN-096 — Segredos, conteúdo privado e redação

- **Estado:** Aprovada
- **Regra:** auditoria não armazena senhas, tokens ou segredos recuperáveis; conteúdo privado e versões de comentários exigem auditoria de conteúdo autorizada; usa “Conteúdo restrito” quando seguro e omite o campo nos demais casos.
- **Origem:** política aprovada de valores e redação, DEC-010 e DEC-015.
- **Requisitos:** BEL-023, BEL-030, BEL-032, BEL-038.

### RN-097 — Autorização da apresentação auditada

- **Estado:** Aprovada
- **Regra:** acesso é reavaliado em cada consulta; Administrador do Workspace sem participação vê apenas auditoria administrativa; redação da apresentação não altera o registro original nem sua retenção de 24 meses.
- **Origem:** política aprovada de valores e redação, DEC-008 e DEC-010.
- **Requisitos:** BEL-032, BEL-035, BEL-036.

### RN-098 — Fuso regional do Workspace

- **Estado:** Aprovada
- **Regra:** todo Workspace possui fuso horário regional de referência; Administradores podem alterá-lo; deslocamento UTC fixo não substitui fuso regional.
- **Origem:** resolução de PEN-030, complementando DEC-011.
- **Requisitos:** BEL-024, BEL-034, BEL-036.

### RN-099 — Datas civis e atraso

- **Estado:** Aprovada
- **Regra:** início e vencimento são datas civis no calendário do Workspace; vencimento ocorre no final do dia nesse fuso; atraso começa depois desse instante somente enquanto o cartão estiver Pendente e é consistente entre regiões.
- **Origem:** resolução de PEN-030, DEC-011.
- **Requisitos:** BEL-024.

### RN-100 — Alteração do fuso e instantes históricos

- **Estado:** Aprovada
- **Regra:** eventos e auditoria registram instantes reais; alterar o fuso preserva datas civis, recalcula instantes de vencimento e não altera instantes históricos; a alteração respeita autorização e gera feed/auditoria aplicáveis.
- **Origem:** resolução de PEN-030, DEC-009, DEC-010 e DEC-011.
- **Requisitos:** BEL-024, BEL-031, BEL-032, BEL-034, BEL-036.

### RN-101 — Escopo da moderação de comentários

- **Estado:** Aprovada
- **Regra:** somente Administrador do quadro modera comentário de terceiro; moderação remove o conteúdo da visualização colaborativa, não permite reescrita e exibe “Comentário removido”, preservando autoria original e identidade do moderador.
- **Origem:** resolução de PEN-011, DEC-007 e DEC-015.
- **Requisitos:** BEL-023, BEL-030.

### RN-102 — Confirmação, justificativa e histórico da moderação

- **Estado:** Aprovada
- **Regra:** moderação exige confirmação e justificativa obrigatória restrita à auditoria autorizada; gera feed/auditoria sem texto removido; conteúdo anterior só permanece na auditoria de conteúdo pelo prazo aplicável; não há restauração no MVP e o histórico movido segue RN-092 a RN-094.
- **Origem:** resolução de PEN-011, DEC-009, DEC-010 e DEC-015.
- **Requisitos:** BEL-023, BEL-030–BEL-032.

### RN-103 — Arquivamento e estados de lista/cartão

- **Estado:** Aprovada
- **Regra:** arquivar lista preserva estados individuais dos cartões e deixa o conteúdo arquivado somente para consulta autorizada; restaurar lista reativa apenas cartões não arquivados individualmente.
- **Origem:** definição complementar aprovada de restauração, DEC-001 e DEC-012 por analogia de preservação de estados.
- **Requisitos:** BEL-012, BEL-013.

### RN-104 — Posição na restauração da lista

- **Estado:** Aprovada
- **Regra:** restaurar lista tenta recuperar a posição anterior; sem posição original válida, utiliza a posição válida mais próxima.
- **Origem:** definição complementar aprovada de restauração.
- **Requisitos:** BEL-013.

### RN-105 — Lista e posição na restauração do cartão

- **Estado:** Aprovada
- **Regra:** restaurar cartão tenta recuperar lista/posição anteriores; se a lista estiver arquivada, o usuário deve restaurá-la explicitamente primeiro ou escolher outra lista ativa; restaurar cartão nunca restaura automaticamente a lista inteira.
- **Origem:** definição complementar aprovada de restauração.
- **Requisitos:** BEL-012, BEL-013.

### RN-106 — Preservação e rastreabilidade da restauração

- **Estado:** Aprovada
- **Regra:** arquivamento/restauração preservam conteúdo, responsáveis, etiquetas, datas, conclusão e histórico conforme autorização e produzem feed/auditoria aplicáveis.
- **Origem:** definição complementar aprovada de restauração, DEC-009 a DEC-015.
- **Requisitos:** BEL-012, BEL-013, BEL-021–BEL-024, BEL-031, BEL-032.

### RN-107 — Limites dos campos

- **Estado:** Aprovada
- **Regra:** limites máximos são: Workspace nome 100 e descrição 2.000; quadro nome 100 e descrição 2.000; lista nome 100; cartão título 200 e descrição 20.000; comentário 10.000; etiqueta nome 50 caracteres.
- **Origem:** validação de campos aprovada.
- **Requisitos:** BEL-001, BEL-003, BEL-004, BEL-022, BEL-023, BEL-034.

### RN-108 — Obrigatoriedade e normalização dos campos

- **Estado:** Aprovada
- **Regra:** são obrigatórios nome do Workspace, nome/descrição do quadro, nome da lista, título do cartão, conteúdo do comentário e nome da etiqueta; campos obrigatórios não contêm apenas espaços; somente extremidades de nomes/títulos são aparadas; descrição de Workspace/cartão é opcional; conteúdo interno de comentários/descrições não é normalizado.
- **Origem:** validação de campos aprovada.
- **Requisitos:** BEL-001, BEL-003, BEL-004, BEL-022, BEL-023, BEL-034.

### RN-109 — Unicode, repetição e consistência da validação

- **Estado:** Aprovada
- **Regra:** campos aceitam Unicode, acentos e múltiplos idiomas; nomes de quadros/listas podem se repetir; etiquetas mantêm unicidade no Workspace; comentários exigem conteúdo significativo; validação independe da interface, informa erros claramente e dados inválidos não geram alteração parcial nem evento falso de sucesso.
- **Origem:** validação de campos aprovada, DEC-014.
- **Requisitos:** BEL-001, BEL-003, BEL-004, BEL-022, BEL-023, BEL-032, BEL-034.

### RN-110 — Retenção e ordem do feed

- **Estado:** Aprovada
- **Regra:** eventos colaborativos do feed são preservados durante a vida útil da entidade, sem expiração automática por idade, em ordem cronológica decrescente e estável; arquivamento e remoção/desativação do participante não eliminam eventos nem autoria histórica.
- **Origem:** definição complementar aprovada do feed, DEC-009 e DEC-020.
- **Requisitos:** BEL-031, BEL-038.

### RN-111 — Navegação e filtro do feed

- **Estado:** Aprovada
- **Regra:** feed permite navegação progressiva até eventos antigos e filtro simples por tipo de atividade no MVP; feed do cartão contém seus eventos e feed do quadro agrega apenas eventos autorizados; reordenações repetitivas podem ser agrupadas visualmente.
- **Origem:** definição complementar aprovada do feed, DEC-009.
- **Requisitos:** BEL-031.

### RN-112 — Proteção contínua do feed

- **Estado:** Aprovada
- **Regra:** consulta reavalia permissões atuais e RN-092/RN-093; feed não expõe segredos, versões protegidas nem conteúdo exclusivo da auditoria; sua retenção por vida da entidade é independente dos 24 meses da auditoria.
- **Origem:** definição complementar aprovada do feed, DEC-009 e DEC-010.
- **Requisitos:** BEL-031, BEL-032, BEL-036.

### RN-113 — Separação e apresentação da auditoria

- **Estado:** Aprovada
- **Regra:** somente usuários autorizados por DEC-010 consultam auditoria; administrativa e conteúdo permanecem separadas; apresentação é cronológica decrescente e estável e mostra identificador, data/hora, ator, operação, resultado e contexto autorizado.
- **Origem:** definição complementar aprovada da consulta de auditoria, DEC-010.
- **Requisitos:** BEL-032, BEL-036.

### RN-114 — Filtros e detalhes da auditoria

- **Estado:** Aprovada
- **Regra:** consulta oferece filtros por período, entidade, operação, resultado e ator; detalhes exibem valores anteriores/novos conforme RN-095 a RN-097, omitindo ou redigindo campos protegidos e reavaliando acesso a cada consulta.
- **Origem:** definição complementar aprovada da consulta de auditoria, DEC-010.
- **Requisitos:** BEL-032.

### RN-115 — Navegação, acessos negados e limite da auditoria

- **Estado:** Aprovada
- **Regra:** auditoria permite navegação progressiva até 24 meses e não permite alteração direta nem exportação no MVP; tentativas relevantes de acesso negado aparecem na auditoria administrativa autorizada sem conteúdo privado.
- **Origem:** definição complementar aprovada da consulta de auditoria, DEC-010.
- **Requisitos:** BEL-032, BEL-036.

### RN-116 — Inicialização da primeira administração global

- **Estado:** Aprovada
- **Regra:** instalação nova exige uma primeira conta com atribuição explícita de Administrador Global, criada por procedimento controlado de inicialização autorizado pelo responsável pela instalação; o procedimento não oferece cadastro público.
- **Origem:** resolução de PEN-035, complementando DEC-020.
- **Requisitos:** BEL-038.
- **Limite:** esta regra não escolhe ferramenta, script, comando ou tecnologia de inicialização.

### RN-117 — Identidade e acesso da primeira conta

- **Estado:** Aprovada
- **Regra:** a primeira conta usa e-mail único, verificado antes do acesso administrativo, e identificador interno único e imutável independente do e-mail; sua atribuição global não a vincula automaticamente a Workspace algum.
- **Origem:** resolução de PEN-035, DEC-008 e DEC-020.
- **Requisitos:** BEL-035, BEL-036, BEL-038.

### RN-118 — Unicidade e não repetição da inicialização

- **Estado:** Aprovada
- **Regra:** a inicialização comum não cria Administradores Globais iniciais duplicados e não pode ser repetida quando já existir administração global ativa.
- **Origem:** resolução de PEN-035.
- **Requisitos:** BEL-038.

### RN-119 — Rastreabilidade inicial e recuperação de emergência

- **Estado:** Aprovada
- **Regra:** criação inicial produz rastreabilidade administrativa mesmo quando ainda não existe conta autora, registrando origem identificável; recuperação administrativa de emergência exige procedimento excepcional controlado e nunca habilita cadastro público.
- **Origem:** resolução de PEN-035, DEC-010 e DEC-020.
- **Requisitos:** BEL-032, BEL-038.
- **Limite:** o procedimento excepcional não é tecnicamente definido nesta especificação.

### RN-120 — Administração global de contas

- **Estado:** Aprovada
- **Regra:** somente Administradores Globais criam, desativam e reativam contas; o Bello admite múltiplos Administradores Globais; criação exige e-mail único e verificação antes do acesso protegido.
- **Origem:** resolução de PEN-036, DEC-020.
- **Requisitos:** BEL-038.

### RN-121 — Concessão, revogação e continuidade global

- **Estado:** Aprovada
- **Regra:** Administrador Global pode conceder/revogar a atribuição global com autorização e confirmação explícita; deve permanecer pelo menos um Administrador Global ativo e apto, inclusive diante de operações concorrentes.
- **Origem:** resolução de PEN-036.
- **Requisitos:** BEL-032, BEL-038.

### RN-122 — Credenciais, recuperação e reativação

- **Estado:** Aprovada
- **Regra:** Administrador Global não consulta senhas ou credenciais secretas; recuperação/redefinição verifica a identidade do titular sem revelar senha anterior; reativação reaplica controles de identidade e elegibilidade.
- **Origem:** resolução de PEN-036, DEC-020.
- **Requisitos:** BEL-032, BEL-038.

### RN-123 — Desativação e sucessão nos recursos

- **Estado:** Aprovada
- **Regra:** desativação revoga acesso operacional e preserva identidade, autoria e histórico; é bloqueada enquanto o usuário for o último Administrador ativo de qualquer Workspace ou quadro, exigindo sucessor ativo nos recursos afetados antes da confirmação.
- **Origem:** resolução de PEN-036, DEC-005, DEC-007 e DEC-020.
- **Requisitos:** BEL-026, BEL-027, BEL-032, BEL-035, BEL-036, BEL-038.

### RN-124 — Independência e limitação do Administrador Global

- **Estado:** Aprovada
- **Regra:** atribuição global é independente dos papéis de Workspace/quadro e não concede acesso a seus conteúdos nem à auditoria de conteúdo; verificação de sucessão e demais operações globais não revelam conteúdo privado dos recursos.
- **Origem:** resolução de PEN-036, DEC-008 e DEC-010.
- **Requisitos:** BEL-032, BEL-035, BEL-036, BEL-038.

### RN-125 — Consistência e auditoria da administração global

- **Estado:** Aprovada
- **Regra:** operações globais de contas exigem autorização, confirmação explícita e auditoria administrativa protegida; concorrência e falhas não podem deixar a plataforma, Workspace ou quadro sem administração nem produzir alteração parcial.
- **Origem:** resolução de PEN-036, DEC-010 e DEC-016.
- **Requisitos:** BEL-010, BEL-032, BEL-035, BEL-036, BEL-038.

### RN-126 — Classificação obrigatória dos eventos auditados

- **Estado:** Aprovada
- **Regra:** toda operação sujeita à auditoria obrigatória possui classificação funcional; cada evento registra identificador, instante, ator ou origem identificável, operação, resultado e contexto mínimo autorizado; operação nova deve receber classificação e política de campos antes de entrar em produção.
- **Origem:** resolução de PEN-037, complementando DEC-010.
- **Requisitos:** BEL-032 e todos os requisitos com mutações auditáveis.

### RN-127 — Transições e versões protegidas

- **Estado:** Aprovada
- **Regra:** valores anteriores/novos são registrados somente quando previstos na matriz; papéis, vínculos, estados de conta e permissões registram transições; edições de títulos, descrições e comentários preservam versões anterior/nova sob auditoria de conteúdo autorizada.
- **Origem:** resolução de PEN-037, DEC-010 e DEC-015.
- **Requisitos:** BEL-001, BEL-004, BEL-023, BEL-026, BEL-027, BEL-030, BEL-032, BEL-035, BEL-038.

### RN-128 — Autenticação auditada sem segredos

- **Estado:** Aprovada
- **Regra:** logins bem-sucedidos/malsucedidos, recuperação de senha e alterações de e-mail são auditados; senhas, tokens, códigos de recuperação e credenciais nunca são preservados em formato recuperável.
- **Origem:** resolução de PEN-037, DEC-010 e DEC-020.
- **Requisitos:** BEL-032, BEL-038.

### RN-129 — Escopos, autorização histórica e redação

- **Estado:** Aprovada
- **Regra:** auditorias global, administrativa de Workspace e de conteúdo têm acessos distintos; classificação administrativa não concede visibilidade a todo administrador; consulta respeita permissão atual e contexto original; informação protegida é redigida/omitida sem alterar retenção de 24 meses.
- **Origem:** resolução de PEN-037, DEC-008, DEC-010 e resolução de PEN-031.
- **Requisitos:** BEL-031, BEL-032, BEL-035, BEL-036, BEL-038.

### RN-130 — Auditoria mínima de movimentos e reordenações

- **Estado:** Aprovada
- **Regra:** movimento/reordenação registra item, origem, destino, posição relativa relevante e resultado; não registra cópia completa da ordenação do quadro a cada operação.
- **Origem:** resolução de PEN-037, DEC-010 e DEC-016.
- **Requisitos:** BEL-006–BEL-011, BEL-032.

### Matriz funcional mínima de auditoria

A matriz abaixo integra RN-126 a RN-130. Armazenar um valor não concede permissão para consultá-lo.

| Entidade / operação | Valores auditados | Escopo de acesso |
|---|---|---|
| Conta — criação, desativação, reativação | identificador e transição de estado | administração global |
| Conta — alteração de e-mail | identidade e e-mail anterior/novo protegidos | administração global protegida |
| Conta — concessão/revogação de Administrador Global | identidade e atribuição global anterior/nova | administração global protegida |
| Autenticação — login e falha | identidade conhecida, tipo, resultado e momento | segurança |
| Recuperação de senha | tipo, resultado, instante e contexto mínimo, sem segredos | segurança |
| Workspace — criação e configuração | identificador, nome, descrição e alterações administrativas pertinentes | governança do Workspace |
| Workspace — participantes e papéis | identificador do participante e papéis anteriores/novos | governança do Workspace |
| Quadro — criação e configuração | identificador, nome, descrição, visibilidade e estado de arquivamento | governança do quadro |
| Quadro — participantes e papéis | identificadores e transições de papéis | governança do quadro |
| Lista — criação, renomeação, movimentação, arquivamento e restauração | identificador, nome, posição e estado conforme a alteração | conteúdo |
| Cartão — criação, título e descrição | identificador e valores alterados conforme sensibilidade | conteúdo protegido |
| Cartão — movimentação e ordenação | item, origem, destino, posição relativa e resultado | conteúdo protegido |
| Cartão — datas e conclusão | datas, estado, ator e instante de conclusão | conteúdo |
| Cartão — responsáveis | identificadores adicionados/removidos | conteúdo |
| Cartão — etiquetas | identificadores adicionados/removidos | conteúdo |
| Comentário — criação, edição, exclusão | autor, instante, operação e conteúdo/versões quando necessário e permitido | conteúdo altamente protegido |
| Comentário — moderação | comentário, moderador, justificativa e estado anterior/novo | conteúdo altamente protegido |
| Etiqueta global — criação, edição, exclusão | identificador, nome e cor, sem associações privadas | governança do Workspace |
| Acesso negado relevante | identidade conhecida, operação, resultado e contexto mínimo | segurança ou administração autorizada |

Administrador Global não adquire acesso à auditoria de conteúdo apenas por administrar a plataforma. Permanecem válidas DEC-010, DEC-015, as resoluções de PEN-021/PEN-031 e RN-095 a RN-097.

## Propostas históricas

### RP-001 — Arquivamento de contêiner sem cascata de estado

- **Estado:** Resolvida
- **Proposta:** arquivar lista ou quadro poderia ocultar descendentes sem mudar individualmente o estado de cada um.
- **Motivação:** preservar a distinção entre estado próprio e visibilidade herdada.
- **Requisitos afetados:** BEL-012–BEL-014.
- **Resolução:** DEC-012 aprovou preservação dos estados individuais e bloqueio operacional do quadro arquivado.

### RP-002 — Menor visibilidade inicial

- **Estado:** Resolvida
- **Proposta:** novos Workspaces e quadros poderiam começar com o menor escopo de acesso disponível.
- **Motivação:** reduzir exposição acidental.
- **Requisitos afetados:** BEL-029, BEL-034.
- **Resolução:** DEC-017 aprovou privacidade padrão e descoberta controlada.

### RP-003 — Matriz explícita de preservação

- **Estado:** Resolvida parcialmente
- **Proposta:** toda operação de cópia ou movimento entre quadros deveria declarar, por campo e relação, o que mantém, remove ou recria.
- **Motivação:** evitar perdas silenciosas.
- **Requisitos afetados:** BEL-011, BEL-017–BEL-020.
- **Resolução:** DEC-018 aprovou a matriz do movimento de cartões; cópias e movimento de listas continuam sem decisão.

## Propostas resolvidas

### RP-004 — Separação de acesso ao feed e à auditoria

- **Estado:** Resolvida
- **Proposta original:** especificar separadamente as permissões de consulta do feed e da auditoria.
- **Resolução:** DEC-007 aprovou a separação inicial de acesso; DEC-009 e DEC-010 aprovaram níveis, cobertura, acesso e proteção de ambos os conceitos.
- **Requisitos afetados:** BEL-031, BEL-032, BEL-036.

## Pendências resolvidas

| ID | Pendência original | Resolução |
|---|---|---|
| PEN-001 | operações de administração do Workspace | resolvida por DEC-005 e pelas definições aprovadas de PEN-018/PEN-019; administração global de contas foi posteriormente resolvida em PEN-036 |
| PEN-002 | relação entre participante de Workspace e participante de quadro | resolvida por DEC-006 e DEC-008 |
| PEN-003 | permissões de Administrador, Membro e Observador | resolvida para quadro por DEC-007 e para Workspace pela resolução de PEN-019 |
| PEN-004 | herança e precedência entre Workspace e quadro | resolvida por DEC-008: escopos separados e sem acesso operacional automático |
| PEN-005 | atividades exibidas no feed e sua visibilidade | resolvida por DEC-009 |
| PEN-006 | operações auditadas, dados, retenção e acesso | resolvida por DEC-010, RN-032–RN-038 e matriz mínima aprovada na resolução de PEN-037 |
| PEN-020 | consulta da auditoria por administrador do Workspace sem participação no quadro | resolvida por DEC-010: somente eventos administrativos, sem detalhes privados de conteúdo |
| PEN-007 | significado funcional de conclusão | resolvida por DEC-011 |
| PEN-009 | elegibilidade de responsáveis | resolvida por DEC-013 e complementada pela resolução de PEN-029 para rebaixamento a Observador |
| PEN-010 | escopo das etiquetas | resolvida por DEC-014 e refinada pela resolução de PEN-028 quanto à autoridade global |
| PEN-008 | inclusão de fechamento/reabertura de quadro no MVP | resolvida por DEC-012 |
| PEN-012 | comportamento de ordenações concorrentes | resolvida por DEC-016 |
| PEN-013 | opções e padrão de visibilidade | resolvida por DEC-017 |
| PEN-014 | movimento entre quadros | resolvida para cartões por DEC-018; movimento de listas permanece fora do aprovado |
| PEN-011 | moderação de comentários | resolvida por RN-101/RN-102: remoção confirmada da visualização, sem reescrita/restauração, com justificativa e auditoria protegida |
| PEN-018 | autorização para criar quadro | resolvida por RN-077–RN-079: qualquer participante ativo/verificado do Workspace cria, tornando-se Administrador explícito inicial |
| PEN-019 | promoção e rebaixamento de Administradores do Workspace | resolvida por RN-080–RN-082, preservando último Administrador e separação dos papéis de quadro |
| PEN-021 | fronteira entre governança e conteúdo | resolvida pela lista fechada de RN-083–RN-085 |
| PEN-028 | autoridade sobre etiquetas compartilhadas | resolvida por RN-086–RN-088, refinando expressamente DEC-014 |
| PEN-029 | responsável rebaixado para Observador | resolvida por RN-089–RN-091 com confirmação adicional, consistência e revalidação |
| PEN-030 | fuso e interpretação temporal | resolvida por RN-098–RN-100 com data civil e fuso regional do Workspace |
| PEN-031 | histórico após movimento | resolvida por RN-092–RN-094 com autorização por contexto e marcador genérico |
| PEN-035 | primeira conta administrativa global | resolvida por RN-116–RN-119: inicialização controlada, sem cadastro público, não repetível e auditável |
| PEN-036 | administração global de contas | resolvida por RN-120–RN-125: Administradores Globais, continuidade, sucessão e segregação de conteúdo |
| PEN-037 | matriz de valores auditados | resolvida por RN-126–RN-130 e pela matriz funcional mínima obrigatória |

## Pendências funcionais

Os itens abaixo não são regras:

| ID | Pendência | Requisitos | Decisão |
|---|---|---|---|
| PEN-015 | exclusão permanente e recuperação | BEL-015 | decisão futura |
| PEN-016 | cópia e preservação | BEL-017–BEL-020 | decisão futura |
| PEN-017 | existência futura de convidado | BEL-037 | decisão futura |
| PEN-032 | autoridade e fluxo de concessão/revogação de integrações externas | BEL-033, BEL-036 | decisão futura |
| PEN-033 | escopo funcional da importação autorizada do Trello | BEL-033 | decisão futura |
| PEN-034 | delimitar quando um convite pendente existe, pois DEC-021 aprovou inclusão direta de contas existentes sem aceite obrigatório | BEL-026, BEL-035, BEL-036 | decisão futura; não altera inclusão direta aprovada |

## Pendências técnicas futuras de auditoria

Os itens abaixo não definem solução e não alteram as regras funcionais aprovadas:

| ID | Pendência técnica | Relacionamento |
|---|---|---|
| PEN-022 | estratégia de armazenamento | DEC-010, BEL-032 |
| PEN-023 | garantias de consistência entre mutação e auditoria | DEC-010, RN-032, RN-036 |
| PEN-024 | proteção contra adulteração | DEC-010, RN-036 |
| PEN-025 | mecanismo de expiração e descarte após 24 meses | DEC-010, RN-037 |
| PEN-026 | tratamento de falhas e indisponibilidade | DEC-010, RN-036 |
| PEN-027 | desempenho e estratégia de consulta | DEC-010, BEL-032 |

