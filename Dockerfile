# syntax=docker/dockerfile:1.7
FROM node:24-slim AS runtime
ARG POSTGRES_MAJOR=17
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /usr/share/keyrings/postgresql.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends "postgresql-client-${POSTGRES_MAJOR}" \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

FROM runtime AS base
WORKDIR /workspace
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" \
    && rm package.json

# Used by scripts/dev.sh: the checkout is bind-mounted and dependencies live in volumes.
# Do not create the volume mount points here: Docker resets an empty volume's owner to
# the image directory's on every mount, undoing the chown to the host user in dev.sh.
FROM base AS development
ENV NODE_ENV=development
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && chown node:node /workspace
CMD ["sh", "scripts/dev-entrypoint.sh"]

FROM base AS build
ARG THROW_CHANNEL=dev
COPY . .
# The full install above validates workspace patches. The server-only deploy below excludes
# the web app, so allow its SQLite patch to be unused during that narrowed install.
RUN --mount=type=cache,id=throw-pnpm-store,target=/pnpm-store \
    export PNPM_CONFIG_STORE_DIR=/pnpm-store \
    && pnpm install --frozen-lockfile \
    && pnpm --filter @throw/web build \
    && pnpm --filter @throw/server build \
    && printf '\nallowUnusedPatches: true\n' >> pnpm-workspace.yaml \
    && pnpm --filter @throw/server deploy --prod --legacy /out

FROM runtime AS production
WORKDIR /app
ARG THROW_VERSION=
ARG THROW_CHANNEL=dev
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle \
    THROW_VERSION=${THROW_VERSION} \
    THROW_CHANNEL=${THROW_CHANNEL}
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /workspace/apps/server/dist ./dist
COPY --from=build /workspace/apps/server/drizzle ./drizzle
COPY --from=build /workspace/apps/web/dist ./web
RUN mkdir -p /data/backups && chown node:node /data/backups
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.mjs && node dist/index.mjs"]
