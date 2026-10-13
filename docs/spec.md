# Throw: initial spec

Status: draft (2026-10-12). The app is called Throw.

Items marked **(assumed)** were proposed during planning and not explicitly confirmed.
Everything else was decided. Undecided points are collected under [Open questions](#open-questions).

## Purpose

A self-hosted, offline-first project management app in the same family as Catch: the same
design language, motion and approach, aimed at tracked work instead of general note keeping.

Catch holds ideas and tasks with an undefined lifecycle. A chore list can pass through the
deck and then sit in the gallery. This app holds tasks whose state and progress matter to a
project's outcome, so they get a tracked lifecycle, a history and a place in a project. The
two are different data, which is why this is a separate app and not a feature of Catch.

## Principles

These come from what existing tools get wrong (GitHub Projects and Kaneo were the named
examples): a bland corporate look, no motion, poor mobile interaction, noisy UI and too many
integrations.

- **The board is the product.** If it is generic there is no reason to build the app.
- **Motion and touch are first-class.** Phone interaction is designed, not adapted.
- **Controls appear only when they are usable.** The UI does not advertise capability.
- **Changes to a task's core attributes are user-driven.** Nothing moves or completes a task
  on the user's behalf.
- **Few integrations, all opt-in.** None in the first version.
- **Boards are for managing, task views are for executing.** A card carries enough to manage
  a task's lifecycle; the work happens in the task's own view.

## Relationship to Catch

- A companion app with its own data model, not a second client over Catch's notes.
- Separate repository, separate server, separate client and fully decoupled releases.
- Separate accounts in each app. No shared auth database.
- Shared warm surfaces, typography and project/tag colors; Throw uses jade accents for
  actions, links, keyboard focus and selected states. The UI palette is the same across
  builds; preview purple and dev blue identify artwork only.
- No link to Catch in the first version. "Promote a note to a task" is a later idea.
- The repository starts from Catch's skeleton (auth, sync, outbox, local persistence, design
  tokens, scripts). Shared packages are extracted only once duplication hurts.
- A self-hoster can run either app or both. The intended shape is one Postgres container
  with a separate database per app; each app needs its own Electric and replication slot.
- Build starts after Catch reaches maturity.

## First version

### In scope

- Workspaces, projects, tasks and one level of subtasks.
- Custom statuses mapped to categories; five priority ranks; nested tags.
- The project board, the cross-project board and the task view.
- Comments and a full activity log.
- Search through a command palette or an integrated input.
- Trash with restore.
- Offline-first web app and Android app.

### Out of scope

