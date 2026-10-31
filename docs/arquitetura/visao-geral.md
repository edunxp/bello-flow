# Visão geral da arquitetura do Bello Flow

## Propósito

Este documento apresenta a arquitetura técnica aprovada para o **Bello Flow**. O nome técnico do projeto permanece `bello`.

A especificação funcional continua sendo a fonte normativa para comportamento, escopo e permissões do produto. Esta seção técnica descreve como atender essas regras sem modificar os identificadores BEL, DEC, RN, RP ou PEN.

## Stack aprovada

| Responsabilidade | Escolha aprovada |
|---|---|
| Frontend | Angular e TypeScript |
| Backend | NestJS sobre Node.js e TypeScript |
| Persistência | Prisma como ORM principal e PostgreSQL |
| Infraestrutura inicial | Docker Compose em servidor único |
| Arquitetura | monólito modular |
| Mutações | API HTTP |
| Atualizações colaborativas | WebSocket integrado ao NestJS |
| Escala inicial | uma instância do backend |

SQL PostgreSQL parametrizado pode complementar o Prisma quando bloqueios, funcionalidades específicas ou desempenho medido o justificarem. Essa possibilidade não transforma SQL direto no mecanismo padrão de persistência.

## Diretrizes arquiteturais

- O backend é a autoridade sobre autorização, ordenação e estado confirmado.
- Administração Global, Workspace, governança de quadro e conteúdo de quadro permanecem escopos independentes.
- Mutação, auditoria obrigatória, feed obrigatório e revisão aplicável são confirmados atomicamente no PostgreSQL.
- E-mail, WebSocket e integrações externas não participam da transação de negócio.
- O banco é a fonte da verdade; mensagens em tempo real apenas sinalizam estados já confirmados.
- Negação de acesso é o comportamento padrão e consultas são restringidas no backend.
- Auditoria e feed colaborativo permanecem conceitos, retenções e superfícies de acesso distintos.
- Componentes distribuídos somente serão considerados diante de necessidade comprovada.

## Fronteiras do monólito modular

| Módulo | Responsabilidade principal | Limite de acesso |
|---|---|---|
| Identidade e Administração Global | contas, autenticação, sessões, recuperação e papéis globais | não concede conteúdo de Workspace ou quadro |
| Workspaces | configuração, participantes, papéis, fuso e catálogo de etiquetas | governança não implica conteúdo dos quadros |
| Quadros | configuração, visibilidade, participantes, papéis, arquivamento e restauração | distingue governança de acesso operacional |
| Kanban | listas, cartões, posições, movimentos e arquivamento | exige participação e papel de quadro adequados |
| Colaboração | responsáveis, etiquetas aplicadas, datas, conclusão e comentários | segue autorização do cartão e do quadro |
| Notificações | e-mails, Central de Notificações e sinais em tempo real | não amplia acesso ao recurso de origem |
| Feed | atividades colaborativas autorizadas | não expõe dados exclusivos da auditoria |
| Auditoria | registro obrigatório, consulta protegida, redação e retenção | escopos global, administrativo e de conteúdo separados |

Cada módulo deve expor casos de uso e contratos explícitos. Controladores não acessam diretamente estruturas internas de outros módulos. Infraestrutura compartilhada deve permanecer pequena e não concentrar regras de negócio.

## Topologia inicial

```text
Navegador
├── Angular ── HTTP ───────────────┐
└── Angular ── WebSocket seguro ───┤
                                   ▼
                      NestJS: monólito modular
                                   │
                      Prisma + SQL parametrizado
                                   │
                                   ▼
                              PostgreSQL

Dependências externas controladas:
├── provedor de e-mail configurável
└── armazenamento externo protegido de backups
```

O Docker Compose descreve conceitualmente serviços separados para aplicação e PostgreSQL. A configuração executável será criada somente na fase de implementação.

## Fora do MVP técnico

- microsserviços;
- Redis;
- filas externas;
- Kubernetes;
- múltiplas instâncias do backend;
- orquestração distribuída sem necessidade comprovada;
- API externa e conectores previstos para entregas posteriores na [DEC-019](../produto/decisoes-funcionais.md#dec-019--integrações-externas).

## Decisões técnicas

As decisões aprovadas estão registradas integralmente em [decisoes-tecnicas.md](decisoes-tecnicas.md):

- AT-001 — autenticação e segurança das sessões;
- AT-002 — autorização centralizada;
- AT-003 — consistência transacional e auditoria obrigatória;
- AT-004 — ordenação concorrente;
- AT-005 — sincronização em tempo real;
- AT-006 — proteção e retenção da auditoria;
- AT-007 — infraestrutura e recuperação;
- AT-008 — bootstrap e migrations;
- AT-009 — e-mails e notificações;
- AT-010 — observabilidade, testes e prontidão.

## Mapa da documentação

- [decisões técnicas](decisoes-tecnicas.md): registro canônico de AT-001 a AT-010;
- [segurança e autorização](seguranca-e-autorizacao.md): sessões, políticas, bootstrap e segurança de notificações;
- [persistência e auditoria](persistencia-e-auditoria.md): transações, concorrência, Prisma, SQL e retenção;
- [colaboração em tempo real](colaboracao-tempo-real.md): WebSocket, revisões e recuperação por HTTP;
- [infraestrutura e operação](infraestrutura-e-operacao.md): Compose, backups, migrations, e-mail e recuperação;
- [qualidade e testes](qualidade-e-testes.md): testes, observabilidade, CI e prontidão;
- [pendências técnicas](pendencias-tecnicas.md): escolhas ainda não aprovadas e validações necessárias.

## Rastreabilidade funcional

- [visão do produto](../produto/visao-geral.md)
- [requisitos funcionais](../produto/requisitos-funcionais.md)
- [regras de negócio](../produto/regras-de-negocio.md)
- [decisões funcionais](../produto/decisoes-funcionais.md)
- [escopo do MVP](../produto/escopo-mvp.md)

