# Task data model

Status: agreed with the owner on 2026-10-13. Projects, statuses, priorities, keys, tasks,
subtasks, the trash, the conflict rule, the log's sync and comments are built; tags are
not, and the timeline has a data layer but no view. Decisions taken while building it are under [Implementation notes](#implementation-notes).

This states the model behind tasks precisely enough to implement: the entities, their
fields, who assigns each value, how rows are ordered and what the server does with each
write. The reasons are in ADR 0005 (conflicts), ADR 0006 (the activity log) and ADR 0007
(identifiers). The product behaviour is in [spec.md](spec.md).

Items marked **(default)** were not discussed with the owner. They are the implementer's
starting point and can change without a new decision.

## Rules that apply to every table

- Every row carries a `workspaceId`, and shapes and queries filter on membership of it
  (ADR 0004). Rows below a project carry a `projectId` as well, so membership of a single
  project can be added later without changing a table. The server sets both from the parent
  row; a client never chooses them freely.
- Ids are UUIDv7 made on the device, except where a table says otherwise.
- **Who sets it** is one of:
  - *Client*: the value in the write is stored.
  - *Server*: the server sets it when it applies the write. The device's optimistic row
    holds nothing for it (or a placeholder for a time) until the synced row arrives.
  - *Fixed*: set at creation and never changed.
- All times come from the server's clock. No write carries a device time.
- A create is safe to replay: one whose id the user already has answers `{ txid: null }`.

## Project

Additions to the existing `projects` table.

| Field | Who sets it | Notes |
| --- | --- | --- |
| `key` | Server | The prefix of task identifiers. Empty on the device until the project syncs. |
| Task counter | Server | The last number handed out. Not synced to clients. |
| Priority names | Client | Five optional names, one per rank. An empty name shows the default: Critical, High, Default, Low, Very Low. |
| `deletedAt` | Server | Set while the project is in the trash. |

**Key.** The create request carries a proposed key. The server stores it, or when another
project in the workspace has it (projects in the trash count), the proposal with the
smallest number from 2 up that makes it unique. A later change to a taken key is refused
with 409. Format **(default)**: one to six characters, `A` to `Z` and digits, starting
with a letter.

**Creation.** The create request also carries the project's first statuses, with ids made
on the device, and the server inserts the project and its statuses in one transaction. A
new project starts with one status in each category **(default names)**: Backlog,
In progress, Done, Cancelled. A project can therefore be created and filled with tasks
offline.

**Trash.** Deleting a project sets `deletedAt`; restoring clears it. Everything in a
trashed project counts as trashed without being written to. Purging a project from the
trash deletes it and everything under it for good.

## Status

One row per status of a project.

| Field | Who sets it | Notes |
| --- | --- | --- |
| `id` | Client | |
| `projectId` | Fixed | |
| `name` | Client | |
| `category` | Fixed | `backlog`, `active`, `done` or `cancelled`. |
| `position` | Client | Fractional index among the statuses of the same category. |
| `isDefault` | Client | The status a task takes when it is dropped on the category. |

Rules the server enforces:

- A project always has at least one status in each category. Deleting the last one is
  refused.
- Each category has exactly one default. Making a status the default clears the flag on
  the previous one in the same transaction. The default cannot be deleted; make another
  the default first.
- A status cannot be deleted while a task uses it, counting tasks in the trash.
- Deleting a status removes the row. Old log entries still show its name (see
  [Activity entry](#activity-entry)).
- A new task with no status given takes the backlog category's default.

Statuses are shown by category in the order backlog, active, done, cancelled, then by
position.

## Task

A subtask is a task with a parent. There is one table.

| Field | Who sets it | Notes |
| --- | --- | --- |
| `id` | Client | |
| `projectId` | Fixed | A task stays in its project. |
| `number` | Server | The number in `CAT-12`. Empty until the task syncs. Unique in the project, never reused. |
| `title` | Client | |
| `description` | Client | BlockNote JSON, text only. |
| `descriptionVersion` | Client | A UUIDv7 made on the device for each description save. Used only to detect conflicts. |
| `statusId` | Client | A status of the same project. |
| `priority` | Client | A rank from 1 (Critical) to 5 (Very Low). New tasks get 3. |
| `position` | Client | Fractional index; see [Ordering](#ordering). |
| `parentId` | Client | Empty for a top-level task. |
| `primaryTagId` | Client | Optional. |
| `closedAt` | Server | When the task entered a done or cancelled status. |
| `deletedAt` | Server | Set while the task is in the trash. |
| `createdAt` | Server | |

Secondary tags are separate rows, one per task and tag, so adding or removing one tag
never conflicts with another device doing the same to a different tag. The tag tree itself
follows Catch's ADR 0016 per project and is specified when tags are built.

**Identifier.** Shown as the project's key, a hyphen and the number. The server takes the
next number from the project's counter in the transaction that creates the task, holding a
lock on the project row. A replayed create takes no number. A task with no number yet
shows no identifier.

**`closedAt`.** Set to the server's time when a status change takes the task from a
backlog or active status into a done or cancelled one, or when a task is created in one.
Cleared when it moves back to a backlog or active status. Unchanged by a move between two
closed statuses.

**Subtasks.** One level deep. A parent must be a top-level task in the same project, and a
task that has subtasks cannot be given a parent. A parent and its subtasks are otherwise
independent: each has its own status, number, priority, tags, comments and log.

**Trash.** Deleting a task sets `deletedAt`; restoring clears it. A task counts as trashed
when it, its parent or its project has `deletedAt` set. Trashing a parent writes nothing to
its subtasks, and restoring it brings them all back. A subtask trashed on its own stays
trashed when its parent is restored. The trash is emptied only by hand. Purging a task
deletes it, its subtasks, comments, log entries and tag rows for good.

### Ordering

- A board column shows its tasks by `priority` (1 first), then `position`, then `id`.
  Compare positions with `comparePositions`.
- Two devices can hand out the same position. The `id` breaks the tie.
- A top-level task's position orders it within its status and priority. A subtask's
  position orders it within its parent, and the view that shows subtasks as cards on the
  board reuses the same value.
- The closed zone is sorted by `closedAt`, newest first.

## Task writes

### Create

The request carries the client-set fields and the task's id, which is also the id of its
"created" log entry.

| Situation | Result |
| --- | --- |
| The status no longer exists | The task takes the backlog default status. The log entry says so. |
| A tag no longer exists | The task is created without it. The log entry says so. |
| The parent is in the trash | Created. The subtask is trashed with its parent. |
| The parent or project was purged | 404. The write is dropped with a notice. |
| The parent is itself a subtask | 409. The write is dropped with a notice. |
| The id is already the user's | `{ txid: null }`: a replay. |

### Update

One request changes one task. It carries:

- A **change id**: a UUIDv7 made on the device for this change to this task. It becomes the
  log entry's id. A request whose change id the server has already recorded answers
  `{ txid: null }` and does nothing.
- Each changed field as **the value the device held before the change and the value
  wanted**. The outbox has both for every queued mutation.

For each field the server compares the "before" value with the task's current one:

| Field | Compared on | Applied when |
| --- | --- | --- |
| `title`, `priority`, `statusId`, `parentId`, `primaryTagId` | The value | The current value equals the "before" value and the new value is valid. |
| `description` | `descriptionVersion` | The current version equals the "before" version. The new document and version are stored together. |
| Trash state | In the trash or not | The task's own state equals the "before" state. The server sets or clears `deletedAt` with its clock. |
| `position` | The status, priority and parent it was computed for, sent with it | After the rest of this write is applied, the task has that status, priority and parent. |
| A secondary tag added or removed | Nothing | Always, if the tag exists. Adding one that is present, or removing one that is absent, changes nothing. |

A value is invalid when the status or tag does not exist in the project, or when the
parent would break the one-level rule.

What happens to the write:

- Fields that pass are applied. Fields that do not are left as the server has them. The
  rule is per field, and the request succeeds either way.
- One log entry records the fields applied and the fields not applied. A position is never
  recorded, applied or not.
- The server substitutes nothing in an update. A task moved to a deleted status stays where
  it was.
- The response returns the transaction id when the task row changed and `{ txid: null }`
  when it did not, since the tasks shape would never stream that transaction. It also lists
  the fields that were not applied, so the client can tell the user. How it tells them is
  not decided.
- A task in the trash, or closed, is updated like any other.
- A task that was purged answers 404 and the write is dropped with a notice.

### Purge

Permanent deletion of a trashed task or project. Replaying it answers `{ txid: null }`.

## Activity entry

Written only by the server, in the transaction of the write it describes. Append-only:
entries are never edited, and are deleted only when their task is purged. Synced to
clients, which cannot write to it.

| Field | Notes |
| --- | --- |
| `id` | The task's id for the "created" entry, otherwise the change id of the update. |
| `taskId` | |
| `userId` | The signed-in user who sent the write. |
| `createdAt` | The server's time when it applied the write. |
| `kind` | `created` or `updated`. An update that only moved a position is kept as `reordered`, on the server only (see [Implementation notes](#the-log-and-comments)). |
| Changes | A list; one item per field the write touched, position excepted. |

Each item in the list holds:

| Part | Notes |
| --- | --- |
| Field | Which field. |
| Previous value | What the server held before the write. |
| New value | What the write asked for. |
| Names | For a status or tag, its name at the time, for both values. |
| Applied | Yes or no. |
| Reason | When not applied: the field had changed (`stale`) or the value was not valid (`invalid`). On a `created` entry, also used to say a status or tag was replaced or left off. |
| Rejected document | Only for a description that was not applied: the document the device sent. |

A description item holds no text otherwise: it says the description changed.

The list is open: a field joins the log by adding items, with no schema change (`changes` is
a `jsonb` column, synced whole). A device shows an item whose field it does not know
generically, or skips it; it never drops the entry. Tag items:

- `primaryTagId`: as a status item, with the tags' names.
- `secondaryTags`: one item per tag added or removed, with that tag's id in an additional
  `tagId`. `previous` and `requested` are the tag's id or null (added: `null` → id;
  removed: id → `null`), with names for both. A tag that no longer exists is recorded with
  `applied: false` and `reason: invalid`, also on a `created` entry that left it off.

The timeline orders entries and comments together by `createdAt`, then `id`. A device may
show its own queued writes in the timeline as pending, under the ids they will have.

## Comment

Created, edited and deleted by clients through the outbox, like projects are today.

| Field | Who sets it | Notes |
| --- | --- | --- |
| `id` | Client | |
| `taskId` | Fixed | |
| `userId` | Server | The author. |
| `body` | Client | BlockNote JSON, text only, as the description **(default)**. |
| `createdAt` | Server | When the server received it. Empty on the device until it syncs. |
| `editedAt` | Server | Empty until the body is edited. |

- Only the author edits or deletes a comment.
- Deleting removes the row. Replaying the delete answers `{ txid: null }`.
- Edits are applied in the order they reach the server **(default)**; the conflict rule for
  tasks does not apply.
- Comment edits and deletions are not recorded in the activity log.
- A comment on a purged task answers 404 and is dropped with a notice.

## What other tables keep doing

Workspaces, projects, statuses and comments apply updates in the order they arrive, with a
request that carries only the changed fields, as the scaffold's project route does.

## Implementation notes

Decided while building the model (2026-10-14), where the sections above left a detail open.
The owner has not reviewed these yet.

### Writes

- **A field already at the wanted value counts as applied.** When the server's value equals
  the value an update asks for, the field is applied and changes nothing, whatever its
  "before" value was. Two devices that make the same change are not told of a conflict.
- **Stale before invalid.** A field that is both stale and invalid is reported as `stale`.
- **The log table exists now, and is written for every task write.** Recognising a resent
  update needs a record of every change id the server applied; without one, a lost response
  followed by another device's change would let the resend undo that change. That record is
  the activity entry, so `task_activity` is created and each create and update writes its
  entry, with every field it touched, applied or not. An update that only moves a position
  writes an entry with no changes, kept on the server only (see
  [The log and comments](#the-log-and-comments)).
- **A `created` entry** lists the title, status, priority and, when set, the description
  version and parent, each with no previous value. When the status the device asked for no
  longer existed, the status item names the status the task took and carries the reason
  `replaced`.
- **Purging only takes what is still in the trash.** A purge of a task or project that no
  longer counts as trashed (restored on another device) does nothing and answers
  `{ txid: null }`, so the restore stands and the write is not dropped with a notice.
- **Emptying the trash** is one write that purges each project and task the device listed:
  projects in the trash, and tasks trashed on their own whose parent and project are not.
- **Trashing a project already in the trash keeps its time.**
- **A create with a parent in another project** answers 409, like one whose parent is a
  subtask. A parent that does not exist answers 404.
- **Status writes** lock the project row, so the rules over a project's statuses hold under
  concurrent writes. An update cannot clear `isDefault`; making another status the default
  clears it. Deleting the default (which also covers the last status of a category) or a
  status in use answers 409, and the outbox drops the write with a notice.
- **Change ids are derived.** The outbox keeps a mutation's row before and after, but not
  its metadata, so the change id is derived from the queued write's idempotency key (a
  UUIDv7, whose time it keeps) and the task id. It is the same on every resend.
- **Writes queued by the previous client are carried over.** A project create queued before
  projects had statuses is sent with the starter statuses, under ids derived from the
  project's, so a resend sends the same ones. A project delete queued before the trash
  existed moves the project to the trash.
- **A create resent after its row was deleted elsewhere recreates it.** Creates are
  recognised as resends while their row exists; a status deleted, or a task or project
  purged, between a create and the resend of its lost response comes back. This holds for
  every table, as in the scaffold. Closing it needs a record of deleted ids.
- **Titles may be empty**, up to 500 characters, so a create is never refused for its title.
  A description is a BlockNote document or null; its version is null until the first save.

### Keys and priorities

- **A settled key can pass six characters.** The format applies to proposals and changes.
  A suffix added to settle a clash (`CATCAT2`) is stored as it is.
- **The proposal travels on the device's row.** The optimistic project has `key: null` and a
  device-only `proposedKey`, which the create request sends and the synced row replaces.
- **Deriving a proposal** **(default)**: the initials of a name of several words, otherwise
  the first three characters of the name, in capitals and without accents; `P` when nothing
  fits.
- **Priority names** are stored as a JSON array of five strings; an empty string shows the
  default name. A name is at most 30 characters **(default)**.
- **Existing projects** were given keys `P1`, `P2`... in workspace order, and the starter
  statuses, by the migration that added them.

### On the device

- **Server times are ISO strings** in UTC with milliseconds, so they compare as strings. A
  device stamps a placeholder from its own clock for `createdAt`, `closedAt` and `deletedAt`
  so a change shows at once; requests never carry them.
- **Statuses and tasks always sync**, whether or not anything on screen reads them, so a
  device has them before it goes offline.
- **Refused fields** reach the client through `onRefusedChanges` in
  `apps/web/src/lib/refusedChanges.ts`. Nothing listens yet (spec, open question 5).
- **Deleting a project in the shell** now moves it to the trash. There is no trash view yet.

### The log and comments

Decided while building the log's sync and comments (2026-10-14). The owner has not reviewed
these yet.

- **Updates that only move a position are kept on the server.** The log leaves reordering
  out, but the entry is still the record of its change id, without which a resent reorder
  could undo a later one. Such an entry has the kind `reordered`, and the shape syncs only
  `created` and `updated` entries. (Electric's `where` cannot test a `jsonb` value, so the
  shape cannot filter on an empty `changes` list.) The migration gave existing entries with
  an empty list that kind.
- **An entry is timed under its task's lock** (`clock_timestamp()`, not the transaction's
  start time), so when one write waits for another on the same task, the log still lists
  them in the order they were applied.
- **No task event was missing an entry.** Trashing and restoring a task are updates, logged
  as `trashed` items. A purge deletes the task's log with it. Trashing or restoring a
  project or a parent writes no entry on the tasks under it, as it writes nothing to their
  rows; the timeline can show that state from the project and parent. Purging a subtask
  writes nothing in its parent's log.
- **A refused status that was deleted has no name.** The server no longer has the status, so
  `requestedName` is null.
- **The log and comments always sync**, like statuses and tasks, so a task's timeline reads
  offline. Devices only read the log.
- **The timeline** orders entries and comments by `createdAt`, then `id`. A comment the
  server has not received yet has no `createdAt` on the device and goes last, in the order
  it was written; it will be dated after everything the device has seen. Entries with an
  empty list are skipped. Queued task changes are not shown as pending: their entries
  appear when the server writes them. `readTaskTimeline` and `useTaskTimeline` in
  `apps/web/src/lib/collections.ts` return it; the view is not built.
- **Device times have millisecond precision**, so two writes to one task in the same
  millisecond are ordered by id.
- **Comment body** **(default)**: a BlockNote document like a description, but never empty
  (at least one block). Text-only is not checked on the server, as for descriptions.
- **Comment edits apply in arrival order** **(default)**. An edit that leaves the body as it
  is (including a resend) changes nothing, keeps `editedAt` and answers `{ txid: null }`.
- **Only the author** edits or deletes a comment; anyone else gets 403, and the outbox drops
  the write with a notice. A comment whose author's account was deleted can no longer be
  changed. Deleting a comment that is not there, or not reachable, answers `{ txid: null }`.
- **A comment on a task in the trash** is accepted, as an update to it would be.
- **On the device**, a new comment carries the signed-in user as its author, and an edit
  stamps a placeholder `editedAt`, until the synced row arrives. Purging a task does not
  delete its comments on the device; the server's cascade streams their removal.
- **A refusal names its entry.** `onRefusedChanges` listeners also receive the update's
  change id, which is the id of the entry recording the refused values (spec, open
  question 5).
- **Storage, measured** in Chromium's OPFS store (the web app's), 2026-10-14: 2,000 update
  entries (status changes with names, renames, priority changes, and status with priority)
  take **0.9 KB each** with the table's indexes, and comments of about 100 characters
  **1.1 KB each**. Of an entry, about 465 bytes are the row's JSON and 250 the sync metadata
  Electric stores with it. The persistence layer also keeps a replay log of up to 1,000
  transactions per collection for a day, which after a large first sync can briefly hold
  about as much again. ADR 0006 estimated 0.5 KB an entry; at the measured size, its busy
  solo user adds about 33 MB a year and a team of five about 82 MB, under the 200 MB limit.

