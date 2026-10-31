# Colaboração e sincronização em tempo real

## Escopo

Este documento detalha [AT-005](decisoes-tecnicas.md#at-005--sincronização-em-tempo-real) e sua relação com AT-001, AT-002, AT-003 e AT-004.

## Modelo aprovado

- Mutações são feitas por HTTP.
- WebSocket distribui notificações de alterações confirmadas.
- O backend inicia com uma única instância.
- PostgreSQL permanece a fonte da verdade.
- A revisão persistida do quadro permite detectar lacunas.
- Recuperação de estado ocorre por HTTP.
- Redis e distribuidores externos não integram o MVP.

## Revisões distintas

| Revisão | Finalidade | Granularidade |
|---|---|---|
| item/contêiner | detectar e conciliar escrita concorrente | lista, cartão ou contêiner afetado |
| sincronização | informar que o estado relevante do quadro avançou | quadro |

A revisão de sincronização é monotônica e participa da transação da mutação relevante. Ela não substitui versões granulares e não determina sozinha qual escrita deve prevalecer.

## Ciclo de atualização

1. O cliente envia a mutação HTTP com suas pré-condições e revisões conhecidas.
2. O backend autentica e autoriza a operação.
3. A transação revalida estado e confirma negócio, auditoria, feed e revisões.
4. A resposta HTTP informa o resultado confirmado.
5. Após o commit, o gateway sinaliza a revisão aos inscritos autorizados.
6. Cada cliente aplica atualização segura ou consulta o estado por HTTP.

Uma falha entre commit e sinalização não desfaz a mutação. Verificação periódica leve, reconexão e comparação de revisão recuperam a diferença sem recarregamento manual pelo usuário.

## Autenticação e autorização do canal

- A conexão usa a sessão persistida definida na AT-001.
- A origem é validada.
- Cada inscrição em quadro é autorizada explicitamente.
- A mensagem não confia em identificadores enviados pelo cliente para ampliar escopo.
- Conta desativada, sessão revogada ou perda de participação bloqueia novas entregas.
- Mudanças de papel são refletidas nas inscrições e nos dados permitidos.
- Observadores recebem atualizações compatíveis com leitura, mas continuam sem mutação.
- Usuários de governança sem participação não recebem conteúdo por WebSocket.

## Conteúdo das mensagens

Mensagens carregam somente o necessário para identificar quadro, tipo de alteração, entidade afetada e revisão. Dados privados completos devem ser obtidos por consulta HTTP autorizada quando necessário.

O canal não transporta:

- senhas, cookies ou tokens;
- versões históricas protegidas;
- conteúdo de auditoria;
- dados de quadros não autorizados;
- resultado presumido antes do commit.

## Reconexão e recuperação

- O cliente mantém a última revisão confirmada conhecida.
- Ao reconectar, compara essa revisão com a revisão autorizada atual.
- Diferença provoca recuperação por HTTP, não reprodução cega de mensagens antigas.
- A recuperação reavalia autorização.
- O protocolo detalhado, intervalos e limites permanecem pendentes.

## Escala futura

Uma única instância pode distribuir eventos em memória após commit. A necessidade de múltiplas instâncias exigirá nova avaliação de distribuição entre processos e recuperação. A aprovação atual não autoriza Redis, fila externa ou outro componente distribuído.

## Rastreabilidade

- BEL-006–BEL-011, BEL-031 e BEL-036.
- DEC-006–DEC-009, DEC-016 e DEC-018.
- RN-022–RN-031, RN-057–RN-059 e RN-092–RN-094.

