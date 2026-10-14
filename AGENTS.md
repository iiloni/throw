# Throw — agent guide

Throw is a self-hosted, offline-first project management app. It is a companion to
[Catch](https://github.com/iiloni/catch) (notes): the same design language and stack, with
its own repository, server, accounts and data. It ships as a web app (installable PWA) and
a Capacitor Android app from the same code.

Read `docs/spec.md` before building a feature: it says what the product is and what is out
of scope. Read `docs/decisions/` before changing architecture. If a decision or the spec no
longer holds, update it in the same change rather than working around it.

The repository has the stack end to end (auth, sync, the outbox, local persistence), two
synced tables (workspaces and projects), and the responsive app shell. The shell owns
workspace and project management, a desktop navigation rail, a phone dock and remembered
navigation. Its project/backlog and cross-project board bodies are placeholders. Tasks,
statuses, tags and the board itself are not built yet.

The board's interaction was worked out in a prototype on mock data: `/prototype/board`, in
development builds only, with its components in `apps/web/src/components/Board`. It has no
server, schema or sync behind it. Build the real board from those components and from
ADR 0008 rather than starting again.

## Layout

| Path | What lives there |
| --- | --- |
| `apps/web` | Vite + React SPA, TanStack Router (file routes in `src/routes`), TanStack DB, Tailwind v4 + shadcn/ui. Also the Capacitor config and native Android project. |
| `apps/server` | Hono API on Node. Better Auth, Drizzle (Postgres), Electric shape proxy. Serves the built web app in production. |
| `packages/shared` | Zod schemas, types and pure helpers used by both apps. Exported as TypeScript source (no build step). |
| `e2e` | Playwright tests that drive the real app against the dev database. |
| `docs/spec.md` | The product spec, with its open questions. |
| `docs/data-model.md` | The task data model: fields, server-assigned values and write rules. |
| `docs/decisions` | Short architecture decision records. |

## Commands

Development runs in Docker, one isolated stack per Git worktree (see `WORKTREES.md`).
Always go through `./scripts/dev.sh` from the checkout you are working in; it targets that
checkout's stack. Never hard-code container or project names.

- `./scripts/dev.sh up`: start this worktree's stack and print its URL. Hot reload is on.
- `./scripts/dev.sh check`: lint, typecheck, unit tests, build. **Must pass before you finish.**
- `./scripts/dev.sh e2e <file> [--grep <pattern>] --workers=1`: targeted Playwright tests
  against this worktree's stack. Select the affected specs or cases; see the E2E policy below.
- `./scripts/dev.sh android [--static] [--usb] [--target <id>]`: install Throw Dev; use
  `--static` for bundled code and offline testing. Host JDK 21, SDK 36 and adb are required.
- `./scripts/dev.sh generate`: create a migration after editing `apps/server/src/db/schema.ts`.
  Commit the generated SQL and journal.
- `./scripts/dev.sh logs app`, `psql`, `shell`, `seed`, `reset -y`: see `./scripts/dev.sh help`.
- `pnpm format` (host): apply Biome formatting and import sorting.

Seeded logins: `admin@example.com` / `adminadmin` and `user@example.com` / `userpassword`.

Throw's worktree ports (20080 to 24000) and Compose project names (`throw_*`) do not overlap
Catch's, so stacks of both run side by side on one machine.

### Pull requests and CI

- For new features and code fixes, use a draft PR targeting `main` by default unless the
  user explicitly requests a different workflow. Work in the assigned checkout; if it is
  on `main`, create a feature branch there. If the assigned checkout is on a worktree
  placeholder branch (e.g. `t3/<id>`), rename it to a semantic name — `<type>/<short-description>`
  using the Conventional Commit type as prefix (e.g. `docs/squash-merge-policy`) — before
  opening the PR, so CI runs once against the final name.
  Commit and push reviewable changes, open the
  draft PR and include its link in progress updates. Reuse an existing PR for the branch
  rather than creating a duplicate. Read-only questions do not require a PR.
- Assign the PR to its creator by default. With `gh pr create`, use `--assignee @me`;
  when reusing an existing PR, check its author and add that author as an assignee.
- Add a small set of existing descriptive labels when opening the draft: `enhancement`
  for features or improvements, `bug` for defect fixes, `documentation` for substantive
  documentation changes, `accessibility` for accessibility work and `maintenance` for CI,
  build tooling, dependencies, refactoring or test infrastructure. Choose labels that
  reflect the actual scope; do not create new labels or apply unrelated issue-status
  labels during routine PR work. Set descriptive labels before `merge on pass`, because
  label edits also trigger CI. Descriptive labels do not authorize merging.
- Iterate on the draft without `merge on pass`. Regular checks run on updates.
  Use targeted local E2E for affected behavior, with `--workers=1` to limit contention
  across active worktrees. Do not run the full local E2E suite as a routine finishing check.
  Also run the affected cases in Firefox when changing navigation/transitions, scrolling or
  fixed/sticky layers, focus/keyboard handling, or browser APIs with different engine support,
  and whenever a bug is reported in Firefox or a Firefox-based browser such as Zen. Keep
  this targeted; ordinary features and the default Chromium/Android checks do not need a
  second full suite. Report the tested browser version and any remaining coverage limits.
  For visual rendering bugs, verify painted frames rather than computed CSS alone. Firefox's
  screenshot API can omit active view transitions; use an isolated display recording for
  those transitions (see `docs/ci.md`).
  Request an early full suite only for sweeping changes that benefit from broad regression
  coverage (for example, shared navigation, sync or test infrastructure changes), or when
  the user explicitly requests one. Offload it to GitHub by adding `run e2e` to the draft
  with `gh pr edit <number> --add-label 'run e2e'`; agents may do this without merge approval.
  For other changes, rely on the full E2E guard before merge. The full Docker E2E suite
  starts with either `run e2e` or `merge on pass` and on later pushes while either remains.
  After the requested E2E jobs finish, inspect their results and remove `run e2e` with
  `gh pr edit <number> --remove-label 'run e2e'` if upcoming commits do not need another
  full run. Keep it while fixing E2E failures or iterating on sweeping changes that still
  warrant full coverage, and reapply it later when another full run is justified.
  Wait until the run finishes before removing it: label changes cancel superseded CI runs.
  `run e2e` requests tests only: keep the PR a draft and do not enable auto-merge or merge
  without separate approval. See `docs/ci.md` for repository setup and commands.
- Use the AI review process below when the developer requests or approves a review,
  or has applied `ai review`. Recommend a review for changes to the areas listed
  there, but wait for developer approval before requesting it. The label is advisory
  and does not authorize merging.
- A PR without `merge on pass` deliberately fails `validation`, even if `run e2e` tests
  pass; require that check in branch protection so testing alone cannot permit merging.
  `merge on pass` means functionality and design are approved and authorizes merging
  once required checks pass.
- A change confined to documentation (`docs/`, root Markdown, the PR
  template, `LICENSE`, `.gitignore`, `cubic.yaml`; the list is `scripts/change-scope.ts`)
  runs `check` and skips E2E, on its PR and on `main`. It still needs `merge on pass` to
  pass `validation`. One other file in the change makes it code. Do not add `run e2e` to
  such a PR.
- After the user approves functionality and design for merging, mark the PR ready and add
  `merge on pass`. Fix failures with the label left in place, then squash-merge. If a fix changes the approved functionality or design, disable pending
  auto-merge, return the PR to draft, remove the label and obtain renewed approval.
  The local `./scripts/dev.sh check` requirement still applies.
- Once the user approves the feature for `merge on pass`, shut down this worktree's dev
  stack with `./scripts/dev.sh down` from this checkout. Approval means the user is done
  manually testing the feature, so free those resources while CI runs. If failed tests
  need local investigation or fixes, bring it back with `./scripts/dev.sh up`, then run
  `./scripts/dev.sh down` again when the local work and checks are finished.
- A PR does not have to be up to date with `main` to merge: its checks ran on GitHub's
  merge of the branch with `main` as it stood then, and a passing result stays valid when
  other PRs land. Do not update the branch just because `main` advanced, since every
  update reruns the full suite.
- When validation passes, look at what reached `main` since the branch last included it
  (`git fetch origin main`, then `git diff --stat HEAD...origin/main`) before merging. If
  none of it touches the files or the behavior your PR changes, squash-merge as it is (`gh pr merge <number> --squash`;
  the repo ruleset only allows squash merges). If it
  does, or the branch conflicts, merge `main` into the branch yourself, read how the two
  changes combine, fix what does not fit, run targeted checks and push; that update is
  worth the rerun. Squash-merge by hand after this look rather than enabling auto-merge ahead
  of it. Also update to pick up a fix for a failure that came from `main`.
- After approval, monitor the latest commit's checks (`gh pr checks <number> --watch`),
  investigate failures, fix them and push updates until required validation passes.
  Continue through the authorized squash-merge and verify the PR is actually merged, then update
  local `main` and clean up the worktree. Opening a PR or enabling auto-merge alone does
  not complete the task.
- Your task ends with your PR merged. Do not watch `main` CI afterwards or take on a
  failure there: a red `main` only blocks releasing that commit, and the user starts an
  agent for it when needed. Do not fix a failure that comes from `main` inside an
  unrelated PR; report it instead.
- Write PR descriptions for a reviewer who has not seen the conversation. Lead with the
  feature, improvement or fix and what it enables or changes. Include motivation or a
  before/after example when useful; a linked issue is optional.
  Summarize the final scope, relevant validation (passed, failed or still pending) and
  material limitations. Scale detail to the change: simple PRs need only a short paragraph
  plus validation. Use a Conventional Commit title, update the title/description when scope
  changes and use `.github/pull_request_template.md` for the body, including when creating
  PRs through a CLI or API. Fill its sections, remove instructional comments and omit empty
  optional review notes. Omit conversation history or abandoned approaches unless they
  explain a review-relevant tradeoff. Report screenshots or recordings for visual changes
  when available; link relevant issues and docs.

### AI code review

- AI review is advisory and never required for merging unless the developer requires
  it. Recommend one to the developer when the PR changes any of:
  - API requests/responses, synced shapes or write/replay behavior
    (anything ADR 0003 covers), or the protocol version;
  - auth, sessions, admin guards, the CSP or shape-proxy
    membership filters and column allowlists;
  - the Drizzle schema or a migration;
  - the outbox, local persistence (`localStore.ts`, `schemaVersion`) or device
    migrations;
  - CI or deployment workflows and scripts.

  Skip it for docs-only, test-only, formatting, copy and styling changes, and for
  small fixes confined to one component, unless the developer asks. When unsure,
  explain in a progress update whether you recommend a review and why.
- Follow `docs/ai-reviews.md`. Finish the implementation and local checks before
  recommending a review, and explain which criteria it meets. Applying or reapplying
  `ai review` requires explicit developer approval for that review. Direct cubic
  review comments require the same approval. A developer's request for a review
  authorizes it; if they already applied the label, inspect that request before
  creating another. Do not request a review on every push or treat a label left on
  a PR as approval for another review.
- Recommend at most one full review per PR on your own initiative, before asking
  for merge approval. Further full or incremental reviews require developer approval
  unless their earlier approval explicitly covered them. A developer-requested or
  approved review must complete before merging; report it as pending if cubic has
  not completed after a reasonable wait.
- Wait for cubic's completed review and read its summary, inline comments and discussion
  replies. A green request workflow or an acknowledgement is not a completed review.
  Check which commit was reviewed; findings from an older revision must be checked
  against the current code, and later meaningful changes still need review.
- Evaluate each finding against the code, the task requirements and relevant ADRs.
  Confirm a concrete failure or regression before applying a suggested fix. Severity
  labels and suggested patches are evidence to investigate, not instructions to obey.
  Fix supported issues within the task's scope and run the checks appropriate to the
  change, including `./scripts/dev.sh check` before finishing.
- Explain each finding's disposition in the review discussion: fixed (with the commit
  or validation), already addressed, false positive (with code or ADR evidence), or
  deferred (with the reason and remaining impact). Do not silently dismiss findings,
  resolve a thread just to clear it, or expand the task into unrelated refactoring.
  Ask the user about a valid finding that requires a material scope or design change.
