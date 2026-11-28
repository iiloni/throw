# 0009: The drawer

Status: accepted (2026-10-15), amended 2026-10-17 for quick capture's card, 2026-10-19
for the move drawer, 2026-11-23 for the project switcher and half-height pages,
2026-11-24 for pages closing into the dock and 2026-11-28 for the shell's own drawer

## Context

Catch treats its dock as a core part of the interface: one glass bar that every phone
screen shares. Throw's phone board grew four bottom surfaces instead of one. The backlog
tray, which is also the dock, and the closed sheet came from the board prototype. The move
drawer appears while a card is held. `BottomSheet` came from Catch for the shell's project
forms and was later used for the tag manager and board settings. Each had its own shape,
material, gestures, focus handling and Back handling. The closed sheet copied the tray's
geometry but not its glass. Board settings floated as an inset card with every corner
rounded, while the move drawer was a separate panel again. A popover tried before that ran
off the edge of the screen.

## Decisions

**A phone has one drawer.** It is a single glass surface along the bottom edge, edge to
edge with rounded top corners, and when fully raised its top sits just below the top safe
area. It is a core part of the interface, owned by the shell, not something each feature
draws. Features ask the drawer to show their content.

**Every sheet on a phone is the drawer.** The backlog, the closed tasks, board settings,
search and capture, the move targets, project create and edit, the tag manager and pickers
are all content the drawer shows. Nothing slides up over the drawer as a second sheet.
`BottomSheet` is not used on phones.

**The collapsed drawer's header is the dock.** On a project board it holds the backlog's
handle, Search and the create button; the cross-project board has no backlog, so its dock
holds Search and the create button. While a task is open it holds that
task's actions, and while a new task is written above it, that task's controls. The dock appears only on boards and open tasks. Settings and an empty
workspace keep the title menu alone: there the drawer is out of sight until something opens
in it, and it goes away again when that closes.

**The drawer has three heights: collapsed, half and full.** It is pulled between them by
its header, and tapping the dock's handle opens or closes it. Content chooses the heights
it uses. The backlog uses all three. Board settings, search and forms open at full height
with a fixed header and their own scrolling. The closed tasks open at half height, as the
backlog does: a glance at what was just finished, with the dimmed board still in view
above (2026-11-23). Pulled up by their header they rise to full, and they come back to
half the same way; pulled down past half, or flung toward the dock, they close. A page that
asks for this (`half` on `DrawerPage`) keeps the end of its list clear of the part left
off screen, as the backlog does, and reopens at half each time. A short picker may rise
only as far as its content needs. An open task's drawer stays collapsed and does not move until one
of its panels is open.

**Opening something replaces what the drawer shows; it does not stack.** Closing it with
the close button, Back, Escape or a pull down returns the drawer to what it showed before,
at the height it was. Board settings opened over the half-open backlog comes back to the
half-open backlog. An open task's panels keep its dock as their header: the dock's buttons
act as tabs, switching the panel beneath them, and tapping the open one closes it. While a
panel closes, it stays in place until the drawer has settled. So does any page closing down
into the dock (2026-11-24): what the drawer showed before is mounted once it is at rest and out
of sight, not in the frames it needs to start sliding. The drawer slides by painted frames, so
a frame held up by that work delays the slide rather than skipping most of it.

**Holding a card turns the drawer into the move drawer.** Lifting a card sinks the
drawer's content out of the way, and its header becomes the move target. Bringing the card
onto it opens the grid of status dropzones (ADR 0008). The exception is content that
reorders its own cards in place: the backlog at full height keeps its place while it is
groomed.

