# 0012: The task's side column

Status: accepted (2026-11-19)

## Context

The desktop task pane stacked everything in its card: title, tags, description, subtasks,
then comments and history. A wide pane spent its width on long description lines while the
subtasks sat a scroll away. Catch's split view gives a wide note pane a column beside the
card for the note's tags, files and link previews, and keeps them below the text in a
narrower one. Throw's task pane already follows that split view (its toolbars, its card and
the dock below it), so its extras follow the same pattern.

## Decisions

**A wide desktop pane has a side column for the task's extras.** It is a fixed 256 px
(`w-64`) column, 12 px beside the card, with its own scroll area, and like the card it stops
above the dock. It holds the task's tags, then its subtasks with their slot to add one, then its relations
(2026-11-22). It is
the place for later extras such as link previews and media: each is one more block in
`TaskColumnFrame`'s children, in order, with its inline copy folding in the main column
(`Fold`). Comments and history stay in the main column, below the description; on narrower
panes and phones, relations live in a third **Links** tab beside Comments and History, which
animates smoothly in and out of `SegmentedTabs` on `springs.pane` as the pane crosses 620 px.

**The pane must be at least 620 px wide** (`COLUMN_MIN` in
`components/TaskDetails/taskColumn.ts`). Catch waits for 700 px (`SIDE_LINKS_MIN`), but
Throw's pane stops at 62% of the board beside the navigation. That is about 640 px on a
1280 px window, and under 700 px on most laptops, so Catch's value left the column out of
reach where a stacked pane was already plainly too wide. At 620 px the card keeps 352 px
beside the column, more than the narrowest pane (340 px). The pane opens at 440 px, so the
column waits until someone widens the pane for it. Narrower panes and phones (ADR 0009) keep
the stacked layout.

**It shows only when there is something in it.** A task's first tag, subtask or relation
springs it open and removing the last springs it shut. Relations are added from the dock,
so they have no inline slot. The card narrows or widens on the spring rather than
jumping. While it is shut, “Add subtask” stays inline below the description, so it can always
be reached. A subtask added there opens as a task of its own, and its parent shows the column
when Back returns there. A new extra goes straight to the open column rather than showing
inline first. The column stays mounted while it is shut, inert and hidden from assistive
technology, so the last removal can animate it shut.

**Both endpoint layouts are chosen before anything moves.** Two progress values drive it,
as Catch's do: `layout` (the pane's width has crossed the breakpoint) and `shown` (there are
extras). Their product opens the column. The card reserves the column's space on that spring
while the inline copies fold away from their measured height and fade. The column fades in
over the room being made, with opacity mapping 0 → 0.3 → 1 to 0 → 0 → 1. Its content keeps
its full width throughout. Dragging the split handle across the breakpoint springs `layout`
the same way, so nothing stretches and then snaps. The springs (`springs.pane`) advance by
painted frames (`animateSteadySpring`), start once the frame that changed the layout is
painted, and continue from their current value when reversed. Reduced motion changes the
layout immediately. Opening a task lays it out at once. Its extras spring only after its
tags and relations have loaded, so switching tasks, or going back to a parent, does not replay the
column's entry.

**One copy can be reached.** During a transition both copies are drawn. Only the
destination is interactive: the other is `inert` and `aria-hidden`, and at rest it is
unmounted. The column is a complementary landmark labeled “Task sidebar”. It follows the card
in the DOM, so focus moves from the card's content to the column, then to the dock below
both. Focus returning from a subtask lands on that subtask's card in whichever copy is live.

## Consequences

- Phone layouts and the prototype board are unchanged.
- Catch's “expand pane” button, which hides the board to give the pane its width, is a
  possible follow-up; it would drive `layout` from the expanded width as Catch's does.
