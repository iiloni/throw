# Throw

A self-hosted, offline-first project management app, in the same family as
[Catch](https://github.com/iiloni/catch).

Throw is at the scaffold stage. The stack works end to end (sign-in, sync, offline writes),
with workspaces and projects as its first data. The product itself, described in
[docs/spec.md](docs/spec.md), is not built yet.

## Development

Requires Docker and, for end-to-end tests and editor support on the host, Node 24 and pnpm
(`corepack enable`).

```bash
./scripts/dev.sh up    # isolated stack for this checkout; prints its URL
./scripts/dev.sh check # lint, typecheck, test, build
pnpm install && ./scripts/dev.sh e2e
```

Sign in with `admin@example.com` / `adminadmin`.

Each Git worktree gets its own stack, so several branches can run side by side; see
[WORKTREES.md](WORKTREES.md). See [DEVELOPMENT.md](DEVELOPMENT.md) for the workflow and
[AGENTS.md](AGENTS.md) for architecture and conventions.

## Self-hosting

[Deployment](docs/deployment.md) covers published-image installation, HTTPS and running beside
Catch with one Postgres container and separate app databases. Production configuration lives
in an operator-owned directory. [Releases](docs/releases.md) covers channels, Android signing
and publishing; [backups](docs/backups.md) covers scheduling and recovery.

Before the first image is published, or to build a checkout:

```bash
cp .env.example .env   # set auth URL/secret, Postgres password and Electric secret
# In .env, uncomment COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml
docker compose up -d --build --wait
```

The app listens on port 3100 (`THROW_PORT` to change it). The first account becomes the
instance admin and sign-up then closes; `REGISTRATION=open` explicitly permits more accounts.