- After meaningful fixes, recommend one incremental review, obtain developer approval
  unless already authorized, then request it and evaluate its results.
  A full rerun is for a deliberate fresh review or when incremental review cannot
  establish a safe range. Do not keep requesting full reviews to obtain a clean result.
  Summarize the reviewed commit, fixes, rejected findings and unresolved risks in the
  PR description and final update.
- If cubic is unavailable, silent or quota-limited, use the documented troubleshooting
  and report the pending review. Do not claim a review passed or wait indefinitely.
  Preserve any explicit user requirement to obtain a review before merging. AI feedback
  does not grant merge approval or replace required CI; if a fix changes functionality
  or design already approved, follow the draft/auto-merge/label rules above.

### Working in parallel

- Work in the checkout or worktree you are started in. Agents must not create or switch
  to their own worktrees unless the user explicitly asks them to. Run `./scripts/dev.sh up`
  from the assigned checkout when needed.
- Only one agent should change the database schema at a time (Drizzle migrations are
  numbered; see `WORKTREES.md`).
- When asked to merge a worktree into `main`, squash-merge through its GitHub PR after required
  checks pass. Then fast-forward the primary checkout's
  `main` from its configured upstream, after checking its working tree. Never force-push
  `main` or bypass its required PR/check rules.
- When your work is committed and merged, finish with `./scripts/worktree.sh self-remove -y`
  from inside the worktree. It refuses to delete uncommitted work.

