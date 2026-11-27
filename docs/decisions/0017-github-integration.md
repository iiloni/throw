# 0017 — GitHub integration

Status: accepted (2026-11-26) for the connection and inbound webhooks (THR-122), links
(THR-123) status rules (THR-125) and release bindings (THR-126). Later parts of the integration amend this record as
they land.

## Context

Work tracked in Throw usually happens in a GitHub repository: a task becomes a branch, a pull
request and, later, part of a release. Today a person copies links by hand and moves the
card when the pull request merges. The GitHub integration (THR-86) lets a project follow one
repository so tasks can show and follow that work. It is built in parts:

| Part | What it adds |
| --- | --- |
| THR-122 | A project's connection to a repository, its encrypted secrets, and a signed inbound webhook receiver with a dispatcher. |
| THR-123 | Synced pull request and issue links on tasks, linked automatically from branches, pull requests, commits and issues, and MCP tools for them. |
| THR-124 | Pull request and issue cards in the task pane and a quiet mark on board cards. |
| THR-125 | Per-project status changes on pull request and issue events, which the project opts into. |
| THR-126 | Tasks bound to the releases and tags that shipped them. |

Throw is self-hosted, often on a home server behind a tunnel, so the integration must work
without a public GitHub App registered for each server.

## Decision

**A project opts in by connecting one repository. GitHub pushes signed webhooks to Throw;
Throw verifies each one before anything reads it.** A connection is the only way GitHub
webhooks enter Throw. Members can also record releases and correct bindings manually in a disconnected project.

### The connection

`github_connections` holds one row per connected project (`project_id` is unique): the
repository as `owner/repo`, the access mode, an on/off switch, the inbound URL's token, the
encrypted webhook secret, an optional encrypted access token and the last delivery's
outcome. It belongs to the project, and so to its workspace: any member of the workspace
manages it ([ADR 0004](0004-workspace-membership.md)), and `created_by` only records who made
it. Purging the project or deleting the workspace deletes the connection. A project in the
trash keeps it, but its deliveries are recorded and ignored.

Access modes:

- `webhook` (the default): GitHub sends webhooks and Throw never calls GitHub. Enough for
  linking and status changes, which read what the webhooks carry.
