FROM node:24.22.2-bookworm-slim AS node
FROM mcr.microsoft.com/playwright:v1.64.1-noble
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /work
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
COPY apps/web apps/web
COPY scripts/e2e scripts/e2e
RUN npm run prisma:generate --workspace=@bello/api && npm run build
CMD ["node", "scripts/e2e/run.mjs"]