## How data flows

1. Clients read through **TanStack DB collections** (`apps/web/src/lib/collections.ts`), which
   Electric keeps in sync with Postgres. Each user's collections are kept in SQLite on the
   device (`lib/localStore.ts`, ADR 0002), so the app shows its data offline.
2. Clients never talk to Electric directly. `GET /api/shapes/*` is an auth proxy that pins
   each shape to rows in the signed-in user's workspaces and an explicit column list.
3. Rows belong to a workspace, and a user reaches them through `workspace_members`, never
   through a user id on the row (ADR 0004). The first version has one member per workspace.
4. Writes are optimistic and queued: `write()` applies them to the collection immediately and
   stores them in an outbox, which sends them to the REST API in order, retrying until the
   server has them. The API returns the Postgres `txid` so the optimistic state is dropped
   once Electric streams that transaction back, or `{ txid: null }` for a replayed write it
   already applied.
5. IDs are UUIDv7 and are generated **on the client** so rows can be created offline.
6. Components call actions in `apps/web/src/lib` (such as `lib/projects.ts`) rather than
   mutating a collection directly. Those actions wrap their changes in `write()`; collections
   have no mutation handlers, so a change outside `write()` throws.

When adding a synced table: add it to the Drizzle schema with a `workspaceId` (or a parent
that has one), generate a migration, add a Zod schema to `packages/shared`, add a shape in
`routes/shapes.ts` with a membership filter and a column allowlist, add write routes that
check membership, return `{ txid }` and are safe to replay, then add a persisted collection.
If clients write to it, add it to `writableCollections` and `send()` in `collections.ts`.

