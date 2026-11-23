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
- **Changes to a task's core attributes are user-driven.** A user can initiate work in an
  external agent and authorize it to act in a workspace. Throw records which credential the
  agent used for each change. Throw itself never moves or completes a task on a schedule.
- **Few integrations, all opt-in.** The first is [MCP](decisions/0014-mcp-server.md).
  [Webhooks](decisions/0015-webhooks.md) are its push companion: they tell an agent to look.
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
- Deployment lives in an operator-owned directory, with a combined Compose example in Throw
  ([deployment guide](deployment.md), ADR 0010). Each app pins and updates its own image.
- Server admins can make, schedule, download and restore whole-server database backups
  ([backup guide](backups.md), ADR 0011).
- Build starts after Catch reaches maturity.

## First version

### In scope

- Workspaces, projects, tasks and one level of subtasks.
- Custom statuses mapped to categories, five priority ranks, optional task sizes and nested tags.
- The project board, the cross-project board and the task view.
- Comments and a full activity log.
- Task relations across the projects of a workspace: blocks, duplicate of and relates to.
- Search, filters and a temporary sort on the boards, and a command palette elsewhere.
- Trash with restore.
- Offline-first web app and Android app.
- An MCP server for reading workspace data, managing tasks and their relations, and
  creating, editing and reordering projects, statuses and tags. The account holder creates a named token for one
  workspace in Settings and can revoke it there. Agent writes sync to the board. Task
  changes show their source in the task's history or comments. Agents can follow workspace
  changes with a cursor-based feed.
