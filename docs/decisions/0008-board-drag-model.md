# 0008: The board's drag model

Status: accepted (2026-10-13)

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

**At rest a column does not mark its zones.** Priorities are set apart by space alone.
Labels at rest are a setting, off by default. Edge marks, always-on dividers and a priority
glyph on every card were tried and added noise for something the order already says.

**Under a held card a column is Compact or Full, and the user chooses.**

- Compact: the card's zone takes the column. Every other priority folds into a rail, a
  labelled bar that stays in view above or below. Holding the card over a rail for about a
  fifth of a second gives the card that priority and opens that zone.
- Full: the column keeps its layout. Zones are labelled, other priorities dim, and the card
  takes the priority of the zone its centre is in.

Compact suits long columns, where the other priorities would otherwise be a scroll away.
Full never moves anything except the gap. Neither was clearly better for every column, so
both stay.

**A rail does not take a card it appeared under.** Rails arrive when the column folds,
sometimes directly beneath a card that is not moving. A rail starts to count only once the
column has finished folding and the card has been somewhere else in that column. Without
this, lifting a card could change its priority.

**A rail needs a dwell; reduced motion removes it.** The dwell separates passing over a rail
from choosing it, and the rail shows the dwell filling. With reduced motion there is nothing
to show, so the rail takes the card at once.

**Placing and sending are different drops.** A card dropped in a column is placed. A card
dropped on a status (a dropzone in the backlog or closed rail, a status in the phone dock)
is sent: it keeps its priority and lands at the top of that priority. Sending is how a card
reaches a status that shows no cards, and the held card shrinks to a token over such a
target to say so.

**Several held cards are sent, not placed.** Each keeps its own priority, so a column takes
the group as a whole and shows no gap.

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

**Every move has a keyboard equivalent.** A card is picked up, carried with the arrow keys
across priorities and columns, and set down or put back. Each step is announced.

## Consequences

- A move is one write carrying the status, priority and position, which is what
  `docs/data-model.md` already expects of a position.
- The engine depends on the board's markup: a component that drops a `data-` attribute
  silently stops being a target. The attributes are listed at the top of `drag.ts`.
- Reading the page every frame costs a layout per frame while a card is held. It is cheap
  for the columns seen so far. A virtualised column would have no element to measure for a
  card that is scrolled out, so long columns need a different answer than virtualisation,
  or the engine needs positions from data for the rows that are not rendered.
- Rows that arrive from sync while a card is held reorder the column under it. Reading the
  live page tolerates that, but the gap can jump. The real board has to decide whether a
  column holds incoming changes until the drop.
- Two settings (zone labels, Compact or Full) exist because of this model and are part of
  the settings page.
- The full-width backlog gallery cannot be reordered yet: a drop position in a masonry
  layout is not designed (spec, open questions).
