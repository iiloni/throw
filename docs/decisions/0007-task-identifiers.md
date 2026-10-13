# 0007: Task identifiers

Status: accepted (2026-10-13)

## Context

A task is shown with an identifier such as `CAT-12`: its project's key and a number. Tasks
and projects are created offline, where no device can know which number or key is free.

## Decisions

**The identifier is assembled, not stored.** A task stores a number and its project stores
a key. Every reference inside the app, and every URL, uses the task's UUID.

**The server assigns the number.** It comes from a counter on the project, taken in the
transaction that creates the task. A task created offline has no number, and shows no
identifier, until it syncs. Tasks queued offline are numbered in the order they were made.
Subtasks draw from the same counter as other tasks.

**Numbers are never reused.** Trashing or purging a task leaves a gap.

**The client proposes a key and the server settles it.** The create form derives a key from
the project's name and lets the user edit it. Keys are unique within a workspace, counting
projects in the trash. When the proposed key is taken, which two devices offline can cause,
the server stores it with a number appended (`CAT2`). A project created offline shows no key
until it syncs. Refusing the duplicate was rejected because it would drop the project and
every task queued under it.

**A key can be changed.** Since identifiers are assembled, every task in the project shows
the new key at once and nothing stored changes. A change to a key that is taken is refused.
Old keys are not kept as aliases.

**A task stays in its project.** Moving a task between projects is not supported.

## Consequences

- An identifier someone wrote down outside the app stops matching after a key change.
  Aliases can be added later as a list of retired keys, without touching existing rows.
- Moves can be added later: a task's identity is its UUID, so a move would rewrite its
  project and number. It would also have to map the status, drop the tags and move the
  subtasks in one transaction.
- Until moves exist, a task filed in the wrong project has to be recreated.
