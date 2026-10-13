# syntax=docker/dockerfile:1.7
# Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY . .
RUN test -f pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Builds the API and, first, every workspace package it depends on.
RUN pnpm --filter "@aeroos/api..." run build
# Standalone production folder: the API, its workspace packages and production dependencies only.
RUN pnpm --filter @aeroos/api deploy --prod /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
