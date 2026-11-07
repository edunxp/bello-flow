# Preparo do ensaio local de recuperação com Resend

## Escopo e autorização

Este perfil prepara um ensaio operacional, separado da homologação sem e-mail.
Sua implementação, teste ou inicialização não autoriza envio. A execução real
exige autorização posterior específica do responsável, após as evidências abaixo.
PT-009 permanece aberta; não há declaração de disponibilidade produtiva.

Endereços confirmados pelo responsável:

- remetente: recuperacao@notify.nextpartner.com.br;
- único destinatário permitido: belloflow@nextpartner.com.br.

O endereço destinatário identifica uma conta de homologação num banco descartável,
sem privilégios administrativos. Não é bootstrap nem conta produtiva.
Use senha exclusiva para teste. A sessão da homologação anterior não é alterada.

## Preparar sem chave e sem envio

No WSL, na raiz do repositório, com as versões Node/npm e Docker documentadas:

```bash
npm run homologacao:recuperacao
```

O comando cria recursos próprios identificados, banco PostgreSQL em tmpfs e
migrations existentes. A API HTTP real recebe somente a credencial runtime e
mantém entrega disabled; não recebe chave Resend nem credencial migrator.
O gateway publica exclusivamente https://127.0.0.1:15444, com certificado
autoassinado temporário. Não instalar confiança global. Não usar localhost,
ngrok ou acesso público neste ensaio.

O runner usa uma rede de acesso com egress e uma rede interna exclusiva do banco;
o banco e a API interna não têm porta publicada no host. O teste simulado usa
somente a rede interna, sem publicação nem egress.

Com o identificador emitido, crie a conta em terminal interativo:

```bash
npm run homologacao:conta -- IDENTIFICADOR_DA_SESSAO
```

No novo perfil, esse comando cria exclusivamente belloflow@nextpartner.com.br,
com senha de 12 a 128 pontos de código Unicode e confirmação em prompt oculto.
Não altera conta existente. A homologação anterior continua usando seu endereço
sintético próprio. Nenhuma senha deve ser compartilhada no chat.

## Barreiras antes da operação real

