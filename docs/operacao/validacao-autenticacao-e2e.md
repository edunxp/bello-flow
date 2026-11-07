# Validação de autenticação em navegador

## Escopo e execução

A suíte valida o Angular compilado, a API NestJS real e PostgreSQL 18.6 descartável.
Não envia e-mails reais e não declara prontidão produtiva. O estado factual e as
evidências do ciclo ficam em [estado do projeto](../estado-do-projeto.md).

Na raiz do repositório, com Docker e Node 24.22.2/npm 11.19.1:

```bash
npm run test:e2e:browser
```

O comando constrói a imagem de teste, provisiona o ambiente, executa os cenários e
remove somente os recursos identificados por esse run. Não usa arquivos .env nem
o PostgreSQL persistente de desenvolvimento. Não é necessário iniciar serviços
manualmente, disponibilizar credenciais reais ou habilitar Resend.

O Dockerfile combina Node na versão do projeto e a imagem oficial
[Playwright v1.64.1 Noble](https://playwright.dev/docs/docker), correspondente à
dependência de desenvolvimento fixada no lockfile. Isso evita depender das
bibliotecas gráficas do Oracle Linux. A primeira execução baixa imagens e instala
dependências; execuções posteriores podem reutilizar o cache de build.

## Isolamento e dados

- Rede Docker interna exclusiva, nomes aleatórios e label de ownership por run.
- Nenhuma porta publicada e nenhum volume persistente ou socket Docker no runner.
- PostgreSQL usa tmpfs em /var/lib/postgresql; roles são provisionadas pelo script
  existente e migrations existentes são aplicadas somente nesse cluster.
- Senhas aleatórias exclusivas do run; o runner recebe apenas runtime e migrator.
  O processo filho da API recebe somente a credencial runtime, sem credencial
  administrativa, migrator, bootstrap ou manutenção.
- O runner confere banco, usuário e versão. Fixtures usam contas sintéticas,
  e-mails example.test e hashes Argon2id gerados somente em memória.
- NestJS usa os módulos e controles HTTP reais. Somente o port de entrega é
  substituído por adapter exclusivo de teste; o link gerado pelo processador real
  é transmitido por IPC e retido em um Map em memória. Não há rota de debug.
- O gateway HTTPS de teste serve o build Angular com fallback SPA e encaminha
  /api e /health/live para a API; headers encaminhados fornecidos pelo cliente são
  removidos. A API mantém origem canônica, header obrigatório, CSRF e CORS fechado.
- Certificado autoassinado temporário; a exceção de certificado vale apenas nos
  contextos descartáveis do Chromium. Não há alteração do trust store do sistema.
  O teste comprova TLS e atributos do cookie seguro nesse ambiente, não a cadeia
  de confiança, proxy ou certificado produtivos.

A limpeza confere ownership e ausência dos recursos removidos. Falha de limpeza
ou ownership divergente reprova o comando sem ampliar o alvo de remoção.
Cancelamento abrupto, perda do Docker ou SIGKILL podem exigir inspeção manual
dos nomes exatos emitidos no log; nunca executar prune ou limpeza global.
Imagens-base e cache de ferramentas podem permanecer para reutilização.

## Cenários e interpretação

| Grupo | Evidência |
| --- | --- |
| Login, consulta, recarga e logout | Navegador/API/PostgreSQL reais; cookie __Host-, HttpOnly, Secure, SameSite, Path, identidade mínima e revogação |
| Rejeição de login | Mesma mensagem para senha incorreta e identidade inexistente, com HTTP 401 |
| Expiração | Fixture envelhecida preservando constraints; transição Angular sem recriar documento reconsulta sessão |
| Recuperação e redefinição | Processador real, captura controlada em memória, senha nova, uso único, revogação das sessões da conta e preservação da sessão de outra conta |
| Link e histórico | Remoção do fragmento, recarga, reabertura no mesmo documento, voltar, skip-link e ausência de token em storage/histórico |
| Token expirado | Fixture envelhecida preservando validade de 30 minutos; mesma rejeição externa |
| Segurança HTTP | 202 sem corpo para entradas elegível/inexistente/inválida; header obrigatório, origem forjada rejeitada, ACAO/ACAC ausentes e health preservado |
| Interface | Teclado, foco e feedback obrigatório; larguras 1280, 640 e 320; reset em 320; ampliação por CSS zoom 2 |
| Logout indisponível | Resposta 503 interceptada, sem falso sucesso nem retry automático; a sessão real permanece válida |
| Limitação | Resposta 429 e Retry-After interceptados, bloqueio temporário e nenhuma nova chamada automática |
| Login tardio | Login real com atraso controlado de entrega da resposta durante navegação |
| Visual | Somente tela pública de login vazia, desktop/celular, sem valores preenchidos |

As interceptações são falhas controladas e não comprovam falha de banco,
commit indeterminado ou saturação real. As provas transacionais e de admissão
existentes continuam válidas e não são substituídas pelo navegador.
O envelhecimento das fixtures é feito pelo migrator exclusivamente no banco
descartável, sem esperar horas e sem alterar limites ou relógios de produção.

CSS zoom 2 não é o zoom nativo do navegador. Leitor de tela, outros motores de
navegador, dispositivos físicos, provider real, entrega na caixa postal e
prontidão produtiva permanecem fora da evidência desta suíte.

## Logs, imagens e CI

Não há trace, vídeo, HAR, storageState, dump de cookies, bodies ou erros brutos.
Falhas mostram somente cenário, categoria, linhas do harness e status HTTP de
rotas conhecidas, sem e-mail, senha, token ou link. Uma falha não pode imprimir
mensagem ou stack integral para diagnóstico.

As únicas imagens são da tela pública de login vazia e são copiadas para
/tmp/bello-e2e-<run>-visuals. Elas não são versionadas nem publicadas como artefatos
do CI. Certificado, chave, perfis de navegador e links desaparecem com o ambiente.

O job Browser E2E executa o mesmo comando. Required exige seu sucesso junto de
Quality e API integration. Não se reduzem cobertura ou gates anteriores.
O formato e a sintaxe do harness são verificados, e os cenários são seriais para
preservar isolamento de fixtures e previsibilidade dos limites aprovados.
