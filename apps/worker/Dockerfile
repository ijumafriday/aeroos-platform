# syntax=docker/dockerfile:1.7
# Build context: repository root.
# Debian (glibc) base: the Temporal worker ships a native core that is not built for Alpine/musl.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY . .
RUN test -f pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter "@aeroos/worker..." run build
RUN pnpm --filter @aeroos/worker deploy --prod /out

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
USER node
CMD ["node", "dist/worker.js"]