A ativação segue o contrato aprovado da F1-B.4.5.7 em
[segurança e autorização](../arquitetura/seguranca-e-autorizacao.md#f1-b457--provider-resend-e-barreiras-de-ativação)
e as evidências da [PT-009](../arquitetura/pendencias-tecnicas.md).
Registrar somente evidências sanitizadas, sem chave, senha, cookie, token,
link completo ou corpo bruto do provider.

Antes de autorizar a tentativa, conferir:

- titularidade, administração da conta, MFA, plano, custos, quotas/rate limits;
- domínio transacional, DNS/DKIM/SPF, avaliação de DMARC, remetente e TLS Enforced;
- chave Sending access restrita ao domínio, responsável pela guarda privada,
  rotação/revogação e destino do segredo durante a operação;
- open_tracking=false e click_tracking=false no domínio; a chave de envio não
  recebe permissão de administrar domínio. Ausência de subdomínio de tracking ou
  omissão de campos no payload não comprova desativação;
- DPA, subprocessadores, jurisdição e avaliação aplicável do tratamento externo
  aceitos pelo responsável: o destinatário e conteúdo, incluindo o link completo,
  serão tratados pela Resend. A documentação de referência informa armazenamento
  nos EUA, mensagens/logs por 30 dias e backups por 7 dias. Expiração do token não
  elimina a cópia remota. Reconfirmar condições atuais antes da autorização;
- autorização específica para uma tentativa a esse destinatário, origem local,
  sem retry, aceitando o consumo de quota e o tratamento externo.

A chave existente não foi consultada por este perfil. A operação proposta usa
chave digitada em TTY oculto, somente em memória e IPC privado, sem arquivo,
argumentos, ambiente do worker ou Docker inspect. Isso não comprova nem substitui
secret manager, política de guarda e rotação da organização; tais evidências
continuam pendentes. Não usar comandos export/echo, arquivos .env, logs ou chat
para fornecer a chave. A memória do processo permanece acessível a quem administra
a máquina/containers; limitar acesso local e não gerar dumps.

## Operação futura autorizada: uma tentativa

Somente depois das barreiras e da autorização específica:

1. Abra a interface local na porta 15444 e solicite recuperação para o endereço
   permitido. A confirmação 202 é condicional; sozinha não prova envio.
2. Em terminal privado, execute:

   ```bash
   npm run homologacao:enviar-uma-vez -- IDENTIFICADOR_DA_SESSAO
   ```

3. O comando exige aceite literal de uma tentativa e pede a chave em modo oculto.
   A declaração do operador não substitui evidências ou autorização do responsável.
4. O worker separado recebe somente a credencial runtime e a chave por IPC.
   Valida configuração resend/HTTPS existente, sem mudar seu endpoint, payload,
   timeout ou classificação de falhas. No harness, somente o hook de agendamento
   é suprimido; runCycle real executa com no máximo um claim.
5. Um marcador exclusivo wx/0600, anterior ao processamento e efeito externo,
   limita a sessão a uma tentativa externa. O guard do adapter confere destinatário
   e consome orçamento antes da chamada. Não restaura orçamento após exceção,
   rejeição ou resultado indeterminado. O marcador persiste em reinício do
   container. Falhas de configuração/banco antes de criá-lo não são tentativa externa.
6. Resultado ACCEPTED significa apenas aceitação pelo provider. Qualquer erro,
   NONE ou INDETERMINATE encerra a operação, sem reenvio automático. Até uma
   execução sem trabalho pode consumir o marcador; não apagá-lo para tentar de novo.
   Um novo ensaio exige investigação e nova autorização, não repetição automática.

Não há rota HTTP que receba chave, exponha link ou acione o worker. O comando só
aceita um runner identificado desse perfil; a homologação sem e-mail é recusada.
O launcher real não aceita destino alternativo, transporte simulado ou chave em
argumentos. O entry point da simulação é separado e aceita somente chave sintética.

## Aceite operacional futuro

O responsável confere o recebimento e a mensagem original privadamente: nenhuma
imagem/pixel de tracking e href sem reescrita. Ferramentas de segurança da caixa
postal também podem reescrever links; se ocorrer, interromper e investigar.
Registrar somente o resultado dessa conferência, sem copiar link/token ao chat.

Abrir o link na mesma máquina e na origem local canônica. O token permanece no
fragmento aprovado, capturado e removido da barra pela interface. Validar:

- redefinição com sucesso e confirmação apropriada;
- rejeição da reutilização do mesmo link;
- senha anterior rejeitada e nova senha aceita;
- invalidação das sessões anteriores conforme o contrato;
- estados persistidos e observações sanitizadas coerentes, sem confundir
  aceitação, entrega e redefinição;
- adequação do timeout de 10 segundos na rede real.

Uma mensagem comprova somente esse ensaio, não entregabilidade geral,
compatibilidade de todos os provedores, hospedagem, retenção operacional ou
prontidão produtiva. Um ensaio de expiração real exige planejamento/volume próprios.

## Validação automatizada sem envio

```bash
npm run test:homologacao:recuperacao
node scripts/e2e/docker.mjs --recovery-check
```

O segundo comando confere health e shell Angular pela publicação HTTPS em loopback,
sem chave, worker ou envio, e limpa sua sessão. Não encerra sessão na porta anterior.

O primeiro comando executa build Angular/API reais, PostgreSQL descartável, Chromium e um servidor
HTTP local simulado. O adapter Resend real é reutilizado, com transporte injetado
somente no entry point de simulação, que mapeia o endpoint fixo ao mock loopback.
A rede interna impede saída ao provider; usa apenas chave e senhas sintéticas.
Captura texto/HTML/link somente em memória, sem screenshots, HAR, traces ou vídeo.

Confere API disabled antes do worker, payload/destinatário/URL, um único POST,
estado SENT/token, bloqueio de segunda execução, redefinição, rejeição de reuso e
troca de senha. Guardas também verificam destinatário indevido e orçamento após
exceção/INDETERMINATE. Não comprova configuração de domínio, DNS, TLS remoto,
retenção ou recebimento real. Nenhuma autenticação Postman é necessária.

## Encerrar

```bash
npm run homologacao:parar -- IDENTIFICADOR_DA_SESSAO
```

A limpeza verifica propriedade e remove somente runner, banco, imagem e redes
dessa sessão. Contas, certificados e marcador são descartados. Não encerra nem
remove a sessão anterior ou recursos de outros sistemas. Não usar limpeza global.

Referências públicas: [tracking](https://resend.com/blog/introducing-custom-tracking-domain)
e [segurança/tratamento externo](https://resend.com/security).