- `token`: the connection also keeps a personal access token for features that read from
  GitHub (fetching a pull request's current state, back-filling links). Throw stores it
  encrypted and never returns it; responses say only `hasToken`. THR-122 stores the token
  but makes no GitHub API call; the parts that call GitHub use it.
- A GitHub App mode is left for later: it would add an `app` mode with an installation ID
  and the app's key, so a server could connect many repositories without personal tokens.
  The `auth_mode` check constraint lists the modes, so adding one is a migration.

Repository names are entered as `owner/repo` or any address GitHub shows for the repository,
normalised by `parseGithubRepository` in `@throw/shared`. Two projects may connect the same
repository; each has its own webhook.

### Secrets and where they live

Each connection has a webhook secret, `throw_ghsec_` and 32 random bytes in base64url,
which the person pastes into the webhook's Secret field on GitHub. Throw makes it; it is
returned once, in the uncached creation or rotation response, and never again. Verifying a
delivery needs the secret itself, so it is stored as outbound webhooks store theirs
([ADR 0015](0015-webhooks.md)): AES-256-GCM under a key derived with HKDF from
`BETTER_AUTH_SECRET`. The GitHub key has its own salt and label, so it never opens outbound
webhooks' secrets, nor theirs its own. The access token is encrypted under the same GitHub
key. If `BETTER_AUTH_SECRET` changes, deliveries fail with a message asking for a new secret,
and a token must be pasted again.

The inbound URL is `/api/integrations/github/webhooks/<token>`, on the server's public URL
(`BETTER_AUTH_URL`), where the token is 24 random bytes. The token finds the connection; it
is not what proves the sender, so the URL can be shown again. The request log replaces it
with `redacted`. A person can move the webhook to a new URL, and the old one stops answering.

`github_connections` and `github_deliveries` are server-only: never in a shape, never
synced, no collection or outbox format. Like MCP tokens and outbound webhooks
([ADR 0011](0011-server-backups.md)), backups exclude their data and a restore clears them,
even from an archive that contains them. After a restore, connections are made again and the
webhook on GitHub is updated with the new URL and secret. Data that later parts derive from
deliveries (links on tasks, release bindings) is ordinary synced data and is backed up.

### Receiving a delivery

GitHub sends no session and no `X-Throw-Protocol`, so the receiver is mounted before the
session and protocol middleware, with its own 25 MB body limit (GitHub's cap). In order:

1. A malformed or unknown token is answered 404 before the body is read.
2. The raw body is read and `X-Hub-Signature-256` is checked: `sha256=` and the hex
   HMAC-SHA256 of the exact bytes, keyed by the secret, compared with
   `crypto.timingSafeEqual`. A missing or wrong signature is 401.
3. `X-GitHub-Event` and `X-GitHub-Delivery` must be present and well formed (400).
4. The body must be a JSON object, sent as JSON or as the `payload` field of a form (400).
5. `repository.full_name` must name the connected repository, compared without regard to
   case (422). An organization's or app's webhook, whose ping names no repository, is refused.
6. A connection that is off, or whose project is in the trash, records the delivery as
   ignored and answers 202 without claiming it, so a redelivery after it is back on is used.
7. Otherwise, in one transaction, the delivery ID is inserted into `github_deliveries`
   (`ON CONFLICT DO NOTHING`), the event is dispatched and the outcome recorded. An ID seen
   before answers 200 `{ duplicate: true }` without dispatching; a concurrent delivery of the
   same ID waits for the first transaction and then finds it. A handler that throws rolls
   the transaction back, so the ID stays unclaimed and GitHub's redelivery is handled.

Each answer and refusal updates the connection's last delivery: time, delivery ID, event,
`ok` / `ignored` / `error` and a short detail. Project settings show it, so a person setting
up the webhook sees GitHub's ping arrive, or why it was refused. Someone who knows the URL but
not the secret can only overwrite that record with a refusal. Payloads are never logged or
stored by the receiver; a failure logs the delivery ID, event and error message.

Delivery IDs are kept for seven days and pruned per connection as deliveries arrive. GitHub
redelivers on request for three days.

### The dispatcher

`githubHandlers` in `apps/server/src/github/dispatch.ts` maps an event name to a handler.
A handler gets the transaction and `{ connection, event, deliveryId, payload }`, validates
what it reads with Zod and returns `ok` or `ignored` with a reason. A ping records the receipt. Pull request and issue deliveries link active tasks whose
project key and number appear in the title, body or PR head branch. Subsequent deliveries
refresh existing links even if the text no longer mentions the task. Push commit messages
can associate additional tasks when the branch and tip identify an already linked open PR.
Reviews summarize the latest decision per reviewer. Check runs and suites summarize the
current PR head, with individual runs replacing their suite count as they arrive.

`task_github_links` belongs to the task and survives a disconnect or backup/restore.
The membership-filtered `task-github-links` shape exposes card metadata, including counts.
Bootstrap advertises the optional `githubTaskLinks` capability. Devices load cached rows
independently and start the remote stream once the server advertises support.
The per-reviewer and per-check records used for aggregation stay on the server. The new
read-only collection has its own SQLite schema version 1 and requires no outbox migration.
Link additions, removals and state changes use the existing protocol-1 relations history
format, with the repository, number and state in its display names. A delivery that adds a link or changes its state
records GitHub as its source and emits a task update webhook. Its actor uses the existing
machine actor kind (`token`), the display name GitHub and an additive `integration: github`
marker. Reviews, checks and other metadata-only refreshes update the synced link quietly.
The receiver keeps normalized review and check signals with their seven-day delivery
receipts. A newly linked PR or a change of head reconciles earlier signals in the same
transaction. Raw webhook bodies never enter these receipts.

`POST /api/integrations/github/tasks/:taskId/links` takes a GitHub PR or issue URL,
plus optional title and state. Manual links reuse metadata from the same project's other
links to that item. For the first link, the default title is owner/repo#number and the
default state is open until a delivery arrives. Creating a link requires an enabled
connection to its repository. `DELETE …/links/:linkId` also works after disconnect.
Both operations return a transaction ID, null on a no-op. MCP exposes the same writes
as `link_github` and `unlink_github`, and `get_task.githubLinks` returns the public rows.

### Status rules

Status rules (THR-125) are the first automatic writes that change a task's own fields: links
are the task's GitHub data, and a rule moves the task itself. They are opt-in
per project and per rule, run only on a verified delivery, and are recorded as the
integration's. A connection holds five rules, each a target status or off (null, the default):

| Rule | Fires when a delivery… |
| --- | --- |
| `prDraftOpened` | opens, reopens or converts a linked pull request to a draft (`opened`, `reopened`, `converted_to_draft`). |
| `prReadyForReview` | opens or reopens a linked pull request ready for review, or takes it out of draft (`ready_for_review`). |
| `prMerged` | closes the task's last open pull request, when it or another of the task's pull requests merged. |
| `prClosed` | closes the task's last open pull request, when none of them merged. |
| `issueClosed` | closes the task's last open linked issue. |

The rules are five nullable columns on `github_connections`, each a foreign key to `statuses`
with `ON DELETE SET NULL`: deleting a status turns off the rules that named it. `PATCH
…/projects/:projectId` takes `statusRules`, a partial object where null turns a rule off and
a rule left out keeps its status. Every target must be a status of the connection's own
project, which must not be in the trash, or the request is refused with 400; the statuses
are held (`KEY SHARE`) until the write commits. The connection's metadata returns all five as
`statusRules`. The rules stay server-only with the connection: a restore clears them with it.

A rule runs inside `handleItem`'s transaction, after the delivery's links are written, for
each active task the delivery links or refreshes:

- **Only on a change of state.** The delivery's `action` must be one that changes the item's
  state, the resulting state must be the rule's, and the task's link must have been in
  another state or have just been made. An `edited` title, a `synchronize` push, labels,
  reviews and checks never move a task, even when they first link it. Deliveries older than
  the link (`updated_at` before its `sourceUpdatedAt`) are ignored before any of this, and a
  second notice of the same state finds nothing changed.
- **Several pull requests move a task together.** A merge or close moves it only when no
  other pull request of the task is open or a draft, and counts as merged when any of them
  merged; so merging one of two leaves the task where it is until the other closes. A new
  draft does not pull a task back while another of its pull requests is ready for review.
  Issues follow the same last-one-closes rule among the task's issues. A manual link counts
  with the state it shows.
- **As a move on the board.** A task already in the target status, a trashed task or one
  under a trashed parent is left alone; a target that is no longer the project's is skipped.
  Entering a closed category stamps `closedAt`, leaving one clears it, and moving between
  closed statuses keeps it. A top-level task moved to an open lane takes the top of that
  lane; one moved to a closed lane keeps its position (the closed zone sorts by closing time),
  and a subtask keeps its place among its siblings.
- **One record per task and delivery.** The link change and the status change go into one
  history entry (`viaTokenName` GitHub, no user) and one `task.updated` webhook whose actor is
  `{ kind: 'token', viaTokenName: 'GitHub', integration: 'github' }`, with `statusTo` and the
  lane position in its values. Outbound webhooks only notify external receivers; nothing in
  Throw sends to GitHub, so a rule cannot feed back into a delivery.

Deliveries for one connection already take turns on its row, which the receiver locks
`NO KEY UPDATE` before handling, so rules choose lane positions one delivery at a time.
`handleItem` locks the task rows it reads `NO KEY UPDATE` too, in id order, so a rule's move
and a device's write to the same task take turns; push deliveries, which never move a task,
keep `SHARE`. A rule re-reads a subtask's parent under `KEY SHARE` and leaves the subtask
alone if the parent was trashed meanwhile. Deleting a status locks the project, which the
delivery holds `SHARE` first, so a delete and a delivery also take turns, as do a delete and
a rules update, which takes the project's `SHARE` before the connection.

Older servers do not return `statusRules`, and the app offers no rules then. An older app
ignores the field. The protocol stays at 1.

### API and compatibility

`/api/integrations/github/projects/:projectId` uses the app session and the protocol gate,
with `Cache-Control: no-store`: `GET` (the connection or `null`), `POST` (connect; 409 when
connected), `PATCH` (`repository`, `authMode`, `token`, `enabled`, `statusRules`; a token
implies `token` mode and `webhook` mode forgets it), `DELETE`, `POST …/secret` and `POST …/url`. A project
outside the user's workspaces answers 404. Request and response schemas are in
`packages/shared/src/github.ts`.

This is an addition under [ADR 0003](0003-api-compatibility.md): the protocol stays at 1.
A new app on an older server gets 404 and does not list the GitHub page; an older app never
asks.

## Consequences

- A server must be reachable from GitHub for webhooks to arrive. A home server behind a
  tunnel works; one only on a private network does not.
- Each project needs its own webhook on GitHub. A GitHub App mode would remove that step.
- A restore disconnects every project. Reconnecting means a new URL and secret on GitHub.
- A changed `BETTER_AUTH_SECRET` breaks every connection until its secret is rotated.

### Releases and tags (THR-126)

A release belongs to a project, keyed by repository and case-sensitive tag name.
A lightweight tag push records a published tag at the repository push time (receipt time
if absent). The server remembers the last source push time per project, repository and tag,
including deleted tags. Older pushes are ignored. For tied or missing times, a subsequent
push advances the tag only if its before SHA matches the observed target. A release for the same tag takes over that row and keeps its ID. Deleting the
release removes its bindings. If a tag push was observed and that tag still exists, the row
reverts to a tag at its last observed commit with a null publication date. It remains visible
but no longer counts as shipped, including after subsequent tag updates. Unpublishing retains the bindings but stops counting them as
shipped. Published prereleases count as shipped. Disconnect and restore preserve both tables.

On publication Throw binds active tasks whose linked PRs merged in this repo after the
previous publication and through the new publication time. Tasks already bound to a published
release in this repo are skipped. In token mode Throw checks candidate merge SHAs against
the tag using GitHub compare. An unavailable comparison falls back to the time window.
This is a snapshot of known merges at delivery time. Members can correct historical or
out-of-order imports manually. Release metadata and bindings sync quietly without task
history entries or outbound notifications.

Protocol 1 advertises `githubReleases`. The read-only `github-releases` and
`task-github-releases` shapes use workspace membership and independent persisted collections.
Under `/api/integrations/github/projects/:projectId/releases`, GET lists releases and POST
records a manual release. PUT or DELETE at `/:releaseId/tasks/:taskId` binds or unbinds a task
of that project. Manual records work without a connection. MCP exposes `list_github_releases`,
`bind_task_release`, `unbind_task_release` and `get_task.githubReleases`. Use `list_tasks`
with `release` (tag name or UUID) or `unreleased: true` for merged tasks awaiting publication.