- Outbound webhooks that wake an external agent when a workspace or project changes. Each
  sends a small signed notice and the agent reads the change from the MCP feed. A user
  creates them in Settings; they run no rules and change nothing in Throw.

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
| Automation inside Throw | Scheduled jobs and rules that change tasks are out of scope. Webhooks only notify. |
| Other integrations, import, export | Out of scope for the first version. |
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
delete. Deleting leaves the project for its workspace, so a notice there offers Undo,
which restores the project and returns to it. A task trashed from its pane stays open with
Restore in place of Trash, so it needs no notice.

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
- A status can take a named tag color. The project board uses it for a stripe along the top of
  its desktop column, the phone board's progress track, and status controls. The desktop
  column background has its own setting. A task card takes its color from its primary tag.
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
| Size | Optional XS, S, M, L or XL. The names are the same across projects. Pick a size from the task dock, or select the current size or None to clear it. |
| Position | Manual order within its status and priority, or for a subtask within its parent; a fractional index as in Catch. |
| Primary tag, secondary tags | See [Tags](#tags). |
| Parent | Set on a subtask. |
| Closed at | Set by the server; see [Status and category](#status-and-category). |

A new task starts in the backlog's default status. A column's own add control creates the
task in that column. On desktop, a plain “Add task” control at the foot of a
column creates it at the top of its default priority and opens its title for editing; the
backlog also has an add button in its header.

A task stays in the project it was created in.

### Subtask

A subtask is a full task: it has its own status, identifier, priority, size, tags, comments and
history. Subtasks are one level deep, and always in their parent's project.

A parent and its subtasks are independent. The parent does not complete when its subtasks
do; it shows their progress as a count.

### Tags

Tags follow Catch's model (Catch ADR 0016), scoped to a project instead of a user:

- A nested tree with no depth limit.
- A task has one optional primary tag and any number of secondary tags.
- The primary tag sets the card's color through its root. Status is already shown by the
  column, so color is free to separate kinds of work.

### Relations

A task can be linked to any other task of its workspace, in its own project or another
one (2026-11-22). A link is one of three kinds, and each task sees it from its own side:

| Kind | One side reads | The other side reads |
| --- | --- | --- |
| Blocks | Blocks | Blocked by |
| Duplicates | Duplicates | Duplicated by |
| Relates to | Relates to | Relates to |

- Relations are informational, like subtasks: a blocked task can still be moved, edited and
  closed, and closing a duplicate closes nothing else.
- A pair is linked once per kind. A task cannot be linked to itself, and a directed link
  cannot be added beside its reverse: if B blocks A, A cannot also block B.
- The task view lists them in groups (Blocked by, Blocks, Duplicates, Duplicated by,
  Relates to), empty groups left out. On wide desktop panes (620 px and wider) they live in
  the side column ([ADR 0012](decisions/0012-task-side-column.md)); on narrower panes and
  phones they live in a third **Links** tab beside Comments and History, with a count and a
  quiet blocked dot while an open blocker remains (animating smoothly out of the tab strip
  when the side column takes over; on narrow containers with three tabs, inactive tabs show
  only their icons while the active tab expands to show its label). Each row shows the other
  task's status, identifier and
  title, struck through when it is closed or in the trash, and its project's name when it is
  in another project. Tapping a row opens that task, over this one on the same board so Back
  returns, or on its own project's board. On a phone the task grows out of its exact opener
  row and dissolves back into it once settled, never crossing to a subtask card of the same
  task. Each row has a remove button, always shown since a touch screen has no hover.
- The dock's link control opens a picker. Its controls sit at the bottom for reachability
  (directly above the desktop dock, and riding above the safe area or keyboard on a phone):
  the relation kind as one segmented control (Blocked by, Blocks, Duplicates, Relates to)
  with a sentence below saying which way it reads (“THR-21 waits until the task you pick is
  done.”), and the search field at the foot. Above them, before anything is typed, are a few
  open tasks of the task's own project that are not linked to it yet, work in progress first;
  typing searches the workspace's tasks out of the trash by identifier or title, in any
  project. One tap (or Enter, with the arrows to move) links a task and closes the picker.
  “Blocked by” is stored as the other task blocking this one. A task already linked shows
  how; one linked that way, or whose reverse is linked, cannot be picked. With a keyboard at
  hand the search takes focus at once; a touch screen keeps its keyboard down until the
  field is tapped, so the suggestions stay in view.
- A card whose blocker is still open (not closed, not in the trash, in any project) shows a
  small blocked mark beside its identifier, named “Blocked by APP-4” or “Blocked by 2
  tasks”. It goes once every blocker closes or is trashed. Closed cards do not show it.
- Adding and removing a relation is recorded in both tasks' history, and reaches agents
  through MCP and webhooks.

### Comments and activity

Every task has an append-only activity log, shown as the task's history. Comments sit
beside it on the task, each under its own tab.

- The server writes the log from the changes it applies; no device writes to it (ADR 0006).
- It records creation and changes to the title, description, status, priority, size, parent,
  tags, relations and trash state. History also records agent reorders and names the token used for
  agent writes. Agent comments show the same attribution in Comments. A description
  entry says the description changed and holds no text.
- Entries are dated and ordered by the server's clock. A change made offline is dated when
  it synced.
- A change that was not applied because of a conflict is recorded too; see
  [Offline changes and conflicts](#offline-changes-and-conflicts).
- A comment is human-facing: something a person writes to themselves or to others in the
  workspace. Comments can be edited and deleted after posting, and are ordered by when the
  server received them.
- The log and comments are kept on the device, so the timeline can be read offline.
- The task view shows one row per server write, with short sentences for its fields.
  Creation is condensed to the title and status, with any unavailable initial choices
  stated separately. Separate writes are never grouped across comments or refusals.
- Comments use the description's text-only editor. Only their author sees edit and delete
  controls. A comment written offline is marked pending until it receives a server time.

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
  gallery. Closed tasks are sorted by when they were closed, and the gallery reads newest
  first across its top row.
- On a desktop, an open rail's inner edge drags it to any width from a single column to the
  whole board; its cards fill as many columns as fit, as Catch's masonry does. Let go near a
  strip or near the whole board, it snaps to the strip or the gallery. The width is kept on
  the device, and the gallery button still opens and restores it in one click. A column and
  its gallery are one grid: the cards fan out into columns and gather back, each springing
  from where it is.
- The backlog and the closed zone are rails, not columns, and do not look like columns. A
  rail runs the full height of the window and is flat: it has no surface, border or shadow
  of its own, whatever the column backgrounds setting says. Only the navigation rail has a
  border.
- The rails lie over the two ends of the active columns' scroller. Opening or closing
  either one pushes the columns along; when the columns do not all fit, the ones at the far
  end scroll under the other rail.
- While a card from another zone is held, each rail turns into dropzones, one per status in
  its category. It does this in place: no column moves and none is covered. A rail that is
  a strip widens into the gap beside it, and no further, so the status names can be read.
  It does not widen over a column, because the columns are drop targets too. Dropping on a
  status sends the card there with its priority kept, at the top of that priority.
- A card held from the backlog can still be placed in the backlog. Its status filters grow
  into targets for changing status. The closed zone is ordered by time, so cards are sent to
  it and never placed in it.
- The full-width backlog gallery reads left to right, then down, in a band per priority, so
  a place between two cards reads as it does in a sentence. A card held there opens a gap
  where it would land, and the other cards spring aside to make room as it moves, as in
  Catch's gallery. Every priority
  shows a band while a card is placed, so an empty one can take it. Cards from elsewhere are
  sent to a backlog status through its filters, never placed in the mixed gallery.
- On a desktop, an active column folds to a narrow strip and opens again, as a column of
  Catch's deck does: the strip shows the status's name turned on its side, its glyph and its
  count, and the whole strip opens it. An open column folds from its header, which is the
  control, as on Catch's deck. The width springs between
  the two, and the column's content fades in once it has mostly resized. Folded columns are
  remembered per project on the device. A card dropped on a strip is sent to its status
  without the column opening ([ADR 0008](decisions/0008-board-drag-model.md)); carrying a card
  into one from the keyboard, or opening one of its tasks, opens it. A phone shows one column
  at a time, so it does not fold them, and a column folded on a desktop shows in full there.
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

Settings' General page has a section for how the board looks and behaves. The board settings
button opens the same options in the [drawer](#the-drawer) at full height on a phone, and in
a panel from the rail on desktop, sized to the window. These are kept on the device. Column backgrounds and the
rails' placement shape desktop columns, so a phone does not show them.

| Setting | Default | Effect |
| --- | --- | --- |
| Priority labels | Off | Names each priority zone in a column at rest. |
| Priority on cards | Off | Marks a card's priority on the card. A card of the default priority is never marked. |
| Size on cards | Off | Adds a small size badge to sized cards on the project and cross-project boards. |
| Column backgrounds | On | Gives each active column a faint surface. |
| Backlog rail, Closed rail | Sticky | One setting for each. Sticky keeps the rail at the window's edge with the columns scrolling beneath it. With board puts it at its end of the columns, and it scrolls away with them. |
| Subtasks as cards | Off | Shows subtasks as top-level cards; see [Subtasks on the board](#subtasks-on-the-board). |
| Scrollbars | Off | Draws scrollbars. Off, a faded edge shows where a list goes on. |
| Holding a card | Compact | Compact or Full; see [Ordering and priority](#ordering-and-priority). |
| Theme | System | System, Light or Dark. The browser and installed app bars follow the chosen theme. |

General also has Catch's app icon switcher on dev and preview builds. A build starts with
its own channel's icon; preview can switch to Stable, and dev to Stable or Preview. Testers
can then see the released icons on one device. The choice is kept on the device. It changes the Android launcher
icon, or the web app's favicons and install manifest. A stable build has its one icon and
no switcher. See [branding](branding.md#app-icon-switcher).

The board practises progressive disclosure: what is not needed at rest is not drawn at rest.
Applying this further is ongoing.

### Cards

A card shows the title, its tags, a muted identifier and subtask progress. Tags are Catch's
badges under the title, as on Catch's note cards (2026-11-19): the primary tag first and
bolder, then the secondary tags, each in its root's color and icon. Catch heads its card
tags with a "Tags" label; a task card leaves it out, and shows at most three badges and a
count of the rest, to keep the board dense. Card badges are flat (no backdrop blur), since
a card is opaque and a board may hold hundreds of them. On the cross-project board, badges
are neutral: cards there take their project's color, and tag colors mean different
things in each project.
Until its number and project key sync, the identifier reads “Pending”. The owner chose this
quiet content when the real board was built (2026-10-14): status appears only in the mixed
backlog and closed zones; a subtask card has a small marker instead of a parent-title row,
and a closed card does not add a relative timestamp. It shows its priority only
when the [setting](#board-settings) asks for it, since the card's place in the column
already says it. It does not show the description.

Subtask progress is an expandable underlay, like link and media previews on a Catch card.
Folded, it shows one pip per subtask and a count. Unfolded, it lists the subtasks:

- A subtask's status can be changed there, without opening it.
- Tapping a subtask opens it in the task view. There is no pop-out card.
- A card that is picked up folds its subtasks away once it moves; one put straight back
  keeps them open.

### Subtasks on the board

By default subtasks live with their parent: their statuses are tracked but do not place them
on the board. A board settings option shows subtasks as top-level cards, marked as subtasks,
in their own status columns. Like the other board settings it is kept on the device and
applies to every board.

Two drag interactions are kept in mind for later: dragging a subtask out to make it a task,
and dropping a card on another to make it a subtask.

### Ordering and priority

A column is sorted by priority, with manual order inside each priority.

At rest a column does not mark its priority zones: cards of every priority are spaced
alike, and the order alone carries the priority. A [setting](#board-settings) labels each
zone.

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
and across columns and priorities, Space or Enter sets it down and Escape puts it back.
Enter on a card at rest opens it. Each step is announced to screen readers, and nothing is
written until the card is set down.

Escape cancels a drag and puts the card back. With reduced motion a held card does not lean
or lift, and it lands without flying home.

A move is status, priority and position written together, and shows at once, offline too.
While a card is held, changes arriving from other devices wait until it is dropped, so the
column does not change under it. A card another device moved to another status, priority
or parent in the meantime is not moved, and the board says so; a refused move settles back
where the server has it.

On desktop, a click with Ctrl, Cmd or Shift selects cards, and a bar offers to move the
selection to a status.

### Search, filters and sorting

Both boards can be narrowed down in place (2026-11-22). Search, filters and the sort are view
state on the device: they apply to the board on screen, are not saved, and are gone when the
board is left or reloaded. The filter card shows one section at a time, chosen from tabs at
its foot as in Catch's filter card: Tags (Projects on the cross-project board), Size and Sort.
A dot marks a tab whose section narrows or orders the board, and the device remembers the last
section opened.

- **Words.** The search's literal words, matched as [search](#desktop) matches them: title,
  identifier, description text and tag names with their ancestors.
- **Tags**, on a project board. Any (OR, the default) or all (AND) of the chosen tags, or
  Untagged alone. A tag matches the tag itself and every tag beneath it, primary or secondary,
  so Home finds a task tagged Garden under Home, as Catch's tag filter does. Each tag shows how
  many cards it would leave, given the rest of the filter. The cross-project board has no tag
  filter, since tags are per project; it scopes to one project instead.
- **Sizes**, on both boards. Any of the chosen sizes (OR), and Unsized for tasks without one.
- **Sort.** Priority, the board's own order, is the default. The others order each column by
  one field, either way round:
  - **Size**, smallest or largest first.
  - **Added**, newest or oldest first, by when the task was created.
  - **Updated**, most or least recent first, by the newest entry in the task's
    [activity log](#comments-and-activity) that changed something. Reordering a card within
    its column leaves the log alone, so it does not count; a write the server refused changed
    nothing and does not count either. A task with no entry yet counts from when it was added.

  Tasks without the value (unsized) go last either way, and ties fall back to priority and
  then manual order. The closed zone keeps its order by closing time.

Everything chosen applies together. Cards that do not match leave the columns, the backlog
and the closed zone; while subtasks stay with their parent, a parent card stays when one of
its subtasks matches, since the card stands for them. Column counts, including a folded
column's strip, count what is left. A column with nothing left says so.

While the board is sorted by anything but priority, columns are not in their manual order, so a card cannot be
placed within one: a card dragged, carried from the keyboard or moved by selection goes to
another status, keeping its priority, and lands where that status puts it. Dropping it back in
its own column writes nothing, and the keyboard's up and down announce the sort instead of
moving the card. Filtering alone keeps placement: a card dropped between the cards still
showing takes a position between them.

What applies always shows. On desktop it is chips in the search; on a phone it is a chip
bar under the board's title, and the dock's Search is marked. Each chip removes its choice, and
Clear all removes every one, with the sort back to priority.

### Phone

The backlog and the closed tasks are not columns on a phone. Each has its own shape and its
own way in and out, so the board is not a row of identical pages.

- The board is the active columns, one page at a time, swiped or chosen from a flow track
  under the title: one segment per column in board order, the columns behind the current
  one filled in. Above the track are the current column's name and count, and the next
  column's name, which turns to it. The board opens on the first active column.
- The backlog lives in the [drawer](#the-drawer), at its three heights:
  - **Collapsed**, the drawer's header is the dock: the backlog's handle (a small stack of
    cards, its name and count) beside Search and the create button.
  - **Half open**, it is a supply of work with the board still above it. Carrying a card
    off sinks the drawer out of sight, so the whole screen is board to place the card on. Its
    cards are not reordered at this height. The drawer comes back to half open after the drop.
  - **Full**, the backlog is groomed: its cards are reordered in place, and the status
    filters are dropzones for its own cards.

  The drawer is pulled between heights by its header, and tapping the handle opens or
  closes it. Vertical pulls also work from the content, including the status filter pills,
  when it was already at the boundary in that direction when the swipe began. A swipe that
  starts with room to scroll stays a scroll, even if it reaches the boundary; lifting and
  swiping again can pull the drawer. A downward pull on the closed tasks returns to the
  previous drawer content and height.
- While a card is held, the pages beside the current one peek in at the edges as bare
  rounded surfaces, without their cards: targets that turn the board, kept quiet. The current
  page draws its cards in from the edges to leave room for them. At rest a page fills the
  screen.
- Past the last column there is a done pocket instead of a page: a card dropped there moves
  to the project's default done status. The card flies into the header's done count, which
  counts tasks done in the last seven days, and the count bumps.
- The done count opens the closed tasks in the drawer at full height: grouped by when they
  were closed (today,
  yesterday, this week, earlier) and filtered by closed status. A card held there reopens
  through the move drawer.
- A long press without movement selects a card. Moving after the press drags it. A touch
  that moves before the press completes scrolls. On Android the press, a page turn and the
  drop are felt as light haptic ticks.
- While a card is held, from the board, the backlog or the closed tasks, the drawer's
  content sinks and its header becomes the move drawer at the bottom edge. It opens into a
  grid of status dropzones under a label for each
  category (Backlog, Active, Closed) when the card is brought onto it, and closes when the
  card leaves. This is how a board card goes back to the backlog, and how any card reaches
  any status without scrolling the board. Above the drawer the column scrolls under the held
  card. With cards selected the drawer is open and tapping a status moves them.
- Holding a card in the outer 44 CSS pixels, where the next page peeks in, leans that
  surface further in and tints it, and the page turns after about half a second.
- Card titles are 16 CSS pixels on a phone. A held card's column shows each collapsed
  priority as its name alone, on a fainter bar, so it stays quiet on a small screen.
- A card on a board page swiped to the right closes into the project's default done status:
  the card follows the finger over a done surface, which fills once letting go will close it,
  and flies off as the done count bumps. A short swipe springs back. Only rightwards, towards
  the done pocket: a swipe to the left over a card still turns to the next column, and any
  swipe that starts outside a card (the gutters, the header) turns the page, so the page
  swipe wins near the edges. Cards are not swiped while some are selected, and cards in the
  drawer are not swiped (owner decision, 2026-10-19).

## The cross-project board

A board over every project in the workspace **(assumed scope)**, at `/w/:workspaceId/board`.
It uses the project board's cards, drag, selection, keyboard carry, swipe to close and task
view, so it reads and moves the same way.

- One column per category instead of per status, since categories are all that projects
  share. Done is shown open by default, with every closed task (no time window). Cancelled
  is the last column and is collapsed by default. On a desktop any column folds and opens as
  a project board's does (2026-11-22), and the choice is remembered on the device for the
  workspace board. A phone shares only Done and Cancelled with it, the pages it can fold.
- Cards are colored by project, because tag colors mean different things in each project.
  For the same reason their tag badges are neutral (2026-11-19).
  Each card names its own project's status and identifier.
- Columns are banded vertically by priority rank. A band is labelled with the rank's name
  when every project names it the same, and with the default name otherwise. On wide
  displays a column lays its cards out as a masonry grid within each band. Within a band,
  cards keep their project's order; cards of different projects interleave in no promised
  order.
- While a single card is dragged, the target column shows that card's project statuses as
  dropzones. Dropping on the column itself, or moving a selection that spans projects, uses
  each project's default status for the category; a card already in that category stays
  where it is. A folded column stays a strip under a held card and takes it the same way.
- Moving a card here changes its status only. Priority and order belong to the project
  board, where cards can be placed between others; keyboard carry still moves a card between
  priority bands, as on the project board **(decision, 2026-11-18)**.
- A card opens its task in place: beside the board on a desktop, as a task screen on a phone,
  with the task's own project's statuses, tags and subtasks.
- New work is captured through the palette, which asks which project it belongs to.
- On a phone the board pages through the four categories as the project board pages through
  statuses, opening on Active. Done and Cancelled can be folded and reopened on their pages,
  with the same remembered preference as desktop. Backlog and Active swipe to close into each card's
  project's default done status. The move drawer offers the held cards' project statuses
  when they share one project, and the four categories when they do not.

## The task view

The full task is where the work is done: description, subtasks (in a dedicated subtask
view), comments and activity.

- On wide screens it opens as a split view on the right. It takes width from the board and
  has a drag handle to adjust the split.
- On small screens it takes the whole screen, like a note in Catch, and is not a bottom
  drawer. It opens out of its card and closes back into it, on the card's color. Pulling it
  down from the top closes it too.
- While a task is open on a phone, the dock (the collapsed [drawer](#the-drawer)) holds
  that task's actions, as it does for a note in Catch: Status, Priority, Color and Tags
  (once the project has any), Link a task (see [Relations](#relations)) and More (close or
  reopen, copy link). The controls act as
  tabs: each opens its panel in the drawer beneath the dock, which stays as the panel's
  header, and the drawer holds still until a panel is open. The status panel is the
  board's grid of statuses by category. As Catch keeps a note's color and tags apart
  (2026-11-19), Color picks the primary tag: each colored top-level tag is a swatch,
  picking one opens its children to pick a more specific one, and uncolored top-level
  tags sit one step away. Tags lists the secondary tags with the primary marked, since a
  tag may hold both roles. Both pickers stay open for further choices. As in Catch, each
  has a "+" in its top-right corner that makes a tag and assigns it at once (2026-11-20):
  in Color, a top-level tag starting with a color no root holds yet, or a child of the
  open tag, either becoming the primary; in Tags, a secondary tag. On a phone the form is
  a drawer page in place of the picker, and Back returns to the picker; on desktop it is a
  centred dialog over the open panel. The task's tags are listed under its title. On desktop the pane follows Catch's split view (2026-11-19):
  the navigation and trash toolbars sit above the task's card, lined up with its edges, and
  the same controls are a glass dock below it. A panel opens above the dock over the
  card's foot without moving the card, and closes from its own button, Escape, Back or a
  tap outside. The desktop dock has no drag gestures: a pointer does not need them, and
  the phone keeps its drawer's drags.
- The description is a directly editable, text-only BlockNote document. Changes commit
  when the task view closes or switches tasks; drafts survive reloads and conflicts.
  Formatting follows Catch (2026-11-19): a mouse formats from BlockNote's floating toolbar,
  and a finger from Catch's formatting bar, which takes the dock's place while the
  description or a comment has focus on a touch screen. Its tools never take focus, so the
  keyboard stays up; leaving the editor brings the task's controls back.
  Code blocks highlight in both themes, even offline. Their glass pill opens on hover,
  keyboard focus or tap and offers language selection, copy and download. Pasting code
  removes its common indentation. The editor tries to detect the language locally for
  unlabelled pasted blocks and when pasting into an empty, unlabelled block.
- Unfinished comments and comment edits can be resumed on the same device after closing the
  task or reloading. Cancel discards the draft, and Ctrl/Cmd+Enter posts or saves it.
- The top toolbars follow Catch: back and the parent/task identifier breadcrumb on the
  left, trash/restore on the right.
- Subtasks sit on the task pane as a flush list of the same task cards, as Catch lists a
  note's links below it, with status controls and an add action. A subtask opens in the same view, with its parent in the
  breadcrumb. Adding one makes it at once and opens it as a new task, as the board's add
  control does (2026-11-19): its title ready to be written and its full controls, over its
  parent's pane. On a phone it grows out of its new card; beside the board it slides in over
  its parent and back out when left. A new subtask left untouched (no title, description,
  tags, comments or changed fields) is discarded as it is left, rather than kept untitled. Opened from its parent's pane, it goes back there: Back, Escape, a pull and
  the breadcrumb return to the parent, and on a phone the subtask grows out of its card
  over the parent's pane and shrinks back into it.
- A desktop pane at least 620 px wide has a side column beside the task's card, as a wide
  Catch note pane does (2026-11-19, ADR 0012). It holds the task's tags and then its
  subtasks, then its relations, and later its link previews and media. It opens with the
  first of them and closes with the last. Until then, “Add subtask” stays below the description. Narrower panes
  and phones keep tags and subtasks inline, and show relations under a third **Links** tab
  beside Comments and History.
- Phone opening/closing uses Catch's card-to-note container transform and timing: the
  surface grows from its card and shrinks into its current position, with a fade when no
  card is visible. As in Catch, the surface has no shadow of its own,
  and a card's subtask underlay hides while its task is open and slides out from behind the
  card as the task lands. When
  a task opens, the board's dock crossfades into the task's controls as Catch's dock does
  for a note, and back again as it closes; the drawer stays above the task until it has
  landed. Desktop panes slide in from the side, as in Catch.
- The phone dock's create button adds a task at the top of the current column's default
  priority (the backlog's default status while the backlog is open) and opens it with
  its title selected.

## Navigation

### Desktop

A left-mounted navigation rail, not a bottom dock. Below 1200 CSS pixels it starts narrow;
at wider desktop widths it starts expanded. An explicit expand/collapse choice is remembered
on the device and takes precedence over window width:

- Workspace switcher at the top, followed by Search (Ctrl/⌘K).
- One icon per project. In the expanded rail, a pencil at the right of each project entry
  appears on hover or keyboard focus and edits that project. It stays visible on touch screens.
- The cross-project board.
- Settings at the bottom.

On a board, search is a floating glass bar at the bottom of the board area, opened from the
rail or with Ctrl/⌘K, which focuses it when it is already open (2026-11-22). It is not modal
and has no results list: the board itself narrows as words are typed or
[filters](#search-filters-and-sorting) chosen, and stays usable while the bar is open. The
bar centres on the board beside an open task pane, and the columns leave room for it at their
ends. A filter button opens the filters and sort in a panel above the field; the chips of what
applies sit between them. Enter opens the best match, ranked as below, and Ctrl/⌘K on an
empty, focused bar closes it. Escape first closes the panel, then clears the words, filters
and sort, then closes the bar and returns focus. Project jumps are not offered there; the rail
lists the projects.

When the board is at least 1320 CSS pixels wide (the window less the rail), search docks as a
sidebar between the rail and the backlog instead of floating, so nothing sits over the cards
(2026-11-22). It is laid out as Catch's search page: the field and filter button at its foot,
the chips above them, and above those Catch's Browse tags, the project's root tags as tiles in
their color with the cards each would leave, and Untagged. A tile toggles its tag in the
filter; on the cross-project board the tiles are the projects and scope the board to one. The
filter button raises Catch's filter card over the tiles, anchored above the field, with the
full filters and sort; a press outside it closes it. It opens, closes and steps back on Escape as
the bar does.

Away from the boards (settings, trash, an empty workspace) search is a command palette. There
is no search page. The palette also captures tasks. It takes Catch's search and quick note as
they are: a dock-shaped glass search field with results as cards above it, highlighted where
they match.

Search and capture belong to the board they are opened from (owner decision, 2026-10-17,
replacing the scope settled on 2026-10-15). A project board searches and captures in that
project alone, with no project filter, chooser or project jumps. Working across projects is
the cross-project board's: there search covers every project in the current workspace, jumps
to projects, and has a filter button beside the field that opens the project scope above it,
shown as a removable chip while it applies. Open and closed tasks and subtasks are included;
trash (including children of trashed parents and projects) is excluded. There is no
cross-workspace search.

Search runs on synced device data, offline too. Every literal query word must appear across
the title, current identifier, description text or tag names, ignoring case and accents. A
task's tags are its primary and secondary tags with their ancestors' names, so a task tagged
Garden under Home is found by either, and a result found by a tag shows the tag that matched
(2026-11-18). Results are drawn as the board's cards are, with their color, tag badges, status,
size and priority (2026-11-23); a tag that matched above the card's own tags is named beside
its identifier. Exact identifiers rank first, then
exact titles, title prefixes, all-title matches, and description/tag matches. Ties favor the
current project, then project name, title and task UUID. A bare number prefers the current
project when several projects have that number. In the palette, up to 30 tasks and eight project jumps are
shown. Enter opens the selected result; arrows change the selection. An Enter pressed while
tasks or projects are still loading waits and chooses the selected result once they appear,
rather than choosing a jump or Create the list has not shown (2026-11-18).

Typing a title also offers Create in the palette. Ctrl/⌘Enter, in the palette or the board's
search, captures it directly into the board's project, or on the cross-project board the
project search is filtered to. The board's search has no create button of its own; the board
has one. With neither project, the title moves to the capture window, which opens on its
project list. The capture window on
desktop is Catch's quick note: a card-colored window with the title, the board's project (a
chip that opens a searchable project list in place on the cross-project board), the backlog
status it lands in, and a create button. A new task appears optimistically with “Pending”
until numbered, and opens in the existing task pane. Escape, Android Back or a tap outside
first closes an open list, then dismisses the palette without creating anything, and
restores focus.

### Phone

A bottom dock with Search and a create button, as in Catch. The dock is the header of the
collapsed [drawer](#the-drawer); on a project board the backlog's handle sits beside them.
There are no Backlog and Board tabs: the backlog is the drawer, so a Board tab had nothing
to switch to.
Project switching and the cross-project board live in the header's title menu. There is no
three-tab dock: every phone board has its own, and other pages use the title menu alone.

The phone layout applies below 768 CSS pixels. The title menu also switches and manages
workspaces, and opens settings. The project dock remains on project and cross-project
boards. Settings and project settings have a dock that names the open page and lists the
others in the drawer, as Catch's settings dock does; an empty workspace uses the title menu
alone. On the cross-project
board, the dock holds Search, which opens the workspace palette, and a create button that
opens the palette's capture, where the project is chosen.

On a phone's project board, search and capture live in the drawer (ADR 0009). The dock's
Search button raises the drawer as a search page: results above, and Catch's glass search
field at the bottom where the dock was, focused so the keyboard rises right under it. Its
filter button opens the board's [filters and sort](#search-filters-and-sorting) above the
field, with their chips over the results. They apply to the board behind and stay after the
search page closes, shown by the chip bar under the title; the words narrow only the results.
With filters chosen and no words typed, the results list what the board behind shows, column by
column in its order, so choosing a tag shows its cards on the search page too.
The cross-project board's palette offers the same filters and sort, with its project scope. The
create button opens Catch's quick note for a task: a card above the dock with the title,
focused, and create. The task lands where a new card would, in the column on screen, or the
backlog's default status while the backlog is open. While the card is up, the dock holds the
new task's status, priority and (when the project has tags) tags, as an open task's dock
does, and the create button turns into its close. Those controls put the keyboard away and
open their pickers in the drawer beneath the dock, with the card riding above; picking
returns to the title. Closing the card, Back, Escape or a tap outside creates nothing.
Elsewhere on a phone (settings, an empty workspace, the cross-project board) the palette
uses its own full-height surface until the drawer moves to the shell.

### The drawer

The drawer is to Throw what the dock is to Catch: a core part of the interface on a phone,
not a component each feature draws. It is one glass surface along the bottom edge, and
every sheet on a phone is the drawer showing that content: the backlog, the closed tasks,
board settings, search and capture, the move targets, forms, the tag manager and pickers.
Collapsed, its header is the dock, on boards and open tasks only; elsewhere it stays out of
sight until something opens in it. Opening something replaces what it shows, and closing
returns it to what it showed before. Opened content sits above the on-screen keyboard, and
Back or Escape first closes a list open inside it. Quick capture's card floats above the
dock rather than opening as a page. Desktop has no drawer. The rules are in
[ADR 0009](decisions/0009-the-drawer.md).

### Shell routes and remembered selection

- `/w/:workspaceId/p/:projectId?view=board` is a project. `view=backlog` opens its
  phone board with the backlog half open. Legacy `view=search` links open the search over
  the board (the bar on desktop, the drawer's search on a phone) and replace the view with
  `board`. The palette has no route of its own.
- `/w/:workspaceId/board` is the cross-project board for that workspace; `view=search`
  opens its search and replaces the view with `board`.
- `/w/:workspaceId/p/:projectId/settings` manages a project in pages laid out as the app's
  settings are: General (name, color and icon, saved as they change; the key; deleting
  the project), Statuses, Priorities and Tags, with Trash beside them. The rail's project
  menu and the phone board's title menu open it. The optional `section` search parameter
  keeps the chosen page across reloads and reconnects.
- `/w/:workspaceId/p/:projectId/trash` lists that project's independently trashed tasks,
  with inherited subtasks grouped under their parent. It is project settings' Trash page,
  and the rail's project menu opens it too.
- `/w/:workspaceId/trash` lists trashed projects and independently trashed tasks across the
  workspace. The workspace menu and desktop rail open it. Each trash offers restore,
  confirmed permanent removal and confirmed emptying of that scope.
- `/settings` redirects to `/settings/general`. Settings has Catch's pages: General
  (theme, the app icon on dev and preview builds, and board), Account (name, password, the server on Android, signing out), Update,
  and Backups for the server's admin at `/settings/admin/backups`. Throw adds MCP tokens
  at `/settings/mcp` for creating and revoking the account's workspace tokens, and Webhooks
  at `/settings/webhooks` for the account's outbound webhooks. Wide, the
  pages are listed beside the open one; on a phone the dock picks between them. Changing the
  password signs the account's other devices out; they keep their unsaved changes until
  the same account signs in again (ADR 0002).
- `/` restores the device's last workspace and project for the signed-in account.
  `/w/:workspaceId` restores that workspace's last project, otherwise its first project
  by position, otherwise the create-project prompt.

Workspace and project segments are UUIDs so names and future task prefixes can change
without breaking bookmarks. The open task is the `task` search parameter on either board,
holding the task's UUID rather than its identifier: a task created offline has no number
yet, and a project's key can change (ADR 0007). As with Catch's `note`, opening a task
pushes one history entry and switching between a task and its subtasks replaces it, so a
reload keeps the task open, browser Back closes it and a link opens it. A link to a task
that is gone says so once the board has loaded, and drops the parameter (2026-11-19). A direct project URL keeps its view on reload. Selecting a project
from navigation opens its board; the shell remembers the last project separately per
workspace. Projects append by position. Deleting a project requires confirmation and moves
it to the trash (see [Project](#project)), where it can be restored or removed for good.

The project board uses synced tasks, statuses and tags, with the backlog in the
drawer on a phone. Cards resolve their primary tag's root color with `taskTagColor` and
show its tags as badges; a partially synced tag tree leaves the card neutral. The drawer
(`components/Drawer`) carries the backlog, the closed tasks, board settings, and search and
capture, and becomes the move drawer while a card is held or selected; the board owns it
for now. Away from boards, the shell hosts that same Drawer component for settings, project settings
and trash forms. Workspace trash has no dock at rest; settings pages give it their page
picker. Tag management uses this host on phones and a
centred dialog on desktop. On a phone board the board owns the drawer, so the
shell's forms (new project, new or renamed workspace) open as a page of the board's drawer
rather than a sheet of their own (2026-11-19). The cross-project board adapts every project's tasks at the same
kind of boundary (`Board/WorkspaceBoard.tsx`). Both desktop boards search and filter through
the board's bar (`components/BoardSearch`); a phone's cross-project board uses the command
palette, with the same filters. Cards move on both boards by dragging, from the keyboard, by long press
and the move drawer on a phone, and by swiping to close.

## Platform and architecture

- Offline-first from the start on the web (installable PWA) and Android. Retrofitting
  offline would change how every write works.
- The stack follows Catch: a Vite and React client with TanStack DB, a Hono server with
  Better Auth and Drizzle on Postgres, Electric for sync behind an auth proxy, an outbox for
  queued writes and Capacitor for Android.
- Android uses `org.iloni.throwtasks` (Throw), `.preview` (Throw Preview) and `.dev`
  (Throw Dev), with separate device data and channel artwork. Bundled code works offline;
  stable/preview ask for the self-hosted server URL. Signed releases and web/Android update
  prompts follow [the release guide](releases.md).
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

1. **Search scope — settled (2026-10-17).** The board search is opened from: one project
   on a project board, every project on the cross-project board; see
   [Navigation](#navigation). On desktop boards it narrows the board in place rather than
   listing results (2026-11-22); see [Search, filters and sorting](#search-filters-and-sorting).
2. **Membership.** Whether a future member joins a whole workspace, a single project, or
   either. Tasks and the rows under them carry both a workspace and a project, so either
   answer can filter them without a migration.
3. **Single sign-on.** Accepting an external OIDC provider in both apps would give shared
   login without coupling them. Not decided.
4. **Deployment — settled (2026-11-18).** Each app ships its own image and Compose file; the
   combined example in `deploy/combined` runs either or both from one stack on one Postgres,
   with separate owners and databases (ADR 0010, [docs/deployment.md](deployment.md)).
5. **Refused changes — settled (2026-10-19).** A quiet notice inside the affected task,
   with no toast or app-wide notification. It appears from the synced log on every device
   for the user whose change was refused, stays until dismissed on that device, and links
   to the exact history entry. One notice summarizes multiple unapplied updates; dismissing
   it acknowledges those entries, and a later refusal brings it back. The entry says what
   was wanted, what stood and why. A refused description links to the existing draft
   recovery and review controls; another device can recover its document from the log.
   Dismissal does not delete the history or a recovery draft.
6. **Reordering the full-width backlog — settled (2026-11-22).** The gallery reads left to
   right, then down, in a band per priority, and the cards make room for a held card as it
   moves, as Catch's masonry gallery does. A caret with nothing moving until the drop was
   chosen first (2026-10-19), when a parting gap in a CSS grid read as too busy; Catch's
   springs and slot hysteresis replaced it. See [The project board](#the-project-board).
7. **The task view — settled for the first version (2026-11-18).** It holds what
   [The task view](#the-task-view) lists: the title and identifier, status, priority and
   tags, the description, subtasks, relations, and its comments and history, each under its
   own tab. More fields
   arrive with the out-of-scope items that need them, such as dates.
