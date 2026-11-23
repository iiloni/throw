# 0008: The board's drag model

Status: accepted (2026-10-13); amended 2026-10-19 when the project board was wired to task
actions, 2026-11-19 when the board learned to wait for a lifted card to move, 2026-11-22
when desktop columns learned to fold, and 2026-11-23 when mobile swipe-to-close on board
cards was removed

## Context

A column is sorted by priority and then by manual order, so every drop into a column has to
answer two questions at once: which priority, and where within it. Most boards answer only
the second and leave priority to a menu.

The spec asked for the held card's priority zone to stretch while the other priorities stay
reachable. That means the column changes shape under the card: zones fold, rails appear, a
gap opens and closes. A clickable prototype on mock data (`/prototype/board`, development
builds only) was used to find a model that stays predictable while that happens.

## Decisions

**A drop sets status, priority and position together.** Placing a card is one move. There
is no separate step for priority.

**At rest a column does not mark its zones.** Cards of every priority are spaced alike, and
the order alone carries the priority. Labels at rest are a setting, off by default. Edge
marks, always-on dividers, a wider space between priorities and a priority glyph on every
card were tried and added noise for something the order already says.

**Under a held card a column is Compact or Full, and the user chooses.**

- Compact: the card's zone takes the column. Every other priority folds into a rail, a
  labelled bar that stays in view above or below. Holding the card over a rail for about a
  fifth of a second gives the card that priority and opens that zone.
- Full: the column keeps its layout. Zones are labelled, other priorities dim, and the card
  takes the priority of the zone its centre is in.

Compact suits long columns, where the other priorities would otherwise be a scroll away.
Full never moves anything except the gap. Neither was clearly better for every column, so
both stay.

**The board makes way for a card only once it moves.** Lifting a card changes nothing around
it: the copy rises where the card was, with the usual lift and haptic, and the card's own
place stays open as a gap of its full height, subtasks and all. The board makes way only when
the card has gone 24 px (32 px under a finger) from where it lifted, or has left the column or
status it was in, whichever comes first. Then the column folds or labels its zones, the dropzones and the
phone's peeks and move drawer appear, the phone's page draws in, edge scrolling starts and an
open card folds its subtasks, all on the transitions they already had. Every one of those
used to happen on the frame the card lifted, so the cards around it jumped before the person
had said where it was going. 24 px is about half the shortest card, the least that could
change its place in a column. It counts from the lift rather than the press, so the slop a
card took to lift is not spent from it, and a finger, which rests less still than a mouse,
gets more. A card dropped before it moves goes back as it was and writes nothing; its subtasks
stay open. Several held cards stay in their places, faded, until they move; then their
column closes up around them as it folds a zone. A keyboard carry never restructures the
column, so it has nothing to wait for.

**A card keeps its place while the board makes way around it.** As a column folds its zones
or labels them, and as the card folds its subtasks, the cards slide under a card that has not
moved, which would carry its place to a neighbour's other side. Testing on a tablet found most
short lifts landed one place off for this reason. So the card keeps the place it lifted from
until it has gone twice the make-way distance from the lift, takes another priority, or leaves
the column; then its place follows it as usual. Counting from the lift rather than from where
the board made way places a quick move that is already far off by the next frame where it is. This is the rule below
for rails, applied to places.

**A rail does not take a card it appeared under.** Rails arrive when the column folds,
sometimes directly beneath a card that is not moving. A rail starts to count only once the
column has finished folding and the card has been somewhere else in that column. Without
this, lifting a card could change its priority. The fold starts when the card moves, so
that is where the wait starts too, not at the lift.

**A rail needs a dwell; reduced motion removes it.** The dwell separates passing over a rail
from choosing it, and the rail shows the dwell filling. With reduced motion there is nothing
to show, so the rail takes the card at once.

**Placing and sending are different drops.** A card dropped in a column is placed. A card
dropped on a status (a dropzone in the backlog or closed rail, the phone's move drawer or
done pocket) is sent: it keeps its priority and lands at the top of that priority. Sending
is how a card reaches a status that shows no cards, and the held card shrinks to a token
over such a target to say so.

**A folded column is a dropzone for its status, and stays folded.** A desktop column folds to
a strip, as Catch's deck does, and shows no cards, so a card dropped on it is sent: it keeps
its priority and lands at the top of that priority, as from a rail's dropzone, and the copy
shrinks into the strip. On the workspace board the strip is the category's, so each card goes
to its own project's default status there. Opening the strip when a card dwelt over it was
considered and rejected: the column would widen under the pointer and push the columns beside
it along while a card is held, which is what the board avoids everywhere else (a card keeps
its place while the board makes way, and the rails turn into dropzones in place). A strip
never changes width or opens during a drag; to place a card among a folded column's cards,
open the column first. A keyboard carry is different: it moves one status at a time and has
no pointer to keep steady, so carrying a card into a folded column opens it, as Catch's deck
opens a column a keyboard selection lands in, and the card is placed there as in any column.
Opening a task whose card is in a folded column (from search, a link or `?task=`) opens the
column too, so the card is there to show the open task and to take focus back.

**Several held cards are sent, not placed.** Each keeps its own priority, so a column takes
the group as a whole and shows no gap.

