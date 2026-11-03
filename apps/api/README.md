# Bello Flow API

Aplicação backend NestJS do Bello Flow. Concentra os módulos e casos de uso do
monólito modular e sua integração com PostgreSQL por Prisma.

O estado atual e o próximo objetivo estão em
[Estado do projeto](../../docs/estado-do-projeto.md).

Os comandos devem ser executados na raiz do monorepositório:

```bash
npm run dev:api
npm run build:api
npm run test --workspace=@bello/api
npm run test:e2e --workspace=@bello/api
```

O servidor de desenvolvimento responde em `http://127.0.0.1:13000`.
A verificação de atividade está disponível em `GET /health/live`.
