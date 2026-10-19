# Tags for later screens

The tag model and write rules are in [data-model.md](data-model.md#tag-tree), adapted from
Catch ADR 0016. The board shows primary tag colours and the task pane picks and lists a
task's tags (`TaskDetails/TaskPickers.tsx`). Project settings mounts `TagManager` in its Tags section.

## Data and actions

`@throw/shared` exports `Tag`, `TaskTag`, the request/row schemas, `tagPath`, `tagTree`,
`tagSubtreeIds`, `tagWriteIssue` and `taskTagColor`. Tree traversal is iterative and guards
incomplete or cyclic snapshots. `taskTagColor(task, projectTags)` returns a palette `Color`
or null; it follows the primary's root, including after a recolor or reparent. Boards can
call it from their own memoized view model; it has no React, collection or network dependency.

Always pass tags from the task's project. The helper also checks that scope defensively.

In `apps/web/src/lib`:

- `tags.ts`: `createTag(projectId, fields)` returns the new id; `updateTag(id, changes)` and
  `deleteTag(id)` manage the tree. Reparenting a root must include `color: null, icon: null`.
- `tasks.ts`: `createTask` accepts `primaryTagId` and `secondaryTagIds`; `updateTask` accepts
  `primaryTagId` with the other task fields. Both keep the existing conflict/replay behavior.
- `tags.ts`: `setPrimaryTag(taskId, tagId | null)` and
  `setSecondaryTag(taskId, tagId, present)` are the assignment actions. Secondary operations
  send task PATCH requests with their own stable change ids, never a replacement array.
- `collections.ts`: `useTags(projectId)` and `useTaskTags(taskId)` expose rows and
  `isLoading`; use `useAwaitingSync` when deciding whether to show a loading state offline.
  Both collections stay subscribed and persist even before a screen reads them.

All actions use `write()` and the outbox. Do not mutate collections from components.

## Components

- `TagBadge`: one chip, using the assigned tag's name and its root's appearance. Hover,
  keyboard focus or tapping reveals the full path. `interactive={false}` is available
  for surfaces that already own interaction.
- `TaskTags`: a wrapping primary-first list; takes `tags`, `primaryTagId` and
  `secondaryTagIds`. A tag assigned in both roles is shown once without changing data.
- `TagPicker`: a controlled, searchable tree with primary radio buttons, independent
  secondary checkboxes and a Clear primary action. Pass the same assignment props plus
  `onPrimaryChange` and `onSecondaryChange`; connect those to the actions above.
- `TagManager`: takes `projectId`, reads its real collection, and manages creation,
  rename, recolor, icon, move and whole-branch deletion through the settings drawer on phones
  and centred dialogs on desktop.
- `TagEditor` and `TagDeleteConfirm`: container-free editor and delete confirmation content,
  with no gestures or Back handling. `TagForm` currently hosts the editor in `BottomSheet`.
- `TagTree`: the underlying searchable/collapsible tree with a `renderTag(tag, path)`
  slot. Ported from Catch, including ancestry guides, reduced-motion-aware row transitions
  and deferred offscreen contents for large trees. Indentation is visually capped, not depth.

On a phone, picking is a page of the single drawer from
[ADR 0009](decisions/0009-the-drawer.md), which owns replacement/restoration, modality,
gestures, Back and focus. On desktop the task pane opens the picker as a panel of its own
controls, beside the status and priority pickers. Phone tag management uses the shell's
`ManagementSurface` host for the existing Drawer; on desktop it uses `BottomSheet`'s centred
dialog. `TagForm` remains a standalone workshop wrapper; production management mounts its
container-free `TagEditor` through that host.

The development-only `/prototype/tags` route demonstrates all pieces against real data.
Sign in first, then choose a project/task or create an example project. Its edits persist.
It supports the existing app theme and is guarded by `import.meta.env.DEV` like the board
prototype. Production tag management lives in project settings.
