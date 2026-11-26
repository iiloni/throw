import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project, Status, Tag, Task } from '@throw/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  projectBoardData,
  secondaryTagsByTask,
  workspaceBoardData,
} from '@/components/Board/selection';
import {
  board,
  collapseSearch,
  initialBoard,
  receiveBoard,
  update,
} from '@/components/Board/state';
import { TagTree } from '@/components/TagTree/TagTree';
import { COLLAPSED_TAGS_KEY } from '@/components/TagTree/useCollapsedTags';
import { BoardSearch, BoardSearchSidebar, searchSidebarOpen } from './BoardSearch';

const project: Project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Board',
  key: 'BRD',
  color: 'teal',
  icon: null,
  position: 'a0',
  priorityNames: ['', '', '', '', ''],
  deletedAt: null,
};
const statuses: Status[] = [
  {
    id: 'build',
    category: 'active',
    name: 'Build',
    projectId: project.id,
    workspaceId: project.workspaceId,
    position: 'a0',
    isDefault: true,
  },
];
let number = 0;
const task = (title: string, size: Task['size']): Task => ({
  id: title,
  projectId: project.id,
  workspaceId: project.workspaceId,
  number: ++number,
  title,
  description: null,
  descriptionVersion: null,
  statusId: 'build',
  priority: 3,
  size,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-14T12:00:00Z',
});

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  localStorage.removeItem(COLLAPSED_TAGS_KEY);
  board.set(initialBoard());
  receiveBoard(
    projectBoardData(
      project,
      statuses,
      [task('Weed beds', 2), task('Paint fence', 4)],
      [],
      secondaryTagsByTask([]),
    ),
    { rename: () => {}, place: () => true, send: () => true },
  );
  act(() => update({ searching: true }));
});

const field = () => screen.getByRole('searchbox', { name: 'Search tasks' });

