# 0001: Stack, inherited from Catch

Status: accepted (2026-10-13)

## Context

Throw is a companion to Catch with its own data model (docs/spec.md). The two should look
and behave alike, release independently, and not double the work of maintaining them.

## Decisions

**The stack is Catch's.** A Vite and React client with TanStack Router and TanStack DB,
Tailwind v4 and shadcn/ui; a Hono server on Node with Better Auth and Drizzle on Postgres;
Electric for sync behind an auth proxy; an outbox for queued writes; Capacitor for Android.
Tooling is the same too: pnpm workspaces, Biome, Vitest, Playwright, one Docker Compose
stack per Git worktree, and the same PR labels and `validation` check.

**The code was copied, not shared.** The repository started from Catch's infrastructure
files at `iiloni/catch@818b50e`, renamed and trimmed. There is no shared package and no
dependency between the repositories. Shared packages are worth extracting only once
keeping two copies in step costs more than the coupling would.

**Separate server, accounts and database.** Throw has its own server and its own users.
Nothing reads Catch's database, and there is no shared auth.

**Only what the scaffold needs was ported.** Left in Catch until a feature needs them:
the dock and navigation, keyboard and system-bar handling, split view, the BlockNote
editor, tags, attachments, server backups, invites and admin pages, multiple accounts on a
device, update prompts, release channels and scripts, and the Android project.

## Consequences

- A fix to copied code (the outbox, the shape proxy, the worktree scripts) has to be made
  in both repositories by hand.
- Application colors and design tokens remain Catch's, including its amber control
  accent. Throw's own Arc Forward artwork has jade, preview purple and dev blue treatments
  for brand assets only; it does not override the application palette or typography
  (see [branding](../branding.md)).
- Development ports and Compose project names differ from Catch's so both run on one
  machine. The production Compose file defaults to port 3100 for the same reason.
- Running both apps from one Compose stack against one Postgres container is intended
  (docs/spec.md) but not set up: each repository's Compose file starts its own Postgres.
