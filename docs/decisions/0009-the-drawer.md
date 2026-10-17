# 0009: The drawer

Status: accepted (2026-10-15)

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

**The collapsed drawer's header is the dock.** On a project or cross-project board it holds
the backlog's handle, Search and the create button. While a task is open it holds that
task's actions. The dock appears only on boards and open tasks. Settings and an empty
workspace keep the title menu alone: there the drawer is out of sight until something opens
in it, and it goes away again when that closes.

**The drawer has three heights: collapsed, half and full.** It is pulled between them by
its header, and tapping the dock's handle opens or closes it. Content chooses the heights
it uses. The backlog uses all three. Board settings, the closed tasks, search and forms open
at full height with a fixed header and their own scrolling. A short picker may rise only as
far as its content needs. An open task's drawer stays collapsed and does not move until one
of its panels is open.

**Opening something replaces what the drawer shows; it does not stack.** Closing it with
the close button, Back, Escape or a pull down returns the drawer to what it showed before,
at the height it was. Board settings opened over the half-open backlog comes back to the
half-open backlog. An open task's panels keep its dock as their header: the dock's buttons
act as tabs, switching the panel beneath them, and tapping the open one closes it. While a
panel closes, it stays in place until the drawer has settled.

**Holding a card turns the drawer into the move drawer.** Lifting a card sinks the
drawer's content out of the way, and its header becomes the move target. Bringing the card
onto it opens the grid of status dropzones (ADR 0008). The exception is content that
reorders its own cards in place: the backlog at full height keeps its place while it is
groomed.

**Content over the board is modal; the backlog is not.** At half height the backlog is a
supply of work with the board usable above it. Anything else the drawer shows traps focus,
takes Escape and Back, and returns focus to whatever opened it. On opening, focus goes to
the drawer itself rather than its first control: focusing the close button opened its
tooltip, and the tooltip took the first Escape.

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
  The drag step wires held cards to the drawer's move state instead of a separate panel.
- Search and capture, the task view's actions and pickers, and the tag manager render into
  the drawer on phones, not into their own sheets or full-screen overlays.
- The prototype shares the Board components, so it gets the drawer too.