| Item | Note |
| --- | --- |
| Teams, members, assignees, mentions | The data model leaves room; see [Workspace](#workspace). |
| Milestones | Room is left: one optional reference on a task. |
| Dates, reminders, recurring tasks | Arrive with or after milestones. |
| Cycles and sprints | Not planned. |
| Attachments, images in descriptions | First follow-up after launch. |
| List view | The board is the only layout. |
| Filtering by tag across projects | Tags are per project. |
| Automation | Out of scope, and it may never fit the product. |
| Integrations, import, export | None. |
| Task relations (blocks, duplicate of) | Later. |
| Reports (cycle time, burndown) | Later; the activity log and timestamps make them possible. |

## Domain model

### Workspace

A workspace groups projects, for example personal and work, or one per client. An account
can have several.

The first version is solo, but it is built team-ready: rows are scoped to a workspace and
project through a membership table, not to a user. Adding sharing later should not need a
data migration.

### Project

A project belongs to one workspace and has a name, a color and an icon. The color identifies
its cards on the cross-project board; the icon represents it in the navigation rail. Icons
can reuse Catch's bundled set.

Each project owns its statuses, its priority names and its tag tree.

### Status and category

Each project defines its own statuses. Every status is filed under one of four fixed
categories:

| Category | Meaning | Example statuses |
| --- | --- | --- |
| Backlog | Not started, not committed | Ideas, Planned |
| Active | Being worked on | Building, In review, Testing |
| Done | Finished | Shipped |
| Cancelled | Closed without being done | Won't do, Duplicate |

The mapping is many-to-one: a category holds any number of statuses.

- Statuses are always ordered by category (backlog, active, done, cancelled), with free
  ordering inside each category.
- A project needs at least one done status and one default status for new tasks. Neither
  can be deleted while tasks use it.
- Each project has a default status per category, used when a task is dropped on a category
  instead of a specific status.
- Categories let the app compute progress, hide closed work, stamp times and consolidate
  different projects onto one board without knowing any status's name.
- A task records when it first entered an active status and when it entered a done status
  **(assumed)**.

### Priority

Five fixed ranks. The default names are Critical, High, Default, Low and Very Low, with
Default as the rank a new task gets. Names are customizable per project; the number of ranks
is not. The cross-project board bands by rank, and each card shows its own project's name
for that rank.

### Task

| Field | Notes |
| --- | --- |
| ID | UUIDv7 generated on the device, so tasks can be created offline. |
| Identifier | Project-prefixed number such as `CAT-12`, assigned by the server on sync. A task created offline shows none until it syncs. |
| Title | |
| Description | BlockNote JSON, as in Catch. Text only in the first version. |
| Status | One of the project's statuses. |
| Priority | One of the five ranks. |
| Position | Manual order within its status and priority; a fractional index as in Catch. |
| Primary tag, secondary tags | See [Tags](#tags). |
| Parent | Set on a subtask. |

A new task starts in the backlog's default status. A column's own add control creates the
task in that column.

### Subtask

A subtask is a full task: it has its own status, identifier, priority, tags, comments and
history. Subtasks are one level deep **(assumed)**.

A parent and its subtasks are independent. The parent does not complete when its subtasks
do; it shows their progress as a count.

### Tags

Tags follow Catch's model (Catch ADR 0016), scoped to a project instead of a user:

- A nested tree with no depth limit.
- A task has one optional primary tag and any number of secondary tags.
- The primary tag sets the card's color through its root. Status is already shown by the
  column, so color is free to separate kinds of work.

### Comments and activity

Every task has an append-only activity log recording each field change, shown as a timeline
on the task. Comments appear in the same timeline. For one user they serve as a work log.

### Closed and deleted tasks

Done and cancelled tasks leave the board's main area, which stays focused on actionable
work. They remain reachable in the closed zone. Deleting a task sends it to a trash with
restore, as in Catch.

## The project board

The board has three zones, which mirror Catch's split between notes at rest and notes in
motion.

| Zone | Desktop position | Content |
| --- | --- | --- |
| Backlog | Left panel | One mixed gallery of backlog tasks. Statuses are filters, not columns; each card shows its status. |
| Active | Centre | One column per active status. |
| Closed | Right strip | Done and cancelled tasks. Shows no tasks until expanded; statuses are filters. |

- The backlog panel is open by default when space allows, collapses to a strip, and expands
  to a full-width gallery.
- The closed strip expands on click to a single column, and from there to a full-width
  gallery. Closed tasks are sorted by completion time **(assumed)**.
- During a drag, each side zone turns into a column of dropzones, one per status in its
  category.

### Cards

A card shows the title, identifier, tags, priority and subtask progress. It does not show
the description. Subtask progress is an expandable underlay, like link and media previews
on a Catch card.

### Subtasks on the board

By default subtasks live with their parent: their statuses are tracked but do not place them
on the board. A view option shows subtasks as top-level cards, marked as subtasks, in their
own status columns.

Two drag interactions are kept in mind for later: dragging a subtask out to make it a task,
and dropping a card on another to make it a subtask.

### Ordering and priority

A column is sorted by priority, with manual order inside each priority.

While a card is dragged within a column:

- Cards of other priorities dim.
- The dragged card's priority zone stretches to take most of the column, and the card is
  placed by dragging within it.
- Hovering the higher or lower priority zones at the top and bottom of the column changes
  the card's priority mid-drag.

### Phone

- Swiping between active columns is accepted. The effort goes into making moves fast.
- The backlog is a drawer that rises from the dock, first to part height and then to full
  screen. Dragging a card above the drawer moves it onto the board.
- The closed strip sits at the right end of the board.
- During a drag or with several cards selected, the dock becomes a grid of status
  dropzones grouped by category, covering backlog and closed statuses too. This moves cards
  to any status without scrolling the board.

## The cross-project board

A board over every project in the workspace **(assumed scope)**.

- One column per category instead of per status, since categories are all that projects
  share. Done is shown open by default.
- Cards are colored by project, because tag colors mean different things in each project.
- Columns are banded vertically by priority rank. On wide displays a column can lay its
  cards out as a masonry grid within each band.
- While a single card is dragged, the target column shows that card's project statuses as
  dropzones. Dropping on the column itself, or moving a selection that spans projects, uses
  each project's default status for the category.

## The task view

The full task is where the work is done: description, subtasks (in a dedicated subtask
view), comments and activity.

- On wide screens it opens as a split view on the right. It takes width from the board and
  has a drag handle to adjust the split.
- On small screens it opens as a pop-up over the board, like the note editor in Catch.
- While a task is open on a phone, the dock holds that task's actions, as it does for a note
  in Catch.

## Navigation

### Desktop

A left-mounted navigation rail, not a bottom dock. Below 1200 CSS pixels it starts narrow;
at wider desktop widths it starts expanded. An explicit expand/collapse choice is remembered
on the device and takes precedence over window width:

- Workspace switcher at the top.
- One icon per project.
- The cross-project board.
- Settings at the bottom.

Search is a command palette or an integrated input. There is no search page. The palette
also covers jumping between projects.

### Phone

A bottom dock with three tabs: Backlog, Board and Search. This mirrors Catch's Gallery, Deck
and Search. Project switching and the cross-project board live in the header's title menu.

The phone layout applies below 768 CSS pixels. The title menu also switches and manages
workspaces, and opens settings. The project dock remains on project and cross-project
boards; settings and an empty workspace use the title menu alone. On the cross-project
board, Backlog returns to the workspace's last project, Board keeps the cross-project
board, and Search shows the workspace search placeholder.

### Shell routes and remembered selection

- `/w/:workspaceId/p/:projectId?view=board` is a project. `view=backlog` selects its
  phone backlog and `view=search` selects the search placeholder. Search is a view of
  the current context, not a separate search page.
- `/w/:workspaceId/board` is the cross-project board for that workspace; `view=search`
  shows its search placeholder.
- `/settings` holds account and appearance controls.
- `/` restores the device's last workspace and project for the signed-in account.
  `/w/:workspaceId` restores that workspace's last project, otherwise its first project
  by position, otherwise the create-project prompt.

Workspace and project segments are UUIDs so names and future task prefixes can change
without breaking bookmarks. Future task paths can have their own segment (for example
`/w/:workspaceId/p/:projectId/tasks/CAT-12`); choosing the task identifier scheme remains
separate work. A direct project URL keeps its view on reload. Selecting a project from
navigation opens its board; the shell remembers the last project separately per workspace.
Projects append by position. Deletion is permanent and requires confirmation.

The shell's backlog and board bodies are placeholders. The backlog drawer and task-specific
dock interactions arrive with the board feature; search and the command palette arrive later.

## Platform and architecture

- Offline-first from the start on the web (installable PWA) and Android. Retrofitting
  offline would change how every write works.
- The stack follows Catch: a Vite and React client with TanStack DB, a Hono server with
  Better Auth and Drizzle on Postgres, Electric for sync behind an auth proxy, an outbox for
  queued writes and Capacitor for Android.
- Shapes are filtered by workspace and project membership, not by user ID as in Catch.

## Open questions

1. **Android application ID.** `throw` is a Java keyword, so it cannot be
   `org.iloni.throw`. The Capacitor config uses `org.iloni.throwtasks` as a placeholder.
2. **Offline conflicts.** The proposal is last write wins per field, not per task. Not
   confirmed.
3. **Activity log while offline.** Whether the server derives log entries from applied
   writes or the client queues them.
4. **Subtask underlay.** Whether tapping a subtask shows a pop-out card with quick actions,
   or goes straight to the full subtask view. Changing a subtask's status in place was also
   proposed.
5. **Priority zones at rest.** Whether a column shows priority dividers all the time or only
   during a drag.
6. **Cancelled.** Whether a cancelled task takes a reason, and whether the cross-project
   board shows cancelled work in its last column.
7. **Search scope.** Presumably the current workspace with a project filter.
8. **Membership.** Whether a future member joins a whole workspace, a single project, or
   either.
9. **Identifier prefix.** How a project's key is chosen and whether it can change.
10. **Single sign-on.** Accepting an external OIDC provider in both apps would give shared
    login without coupling them. Not decided.
11. **Deployment.** How one Compose stack runs either or both apps when they live in
    separate repositories.