## Conventions

### API compatibility

- Read [ADR 0003](docs/decisions/0003-api-compatibility.md) when changing API requests,
  responses, synced shapes or write/replay behavior. Review old client → new server **and**
  new client → old server; shared TypeScript types only check one build.
- Nothing is released yet, so the protocol is 1 and may change freely until the first
  release. After that, keep `API_PROTOCOL_VERSION` and `SUPPORTED_API_PROTOCOLS` in
  `packages/shared/src/protocol.ts` unchanged for UI changes, compatible fixes and additions
  with working fallbacks.
- For an incompatible contract after the first release, increment the client protocol and
  server maximum. Raise the minimum when old clients cannot work. Add boundary tests, document
  the upgrade order and use a breaking Conventional Commit.
- Shape column changes also require the collection's `schemaVersion` bump. Changes to queued
  write formats need a lossless device migration; the protocol gate and schemaVersion do not
  migrate the outbox. Never clear local data or classify protocol rejection as a permanent
  write failure to resolve incompatibility.
- New data routes are gated by default. Use `compatibleFetch` for client REST requests and
  `compatibleShapeFetch` for Electric. Keep bootstrap and auth requests backward compatible.

### General

- Use Conventional Commits: `<type>(<optional scope>): <description>`, for example
  `feat(board): add status columns` or `fix(sync): retry interrupted writes`.
  Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- TypeScript strict everywhere. No `any`; validate unknown data with Zod.
- Request and response shapes come from `packages/shared`. Do not redeclare them in an app.
- Style with Tailwind utilities and the tokens in `apps/web/src/styles.css`. Tokens already
  handle dark mode via `light-dark()`, so avoid `dark:` variants. The tokens are Catch's;
  keep the two apps' look in step unless the spec says otherwise.
- Motion and touch are part of the product (see the principles in `docs/spec.md`). Design
  for touch first: no hover-only controls on mobile widths.
