# Bello Flow API

API da fundação F0.1, criada com NestJS 12.3.2.

Os comandos devem ser executados na raiz do monorepositório:

```bash
npm run dev:api
npm run build:api
npm run test --workspace=@bello/api
npm run test:e2e --workspace=@bello/api
```

O servidor de desenvolvimento responde em `http://127.0.0.1:13000`.
A verificação de atividade está disponível em `GET /health/live`.
