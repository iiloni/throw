# 0013: Page motion

Status: accepted (2026-11-20); board switch revised 2026-11-24

## Context

Every route change swapped the page in one frame: a project switch, opening settings or the
trash, and a cold start all snapped their content in. The spec makes motion first-class, and
Catch already solved this (its ADR 0003, "Page transitions" and the content entry). Throw
ports that approach and adapts it to a shell that also has a desktop rail, boards that fill
the window, and settings frames that list their pages beside the open one.

## Decisions

**Page transitions use the View Transitions API with transition types**, set once on the
router (`defaultViewTransition` in `main.tsx`), which asks `pageTransition` in
`lib/pageTransition.ts` for each navigation. It animates snapshots, so no transform lands on
the page and fixed or sticky UI keeps working. As in Catch, an engine without
`:active-view-transition-type()` gets no page transitions at all, rather than the router's
default cross-fade of every navigation, opening tasks too. The types:

- **`fade`: one board to another** (a project or workspace switch from the rail, the phone
  menu or search). The owner chose a cross-fade here: boards are siblings, not an order. It
  is a true dissolve: both page images run the same 260 ms ease-out and add up
  (`mix-blend-mode: plus-lighter` in an isolated image pair, as the browser's own cross-fade
  does), so what the boards share (the header, column frames, the page colour) holds steady
  and only what differs changes. The first version faded the old board out over 180 ms and
  the new one in over 260 ms from 60 ms, Catch's slide timings; with plain alpha the two
  half-faded images let the background through, so every switch blinked the whole page
  toward the background colour, and on a phone the scrim of the closing switcher dimmed and
  washed out with it. The arriving board's content then settles in (below), so the switch
  reads as a deliberate arrival rather than a swap. Switching workspace goes straight to the
  board it would open, so it is one cross-fade rather than a fade to the workspace's loading
  page and another to its board.
- **`forward` / `back`: pages with an order** slide 20% in the direction of travel while
  cross-fading, over 500 ms on the emphasized curve, Catch's page slide. Left to right: boards,
  then a project's settings (General, Statuses, Priorities, Tags, then its trash), then the
  app's Settings pages in their listed order. Opening settings slides forward; Back to board
  slides back.
- **`enter`: a page with no place in that order** (the workspace trash, or one project's
  settings to another's) fades in with the content entry's 10 px settle.
- **`inner`: settings side by side.** On a desktop the unified page list (project, User and
  Admin sections) stays put while only the open page beside it changes (`data-settings-page` in
  `SettingsLayout`), entering as `enter` does. Switching from one project's settings directly to
  another project's uses `enter`, since the project section itself changes. Catch leaves these
  unanimated; Throw's owner asked that pages not snap.

Changes to the search params of the same page get no page transition: opening or closing a
task, the backlog and the view have their own motion (`TaskScreenSurface`, the drawer), which a
snapshot cross-fade would run on top of. Opening a task in another project from search skips
the cross-fade for the same reason, and lets the task's own opening carry the change.
Redirects (`/`, a workspace's first project) and first loads change in place.

**The rail and the phone's dock stay live and still.** Each gets a `view-transition-name`
(`rail`, `dock`) only while a transition runs, with no animation, and the outgoing copy is
hidden once the incoming live one is there. A named element is a backdrop root, so a permanent
name would stop their glass from blurring the page behind. A sunk drawer (`data-sunk`) is out
of sight and goes with the page. A dock that only exists on one side (the trash has none at
rest) fades with the page. The moving page is clipped where the page column starts
(`--page-inset`, measured from the rail as the transition begins), so it never slides under
the rail's glass.

**Content enters once per document** (`useEntryMotion` in `lib/entryMotion.ts`, Catch's hook):
a 10 px settle and fade over 420 ms (`curves.enter`), run with `animateSteady` so startup work
cannot skip ahead through it, staggered in 20 ms steps capped at 120 ms. Board cards arrive in
a diagonal wave, across the columns and down each one; desktop column headers follow their
column; settings sections stagger down the page; the trash list and empty states enter whole.
An entry is keyed by the element's identity, so it never replays: not on a sync update, a
reconnect's full snapshot (which `steadyRows` already holds), a card moving column or a
remounted route. The one exception is a board switched to: content that mounts under a
`fade` (`boardArriving`) enters every time, not only on its first visit. Before, only a board
seen for the first time had its cards settle in, and every later switch to it was a bare
cross-fade that read as no transition at all. A card that is held (ADR 0008) or that a task is opening from or landing in
skips its entry, so the drag engine and the task morph measure it at rest. Content that mounts
while a page transition moves the whole page (`forward`, `back`, `enter`, `inner`) shows at
once, since the page's motion already carries it. A cross-fade leaves the page still, so the
arriving board enters its cards inside it, as on a cold start.

**Android cold starts** keep the native splash over the WebView until the first route has
drawn. Boards and other routes that read synced data wait for their local SQLite rows to be
published. Login and server setup release as soon as their page draws. The icon breathes in
its channel color and collapses as the background fades. Android's animator settings control
the motion. A three-second native timeout releases the splash if the page never signals.

**Reduced motion** turns every page transition into a 150 ms cross-fade and shows content at
once.

## Consequences

- A new page joins `pageAt` with its place in the order, or takes `enter` by default when it
  has none. A new navigation that opens a task or other surface with its own motion passes
  `viewTransition: false`.
- Something that must stay still across pages, as the rail and the dock do, takes the same
  live, unanimated treatment in `styles.css`.
- Content that should not enter (a surface with its own motion) passes `skip` to
  `useEntryMotion`.
- Firefox runs page transitions only where it supports transition types (Firefox 155 does,
  `plus-lighter` included); older versions get the content entries alone. Its screenshot API
  can omit an active view transition, so verify painted frames with a display recording
  (`docs/ci.md`). Under Xvfb's software rendering, Firefox paints only the
  `::view-transition` background for the first one or two frames of every page transition
  before the snapshots appear; CSS cannot hold those frames, so it remains a known
  limitation.
