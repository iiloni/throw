# Task data model

Status: agreed with the owner on 2026-10-13. Nothing here is built yet.

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
| `kind` | `created` or `updated`. |
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
| `createdAt` | Server | When the server received it. |
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