- Controls appear only when they are usable. Do not add UI that advertises capability.
- Add UI primitives with `pnpm dlx shadcn@latest add <component>` from `apps/web`; they land
  in `src/components/ui` and are ours to edit.
- Feature components go in `apps/web/src/components/<Name>/<Name>.tsx` with a
  `<Name>.test.tsx` next to them.
- Every Postgres query that touches workspace data filters by membership
  (`memberWorkspaces` in `apps/server/src/lib/workspaces.ts`).
- Keep comments for the *why*; do not narrate the code.

### Porting from Catch

Much of what Throw needs already exists in Catch (`iiloni/catch`): the dock and its glass,
the keyboard and safe-area handling, split view, the BlockNote editor, nested tags,
attachments, backups, invites, release channels and the Android project. Port a piece when
a feature needs it rather than ahead of time, and adapt it to workspaces instead of user
ids. Do not add a dependency on Catch's repository; the two release independently.

## Gotchas

- A new workspace package needs its own `node_modules` volume in `docker-compose.dev.yml`,
  or the container will install dependencies into the bind-mounted checkout.
- `pnpm-lock.yaml` started as Catch's. Dependency names that contain "catch" (such as
  `@babel/plugin-transform-optional-catch-binding`) are real; do not rename them.
- Electric rows skip the collection's Zod schema, so column types that need parsing (such as
  `timestamptz` into `Date`) go in a `parser` option on the collection's `shapeOptions`.
- A shape's `where` uses a subquery on `workspace_members`. Electric moves rows in and out of
  a shape when membership changes, so do not denormalize a user id onto rows to filter them.
- A shape's first response (`offset=-1`) is the shape as Electric first built it, not as it
  is now. Tests read a shape with `shapeRows` in `e2e/helpers.ts`, which follows its log.
- `throw` is a Java keyword, so the Android application id cannot be `org.iloni.throw`.
  The permanent application id is `org.iloni.throwtasks`; dev and preview add `.dev` and
  `.preview`, with names Throw Dev and Throw Preview.
- All clients authenticate with Better Auth bearer tokens (`set-auth-token` header), not
  cookies, so the Android app on another origin shares the web app's code path. Only the
  signed token from `set-auth-token` works as a bearer token.
- Sign-up closes after the first account unless `REGISTRATION=open`, which dev stacks set.
  Catch's invite links have not been ported, so a closed server has one account.
- The app draws edge to edge. Pad fixed UI with the `--safe-top` / `--safe-bottom` tokens.
  The root sets `--keyboard` through browser viewport/VirtualKeyboard tracking; the shell
  uses `--dock-*` for the phone dock. Catch's native KeyboardInsets plugin owns system
  insets and keyboard animations on Android;
  Capacitor SystemBars inset handling is disabled to avoid competing owners. Android Back
  dismisses open sheets through `lib/backButton.ts` before navigating history.
- TanStack DB is pre-1.0. Keep its usage inside `src/lib/collections.ts`, `src/lib/localStore.ts`
  and route files so upgrades stay contained.
- Bump a collection's `schemaVersion` in `collections.ts` whenever the columns its shape syncs
  change, or devices keep reading rows of the old shape from their local database.
- Collections open the signed-in user's local database when the module loads (top-level
  await), so signing in does a full page load. Offline, collections never become ready (that
  needs the server); pages wait with `useAwaitingSync`, not `isLoading`.
- The dev server has no service worker, so a page cannot load code offline in development.
  E2E tests for offline behavior block `/api` instead (see `e2e/projects.spec.ts`).
- A production build registers a service worker that precaches the app. There is no update
  prompt yet: a new build takes over once every tab of the old one has closed.
- E2E setup goes through `e2e/helpers.ts`: `signUp` makes the account through the API and
  stores its session as the app does.
- An E2E test that only uses `request` is tagged `@api` and runs once in the `api` project
  instead of once per layout. A test of behavior no layout changes (sync, the outbox) skips
  one layout with `test.skip(isMobile, reason)`, provided another test in the file still
  drives the same screens on both.
- The production server sends a content security policy (`lib/securityHeaders.ts`) that
  Vite's dev server does not. A script, frame or request to another origin works in
  development and is blocked in production until the policy allows it.
- Traces slow every E2E test, so only the rerun of a failed test records one
  (`playwright.config.ts`). A test that passes on its rerun is reported as flaky, which fails CI.
