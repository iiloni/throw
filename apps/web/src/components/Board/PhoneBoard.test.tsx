import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBoards } from './mockData';
import type { Status } from './model';
import { FlowTrack, type Folding, PhoneBoard, phoneColumns } from './PhoneBoard';
import { board, countIn, current, initialBoard, setFilter } from './state';

const statuses = (...names: string[]) =>
  names.map(
    (name, index): Status => ({
      id: name.toLowerCase(),
      name,
      category: 'active',
      isDefault: index === 0,
      color: null,
    }),
  );

describe('phoneColumns', () => {
  const [next, implementation, review] = statuses('Next', 'Implementation', 'Review');

  it('pages through the columns left open', () => {
    const folded = new Set(['implementation']);
    expect(phoneColumns([next!, implementation!, review!], (id) => folded.has(id))).toEqual([
      next,
      review,
    ]);
  });

  it('keeps the first column when every one is folded, so the pager is never empty', () => {
    expect(phoneColumns([next!, implementation!, review!], () => true)).toEqual([next]);
    expect(phoneColumns([], () => true)).toEqual([]);
  });
});

describe('FlowTrack', () => {
  const all = statuses('Next', 'Implementation', 'Review');
  const open = [all[0]!, all[2]!];

  beforeEach(() => {
    localStorage.clear();
    board.set(initialBoard(mockBoards()));
  });

  function track(folding: Partial<Folding> = {}, pages = open, page = 0) {
    const onTurn = vi.fn();
    const onCollapse = vi.fn();
    const onExpand = vi.fn();
    render(
      <FlowTrack
        statuses={pages}
        page={page}
        onTurn={onTurn}
        folding={{ statuses: all, onCollapse, onExpand, ...folding }}
      />,
    );
    return {
      onTurn,
      onCollapse,
      onExpand,
      nav: screen.getByRole('navigation', { name: 'Columns' }),
    };
  }

  it('shows a folded column as a short handle in its place, which opens it', () => {
    const { nav, onExpand, onTurn } = track();
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Next, 0 tasks',
      'Expand Implementation column, 0 tasks',
      'Review, 0 tasks',
    ]);
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false');
    expect(buttons[1]).toHaveAttribute('data-folded');
    expect(buttons[0]).toHaveAttribute('aria-current', 'page');
    fireEvent.click(buttons[1]!);
    expect(onExpand).toHaveBeenCalledWith('implementation');
    fireEvent.click(buttons[2]!);
    expect(onTurn).toHaveBeenCalledWith(1);
  });

  it('folds the current column from the end of its name’s row, and focuses the handle it became', () => {
    const { onCollapse } = track({}, all, 1);
    const fold = screen.getByRole('button', { name: 'Collapse Implementation column' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(fold);
    expect(onCollapse).toHaveBeenCalledWith('implementation');
    expect(document.activeElement).toBe(
      document.querySelector('[data-column-id="implementation"]'),
    );
  });

  it('offers no fold for the last column left open', () => {
    track({}, [all[1]!]);
    expect(screen.queryByRole('button', { name: /^Collapse/ })).not.toBeInTheDocument();
  });

  it('stays a plain track without folding, as on the workspace board', () => {
    render(<FlowTrack statuses={all} page={0} onTurn={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Columns' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.ariaLabel),
    ).toEqual(['Next, 0 tasks', 'Implementation, 0 tasks', 'Review, 0 tasks']);
    expect(within(nav).getAllByRole('button')[0]).not.toHaveAttribute('aria-expanded');
    expect(screen.queryByRole('button', { name: /^Collapse/ })).not.toBeInTheDocument();
  });

  it('counts each column on its segment, folded ones too, as the filter leaves them', () => {
    const { project } = current();
    const active = project.statuses.filter((status) => status.category === 'active');
    const [first, second] = active;
    const count = (id: string) => countIn(board.get(), id);
    const tasksIn = (id: string) => {
      const n = count(id);
      return `${n} ${n === 1 ? 'task' : 'tasks'}`;
    };
    const onTurn = vi.fn();
    const folding = { statuses: active, onCollapse: vi.fn(), onExpand: vi.fn() };
    render(
      <FlowTrack
        statuses={active.filter(({ id }) => id !== second!.id)}
        page={0}
        onTurn={onTurn}
        folding={folding}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Columns' });
    const segment = within(nav).getByRole('button', { current: 'page' });
    expect(segment).toHaveAccessibleName(`${first!.name}, ${tasksIn(first!.id)}`);
    expect(segment).toHaveTextContent(String(count(first!.id)));
    const handle = within(nav).getByRole('button', { expanded: false });
    expect(handle).toHaveAccessibleName(`Expand ${second!.name} column, ${tasksIn(second!.id)}`);
    expect(handle).toHaveTextContent(String(count(second!.id)));

    // A search that matches nothing leaves every segment at none.
    act(() => setFilter({ query: 'zzzz-none' }));
    for (const button of within(nav).getAllByRole('button')) {
      expect(button).toHaveTextContent('0');
      expect(button.getAttribute('aria-label')).toMatch(/0 tasks$/);
    }
  });
});

describe('PhoneBoard', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    scrollTo.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: scrollTo,
      configurable: true,
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    board.set(initialBoard(mockBoards()));
  });

  const pageCount = () => document.querySelectorAll('[data-pager] > [data-page]').length;

  it('skips a folded column, keeps the choice for the project and opens it again', async () => {
    const { project } = current();
    const active = project.statuses.filter((status) => status.category === 'active');
    render(<PhoneBoard />);
    expect(pageCount()).toBe(active.length);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: `Collapse ${active[0]!.name} column` }));
    });
    expect(pageCount()).toBe(active.length - 1);
    expect(JSON.parse(localStorage.getItem(`throw-board-collapsed:${project.id}`)!)).toEqual([
      active[0]!.id,
    ]);
    // The next column takes the folded one's place.
    expect(
      within(screen.getByRole('navigation', { name: 'Columns' })).getByRole('button', {
        current: 'page',
      }),
    ).toHaveAccessibleName(new RegExp(`^${active[1]!.name}, \\d+ tasks?$`));

    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`^Expand ${active[0]!.name} column, `) }),
      );
    });
    expect(pageCount()).toBe(active.length);
    expect(localStorage.getItem(`throw-board-collapsed:${project.id}`)).toBe('[]');
    // And the board turns to it.
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' })),
    );
  });
});
