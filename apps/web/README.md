# Bello Flow Web

Aplicação frontend Angular do Bello Flow, responsável pela interface web do
produto.

O estado atual e o próximo objetivo estão em
[Estado do projeto](../../docs/estado-do-projeto.md).

Os comandos devem ser executados na raiz do monorepositório:

```bash
npm run dev:web
npm run build:web
npm run test --workspace=@bello/web
```

O servidor de desenvolvimento responde em `http://127.0.0.1:14200`. A
configuração de desenvolvimento encaminha `/api` para o NestJS em
`http://127.0.0.1:13000`, preservando a origem percebida pelo navegador. O
frontend deve chamar a API por URLs relativas, sem codificar a origem do backend.

## Autenticação e recuperação

As rotas são `/login`, `/forgot-password`, `/reset-password` e `/` (área
autenticada mínima). A inicialização consulta a sessão; ausência de sessão na
área protegida conduz ao login, enquanto indisponibilidade permite repetir apenas
a consulta. Novas entradas nas rotas de acesso/área autenticada também reconsultam a sessão;
não há polling nem armazenamento persistente de identidade ou segredos.
Login confirmado atualiza a sessão global mesmo se a tela de login já foi fechada.

O cliente usa os contratos publicados em
[segurança e autorização](../../docs/arquitetura/seguranca-e-autorizacao.md).
Inclui uma única ocorrência de `X-Bello-Flow-Request: 1`, usa JSON apenas nos DTOs
e deixa cookie, Origin e Referer sob controle do navegador. Logout não envia corpo.
Não há retry automático de mutações. Timeout de 15 segundos ou erro operacional
não comprova que a mutação deixou de acontecer; a interface informa incerteza.

A solicitação aceita mostra confirmação condicional, sem afirmar envio de e-mail.
O reset captura o token canônico do fragmento antes da ativação das rotas, remove
o fragmento por `replaceState` e mantém o token somente em memória. Reaberturas
no mesmo documento são capturadas antes dos listeners de localização do Router;
novas entradas reativam o formulário sem transportar o token no estado de navegação. Sair da tela
ou concluir o reset descarta o valor. Recarregar exige reabrir o link original ou
solicitar outro. A confirmação de senha fica apenas no cliente; a política de
12–128 pontos de código Unicode bem formados preserva a regra da API, sem trim
ou normalização da senha. A API continua sendo a autoridade.

Depois do reset, há nova consulta da sessão: não se presume que o cookie seja
da conta redefinida, não há limpeza de cookie pelo cliente nem login automático.

Os testes de fluxo usam componentes, formulários, Router e HttpClient reais com
`HttpTestingController` em jsdom. Eles comprovam integração Angular e DTOs,
não entrega real de e-mail, atributos de cookie de produção ou experiência em
navegador real/leitor de tela. Provider, TLS/proxy público, fallback de rotas SPA
(exceto `/api` e `/health/live`) e prontidão produtiva exigem validação própria.
