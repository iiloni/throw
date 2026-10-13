# 0005: Offline conflicts: the server's value stands

Status: accepted (2026-10-13)

## Context

A device can change a task while offline and send the change days later, after another
device changed the same task. The scaffold's rule, taken from Catch, is that an update
carries only the fields it changed and the server applies it on arrival. A device that
comes back online therefore overwrites newer work without anyone being told.

The owner's position decides this: the server is the arbiter of truth. Working offline is a
convenience that should lose as little as possible; it is not the normal way to use Throw.

## Decisions

**A task update says what the device last saw.** Each changed field is sent as the value
the device held before the change and the value it wants. The server compares the first
with what it holds now. When they match, the field is applied. When they differ, something
else changed that field first: the server keeps its own value and does not apply the field.

**The rule is per field.** One write that changes a title and a status can have one applied
and the other not. Edits to different fields of a task on two devices both survive.

**A field that is not applied is recorded, not discarded.** The task's activity log gets an
entry naming the field, the value that was wanted and the value that stood (ADR 0006). The
user can apply it again by hand. The write itself succeeds, so the outbox moves on.

**No device clocks.** Which edit is newer is decided by which reached the server first.
Ordering by device time was considered and rejected: a device with a wrong clock would win
or lose every conflict, and the server could not tell.

**The description is compared by a version token.** A description is one BlockNote
document, so a conflict is about the whole text. Each save names a new token and the token
it replaces, and the server compares tokens the way it compares any other field. When a
save is not applied, its document is kept in the log entry, since written text is the one
thing here that cannot be redone in seconds.

**A position applies only where it was computed.** A position means something inside one
status and priority (or, for a subtask, one parent). A position write names them, and the
server ignores it when the task is no longer there. Ignored positions are not recorded.

**An invalid field is treated like a stale one.** A status that was deleted, a parent that
would break the one-level rule, a tag that no longer exists: the field is not applied and
the log says why. The server never substitutes a value in an update.

**Creation is the exception.** Dropping a create would lose a title and a description
written offline. A task created in a status that no longer exists lands in the project's
default status, and a tag that no longer exists is left off. The log says so.

**What can still be dropped.** A write to a task, project or parent that was purged from the
trash answers 404 and is dropped with a notice, as before (ADR 0002).

**Scope.** The rule covers tasks. Workspaces, projects, statuses and comments keep the
scaffold's rule, applied in the order writes arrive: they have no log to record a refused
field in, and they change rarely.

## Consequences

- An offline device can never undo what the server already has. The cost is the opposite
  case: an edit made later, on a device that synced after another one, is not applied even
  though it was the user's latest intent. It is in the log.
- Task writes have a different format from the scaffold's project writes. Queued writes are
  device data (ADR 0002), so changing this format after release needs an outbox migration.
- A chain of offline edits to one field holds together: each names the value the one before
  it set. If the first is not applied, the rest are not either.
- Queued description saves can be merged as Catch merges them, provided the merged save
  keeps the earliest save's replaced token and the latest save's document.
- A write whose fields were all refused changes no task row. The route must answer
  `{ txid: null }` for it, or the client waits for a transaction the tasks shape never
  streams.
