import { settingsSectionSchema } from './projectSettings';
import { SETTINGS_TABS } from './settings';

/**
 * The view transition types a navigation can take (styles.css draws them):
 * - `forward` / `back` slide the page a short way in the direction of travel, as Catch's do;
 * - `fade` cross-fades one board into another when the project or workspace changes;
 * - `enter` lets a page with no place in an order rise softly into view;
 * - `inner` changes only the open page beside a settings list that stays put.
 *
 * On a phone, `docked` joins one of them when both pages show the dock, which stays live
 * through the transition and blurs the pages moving under it.
 */
export type PageTransition = 'forward' | 'back' | 'fade' | 'enter' | 'inner';
type Transition = [PageTransition] | [PageTransition, 'docked'];

type Location = { pathname: string; search: unknown };

/**
 * A page as transitions see it. Settings pages sit in a frame (the app's or a project's), in
 * the order their list shows them. Where each kind sits left to right: boards, then a
 * project's settings, then the app's.
 */
type Page =
  | { kind: 'board'; key: string; order: 0 }
  | { kind: 'settings'; key: string; frame: string; order: number }
  | { kind: 'other'; key: string };

const BOARD = /^\/w\/([^/]+)\/(?:p\/([^/]+)|board)$/;
const PROJECT_PAGE = /^\/w\/[^/]+\/p\/([^/]+)\/(settings|trash)$/;
const WORKSPACE_TRASH = /^\/w\/([^/]+)\/trash$/;
const PROJECT_SECTIONS = settingsSectionSchema.options;

function sectionOf(search: unknown) {
  const section =
    typeof search === 'object' && search !== null && 'section' in search
      ? settingsSectionSchema.safeParse(search.section)
      : null;
  return section?.success ? section.data : 'general';
}

/** The page at a location, or null for one that only redirects (or is not in the app). */
export function pageAt({ pathname, search }: Location): Page | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const board = BOARD.exec(path);
  if (board) return { kind: 'board', key: board[2] ? `p:${board[2]}` : `w:${board[1]}`, order: 0 };
  const project = PROJECT_PAGE.exec(path);
  if (project) {
    const index =
      project[2] === 'trash'
        ? PROJECT_SECTIONS.length
        : PROJECT_SECTIONS.indexOf(sectionOf(search));
    return {
      kind: 'settings',
      key: `${project[1]}:${index}`,
      frame: `project:${project[1]}`,
      order: 1 + index / 10,
    };
  }
  const trash = WORKSPACE_TRASH.exec(path);
  if (trash) return { kind: 'other', key: `trash:${trash[1]}` };
  const tab = SETTINGS_TABS.findIndex((item) => item.path === path);
  if (tab >= 0) return { kind: 'settings', key: path, frame: 'app', order: 3 + tab / 10 };
  return null;
}

/**
 * The view transition for a navigation, or false for none. Opening a task, the backlog or a
 * view changes only the search params of the same page and has its own motion. A redirect
 * (`/`, a workspace's first project) has nothing to show yet, so it changes in place.
 *
 * `wide` is the desktop layout, where settings list their pages beside the open one and
 * there is no dock.
 */
export function pageTransition(
  from: Location | undefined,
  to: Location,
  wide: boolean,
): Transition | false {
  const before = from && pageAt(from);
  const after = pageAt(to);
  if (!before || !after || before.key === after.key) return false;
  // Boards and settings pages have a dock on a phone; the workspace trash has none.
  if (before.kind === 'other' || after.kind === 'other') return ['enter'];
  const type = pageBetween(before, after, wide);
  return wide ? [type] : [type, 'docked'];
}

type OrderedPage = Exclude<Page, { kind: 'other' }>;

function pageBetween(before: OrderedPage, after: OrderedPage, wide: boolean): PageTransition {
  if (before.kind === 'board' && after.kind === 'board') return 'fade';
  if (before.kind === 'settings' && after.kind === 'settings') {
    // Switching from one project's settings to another's replaces the project group and has no order.
    if (before.frame !== after.frame && before.frame !== 'app' && after.frame !== 'app')
      return 'enter';
    // Side by side, the unified settings list stays put while only the open page changes.
    if (wide) return 'inner';
  }
  return after.order > before.order ? 'forward' : 'back';
}

function transitionIs(types: string) {
  try {
    return document.documentElement.matches(`:active-view-transition-type(${types})`);
  } catch {
    // An engine without transition types runs no page transitions (main.tsx).
    return false;
  }
}

/**
 * Whether a page transition is moving the page as a whole, so content arriving with it
 * should not make its own entry on top. A cross-fade leaves the page still, and its content
 * enters as it would on a cold start.
 */
export function pageMoving() {
  return transitionIs('forward, back, enter, inner');
}

/**
 * Whether a board is arriving through a cross-fade. Its content settles in every time, not
 * only on its first visit, so every switch between boards reads alike.
 */
export function boardArriving() {
  return transitionIs('fade');
}

/**
 * Notes where the page column starts, so the moving page is clipped beside the desktop rail
 * instead of sliding under its glass. Call just before a transition captures the old page.
 */
export function measurePageInset() {
  const rail = document.querySelector('[data-rail]');
  document.documentElement.style.setProperty(
    '--page-inset',
    `${rail ? Math.round(rail.getBoundingClientRect().right) : 0}px`,
  );
}
