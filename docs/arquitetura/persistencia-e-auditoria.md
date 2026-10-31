# Persistência, transações e auditoria

## Escopo

Este documento detalha [AT-003](decisoes-tecnicas.md#at-003--consistência-transacional-e-auditoria-obrigatória), [AT-004](decisoes-tecnicas.md#at-004--ordenação-concorrente) e [AT-006](decisoes-tecnicas.md#at-006--proteção-e-retenção-da-auditoria).

## Responsabilidades de Prisma e PostgreSQL

| Componente | Responsabilidade |
|---|---|
| Prisma | acesso tipado padrão, contexto transacional, migrations administrativas e operações comuns |
| PostgreSQL | atomicidade, isolamento, restrições, bloqueios, persistência, privilégios e recuperação |
| SQL parametrizado | complemento localizado para bloqueios, recursos específicos ou desempenho comprovado |

Prisma não substitui garantias do banco. SQL específico deve permanecer encapsulado no módulo responsável, parametrizado, testado com PostgreSQL real e executado no mesmo contexto transacional quando fizer parte da operação.

## Fronteira transacional das mutações

Uma mutação auditável segue esta fronteira conceitual:

1. Receber identificador único da operação e contexto autenticado.
2. Iniciar uma transação curta.
3. Revalidar autorização, elegibilidade, estado e revisões relevantes.
4. Executar a alteração de negócio.
5. Gravar a auditoria obrigatória.
6. Gravar o feed obrigatório, quando aplicável.
7. Atualizar revisões aplicáveis.
8. Confirmar a transação.
9. Somente após commit confirmado, sinalizar WebSocket e processadores externos.

Falha dos passos obrigatórios anteriores ao commit provoca rollback. O identificador único permite reconciliar um resultado de commit indeterminado antes de repetir. Uma repetição precisa revalidar o estado e não pode duplicar efeitos.

## Isolamento, bloqueios e repetição

- O nível de isolamento será escolhido por classe de operação, após validação técnica.
- Bloqueios são pontuais e não devem abranger o quadro inteiro sem justificativa.
- Recursos múltiplos são bloqueados em ordem determinística.
- Conflitos recuperáveis admitem quantidade limitada de novas tentativas.
- Cada nova tentativa repete autorização e pré-condições, não apenas as instruções SQL.
- Erros não recuperáveis ou repetição esgotada retornam resultado explícito, sem sucesso aparente.
- O limite de tentativas e os casos recuperáveis permanecem pendentes.

## Ordenação de listas e cartões

### Estado aprovado

- posições esparsas;
- backend como autoridade;
- revisão granular do item e do contêiner;
- revisão monotônica de quadro separada para sincronização;
- vizinhos informados como intenção de posicionamento;
- rebalanceamento restrito ao contêiner;
- bloqueios determinísticos;
- última operação confirmada prevalece no mesmo item.

### Movimento dentro da transação

O backend valida origem, destino, vizinhos, estado de arquivamento, permissões e revisões. A posição final é calculada sobre o estado transacional atual, e não aceita cegamente a posição produzida pelo cliente.

Movimentos entre contêineres bloqueiam somente os recursos necessários e em ordem estável. Movimentos entre quadros também aplicam DEC-018: autorização em ambos, confirmação de responsáveis incompatíveis, preservação de identidade e histórico e proteção do contexto de origem.

O rebalanceamento pode modificar chaves físicas, mas não a ordem funcional. A representação da chave e o limiar de rebalanceamento ainda serão validados.

## Auditoria obrigatória

A auditoria implementa a matriz funcional de RN-126–RN-130 e PEN-037. Cada evento possui, no mínimo, os campos funcionais aprovados aplicáveis, incluindo identificação, instante, ator ou origem, operação, resultado, contexto e correlação.

Armazenamento e consulta são controles distintos:

- valores anteriores e novos são gravados seletivamente pela matriz;
- versões de descrições e comentários pertencem à auditoria de conteúdo protegida;
- senhas, tokens, cookies e credenciais não são armazenados;
- consultas reavaliam permissão atual e contexto original;
- campos são omitidos ou redigidos sem alterar o registro original;
- Administrador Global e Administrador de Workspace não herdam auditoria de conteúdo.

## Proteção append-only

- A credencial operacional insere e consulta apenas o necessário e não altera ou remove eventos.
- Expurgo e manutenção usam credencial administrativa separada.
- A aplicação comum não executa DDL sobre a auditoria.
- Correções funcionais produzem novos eventos.
- A proteção reduz alterações acidentais ou pela aplicação comprometida, mas não garante inviolabilidade diante de administrador privilegiado do banco.
- Verificação criptográfica adicional não integra o MVP.

## Retenção e expurgo

- O prazo é de 24 meses pelo instante de ocorrência.
- O expurgo é automático, agendado e controlado.
- Cada execução registra período tratado, quantidade e resultado.
- Falhas precisam ser observáveis e retomáveis sem remoção indiscriminada.
- Backups e restaurações precisam ser compatíveis com retenção e acesso restrito.

O formato físico, a estratégia de particionamento e o mecanismo concreto de expurgo permanecem pendentes. Particionamento não é obrigatório sem volume que o justifique.

## Consultas

As consultas funcionais seguem DEC-010 e RN-113–RN-115: ordem cronológica decrescente estável, filtros aprovados, navegação progressiva e redação contextual. Índices, paginação física e SQL especializado serão definidos a partir do modelo e de medições.

## Rastreabilidade

- **Ordenação:** BEL-006–BEL-011; DEC-016 e DEC-018; RN-057–RN-066 e RN-130.
- **Feed:** BEL-031; DEC-009; RN-026–RN-031 e RN-110–RN-112.
- **Auditoria:** BEL-032; DEC-010; RN-032–RN-038, RN-095–RN-097 e RN-113–RN-130.
- **Pendências de origem:** PEN-022–PEN-027 e PEN-037.

