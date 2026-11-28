/**
 * The desktop task's side column, as Catch's split view gives a note's links, files and tags
 * one: a fixed-width column beside the card for the task's extras (its tags and subtasks, and
 * later its link previews and media), which narrower panes keep inline below the text.
 */

/** The column's own width (`w-64`), as in Catch. */
export const COLUMN_WIDTH = 256;
/** Between the card and the column. */
export const COLUMN_GAP = 12;

/**
 * From this pane width the extras get a column. Catch waits for 700 px, but Throw's pane
 * stops at 62% of the board beside the navigation: about 640 px on a 1280 px window, and
 * under 700 px on most laptops. At 620 px the card keeps 352 px beside the column, more than
 * the narrowest pane (340 px). The pane opens at 440 px, so the column waits until it is
 * widened for.
 */
export const COLUMN_MIN = 620;

export function columnFits(paneWidth: number | null) {
  return paneWidth !== null && paneWidth >= COLUMN_MIN;
}

/**
 * How far the column is open, from how far the pane's layout has moved to the side (`layout`)
 * and how far the extras have arrived (`shown`), each from 0 to 1.
 */
export function columnProgress(layout: number, shown: number) {
  return layout * shown;
}

/** The space the card leaves for the column, gap included. */
export function columnSpace(progress: number) {
  return (COLUMN_WIDTH + COLUMN_GAP) * progress;
}

/**
 * The column fades in only once the card has made room for most of it, so its content never
 * shows squeezed into a sliver. Opacity maps 0 → 0.3 → 1 to 0 → 0 → 1, as Catch's does.
 */
export function columnOpacity(progress: number) {
  return progress <= 0.3 ? 0 : (progress - 0.3) / 0.7;
}

/**
 * How much of a folding inline copy is drawn at a given amount: its natural height, or a
 * share of its measured one while it folds.
 */
export function foldHeight(amount: number, measured: number): number | 'auto' {
  return amount >= 1 ? 'auto' : Math.max(0, measured * amount);
}

/**
 * From this pane width the task is a workspace (ADR 0012): its comments and history leave the
 * card for a pane of their own, which scrolls on its own beside the card and the column, so
 * the description and the conversation can be read side by side. An expanded pane reaches it
 * on most monitors (a 1366 px laptop and up); a split pane only beside a very wide board.
 * At this width the card keeps 560 px beside an activity pane and the column.
 */
export const WORKSPACE_MIN = 1200;
/** The activity pane takes this share of the width, between its narrowest and widest. */
const ACTIVITY_SHARE = 0.3;
export const ACTIVITY_MIN = 360;
export const ACTIVITY_MAX = 560;
/** Between the card (or the column beside it) and the activity pane. */
export const ACTIVITY_GAP = 12;
/**
 * The workspace card's widest: a comfortable measure for the title and description. Past it,
 * the workspace stops growing and stands centred, rather than stretching lines across a
 * monitor.
 */
export const CARD_MAX = 840;

export function workspaceFits(paneWidth: number | null) {
  return paneWidth !== null && paneWidth >= WORKSPACE_MIN;
}

/** The activity pane's own width in a workspace this wide. */
export function activityWidth(paneWidth: number) {
  return Math.round(Math.min(ACTIVITY_MAX, Math.max(ACTIVITY_MIN, paneWidth * ACTIVITY_SHARE)));
}

/** The space the card leaves for the activity pane, gap included, as it opens. */
export function activitySpace(progress: number, width: number) {
  return (width + ACTIVITY_GAP) * progress;
}

/**
 * The widest the task's content gets: none until the workspace layout starts, then the card's
 * measure with whatever stands beside it. The cap starts a pane's width past that, so it only
 * comes into play as the layout settles, and continuously: the content never jumps to it.
 */
export function workspaceMaxWidth({
  progress,
  paneWidth,
  beside,
}: {
  progress: number;
  paneWidth: number;
  /** The activity pane's and column's space at this point, gaps included. */
  beside: number;
}): number | 'none' {
  if (progress <= 0) return 'none';
  return CARD_MAX + beside + (1 - progress) * paneWidth;
}
