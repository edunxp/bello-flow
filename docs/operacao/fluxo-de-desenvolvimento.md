# Fluxo de desenvolvimento ChatGPT + Codex

## Escopo e precedência

Este procedimento organiza o planejamento, a implementação, a revisão e a
publicação do Bello Flow entre usuário, ChatGPT e Codex. Ele não aprova escopo,
não altera contratos AT, DEC, RN ou requisitos e não concede autorização
operacional por si só.

Devem ser observados em conjunto:

1. as regras permanentes do [AGENTS.md](../../AGENTS.md);
2. a autorização e o escopo temporários da atividade;
3. as fontes normativas aplicáveis ao comportamento; e
4. este fluxo operacional.

A atividade delimita as operações permitidas, mas não substitui silenciosamente
decisão normativa aprovada. Conflito material exige decisão antes da parte
afetada.

Para commit, push e CI, o
[Procedimento de Git e publicação](git-e-publicacao.md) é a fonte operacional
específica. Em caso de conflito, prevalece a regra mais específica e segura sem
alterar a precedência das fontes normativas.

## Responsabilidades

- O usuário estabelece objetivos, prioridades, limites e autorizações.
- O ChatGPT consolida escopo, arquitetura, restrições, critérios de aceite e
  decisões que precisam retornar ao usuário.
- O Codex inspeciona, implementa, valida e apresenta evidências dentro do escopo
  e da modalidade de autorização recebidos.

## Preparação — escopo e inspeção

1. O usuário define o objetivo, a prioridade e as operações autorizadas.
2. O ChatGPT identifica o escopo, as fontes normativas, as restrições
   arquiteturais e de segurança e os critérios de aceite.
3. A inspeção é incremental e proporcional à complexidade e ao risco da
   atividade. O Codex prioriza arquivos, módulos, contratos e dependências
   diretamente relacionados ao incremento e realiza inspeção somente leitura
   quando necessária para confirmar o estado real ou reduzir incerteza relevante.
4. Evidências de etapas anteriores são reutilizadas enquanto o componente e suas
   dependências relevantes não tiverem mudado. Inspeções gerais do repositório não
   são repetidas sem necessidade concreta, e decisões normativas publicadas não
   são reabertas sem evidência nova.
5. O escopo da inspeção somente é ampliado quando uma dependência,
   incompatibilidade ou risco tecnicamente identificado exigir evidência
   adicional.
6. Quando o contrato estiver aprovado, o escopo estiver claro e houver
   autorização de implementação, o trabalho pode seguir diretamente para
   implementação e testes, sem exigir uma etapa separada de inspeção para cada
   subincremento. Permanecem obrigatórias a leitura das instruções do agente e das
   fontes aplicáveis, além das validações proporcionais ao risco.
7. Reduzir inspeções repetitivas não reduz os testes necessários nem as garantias
   de segurança, cobertura mínima de 90% por métrica, PostgreSQL descartável e
   gates de CI definidos nas etapas seguintes.
8. Bloqueios materiais de arquitetura, segurança, integridade ou contrato retornam
   para decisão explícita antes da parte afetada. Atividades independentes podem
   continuar quando permanecerem seguras e autorizadas.

O resultado desta preparação deve distinguir fatos confirmados, inferências e
pendências. Planejamento não equivale a autorização de implementação, commit ou
push.

## Etapa 1 — Implementação

1. O Codex implementa somente depois de receber autorização e somente no escopo
   aprovado.
2. Código e testes aplicáveis são produzidos no mesmo ciclo, conforme o contrato
   publicado.
3. Erros técnicos podem ser corrigidos durante a mesma atividade quando a correção
   for necessária ao objetivo, permanecer dentro do contrato aprovado e não
   ampliar arquitetura, requisitos ou privilégios.
4. Alteração de decisão normativa, política de segurança, requisito ou escopo
   material exige nova decisão antes da parte afetada.

KISS e YAGNI orientam a implementação: não antecipar fases, infraestrutura,
abstrações ou funcionalidades futuras.

## Etapa 2 — Validação técnica

1. O Codex executa validações e testes proporcionais ao risco e comprova a
   cobertura mínima vigente de 90% em lines, statements, functions e branches
   quando aplicável.
2. Garantias de transação, concorrência, locks, privilégios e migrations usam
   PostgreSQL real comprovadamente descartável. Testes destrutivos nunca usam
   banco persistente.
3. Regressões, lint, formatação, typecheck e build são executados conforme o risco
   e as regras de qualidade aplicáveis.
4. Evidências ainda válidas são reutilizadas; baterias completas não são repetidas
   sem mudança ou risco que as justifique.

## Etapa 3 — Revisão e correções

