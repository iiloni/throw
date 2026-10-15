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

**Port features when needed.** The scaffold was followed by the responsive shell and the
Capacitor Android project, including native SQLite, keyboard/system-bar handling and the
stable/preview/dev source sets. Split view, the BlockNote editor, attachments, invites and account-management admin pages and multiple accounts on a device stay in Catch
until a feature needs them. Release/signing, update prompts and server backups were ported
in ADRs 0009–0010. No sharing, reminders, media or widgets
are ported with the Android shell.

## Consequences

- A fix to copied code (the outbox, the shape proxy, the worktree scripts) has to be made
  in both repositories by hand.
- Application surfaces, typography and project/tag colors remain Catch's. Throw's UI uses
  an explicitly authored jade accent palette for controls, links, focus and selected
  states in every build. Arc Forward's jade, preview purple and dev blue artwork remains
  independent of the UI tokens (see [branding](../branding.md)).
- Development ports and Compose project names differ from Catch's so both run on one
  machine. The production Compose file defaults to port 3100 for the same reason.
- Each repository keeps its standalone Compose stack; ADR 0009 adds a combined example
  for an operator-owned directory with one Postgres container and separate databases.
