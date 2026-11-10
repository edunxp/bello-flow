# Homologação HTTPS local sem envio de e-mail

## Objetivo

Disponibilizar o build Angular e a API reais apenas na máquina do responsável,
com PostgreSQL descartável. O perfil tem envio obrigatoriamente disabled:
não recebe chave Resend, não usa ngrok, não publica banco e não ativa produção.

O estado factual e a base do ciclo ficam no [estado do projeto](../estado-do-projeto.md).
O fluxo automatizado existente continua documentado na
[validação E2E](validacao-autenticacao-e2e.md).

## Iniciar

Na cópia autorizada do repositório no WSL OracleLinux_8_10, com Docker disponível
e Node 24.22.2/npm 11.19.1, execute na raiz:

```bash
npm run homologacao:local
```

O comando constrói a imagem, cria redes próprias de acesso e de banco, com PostgreSQL em tmpfs, aplica as
migrations existentes e inicia uma sessão em segundo plano. Emite a URL
https://127.0.0.1:15443 e o identificador aleatório da sessão, além dos comandos
exatos para criar conta e encerrar. Se a porta estiver ocupada, a nova sessão falha
sem encerrar ou modificar o serviço que já a ocupa.

A publicação Docker é conferida como 127.0.0.1:15443 exclusivamente. O gateway
escuta em todas as interfaces somente dentro do container, necessário ao port
mapping; a API interna permanece em loopback. Não há publicação externa do
PostgreSQL nem do processo API. Não alterar para 0.0.0.0 no host.

O certificado é autoassinado, temporário e válido por um dia. O navegador pode
pedir uma exceção para esse endereço local; não se instala certificado no trust
store nem se altera a validação TLS de outros sites. Não usar localhost ou outro
hostname: cookie, certificado e origem canônica estão em 127.0.0.1.

## Criar conta sintética

Na mesma raiz e em terminal interativo, use o comando emitido ao iniciar:

```bash
npm run homologacao:conta -- IDENTIFICADOR_DA_SESSAO
```

A conta é exclusivamente homologacao@example.test, verificada para permitir
exercitar login. Não recebe papel administrativo e não representa bootstrap
operacional ou cadastro público. A senha e confirmação são digitadas em modo
oculto pelo prompt já existente no projeto, dentro do container, sem aparecer
em argumentos, ambiente, logs, arquivo ou relatório. Use senha exclusiva para
esse teste, de 12 a 128 pontos de código Unicode válidos.

O provisionador confere identificador, ownership, comando do container e
identidade do banco antes da escrita, usa somente o migrator descartável e não
altera conta existente. Um segundo cadastro nessa sessão falha, sem trocar a
senha. Reiniciar do zero exige encerrar a sessão e criar outra.

## Exercitar a interface

Abra https://127.0.0.1:15443 no navegador da própria máquina e use a conta sintética.
Login, consulta/restauração, recarga e logout usam o backend e o banco reais.

Solicitar recuperação pode produzir a confirmação condicional normal da API.
Isso não significa envio: este perfil não inicia o processador de entrega e não
gera link/token. A redefinição completa permanece comprovada pela suíte E2E
controlada, sem rota de diagnóstico, exposição de link ou captura pública.

A API recebe apenas sua credencial runtime; não recebe migrator, bootstrap,
manutenção nem segredo do provider. O perfil usa NODE_ENV=development e recusa
origem diferente da fixa, ou qualquer modo de entrega diferente de disabled.
Mudar variáveis no shell não habilita Resend: o ambiente do filho é construído
explicitamente. O banco permanece na rede interna. O runner usa uma segunda rede de acesso
para permitir a publicação em loopback; essa rede permite egress, mas não recebe
segredos de provider e o envio é recusado pelo perfil, independentemente da rede.

## Encerrar

Use o comando exato emitido na inicialização:

```bash
npm run homologacao:parar -- IDENTIFICADOR_DA_SESSAO
```

O controle confirma ownership e comando local antes de remover somente runner,
banco, imagem e as duas redes dessa sessão, usando a mesma limpeza conferida no E2E.
O banco em memória, conta, senha hash, certificados e sessões são descartados.
A falha de limpeza é reportada como erro; nenhum alvo genérico é removido.
Imagens-base e cache de ferramentas podem permanecer. Não executar prune,
remoção de volumes globais ou limpeza de recursos preexistentes.

## Validação e limites

```bash
npm run test:homologacao:local
npm run test:homologacao:host
npm run test:e2e:browser
```

