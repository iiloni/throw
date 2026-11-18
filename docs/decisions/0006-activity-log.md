# 0006: The activity log is written by the server

Status: accepted (2026-10-13)

## Context

Every task has an append-only log of its changes, shown as a timeline with its comments
(docs/spec.md). Changes are made offline and arrive late, and under ADR 0005 some of them
are not applied. The log has to stay true to the task through that. Catch has nothing to
port here: its history versions a note's content and is captured on the device.

## Decisions

**The server writes every entry.** It derives the entry from the write it applies, in the
same transaction, so an entry and the change it describes cannot exist apart. Clients never
write to the log. Entries a client queued itself were rejected: they would state what the
device believed when offline, which is no longer true by the time they arrive, and they
travel as separate requests from the change.

**One entry per write, and the write names it.** A task write carries a UUIDv7 made on the
device, and the server uses it as the entry's id. A resent write is recognised by that id
and is not applied or logged twice. A device may show its queued writes in the timeline as
pending under the same id.

**The server's clock and order.** An entry is timed when the server applies the write.
There is no device time anywhere in the log. Work done offline on Monday and synced on
Friday is dated Friday. The timeline is ordered by that time, so the last entry for a field
always states the field's current value.

**What is recorded.** Creation, and changes to the title, description, status, priority,
parent, tags and trash state. Reordering is not recorded. A description entry says the
description changed and holds no text. Fields that were not applied are recorded with the
reason (ADR 0005); only there, a refused description keeps its document.

**Entries keep names as well as ids.** A status or tag can be deleted, and an old entry
must still read as "Testing".

**Entries record who.** The signed-in user who sent the write, for when a workspace is
shared.

**Comments are a separate table.** A comment is something a person wrote to themselves or
to others. It is created on the device like any synced row, and it can be edited and
deleted, which an append-only log cannot. Comments are merged into the timeline when shown,
ordered by when the server received them.

**The log and comments sync to the device.** The timeline is readable offline. Estimated at
about 0.5 KB an entry, a busy solo user adds around 18 MB a year and a team of five around
45 MB; the owner's limit for this was 200 MB. Measured later at 0.9 KB an entry, the same
use comes to about 33 MB and 82 MB (docs/data-model.md, implementation notes).

**The task keeps one time of its own.** `closedAt`, set by the server when a task enters a
done or cancelled status and cleared when it leaves, because the closed zone sorts by it.
Anything else, such as when work started, is read from the log when a report needs it.

## Consequences

- The dates in the log are sync times for offline work. Reports built on the log later
  measure when the server learned of a change.
- Description version history is not provided by the log. It is separate, later work.
- Every device holds its workspaces' full history. If that grows too large, the shape can
  be narrowed to open tasks without a data migration.
- The storage figures were estimates when this was decided. The measured cost per entry is
  about twice the estimate, still well under the limit.