**The move drawer is the drawer's `move` content (2026-10-19).** A feature passes what to
show as `move`; while it is set, the header shows it in place of the dock or page title and
the drawer rests just tall enough for it, following its height as the grid opens and
closes. The drawer's content fades out but stays mounted, because a touch ends if the element
it began on is removed, and a card lifted from the half-open backlog began there. Pulls are
off while it shows. The whole visible drawer is the target that opens the grid
(`data-drop-expand`), safe area included. While the backlog is groomed at full height, the
same content floats as a glass panel at the drawer's foot instead, and the backlog keeps its
place. With cards selected and no finger down, the move drawer shows open with a count and
Clear, and tapping a status sends the selection; Back clears the selection first. An open
task, a page or capture take precedence: the board does not pass `move` while one shows.
The move target and the dock trade places as the board's dock and a task's do, and its views
(the hint, the grid and a selection's pickers) fade across one another on the drawer's own
spring, as its pages do (2026-11-27). A leaving view or target keeps what it last showed and
is inert, so a quick second tap or a held card never lands on it. Cards selected from the
open backlog or the closed tasks' half page leave that list where it is: the selection's
controls float at the foot of the screen as they do over the groomed backlog, so more cards
can be chosen from the same list, and the glass springs to each picker's height. Only a
collapsed drawer takes the selection into its header.

**Content over the board is modal; the backlog is not.** At half height the backlog is a
supply of work with the board usable above it. Anything else the drawer shows traps focus,
takes Escape and Back, and returns focus to whatever opened it. On opening, focus goes to
the drawer itself rather than its first control: focusing the close button opened its
tooltip, and the tooltip took the first Escape. Content built around a field (search, the
capture card) names that field, and the drawer focuses it instead, so the keyboard rises as
it opens.

**Quick capture is a card above the dock (2026-10-17).** As in Catch's quick note, the
create button opens a card holding the new task's title, floating above the collapsed
drawer and riding above the keyboard with the dock. The dock holds the new task's status,
priority and tags, and the create button becomes the card's close. Those controls open their
pickers as pages under the dock, as an open task's do, and the card rides above them. The
card is the drawer's: it draws it, dims the board behind it, and closes it on Back, Escape
or a tap outside. It is not a second sheet; nothing else floats above the drawer.

**One material.** The drawer is `glass-thick` at every height and for every content. The
closed sheet's opaque background goes.

**Desktop has no drawer.** At 768 CSS pixels and wider, the rail, the backlog and closed
rails and the split task pane stay as they are. Board settings opens as a panel from the
rail, sized to the window and scrolling inside it so nothing is cut off. The shell's forms
and the tag manager are centred dialogs.

## Consequences

- One drawer component replaces the backlog tray's surface, the closed sheet, the move
  drawer and `BottomSheet` on phones. Its gestures, Back handling, keyboard insets and focus
  rules are written once.
- The board settings and closed tasks content, and the move targets, become drawer content.
  Held and selected cards use the drawer's `move` content; the separate move panel is gone.
- The `move` prop was added without changing the drawer's other props or behaviour. The
  older `sunk` prop is no longer used by the board; it stays until parallel work on the
  drawer has landed, and can then be removed.
- Search, the task view's actions and pickers, and the tag manager render into the drawer
  on phones, not into their own sheets or full-screen overlays. Capture is the drawer's card
  and dock.
- The prototype shares the Board components, so it gets the drawer too.
- **Half-height pages (2026-11-23).** A page may open at half height and be pulled between
  half and full; it stays modal at both, with the scrim, focus, Escape and Back as any page
  has. Back and Escape close it from either height rather than lowering it first, since
  closing returns the drawer to what it showed before. Pages that fit their content and full
  pages are unchanged.
- **The project switcher is drawer content (2026-11-23).** On a phone the page title opens
  the shell's `ProjectSwitcher` as a page that fits its content, in the shell's drawer: the
  workspace's projects as tinted tiles, a workspace row that opens a
  Workspaces view (Back returns to the projects), and settings and the trash as a footer.
  Pulling down from the top of a board opens the same page (`SwitcherPull`). The desktop
  rail keeps its workspace menu.
- **Exception: app-level prompts (2026-11-18).** The update prompts (`AppUpdatePrompt`,
  `WebUpdatePrompt`) stay centred dialogs at every width. They can appear over any screen,
  including a board whose drawer is open with its own content, and must not replace that
  content or wait for it to close. Settings' own confirmations, such as restoring or
  deleting a server backup, use `ManagementSurface` like other management forms.
- **The shell owns the drawer (2026-11-28).** The drawer was one component but four mounts:
  the project board, the cross-project board and the dependency graph each drew their own, and
  `ManagementSurface` drew a fourth away from boards, lending its pages to a board's drawer
  through a store while one was open. Every screen change unmounted the drawer and mounted
  another, so its glass, its height and a page closing over the change started again from
  nothing. Now `DrawerHost` in the app shell draws the only one, and it stays mounted as
  screens change, as Catch's dock does. Screens hand it what to show with `useDrawerSlot`
  (the drawer's own props: dock, backlog, pages, the capture card, the move target), the
  newest screen's showing. Management forms and the project switcher lend it a page over any
  screen with `useLentDrawerPage`, which makes the rest of the app inert behind it, boards
  included; closing the newest lent page shows any opened before it again. The prototype mounts
  a host of its own.
  - A dock taking another's place, from a board to its graph or to settings, fades across it
    on the drawer's spring (`face`); another project's board keeps it still. A screen that
    arrives or leaves with nothing in sight, such as the trash, places the drawer at once
    rather than sliding it, so the drawer comes and goes with its page as each screen's own
    did; between two docks the drawer moves to the new one's height. A page open as the screen
    changes closes into the new dock as any page does.
  - The drawer's content is drawn in the shell, outside the screen's tree, so it reads the
    shell's contexts. A board boundary carries its own to it (`BoardDrawerBridge`), and a
    context it adds for drawer content must join that bridge. The board stops painting under a
    drawer page by a mark of its own (`data-board-cover`), since the drawer is no longer its
    sibling.
