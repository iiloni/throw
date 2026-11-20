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
 * From this pane width the extras get a column. The card keeps 432 px beside it, enough for
 * the title, a description's lines and the timeline's rows, as Catch keeps a note's. The
 * pane opens at 440 px, so the column waits until it is widened for.
 */
export const COLUMN_MIN = 700;

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
