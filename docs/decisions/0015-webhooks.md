# 0015 — Outbound webhooks

Status: accepted (2026-11-22); quiet windows added 2026-11-23

## Context

An agent that works from a Throw project follows it with MCP `list_changes`
([ADR 0014](0014-mcp-server.md#change-feed)). Polling works, but an agent that sleeps
between tasks, such as a scheduled action that a webhook can start, needs to be woken
when something it cares about changes. Throw still runs no automations of its own.

## Decision

**Webhooks are an opt-in push companion to `list_changes`.** A signed-in user creates a
webhook in Settings for one workspace they belong to, optionally limited to one project.
When a write in that scope commits, Throw POSTs a small notice to the webhook's URL. The
notice says what kind of thing changed and where; it never carries task titles,
descriptions or comment text. The receiver calls `list_changes({ since: cursor })` for the
authoritative change and treats a webhook as a hint to look. A missed or dropped delivery
loses nothing, because the feed still has the change. Webhooks start no work in Throw and
change no task: the spec's no-automation rule stands.

### Events and payload

| Event | When |
| --- | --- |
| `task.created` | A task or subtask is created. |
| `task.updated` | A task's fields, tags, relations, position (from MCP), trash state or parent change. A relation announces both its tasks. `kind` is `updated`, `reordered`, `trashed` or `restored`. |
| `task.deleted` | A task is purged from the trash. Purging a parent announces each subtask too. |
| `comment.created`, `comment.updated`, `comment.deleted` | A comment changes. |
| `structure.updated` | A project, status or tag is created, edited, reordered by MCP, trashed, restored or deleted. One per project per transaction. |
| `webhook.test` | Settings' **Send test**. Sent at once, not queued, whatever the quiet window. |

Headers are `Content-Type: application/json`, `User-Agent: Throw-Webhooks/1`,
`X-Throw-Event`, `X-Throw-Delivery` (the delivery's UUIDv7, the same on every retry) and
`X-Throw-Signature: sha256=<hex HMAC-SHA256 of the raw body>`, keyed with the whole
signing secret as UTF-8. The body is:

```json
{
  "deliveryId": "…", "event": "task.updated", "workspaceId": "…",
  "projectId": "…", "projectKey": "THR", "entityType": "task", "kind": "updated",
  "taskId": "…", "taskKey": "THR-12",
  "actor": { "kind": "user", "viaTokenName": null },
  "changedFields": ["statusId", "position"],
  "statusTo": { "id": "…", "name": "Done", "category": "done" },
  "occurredAt": "2026-11-22T10:00:00.000Z"
}
```

`taskId`/`taskKey` appear for task and comment events, `statusTo` when a status changed,
and `changedFields` for task and structure events (`project.name`, `status.isDefault`, …),
so a receiver can filter without reading the feed. Shared Zod schemas in
`packages/shared/src/webhooks.ts` describe the request and response bodies.

### What is announced

Deliveries are inserted in the same transaction as the write, from the shared write
functions MCP and REST already use, so a rolled-back write announces nothing and a
committed one is never missed. The write holds a key-share lock on the webhooks it queues
for, so a concurrent delete waits rather than breaking the write. Replayed and no-op writes, writes where every field was
refused, and a device's drag reorders (task or structure) are not announced. Writes made
through an MCP token are skipped by default (`ignoreTokenWrites`), so an agent is not woken
by its own changes; the payload's `actor` says which kind of write it was otherwise.

The owner's workspace membership is checked when a change is queued and again before each
send. A webhook whose owner has left the workspace stops delivering, and its queued
deliveries fail, as do those of a webhook that was turned off. A project webhook is quiet while its project is in the trash, apart from the change
that trashes it. Purging the project deletes the webhook (`ON DELETE CASCADE`) rather than
widening it to the workspace. Deleting the account or workspace deletes its webhooks.

### Quiet windows

A board's `+` makes a task at once, and every title keystroke, description save or tag
toggle after it is a write. Sent one by one, these wake an agent while the person is still
writing the task. Each webhook therefore has a **quiet window**, `quietWindowSeconds` from 0
(the default: every change is sent as it happens, as before) to 600. Settings offers 30 s,
1, 2, 5 and 10 minutes.

With a window, task and structure changes wait for a pause:

- **Folding.** A change folds into the webhook's waiting (unsent) delivery for the same
  task (`task:<id>`) or project (`structure:<projectId>`), and the window starts again from
  that change: a trailing debounce, so a person who keeps editing keeps it waiting. The
  delivery keeps its ID. `occurredAt` is the latest change's and the actor is the person if
  anyone but a token took part, so an agent that skips its own writes still looks.
- **Net changes.** Task changes count by their effect. Each task write passes its activity
  items, and the waiting delivery stores (in `fold`, never sent) each field, secondary tag
  and relation as it was before the window's first change to it and after the latest.
  `changedFields` lists only what still differs, and `statusTo` appears only while the status
  does. Marking a task done by mistake and moving it back, or removing a tag and adding it
  again, leaves nothing, and such a delivery sends nothing. Status moves wait like any other
  change, so that an undone move is caught. A position left over from an undone move does not
  count, as device reorders are not announced; an agent's reorder does.
- **New tasks.** A task created in the window is announced as `task.created` with the fields
  it was created with and any that changed since. One that is still blank (titled `New task`
  with no description or tags, and nothing changed since) or that is in the trash sends
  nothing for now; naming or restoring it announces it as created after the window. A task
  created and purged within the window was never announced and its delivery is removed.
  Held deliveries last a day (below), so a task first named later than that is announced as
  `task.updated`; `list_changes` still has its creation.
- **At once.** Comments are written on purpose and are never folded: each comment event is
  sent at once and leaves the task's waiting delivery as it is. A purge (`task.deleted`) is
  final, so it folds in (replacing whatever was waiting) and is sent at once.
- **Structure** notices are not cancelled: they list every changed field, named after the
  first change, as within one transaction.

A delivery with nothing to send for now is `held`: not sent, but still open to later changes,
which compare with the same starting point. Held deliveries are deleted after a day like
finished ones; a change after that starts afresh. The fold keeps field values (titles among
them) only while the delivery waits: the worker clears it when it claims the delivery. Changing a webhook's window applies to what
is already waiting when it shortens it: nothing waits longer than the new window from now, so
setting 0 sends waiting deliveries at once. A longer window leaves them on their schedule,
and held deliveries stay held. Turning a window off does not unfold anything: later changes
are sent one by one.

Folding is safe under concurrent writes. A partial unique index allows one waiting (`pending`
or `held`, never attempted) delivery per webhook and key. A write locks the waiting row
(`FOR UPDATE`) and folds into it, or inserts with `ON CONFLICT DO NOTHING` and folds on its
next round when a concurrent write inserted first. The worker claims with `SKIP LOCKED`, so it
skips a row being folded; a claimed row has an attempt, leaves the index and is never changed,
so a change after the claim starts a new delivery. After three contended rounds the change is
queued on its own rather than lost, even one that would have been held.

Every queueing or folding commit notifies the worker, which then sleeps until the earliest
due delivery (at most the 30-second poll), so windows shorter than the poll and deliveries
brought forward are sent on time.

### Delivery

A worker in the server process sends queued deliveries. A commit wakes it through
`LISTEN`/`NOTIFY`, with a 30-second poll as fallback. It claims rows with
`FOR UPDATE SKIP LOCKED` and a two-minute lease, so a crash mid-send is retried. A send
has a ten-second budget that covers resolving the name, connecting and the answer; at most
two system DNS lookups run at once, so stalled name servers cannot fill libuv's thread pool. A non-2xx answer, including a redirect, is a failure. Five
attempts are made, waiting 10 s, 30 s, 2 min and 5 min between them, and the delivery is
then marked failed. Settings shows each webhook's last outcome. Finished deliveries are
deleted after a day. The worker pauses during a backup or restore and stops on shutdown.

### Where Throw may connect

A webhook makes the server send requests to a URL its user chose, so delivery is guarded
against reaching internal services:

- Only `https://` URLs without credentials. Names and address literals are checked when
  the webhook is saved, and names again at each delivery.
- Each delivery resolves the name and refuses it if **any** answer is not allowed. The
  request connects only to the checked addresses (a pinned lookup and no pooled sockets),
  so DNS rebinding cannot swap the address in between. Redirects are not followed.
- By default only public addresses are allowed. Loopback, `0.0.0.0/8`, link-local
  (including cloud metadata at `169.254.169.254`), multicast and reserved ranges are always
  refused. RFC 1918, CGNAT (`100.64.0.0/10`), ULA and documentation ranges are private.
  IPv4-mapped and NAT64 IPv6 addresses are checked as the IPv4 address they reach.
- An operator can trust private receivers, such as a tailnet. `WEBHOOK_ALLOWED_HOSTS`
  names hosts or `*.` suffixes that may resolve to private addresses, but never to
  loopback or link-local. `WEBHOOK_ALLOWED_CIDRS` lists ranges that are always allowed.
  `WEBHOOK_ALLOW_LOOPBACK_HTTP` permits plain-HTTP loopback for automated tests and is
  refused when `NODE_ENV=production`.

### Secrets, storage and backups

Each webhook has a signing secret: `throw_whsec_` and 32 random bytes in base64url. It is
returned once, in the uncached creation or rotation response. Delivery needs the secret
itself, so it cannot be stored as a digest like MCP tokens. It is encrypted with
AES-256-GCM under a key derived with HKDF from `BETTER_AUTH_SECRET`. If that secret
changes, the stored secrets cannot be read and deliveries fail until the user makes a new
one.

`webhooks` and `webhook_deliveries` are server-only tables: never in a shape, never
synced, with no collection or outbox format. They follow the MCP token contract of
[ADR 0011](0011-server-backups.md): backups exclude their data and a restore clears them,
even from an archive that contains them. A restore therefore removes webhooks, and the
user recreates them as they reissue MCP tokens.

### API and compatibility

`/api/webhooks` uses the app session and the `X-Throw-Protocol` gate like token
management, with `Cache-Control: no-store`: list (with the user's workspaces and active
projects), create, update (`name`, `url`, `projectId`, `ignoreTokenWrites`, `enabled`,
`quietWindowSeconds`), delete, `POST /:id/secret` and `POST /:id/test`. Users see only their
own webhooks; others answer 404. This is an addition under
[ADR 0003](0003-api-compatibility.md): the protocol stays at 1. A new app on an older server
gets 404 and hides the Webhooks page; an older app never asks.

Quiet windows are a compatible addition too. Requests leave `quietWindowSeconds` out by
default and the server reads a missing value as 0 on create and unchanged on update, so an
older app keeps working. The list answers `quietWindow: true`. A new app shows the control,
and sends the field, only when it does: create and update bodies are strict, so an older
server would refuse it. A webhook from an older server reads as 0.

## Consequences

- Receivers must verify signatures and deduplicate by delivery ID. Ordering between
  deliveries is not guaranteed; the change feed is ordered.
- Every announced write runs one indexed query for the workspace's webhooks, and one more
  per write for webhooks with a quiet window.
- A quiet window has no upper bound on waiting while changes keep coming: a task edited
  continuously is announced once its editing pauses. The change feed has every change
  meanwhile.
- The worker runs in the single supported server process. Multiple instances would share
  the queue safely through `SKIP LOCKED`, but each would need its own `LISTEN`.
