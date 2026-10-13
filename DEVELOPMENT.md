# Developing Throw

This guide is for people changing Throw's code. It covers the development environment,
tests and how changes reach `main`.

For how the code is organized and the conventions it follows, read [AGENTS.md](AGENTS.md).
[docs/spec.md](docs/spec.md) describes what is being built, and [docs/decisions](docs/decisions)
records why the stack looks the way it does.

## What you need

- Docker, which runs the app, Postgres and Electric.
- Node 24 and pnpm (`corepack enable`) on the host, for end-to-end tests and editor support.

## Start the app

```bash
./scripts/dev.sh up
```

This builds and starts a stack for this checkout and prints its URL. Hot reload is on.
Sign in with `admin@example.com` / `adminadmin` or `user@example.com` / `userpassword`.

Each Git worktree gets its own stack with its own database and port, so several branches can
run side by side. See [WORKTREES.md](WORKTREES.md).

`./scripts/dev.sh help` lists every command, including `logs`, `psql`, `shell`, `seed` and
`reset`.

## Check your changes

```bash
./scripts/dev.sh check   # lint, typecheck, unit tests, build
pnpm format              # apply formatting and import sorting
```

`check` must pass before a change is finished.

### End-to-end tests

Playwright runs on the host against this checkout's stack. Set it up once:

```bash
pnpm install
pnpm exec playwright install chromium
```

Then run the specs your change affects:

```bash
./scripts/dev.sh e2e e2e/auth.spec.ts --workers=1
./scripts/dev.sh e2e e2e/auth.spec.ts --grep "signing in" --workers=1
```

The full suite is slow and runs in CI before a merge, so it is not a routine local check.
Runs take a lock shared by all worktrees on the machine and need `flock`.

## Pull requests

Changes go through a draft pull request against `main`. Commits and PR titles use
[Conventional Commits](https://www.conventionalcommits.org/).

[Pull requests and CI](docs/ci.md) explains the labels that request the full test suite and
approve a merge, and the checks a PR must pass. [AI code review](docs/ai-reviews.md) covers
the optional review.

## Android

The client is written to run in a Capacitor WebView as well (`apps/web/capacitor.config.ts`,
the native paths in `lib/localStore.ts` and `lib/serverUrl.ts`), but the Android project has
not been generated yet. Catch's `android` commands, release channels and signing have not
been ported.

## Releasing

There is no release process yet. Catch's tagging, changelog and image publishing scripts
have not been ported.
