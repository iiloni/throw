# Throw: initial spec

Status: draft (2026-10-13). The app is called Throw.

Items marked **(assumed)** were proposed during planning and not explicitly confirmed.
Everything else was decided. Undecided points are collected under [Open questions](#open-questions).

The fields, server-assigned values and write rules behind the domain model are stated
precisely in [data-model.md](data-model.md).

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
| Reports (cycle time, burndown) | Later; the activity log makes them possible. |
| Time tracking | Out of scope until further notice. |
| Moving a task to another project | Not supported for now. A task filed in the wrong project is recreated. |
| Description version history | Later, as its own piece of work. The activity log records that a description changed, not its text. |

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

A project has a key, the prefix of its tasks' identifiers (`CAT` in `CAT-12`). The create
form derives it from the name and lets the user edit it. Keys are unique within a
workspace. The server settles the key when the project syncs: if two projects were given
the same one offline, the second gets a number appended (`CAT2`). A project created offline
shows no key until then. The key can be changed later, and every task shows the new one at
once; old identifiers are not kept as aliases (ADR 0007).

Deleting a project sends it to the trash with everything in it. It is not a permanent
delete.

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
- A project always has at least one status in each category, and starts with one in each.
- A status's category is fixed when it is created. Changing it would close or reopen every
  task in it at once.
- Each project has a default status per category, used when a task is dropped on a category
  instead of a specific status. The backlog's default is the status a new task gets.
- A status cannot be deleted while tasks use it. A task moved, from a device that was
  offline, into a status that was deleted meanwhile stays where it was.
- Categories let the app compute progress, hide closed work, stamp times and consolidate
  different projects onto one board without knowing any status's name.
- A task records when it was closed: the time it entered a done or cancelled status,
  cleared if it is reopened. This is what the closed zone sorts by. It is not time
  tracking, and nothing else is stamped on the task.
- A cancelled task takes no reason. The cancelled status is the reason ("Won't do",
  "Duplicate"), and a comment carries any detail.

### Priority

Five fixed ranks. The default names are Critical, High, Default, Low and Very Low, with
Default as the rank a new task gets. Names are customizable per project; the number of ranks
is not. The cross-project board bands by rank, and each card shows its own project's name
for that rank.

### Task

| Field | Notes |
| --- | --- |
| ID | UUIDv7 generated on the device, so tasks can be created offline. |
| Identifier | The project's key and a number, such as `CAT-12`. The server assigns the number when the task syncs; a task created offline shows none until then. Numbers are never reused, and subtasks draw from the same sequence. |
| Title | |
| Description | BlockNote JSON, as in Catch. Text only in the first version. |
| Status | One of the project's statuses. |
| Priority | One of the five ranks. |
| Position | Manual order within its status and priority, or for a subtask within its parent; a fractional index as in Catch. |
| Primary tag, secondary tags | See [Tags](#tags). |
| Parent | Set on a subtask. |
| Closed at | Set by the server; see [Status and category](#status-and-category). |

A new task starts in the backlog's default status. A column's own add control creates the
task in that column.

A task stays in the project it was created in.

### Subtask

A subtask is a full task: it has its own status, identifier, priority, tags, comments and
history. Subtasks are one level deep, and always in their parent's project.

A parent and its subtasks are independent. The parent does not complete when its subtasks
do; it shows their progress as a count.

### Tags

Tags follow Catch's model (Catch ADR 0016), scoped to a project instead of a user:

- A nested tree with no depth limit.
- A task has one optional primary tag and any number of secondary tags.
- The primary tag sets the card's color through its root. Status is already shown by the
  column, so color is free to separate kinds of work.

### Comments and activity

Every task has an append-only activity log, shown as a timeline on the task. Comments
appear in the same timeline.

- The server writes the log from the changes it applies; no device writes to it (ADR 0006).
- It records creation and changes to the title, description, status, priority, parent,
  tags and trash state. Reordering is not recorded. A description entry says the
  description changed and holds no text.
- Entries are dated and ordered by the server's clock. A change made offline is dated when
  it synced.
- A change that was not applied because of a conflict is recorded too; see
  [Offline changes and conflicts](#offline-changes-and-conflicts).
- A comment is human-facing: something a person writes to themselves or to others in the
  workspace. Comments can be edited and deleted after posting, and are ordered by when the
  server received them.
- The log and comments are kept on the device, so the timeline can be read offline.

### Closed and deleted tasks

Done and cancelled tasks leave the board's main area, which stays focused on actionable
work. They remain reachable in the closed zone. Deleting a task sends it to a trash with
restore, as in Catch.

- A subtask is in the trash while its parent is, and a task while its project is.
  Restoring the parent or project brings them back.
- A task in the trash can still receive a change made earlier on an offline device. It
  stays in the trash.
- The trash is emptied only by hand. Nothing is purged automatically.

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
  gallery. Closed tasks are sorted by when they were closed.
- The backlog and the closed zone are rails, not columns, and do not look like columns. A
  rail runs the full height of the window and is flat: it has no surface, border or shadow
  of its own, whatever the column backgrounds setting says. Only the navigation rail has a
  border.
- The rails lie over the two ends of the active columns' scroller. Opening or closing
  either one pushes the columns along; when the columns do not all fit, the ones at the far
  end scroll under the other rail.
- While a card from another zone is held, each rail turns into dropzones, one per status in
  its category. It does this in place: no column moves and none is covered. A rail that is
  a strip widens into the gap beside it, and no further, so the status names can be read
  **(assumed: tried, not yet confirmed)**. It does not widen over a column, because the
  columns are drop targets too. Dropping on a status sends the card there with
  its priority kept, at the top of that priority.
- A card held from the backlog can still be placed in the backlog. Its status filters grow
  into targets for changing status. The closed zone is ordered by time, so cards are sent to
  it and never placed in it.
- The board has no title row. The project's name is in the expanded navigation rail, and in
  a tooltip on the project's icon when the rail is collapsed.
- A list of cards fades out over its last few pixels at the top or bottom while
  there is more that way. No card is cut off in a straight line, and the fade is what says
  the list scrolls.
- Where cards are scrolled out of a column, the visible area's corners take the card radius
  at the cards' own edges, so a card that is cut off still shows four round corners.
- Scrollbars are off by default, since the fades do their job with less noise. A
  [setting](#board-settings) turns them on for people who need the bar. They are then
  Catch's overlay scrollbars: drawn over the content, shown on hover on desktop and never
  on touch screens.
- A wheel turned where nothing scrolls up and down (the page, a rail's strip, a column short
  enough to fit) scrolls the columns sideways.

How a held card behaves, and why, is recorded in
[ADR 0008](decisions/0008-board-drag-model.md).

### Board settings

The settings page has a section for how the board looks and behaves. These are kept on the
device.

| Setting | Default | Effect |
| --- | --- | --- |
| Priority labels | Off | Names each priority zone in a column at rest. |
| Priority on cards | Off | Marks a card's priority on the card. A card of the default priority is never marked. |
| Column backgrounds | On | Gives each active column a faint surface. |
| Scrollbars | Off | Draws scrollbars. Off, a faded edge shows where a list goes on. |
| Holding a card | Compact **(assumed default)** | Compact or Full; see [Ordering and priority](#ordering-and-priority). |
| Theme | System | System, Light or Dark. |

The board practises progressive disclosure: what is not needed at rest is not drawn at rest.
Applying this further is ongoing.

### Cards

A card shows the title, identifier, tags and subtask progress. It shows its priority only
when the [setting](#board-settings) asks for it, since the card's place in the column
already says it. It does not show the description.

Subtask progress is an expandable underlay, like link and media previews on a Catch card.
Folded, it shows one pip per subtask and a count. Unfolded, it lists the subtasks:

- A subtask's status can be changed there, without opening it.
- Tapping a subtask opens it in the task view. There is no pop-out card.
- A card that is picked up folds its subtasks away as it lifts.

### Subtasks on the board

By default subtasks live with their parent: their statuses are tracked but do not place them
on the board. A view option shows subtasks as top-level cards, marked as subtasks, in their
own status columns.

Two drag interactions are kept in mind for later: dragging a subtask out to make it a task,
and dropping a card on another to make it a subtask.

### Ordering and priority

A column is sorted by priority, with manual order inside each priority.

At rest a column does not mark its priority zones: cards of different priorities are set
apart by a little space and nothing else. A [setting](#board-settings) labels each zone.

While a card is held over a column, the zones always show, in one of two ways the user
chooses:

- **Compact.** The card's priority zone takes the column and the card is placed by dragging
  within it. Every other priority folds into a labelled rail above or below. Holding the
  card over a rail for a moment changes its priority and opens that zone instead.
- **Full.** The column keeps its layout. Zones are labelled, cards of other priorities dim,
  and the card takes the priority of the zone it is over.

A held card leans into its movement. With several cards held, each keeps its own priority
and the column takes them as a group.

A card can also be moved from the keyboard: Space picks it up, the arrows move it within
and across columns and priorities, Space or Enter sets it down and Escape puts it back
**(assumed)**. Each step is announced to screen readers.

On desktop, a click with Ctrl, Cmd or Shift selects cards, and a bar offers to move the
selection to a status **(assumed)**.

### Phone

- Swiping between active columns is accepted. The effort goes into making moves fast.
- The backlog is a drawer that rises from the dock, first to part height and then to full
  screen. Dragging a card above the drawer moves it onto the board.
- The closed strip sits at the right end of the board.
- A long press without movement selects a card. Moving after the press drags it. A touch
  that moves before the press completes scrolls.
- During a drag or with cards selected, the dock becomes a grid of status dropzones under
  a label for each category (Backlog, Active, Closed). This moves cards to any status
  without scrolling the board. With cards selected, tapping a status moves them.
- Holding a card at the side of the screen turns to the next column.

## The cross-project board

A board over every project in the workspace **(assumed scope)**.

- One column per category instead of per status, since categories are all that projects
  share. Done is shown open by default. Cancelled is the last column and is collapsed by
  default.
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
without breaking bookmarks. A future task path has its own segment holding the task's
UUID, not its identifier: a task created offline has no number yet, and a project's key
can change (ADR 0007). A direct project URL keeps its view on reload. Selecting a project
from navigation opens its board; the shell remembers the last project separately per
workspace. Projects append by position. Deleting a project is permanent in the shell as
built and requires confirmation; it moves to the trash once the task model is built (see
[Project](#project)).

The shell's backlog and board bodies are placeholders. The backlog drawer and task-specific
dock interactions arrive with the board feature; search and the command palette arrive later.

## Platform and architecture

- Offline-first from the start on the web (installable PWA) and Android. Retrofitting
  offline would change how every write works.
- The stack follows Catch: a Vite and React client with TanStack DB, a Hono server with
  Better Auth and Drizzle on Postgres, Electric for sync behind an auth proxy, an outbox for
  queued writes and Capacitor for Android.
- Shapes are filtered by workspace and project membership, not by user ID as in Catch.

### Offline changes and conflicts

The server is the arbiter of truth. Working offline is a convenience that should lose as
little as possible; it is not the normal way to use the app (ADR 0005).

- A change made offline is applied when it syncs, unless the same field of the same task
  was changed on the server in the meantime. Then the server's value stands. A device
  coming back online never undoes newer work.
- The rule is per field. Changing a task's title on one device and its status on another
  keeps both.
- A change that is not applied is not lost: it is recorded in the task's activity log with
  the value that was wanted, and can be made again by hand. For a description, the log
  keeps the text that was not applied.
- No device clock is involved. Which change came first is decided by the order they reach
  the server.
- A reorder made offline is ignored if the card has since left that column.
- A task created offline is never dropped because its status was deleted meanwhile. It
  lands in the project's default status.

## Open questions

1. **Android application ID.** `throw` is a Java keyword, so it cannot be
   `org.iloni.throw`. The Capacitor config uses `org.iloni.throwtasks` as a placeholder.
2. **Search scope.** Presumably the current workspace with a project filter. It does not
   affect the task schema: a workspace's tasks are on the device, so search can run there.
3. **Membership.** Whether a future member joins a whole workspace, a single project, or
   either. Tasks and the rows under them carry both a workspace and a project, so either
   answer can filter them without a migration.
4. **Single sign-on.** Accepting an external OIDC provider in both apps would give shared
   login without coupling them. Not decided.
5. **Deployment.** How one Compose stack runs either or both apps when they live in
   separate repositories.
6. **Refused changes.** How the app tells the user that a change made offline was not
   applied, beyond the entry in the task's log.
7. **Reordering the full-width backlog.** The gallery lays cards out in several columns per
   priority. Whether cards can be reordered there, and how a drop position reads in a
   masonry layout, is not designed.
8. **The card and the task view.** The board prototype settled how cards move, not what a
   card or the full task view contains beyond what this spec already lists.
