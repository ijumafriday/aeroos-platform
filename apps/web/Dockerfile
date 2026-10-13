# syntax=docker/dockerfile:1.7
# Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY . .
RUN test -f pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter "@aeroos/web..." run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV OIDC_AUTHORITY=http://localhost:8081/realms/aeroos OIDC_CLIENT_ID=aeroos-web
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
