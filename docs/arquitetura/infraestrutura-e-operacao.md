# Infraestrutura e operação

## Escopo

Este documento detalha [AT-007](decisoes-tecnicas.md#at-007--infraestrutura-e-recuperação), [AT-008](decisoes-tecnicas.md#at-008--bootstrap-e-migrations) e [AT-009](decisoes-tecnicas.md#at-009--e-mails-e-notificações). Não contém configuração executável.

## Topologia inicial com Docker Compose

Serviços permanentes mínimos:

| Serviço | Responsabilidade | Exposição |
|---|---|---|
| aplicação | Angular compilado, API NestJS, WebSocket e processador interno de notificações | HTTPS/WSS através da terminação segura aplicável |
| PostgreSQL | dados de negócio, sessões, feed, auditoria, revisões e pendências de envio | rede interna, sem porta pública |

Dependências externas:

- provedor SMTP ou API de e-mail configurável;
- destino externo protegido de backups;
- terminação TLS, quando não estiver incorporada à hospedagem escolhida.

Desenvolvimento pode separar o servidor Angular do backend e usar um capturador de e-mails, mas esses componentes não são requisitos da implantação do MVP.

## Ambientes e configuração

- Produção possui configuração própria e imagens versionadas.
- Código da aplicação não é montado de forma mutável em produção.
- Segredos não entram em código, imagem ou versionamento.
- Aplicação e banco possuem healthchecks adequados às suas responsabilidades.
- Atividade e prontidão são verificações distintas.
- Política de reinício não substitui diagnóstico de falhas recorrentes.
- Logs são controlados e não contêm segredos.

Arquivos Compose, imagens, portas e mecanismo de segredos serão definidos na implementação.

## Banco e persistência operacional

- O armazenamento do PostgreSQL é persistente.
- A credencial operacional é distinta das credenciais de migration e manutenção da auditoria.
- O banco não é acessível publicamente.
- Capacidade, conexões, disco e crescimento de auditoria são monitorados.
- Atualizações e migrations possuem janela, validação e plano de recuperação.

## Backups e recuperação

| Objetivo | Valor aprovado |
|---|---|
| Estratégia-base | backup-base com arquivamento WAL |
| RPO-alvo | até 1 hora |
| RTO-alvo | até 4 horas |
| Teste de restauração | mensal, em ambiente isolado |

Backups devem ser automatizados, externos, protegidos e verificáveis. A restauração precisa preservar as garantias de auditoria, sessões, papéis, vínculos e retenção. RPO e RTO são metas; somente exercícios medidos podem demonstrar seu cumprimento.

Destino, criptografia operacional, retenção de backups e ferramenta de backup permanecem pendentes.

## Migrations

- Prisma é a ferramenta aprovada para migrations do modelo principal.
- Execução ocorre como etapa administrativa separada da inicialização comum da aplicação.
- A credencial possui apenas os privilégios necessários ao procedimento.
- Artefatos são versionados e validados antes de produção.
- Compatibilidade entre aplicação e banco é verificada antes da entrada em serviço.
- Cada mudança possui procedimento de recuperação compatível com sua natureza.
- Nenhuma migration foi criada nesta consolidação documental.

## Bootstrap e emergência

- A CLI de bootstrap é administrativa, não pública e de uso único.
- Concorrência não pode produzir dois primeiros administradores.
- Conclusão persistida impede repetição comum.
- Evidência e auditoria registram a origem autorizada.
- Recuperação emergencial offline é um procedimento distinto e prioriza conta existente.
- O mecanismo concreto será especificado antes da implementação.

## E-mails e Central de Notificações

Solicitações de e-mail são persistidas no PostgreSQL e processadas depois do commit por processador interno do NestJS. Não existe fila externa no MVP.

O processamento precisa acompanhar estado e tentativas, permitir diagnóstico e reduzir duplicidades, sem prometer entrega exatamente uma vez pelo provedor. Falha de envio não reverte inclusão, redefinição ou outra operação já confirmada.

Inclusões diretas em Workspace e quadro geram e-mail e item na Central de Notificações, conforme DEC-021. A Central obedece às mesmas fronteiras de autorização e não expõe conteúdo privado do recurso.

## Monitoramento operacional mínimo

- disponibilidade e prontidão da aplicação;
- conexão e saúde do PostgreSQL;
- uso e crescimento de disco;
- execução e idade dos backups;
- resultado dos testes de restauração;
- validade dos certificados;
- falhas de migrations e bootstrap;
- erros e acúmulo de notificações;
- conexões e falhas relevantes de WebSocket.

Ferramentas e limiares específicos permanecem pendentes.

## Rastreabilidade

- BEL-026, BEL-032, BEL-035, BEL-036 e BEL-038.
- DEC-005–DEC-010, DEC-020 e DEC-021.
- RN-037, RN-069–RN-076 e RN-116–RN-129.