1. O Codex entrega relatório objetivo, com comandos executados, resultados e
   referências verificáveis.
2. O ChatGPT avalia aderência normativa, segurança, integridade, testes,
   cobertura, concorrência, riscos e limites do escopo.
3. Quando a revisão depender do conteúdo exato, deve solicitar ou examinar diff,
   patch, arquivos e linhas relevantes.
4. Problemas locais e independentes podem ser reunidos em uma rodada consolidada
   de correção, desde que continuem autorizados e não alterem decisões aprovadas.
5. O Codex corrige os achados dentro do escopo autorizado e repete somente as
   validações afetadas até obter aprovação.
6. Bloqueios críticos exigem decisão explícita antes de implementação adicional.
7. O relatório do Codex não substitui evidência de execução, resultado de teste,
   estado Git, migration, código ou documento normativo.

A revisão deve priorizar evidências objetivas e achados acionáveis, evitando
relatórios extensos sem impacto na decisão.

## Etapa 4 — Consolidação documental

1. Antes do commit, o Codex atualiza os documentos aplicáveis ao incremento.
2. A documentação registra somente o estado comprovado: implementado, validado
   localmente e aguardando commit ou publicação.
3. Sucesso de CI remoto, SHA ainda inexistente e publicação ainda não realizada
   não são antecipados.
4. Documentação, código, testes e configurações estritamente necessárias formam o
   mesmo conjunto revisável e, quando aprovados, o mesmo commit.
5. Contratos normativos existentes são referenciados, não duplicados.

## Etapa 5 — Revisão final

1. O ChatGPT revisa em conjunto código, testes, documentação, evidências e estado
   Git.
2. Somente após aprovação final é preparada autorização específica para o commit.
3. Achado remanescente retorna à etapa aplicável sem ampliar automaticamente o
   escopo.

## Etapa 6 — Commit local

1. Mediante autorização específica, o Codex cria um único commit com código,
   testes, documentação aplicável e configurações estritamente necessárias.
2. O staging é explícito e integralmente revisado conforme o
   [Procedimento de Git e publicação](git-e-publicacao.md).
3. Esta etapa não autoriza nem executa push.

## Etapa 7 — Publicação

1. Em atividade posterior e mediante autorização separada, o Codex confirma o
   commit aprovado, atualiza as referências remotas e executa push normal.
2. Antes do push, confirma branch, SHA, escopo, árvore limpa e divergência com
   `origin/main`.
3. Force push, force-with-lease, merge, rebase, pull e correções automáticas de
   divergência permanecem proibidos.
4. Depois do push, confirma o SHA remoto exato e a sincronização da branch.

## Etapa 8 — CI remoto

1. O Codex localiza o workflow pelo SHA exato, branch, evento e tentativa.
2. `Quality`, `API integration` e `Required` precisam terminar com `success`.
3. Enquanto houver job pendente, não presume aprovação. Falha é reportada sem
   correção, novo commit, nova publicação ou reexecução não autorizados.
4. Somente depois do sucesso remoto o incremento é classificado como publicado e
   validado.

## Etapa 9 — Encerramento

1. O resultado da publicação, o SHA e o CI são registrados no relatório
   operacional.
2. Não se exige automaticamente novo commit apenas para inserir SHA ou número da
   execução CI na documentação.
3. Atualização documental posterior ocorre somente por exigência normativa ou
   operacional expressa, correção factual, mudança material do estado do projeto
   ou consolidação periódica.
4. Quando necessária, essa atualização segue novamente as autorizações e regras
   Git aplicáveis.

## Relatório padronizado do Codex

O relatório deve ser proporcional à atividade e conter, quando aplicável:

A. objetivo e escopo executado;
B. arquivos criados, modificados ou removidos;
C. decisões técnicas e justificativas;
D. testes, cobertura e comandos executados;
E. evidências relevantes e referências de arquivos e linhas;
F. riscos, bloqueios e pendências;
G. estado Git inicial e final;
H. commit, push e CI, quando autorizados; e
I. parecer sobre conclusão e próxima etapa.

Itens não aplicáveis podem ser identificados de forma breve, sem inventar
evidência. O relatório deve separar claramente o que foi confirmado, inferido e
permanece pendente.

## Diretrizes permanentes

- preservar KISS e YAGNI;
- tratar segurança, autorização, auditoria e dados sensíveis como restrições de
  primeira classe;
- não duplicar documentação normativa nem transformar proposta em decisão;
- não presumir autorização de commit ou push;
- não ampliar nem antecipar o escopo aprovado;
- preservar os gates de cobertura e CI vigentes; e
- preferir evidências objetivas a repetição de inspeções ou relatórios extensos.
