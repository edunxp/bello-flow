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