O smoke não publica porta: usa Chromium e o perfil local real para comprovar login,
recarga, cookie seguro e solicitação 202 com request PENDING e zero tentativas e
tokens de entrega. Ele cria uma fixture sintética e limpa seus recursos ao terminar.
O teste de host inicia o mesmo perfil, publica somente em loopback, confere
health e shell Angular por HTTPS e encerra sua sessão ao terminar. No Windows/WSL,
o acesso também é conferido pelo Windows, separado do teste Linux. O gate Browser E2E também executa o smoke no CI.

O perfil separado de [preparo do ensaio Resend](ensaio-recuperacao-local.md)
usa outra porta e mantém autorização própria para qualquer envio real.

Nenhuma validação envia e-mail externo. Um ensaio Resend futuro exige escopo e
autorização próprios: ambiente, chave privada, destinatário e volume definidos,
tracking desativado confirmado e condições de tratamento externo aceitas.
Domínio verificado, MFA e TLS de envio configurados no painel do provider não
encerram a PT-009 nem declaram prontidão produtiva.

## Prontidão e prova isolada de restauração

O gateway de homologação encaminha `/health/live` e `/health/ready` à API.
Atividade verifica o processo HTTP. Prontidão verifica se o PostgreSQL responde
pela conexão de runtime. Em falha, a API responde 503 sem detalhes do banco.
O teste de publicação local verifica as duas rotas por HTTPS em uma porta
loopback temporária atribuída pelo Docker.

Na raiz do projeto, execute `bash scripts/restore-drill.sh`. O ensaio requer
a imagem local `postgres:18.6-bookworm` e cria um contêiner sem rede, com socket
privado e armazenamento temporário. Aplica os SQL versionados, verifica o
backup-base com `pg_verifybackup` e reproduz WAL até um ponto nomeado. O aceite
confere a alteração sintética com sua auditoria, a revogação de sessão, os
vínculos administrativos, os limites de acesso do runtime à auditoria e a
remoção exclusiva de eventos vencidos pela credencial de manutenção. O contêiner do ensaio é
removido ao encerrar.

A duração reportada começa na criação do ponto de restauração e inclui o
arquivamento do segmento e a validação no banco restaurado. O ensaio comprova
a recuperação desse ponto com a carga sintética local. A homologação de
produção depende de medições com carga representativa, destino externo
protegido, política de retenção e alertas operacionais. Os critérios de monitoramento e recuperação estão em
[Infraestrutura e operação](../arquitetura/infraestrutura-e-operacao.md).

A função `public.purge_expired_audit_events()` calcula o limite de 24 meses
em UTC no PostgreSQL e devolve o limite aplicado e o número de linhas removidas.
Ela é executável pela capacidade `bello_audit_maintenance`. Para uma implantação
autorizada, o agendador de manutenção deve registrar limite, quantidade e
resultado, alertar em falha e usar uma conexão própria. Depois de restaurar
um backup, execute o expurgo antes de disponibilizar consultas, para evitar
reapresentar eventos que venceram depois da captura. O ensaio comprova esse
procedimento apenas com dados sintéticos.

### Verificações de monitoramento

| Sinal | Prova isolada | Evidência para homologação operacional |
| --- | --- | --- |
| Disponibilidade e PostgreSQL | HTTPS em loopback verifica atividade, prontidão e shell Angular. O teste de prontidão injeta falha de consulta e verifica 503 sanitizado. | Exercitar o alerta de indisponibilidade e o retorno à prontidão pela origem canônica. |
| Backup-base e WAL | O ensaio verifica o manifesto, espera o arquivamento do segmento e mede até o aceite da restauração. | Conferir último backup e WAL no destino externo e exercitar alerta de atraso com o RPO de até 1 hora. Medir restauração mensal isolada e comparar com o RTO de até 4 horas. |
| Retenção | O executor consulta com conexão separada e registra limite e quantidade em JSON. Uma execução repetida remove zero eventos. | Agendar `PGSERVICE=<serviço-de-manutenção> bash scripts/audit-retention.sh`. O agendador registra instante e falha. A credencial de manutenção deve vir de um serviço PostgreSQL próprio e fora da configuração HTTP. |
| Disco, TLS e aplicação | A execução isolada usa armazenamento descartável e certificado temporário. | Conferir espaço e crescimento, validade do certificado, falhas de migration, notificações, erros e latência HTTP e falhas WebSocket. Exercitar alertas e validar destino e responsável. |

A homologação real depende de hospedagem, credenciais e destino de backup
autorizados. Ferramentas e limiares pendentes continuam registrados em PT-010
a PT-014.