describe('the board’s search bar', () => {
  it('narrows the board as words are typed and says how many cards are left', () => {
    render(<BoardSearch />);
    fireEvent.change(field(), { target: { value: 'weed' } });
    expect(board.get().filter.query).toBe('weed');
    expect(field()).toHaveAccessibleDescription('1 matching. Enter opens BRD-1');
  });

  it('opens the best match on Enter', () => {
    render(<BoardSearch />);
    fireEvent.change(field(), { target: { value: 'fence' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(board.get().openTaskId).toBe('Paint fence');
  });

  it('steps back on Escape: the panel, then what narrows the board, then the bar', () => {
    render(<BoardSearch />);
    const trigger = screen.getByRole('button', { name: 'Filter and sort' });
    fireEvent.click(trigger);
    expect(screen.getByRole('region', { name: 'Filters and sort' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Size' }));
    fireEvent.click(screen.getByRole('button', { name: /^Size S,/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(screen.getByRole('button', { name: 'Largest' }));
    expect(board.get()).toMatchObject({ filter: { sizes: [2] }, sort: 'size-desc' });
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent(
      /Largest first/,
    );

    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(board.get().filter.sizes).toEqual([2]);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(board.get()).toMatchObject({ filter: { sizes: [] }, sort: 'priority', searching: true });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(board.get().searching).toBe(false);
  });

  it('collapses the floating bar without clearing query, filters or sort, while Close clears them', () => {
    render(<BoardSearch />);
    fireEvent.change(field(), { target: { value: 'weed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Size' }));
    fireEvent.click(screen.getByRole('button', { name: /^Size S,/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));

    act(() => collapseSearch());
    expect(board.get()).toMatchObject({
      searching: false,
      sort: 'size-asc',
      filter: { query: 'weed', sizes: [2] },
    });

    act(() => update({ searching: true }));
    expect(field()).toHaveValue('weed');
    expect(screen.getByRole('button', { name: 'Filter and sort' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent(
      /Smallest first/,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(board.get()).toMatchObject({
      searching: false,
      sort: 'priority',
      filter: { query: '', sizes: [] },
    });
  });

  it('feathers the top and bottom edges of the docked sidebar scroller when overflowing', () => {
    const { container } = render(<BoardSearchSidebar />);
    const area = container.querySelector<HTMLElement>('[data-slot="scroll-area"][data-edges]');
    const viewport = area?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    expect(area).toBeInTheDocument();
    expect(viewport).toBeInTheDocument();
    if (!area || !viewport) return;

    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 500 });
    viewport.scrollTop = 0;
    fireEvent.scroll(viewport);
    expect(area).not.toHaveAttribute('data-more-top');
    expect(area).toHaveAttribute('data-more-bottom');

    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    expect(area).toHaveAttribute('data-more-top');
    expect(area).toHaveAttribute('data-more-bottom');

    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);
    expect(area).toHaveAttribute('data-more-top');
    expect(area).not.toHaveAttribute('data-more-bottom');
  });
});

const makeTag = (
  id: string,
  name: string,
  parentId: string | null = null,
  color: Tag['color'] = parentId ? null : 'teal',
): Tag => ({
  id,
  name,
  parentId,
  projectId: project.id,
  workspaceId: project.workspaceId,
  icon: null,
  color,
  position: 'a0',
});

describe('the docked search sidebar', () => {
  const tags: Tag[] = [
    makeTag('home', 'Home', null, 'teal'),
    makeTag('garden', 'Garden', 'home'),
    makeTag('work', 'Work', null, 'blue'),
  ];

  beforeEach(() => {
    receiveBoard(
      projectBoardData(
        project,
        statuses,
        [
          { ...task('Weed beds', 2), primaryTagId: 'garden' },
          { ...task('Paint fence', 4), primaryTagId: 'home' },
          { ...task('Write report', null), primaryTagId: 'work' },
          task('Tidy desk', null),
        ],
        tags,
        secondaryTagsByTask([]),
      ),
      { rename: () => {}, place: () => true, send: () => true },
    );
    act(() => update({ searching: true }));
  });

  it('shows inline Sort, Size and Tags sections directly without a popup filter button', () => {
    render(<BoardSearchSidebar />);
    expect(screen.queryByRole('button', { name: 'Filter and sort' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Filter type' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sort' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Size' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tags' })).toBeInTheDocument();

    const sortRegion = screen.getByRole('region', { name: 'Sort' });
    fireEvent.click(within(sortRegion).getByRole('button', { name: 'Size' }));
    fireEvent.click(within(sortRegion).getByRole('button', { name: 'Largest' }));

    const sizeRegion = screen.getByRole('region', { name: 'Size' });
    fireEvent.click(within(sizeRegion).getByRole('button', { name: /^Size S,/ }));
    fireEvent.click(within(sizeRegion).getByRole('button', { name: /^Unsized,/ }));

    const tagsRegion = screen.getByRole('region', { name: 'Tags' });
    fireEvent.click(within(tagsRegion).getByRole('button', { name: /^Home \/ Garden,/ }));
    fireEvent.click(within(tagsRegion).getByRole('button', { name: /^Work,/ }));
    fireEvent.click(within(tagsRegion).getByRole('button', { name: 'All tags' }));

    expect(board.get()).toMatchObject({
      sort: 'size-desc',
      filter: {
        sizes: [2],
        unsized: true,
        tagIds: ['garden', 'work'],
        match: 'all',
      },
    });
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent(
      /Largest first/,
    );
  });

  it('clears filters and focuses the search input on Escape, then dismisses on the next Escape', () => {
    render(<BoardSearchSidebar />);
    const sortRegion = screen.getByRole('region', { name: 'Sort' });
    fireEvent.click(within(sortRegion).getByRole('button', { name: 'Size' }));
    const largest = within(sortRegion).getByRole('button', { name: 'Largest' });
    largest.focus();
    fireEvent.click(largest);
    expect(board.get().sort).toBe('size-desc');

    // Pressing Escape while focus is on the conditional direction button clears filters and moves focus to the search input.
    fireEvent.keyDown(largest, { key: 'Escape' });
    expect(board.get()).toMatchObject({ sort: 'priority', searching: true });
    expect(field()).toHaveFocus();

    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(board.get().searching).toBe(false);
  });

  it('remembers collapsed tag branches across reopening and shares them with tag pickers', () => {
    const sidebar = render(<BoardSearchSidebar />);
    const tagsRegion = () => screen.getByRole('region', { name: 'Tags' });
    fireEvent.click(within(tagsRegion()).getByRole('button', { name: 'Collapse Home' }));
    expect(within(tagsRegion()).queryByRole('button', { name: /^Home \/ Garden,/ })).toBeNull();
    sidebar.unmount();

    render(<BoardSearchSidebar />);
    expect(within(tagsRegion()).getByRole('button', { name: 'Expand Home' })).toBeInTheDocument();
    expect(within(tagsRegion()).queryByRole('button', { name: /^Home \/ Garden,/ })).toBeNull();

    render(<TagTree tags={tags} renderTag={(tag) => <button type="button">{tag.name}</button>} />);
    expect(screen.getAllByRole('button', { name: 'Expand Home' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Garden' })).toBeNull();
  });

  it('shows Find tags for large tag lists and clears the tag query before board filters on Escape', () => {
    const manyTags = Array.from({ length: 10 }, (_, i) => makeTag(`t-${i}`, `Tag ${i + 1}`));
    receiveBoard(
      projectBoardData(
        project,
        statuses,
        [task('Weed beds', 2)],
        manyTags,
        secondaryTagsByTask([]),
      ),
      { rename: () => {}, place: () => true, send: () => true },
    );
    act(() => update({ searching: true }));

    render(<BoardSearchSidebar />);
    const findTags = screen.getByRole('searchbox', { name: 'Find tags' });
    fireEvent.click(screen.getByRole('button', { name: /^Size S,/ }));
    fireEvent.change(findTags, { target: { value: 'Tag 10' } });
    expect(screen.getByRole('button', { name: /^Tag 10,/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tag 2,/ })).not.toBeInTheDocument();

    // First Escape clears Find tags without clearing active board filters.
    fireEvent.keyDown(findTags, { key: 'Escape' });
    expect(findTags).toHaveValue('');
    expect(board.get().filter.sizes).toEqual([2]);

    // Next Escape clears board filters, then final Escape dismisses the sidebar.
    fireEvent.keyDown(findTags, { key: 'Escape' });
    expect(board.get().filter.sizes).toEqual([]);
    expect(board.get().searching).toBe(true);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(board.get().searching).toBe(false);
  });

  it('renders Projects inline instead of Tags on the workspace board', () => {
    const secondProject: Project = { ...project, id: 'project-2', name: 'Kitchen', key: 'KIT' };
    const secondStatus: Status = { ...statuses[0]!, id: 'kit-build', projectId: secondProject.id };
    receiveBoard(
      workspaceBoardData(
        project.workspaceId,
        [project, secondProject],
        [statuses[0]!, secondStatus],
        [
          task('Weed beds', 2),
          { ...task('Wash dishes', 3), projectId: secondProject.id, statusId: secondStatus.id },
        ],
        [],
        secondaryTagsByTask([]),
      ),
      { rename: () => {}, place: () => true, send: () => true },
    );
    act(() => update({ searching: true }));

    render(<BoardSearchSidebar />);
    expect(screen.queryByRole('region', { name: 'Tags' })).not.toBeInTheDocument();
    const projectsRegion = screen.getByRole('region', { name: 'Projects' });
    const kitchen = within(projectsRegion).getByRole('button', { name: /Kitchen/ });
    expect(kitchen).toHaveTextContent('1');
    fireEvent.click(kitchen);
    expect(board.get().filter.projectId).toBe('project-2');
  });

  it('tracks docked open state and collapses without clearing active filters', () => {
    const { unmount } = render(<BoardSearchSidebar />);
    expect(searchSidebarOpen.get()).toBe(true);

    const sortRegion = screen.getByRole('region', { name: 'Sort' });
    fireEvent.click(within(sortRegion).getByRole('button', { name: 'Size' }));
    const sizeRegion = screen.getByRole('region', { name: 'Size' });
    fireEvent.click(within(sizeRegion).getByRole('button', { name: /^Size S,/ }));

    act(() => collapseSearch());
    expect(board.get()).toMatchObject({
      searching: false,
      sort: 'size-asc',
      filter: { sizes: [2] },
    });
    expect(searchSidebarOpen.get()).toBe(false);

    act(() => update({ searching: true }));
    expect(searchSidebarOpen.get()).toBe(true);
    expect(board.get()).toMatchObject({
      sort: 'size-asc',
      filter: { sizes: [2] },
    });

    // Closing from the search field's close button clears filters and sort.
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(board.get()).toMatchObject({
      searching: false,
      sort: 'priority',
      filter: { sizes: [] },
    });
    unmount();
    expect(searchSidebarOpen.get()).toBe(false);
  });
});

describe('relation filters', () => {
  const linked = () =>
    receiveBoard(
      {
        ...projectBoardData(
          project,
          statuses,
          [task('Weed beds', 2), task('Paint fence', 4), task('Tidy desk', null)],
          [],
          secondaryTagsByTask([]),
        ),
        relations: {
          blocked: new Set(['Weed beds']),
          blocking: new Set(['Paint fence']),
          duplicates: new Set(['Weed beds', 'Tidy desk']),
        },
      },
      { rename: () => {}, place: () => true, send: () => true },
    );

  it('leaves Links out where the board has no relations, as the prototype does', () => {
    const { unmount } = render(<BoardSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    expect(screen.queryByRole('tab', { name: 'Links' })).not.toBeInTheDocument();
    unmount();
    render(<BoardSearchSidebar />);
    expect(screen.queryByRole('region', { name: 'Links' })).not.toBeInTheDocument();
  });

  it('chooses relations from the Links tab, each counted, and removes them by their chips', () => {
    linked();
    render(<BoardSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    const panel = screen.getByRole('region', { name: 'Filters and sort' });
    expect(within(panel).getByRole('button', { name: 'Blocked, 1 task' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Blocking, 1 task' })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Duplicates, 2 tasks' }));
    fireEvent.click(within(panel).getByRole('button', { name: /^Blocked,/ }));
    // Kept in the filter's order, whichever was chosen first.
    expect(board.get().filter.relations).toEqual(['blocked', 'duplicates']);
    expect(within(panel).getByRole('button', { name: /^Blocked,/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(field()).toHaveAccessibleDescription('2 matching');
    const chips = screen.getByRole('group', { name: 'Active filters' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove Blocked filter' }));
    expect(board.get().filter.relations).toEqual(['duplicates']);
    // Counts follow the rest of the filter: with Size S, only Weed beds is left to count.
    fireEvent.click(screen.getByRole('tab', { name: 'Size' }));
    fireEvent.click(screen.getByRole('button', { name: /^Size S,/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(screen.getByRole('button', { name: 'Blocking, 0 tasks' })).toBeInTheDocument();
  });

  it('shows a Links section in the docked sidebar', () => {
    linked();
    render(<BoardSearchSidebar />);
    const links = screen.getByRole('region', { name: 'Links' });
    fireEvent.click(within(links).getByRole('button', { name: /^Blocking,/ }));
    expect(board.get().filter.relations).toEqual(['blocking']);
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent(/Blocking/);
  });
});

describe('search over a soft keyboard', () => {
  // jsdom computes no Tailwind, so these pin the rules that keep search above `--keyboard`.
  it('lifts the floating bar by translate, so its measured height and the columns stay', () => {
    const { container } = render(<BoardSearch />);
    const float = container.querySelector<HTMLElement>('[data-board-search-float]');
    expect(float).toBeInTheDocument();
    expect(float?.className).toContain(
      '[translate:0_min(0px,calc(max(1.25rem,var(--safe-bottom)+0.75rem)-0.75rem-var(--keyboard)))]',
    );
    // The resting foot is unchanged, and the lift is not padding on the measured bar.
    expect(float?.className).toContain('pb-[max(1.25rem,calc(var(--safe-bottom)+0.75rem))]');
    const bar = container.querySelector<HTMLElement>('search[aria-label="Search the board"]');
    expect(bar?.className).not.toContain('--keyboard');
  });

  it('ends the docked sidebar above the keyboard, as it was with none', () => {
    const { container } = render(<BoardSearchSidebar />);
    const sidebar = container.querySelector<HTMLElement>('search[data-docked]');
    expect(sidebar?.className).toContain(
      'pb-[max(1.5rem,calc(var(--safe-bottom)+0.75rem),calc(var(--keyboard)+0.75rem))]',
    );
  });

  it('fits the filter panel between the top of the screen and the lifted bar', () => {
    render(<BoardSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    const panel = screen.getByRole('region', { name: 'Filters and sort' });
    expect(panel.className).toContain(
      '[--board-filter-view-max:max(8rem,min(26rem,calc(100dvh-var(--keyboard)-var(--safe-top)-var(--dock-height)-15rem)))]',
    );
  });

  it('keeps focus, and the keyboard, in the field when a chip or filter is pressed', () => {
    const { unmount } = render(<BoardSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    const chip = screen.getByRole('button', { name: /^Sorted .*Sort by priority$/ });
    // A press that is not prevented would move focus to the chip and drop the keyboard.
    expect(fireEvent.pointerDown(chip)).toBe(false);
    // The panel stays open while the field is used, and a press inside it keeps focus too.
    fireEvent.pointerDown(field());
    expect(screen.getByRole('region', { name: 'Filters and sort' })).toBeInTheDocument();
    expect(fireEvent.pointerDown(screen.getByRole('tab', { name: 'Size' }))).toBe(false);
    unmount();

    render(<BoardSearchSidebar />);
    const sortRegion = screen.getByRole('region', { name: 'Sort' });
    expect(fireEvent.pointerDown(within(sortRegion).getByRole('button', { name: 'Size' }))).toBe(
      false,
    );
    expect(fireEvent.pointerDown(field())).toBe(true);
  });
});