**A sorted column takes sends only (2026-11-22).** A temporary sort by size, date added or
last update (spec, "Search, filters and sorting") shows a column out of its manual order, so no
slot in it means a position: a neighbour above may sit lower in the stored order. A sorted list is
marked `data-drop-send`, and the engine answers it with its status, so a drop there sends the
card, keeping its priority, and a drop in the card's own column writes nothing. The column
shows no gap, the lifted card stays faded where it was, and the keyboard's up and down
announce the sort instead of moving the card. Filtering alone keeps placement: the visible
neighbours are still in order, so a position between them is valid.

**The closed zone takes sends only.** It is ordered by when tasks were closed. The backlog
gallery mixes statuses, so only a card that came from the backlog can be placed in it; a
card from elsewhere is sent to one of its statuses.

**The rails do not move the board during a drag.** The backlog and closed rails turn into
dropzones at the place they already occupy. Widening them would slide the columns out from
under the held card, and floating them over the board hid the last column.

**On touch, a long press selects and movement after it drags.** A press that moves before
it completes is a scroll. A card dragged this way alone is not left selected.

**The engine is our own, on pointer events, and reads its targets from the live page.**
Every frame it asks what is under the pointer and measures the slots in that column, using
data attributes the components set. Drag libraries measure droppable rectangles when a drag
starts or when a list reorders, and assume the list keeps its shape; here the shape is the
interaction. The engine is one module with no dependency.

**A card's place is worked out as if no gap were open.** The gap that shows where the card
will land pushes its neighbours. Comparing against where the neighbours would be without it
stops the gap from pushing a card back under the pointer and flipping the answer every
frame.

**The lifted card stays mounted.** A touch keeps sending its events to the element it
started on. Removing that element ends the drag on a phone, so the card is hidden in place
and a copy follows the finger.

**The held copy takes the width of the list it is over.** Cards in the backlog and in a
column differ in width. The copy springs to the new width as it crosses, keeps the same
point under the finger, and the gap it will fill follows its re-wrapped height. It lands
already the right size instead of snapping, the way a Catch card springs to a new column
width.

**Every move has a keyboard equivalent.** A card is picked up, carried with the arrow keys
across priorities and columns, and set down or put back. Each step is announced. Carrying
writes nothing: each step is a preview over the synced board, and setting the card down is
one write for where it ended up. Putting it back writes nothing.

**Sync waits while a card is held.** Rows that arrive while a pointer holds a card are kept
aside and applied at the drop, so the column, its gap and the place under the pointer do not
change under the card. The drop is worked out against the board that was shown, and the
position applies only in the status, priority and parent it was computed for (ADR 0005), so
a column that changed meanwhile still gets a valid position. A keyboard carry keeps its
preview over incoming rows instead, since it has no pointer to hold steady.

**A card another device moved while it was held is not moved.** At the drop, a held card
whose status, priority or parent changed elsewhere, or that was removed, is left where the
other device put it, and the board announces it. A reorder elsewhere does not count: the move
still means the same thing. The same check applies to setting down a keyboard carry.

**A move shows before it syncs.** The board applies a placement locally and then queues it
through `moveTask` or `sendTask`, so the landing card finds its new place at once and never
flashes back into the column it left. A move that cannot be queued (its status or project
was deleted meanwhile) reverts to the synced board. A move the server refuses is replaced by
the server's row when sync brings it back.

**The backlog gallery makes room as Catch's does.** The gallery reads left to right, then
down, in a band per priority. It is Catch's masonry (`lib/masonry.ts`): each card goes to the
top of the shortest column. A list marked `data-layout="masonry"` describes its columns, bands
and the heights of the cards a held one is placed among in a `data-masonry` element, and the
engine places the card at the slot nearest it in the layout those cards would have with it
there (Catch's `dropIndex`, with its hysteresis), so cards still springing to their places do
not change the answer. The gallery shows that layout as the card moves: a gap where it would
land and the others springing aside, as Catch's gallery does, at one column in the rail or
many across the board. The column count is frozen while a card is held. Its priorities show
as labels while a card is placed, as a column does in Full; the rail does not fold them into
rails.

This replaces a caret in the gutter with nothing moving until the drop, chosen on
2026-10-19 when a parting gap in a CSS grid read as too busy. With Catch's springs and its
slot hysteresis, the owner chose live reflow on 2026-11-22.

**On a phone, horizontal swipes over cards turn between columns (2026-11-23).** Board cards
previously swiped right to close into the default done status, with `touch-action: pan-y
pan-right` handing rightward swipes to the card gesture. In practice, swiping horizontally
between active columns triggered swipe-to-close accidentally far too easily. Cards no longer
intercept horizontal swipes, so swipes starting anywhere on a card turn the pager cleanly in
both directions; closing a card uses long-press drag (including to the done pocket), the move
drawer, or the task dock's Close action.

## Consequences

- A move is one write carrying the status, priority and position, which is what
  `docs/data-model.md` already expects of a position.
- The engine depends on the board's markup: a component that drops a `data-` attribute
  silently stops being a target. The attributes are listed at the top of `drag.ts`.
- Reading the page every frame costs a layout per frame while a card is held. It is cheap
  for the columns seen so far. A virtualised column would have no element to measure for a
  card that is scrolled out, so long columns need a different answer than virtualisation,
  or the engine needs positions from data for the rows that are not rendered.
- Holding sync until a drop means a long hold shows slightly stale data. Moves elsewhere are
  never written over, so the cost is only how current the board looks while a card is held.
- Two settings (zone labels, Compact or Full) exist because of this model and are part of
  the settings page.
- The closed gallery is masonry too, newest first across the top row: closed work is ordered
  by time and is never placed.
