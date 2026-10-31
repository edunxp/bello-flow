# Segurança e autorização

## Escopo

Este documento detalha as responsabilidades decorrentes de [AT-001](decisoes-tecnicas.md#at-001--autenticação-e-segurança-das-sessões), [AT-002](decisoes-tecnicas.md#at-002--autorização-centralizada), [AT-008](decisoes-tecnicas.md#at-008--bootstrap-e-migrations) e [AT-009](decisoes-tecnicas.md#at-009--e-mails-e-notificações). Ele não redefine os papéis funcionais.

## Identidade, senha e sessão

- Contas são criadas somente pela Administração Global ou, para a primeira conta, pelo bootstrap controlado.
- Não existe cadastro público.
- A identidade interna imutável é distinta do e-mail mutável.
- Senhas utilizam Argon2id e não podem ser recuperadas por administradores.
- A sessão persistida é o estado revogável de autenticação.
- O Angular não recebe token de sessão para armazenamento em APIs JavaScript persistentes.
- Inatividade de 8 horas e vida absoluta de 7 dias são limites independentes; atingir qualquer deles invalida a sessão.
- Múltiplas sessões por usuário são permitidas, com revogação individual e encerramento global.
- Redefinição de senha ou desativação revoga todas as sessões existentes.
- Cookies, CSRF, origem e HTTPS formam controles complementares; nenhum deles substitui a autorização do recurso.

A configuração concreta de domínio, caminho, atributo `SameSite` e demais propriedades do cookie permanece pendente e deve ser validada contra a topologia real.

## Fluxo de uma requisição protegida

1. Validar transporte seguro, origem e proteção CSRF quando a operação for mutável.
2. Resolver a sessão persistida sem registrar seu identificador em logs.
3. Validar expiração por inatividade e absoluta.
4. Validar conta ativa e e-mail verificado quando exigido.
5. Carregar o estado atual necessário à política do domínio.
6. Avaliar ação, recurso, participação e papel, com negação por padrão.
7. Para mutação sensível, repetir a validação relevante dentro da transação.
8. Auditar a negativa quando funcionalmente relevante, sem revelar conteúdo privado.

## Escopos de autorização

| Escopo | Exemplos de autoridade | Não concede automaticamente |
|---|---|---|
| Global | administrar contas e atribuição de Administrador Global | participação em Workspace, quadro ou auditoria de conteúdo |
| Workspace | participantes, papéis, fuso, etiquetas globais e governança autorizada de quadros | listas, cartões, comentários, feed ou auditoria de conteúdo |
| Governança de quadro | dados básicos, visibilidade, participantes, papéis e arquivamento | conteúdo sem participação explícita |
| Conteúdo de quadro | listas, cartões e colaboração conforme papel | administração global ou do Workspace |
| Auditoria | consulta do escopo administrativo ou de conteúdo autorizado | dados fora do contexto e da permissão atuais |

Essas fronteiras implementam DEC-006, DEC-007 e DEC-008, além de RN-083–RN-085 e RN-124.

## Serviço central de políticas

O serviço central deve:

- organizar políticas por domínio, evitando uma matriz monolítica desconectada do recurso;
- receber contexto explícito de usuário, ação e recurso;
- consultar papéis e vínculos atuais no backend;
- produzir apenas as informações necessárias para permitir, negar ou aplicar redação;
- ser reutilizado por HTTP, serviços internos, WebSocket, feed e auditoria;
- restringir a consulta na origem, em vez de carregar dados proibidos para filtrá-los depois;
- diferenciar 404 de 403 conforme o risco de revelar a existência do recurso;
- não manter cache persistente de permissões entre requisições no MVP.

## WebSocket

A autenticação inicial do WebSocket não autoriza indefinidamente a conexão. Inscrições são avaliadas por quadro, e sessão, conta, participação e papel precisam ser reavaliados quando aplicável. Remoção, desativação ou mudança de papel invalida as inscrições afetadas antes de novas entregas protegidas.

## Bootstrap e recuperação administrativa

- A primeira conta é criada por CLI administrativa não pública.
- A execução é autorizada pelo responsável pela instalação e protegida contra concorrência.
- Identidade, papel global, estado de conclusão e auditoria inicial formam uma unidade atômica.
- A origem administrativa precisa ser rastreável mesmo sem uma conta autora anterior.
- O bootstrap comum não pode ser reutilizado quando já houver Administração Global ativa.
- Recuperação emergencial é um procedimento offline separado, controlado e auditado, priorizando a recuperação de conta existente.
- A recuperação não concede participação em Workspaces ou quadros.

O comando, formato de autorização e mecanismo operacional da CLI serão definidos posteriormente.

## Tokens de verificação e recuperação

- O valor enviado é aleatório, de uso único e limitado no tempo.
- A estrutura de validação persiste somente hash suficiente para verificar a apresentação futura.
- Verificação expira em 24 horas; recuperação de senha expira em 30 minutos.
- Recuperação não confirma publicamente a existência da conta.
- Redefinição bem-sucedida revoga sessões e produz auditoria sem o token.
- Logs, feed e auditoria não registram o valor do link, cookie ou token.

A representação segura do link nas solicitações de envio persistidas ainda precisa de detalhamento; ver [pendências técnicas](pendencias-tecnicas.md).

## Respostas e minimização

- Negativas usam 404 quando revelar a existência for indevido e 403 nas demais situações.
- Mensagens de recuperação mantêm resposta externa indistinguível para contas existentes e inexistentes.
- Consultas administrativas não retornam conteúdo usado apenas para decidir autorização.
- Auditoria de negativa registra contexto mínimo e autorizado.
- Logs técnicos não substituem auditoria e não devem conter conteúdo sensível desnecessário.

## Rastreabilidade

- [BEL-026–BEL-032, BEL-035, BEL-036 e BEL-038](../produto/requisitos-funcionais.md)
- [DEC-006–DEC-010, DEC-017, DEC-020 e DEC-021](../produto/decisoes-funcionais.md)
- [RN-007–RN-009, RN-017–RN-025, RN-083–RN-097 e RN-116–RN-129](../produto/regras-de-negocio.md)

