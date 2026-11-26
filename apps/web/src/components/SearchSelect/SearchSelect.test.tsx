import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSelect, type SelectOption, searchOptions } from './SearchSelect';

const options: SelectOption[] = [
  { value: '', label: 'Top level' },
  { value: 'product', label: 'Product', depth: 0 },
  { value: 'features', label: 'Features', detail: 'Product', keywords: ['Product / Features'] },
  { value: 'research', label: 'Research', depth: 0 },
  { value: 'fees', label: 'Fees', keywords: ['Billing / Fees'] },
];

function layout({ desktop, coarse = false }: { desktop: boolean; coarse?: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('width') ? desktop : query.includes('coarse') ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function show(value = '', onSubmit = vi.fn()) {
  const onChange = vi.fn();
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <span id="label">Parent tag</span>
      <SearchSelect
        labelId="label"
        title="Parent tag"
        searchLabel="Search tags"
        emptyText="No tag matches."
        options={options}
        value={value}
        onChange={onChange}
      />
    </form>,
  );
  return onChange;
}

const labels = () =>
  screen.getAllByRole('option').map((option) => option.querySelector('.truncate')?.textContent);

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('searchOptions', () => {
  it('keeps the given order without a search', () => {
    expect(searchOptions(options, '  ')).toEqual(options);
  });

  it('puts names that start with the search ahead of paths that only contain it', () => {
    expect(searchOptions(options, 'fe').map((option) => option.value)).toEqual([
      'features',
      'fees',
    ]);
    expect(searchOptions(options, 'product / f').map((option) => option.value)).toEqual([
      'features',
    ]);
    expect(searchOptions(options, 'billing')[0]?.value).toBe('fees');
  });
});

describe('SearchSelect on desktop', () => {
  beforeEach(() => layout({ desktop: true }));

  it('names its field with the chosen option and opens the list beside it on that option', () => {
    show('research');
    const field = screen.getByRole('button', { name: 'Parent tag Research' });
    expect(field).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(field);
    const list = screen.getByRole('dialog', { name: 'Parent tag' });
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Search tags' })).toHaveFocus();
    expect(screen.getByRole('option', { name: 'Research' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(labels()).toHaveLength(options.length);
  });

  it('narrows the list by a search and takes a tapped option', () => {
    const onChange = show();
    fireEvent.click(screen.getByRole('button', { name: 'Parent tag Top level' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tags' }), {
      target: { value: 'feat' },
    });
    expect(labels()).toEqual(['Features']);
    fireEvent.click(screen.getByRole('option', { name: /^Features/ }));
    expect(onChange).toHaveBeenCalledWith('features');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes the best match on Enter, moves with the arrows and never submits the form', () => {
    const onSubmit = vi.fn();
    const onChange = show('', onSubmit);
    fireEvent.click(screen.getByRole('button', { name: 'Parent tag Top level' }));
    const search = screen.getByRole('combobox', { name: 'Search tags' });
    fireEvent.change(search, { target: { value: 'fe' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Fees' }).id,
    );
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
    expect(onChange).toHaveBeenCalledWith('features');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says when nothing matches', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Parent tag Top level' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tags' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('No tag matches.');
  });
});

describe('SearchSelect on a phone', () => {
  it('opens in place under the field, with no sheet or popover over the drawer', () => {
    layout({ desktop: false, coarse: true });
    const onChange = show('product');
    const field = screen.getByRole('button', { name: 'Parent tag Product' });
    fireEvent.click(field);
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const listbox = screen.getByRole('listbox', { name: 'Parent tag' });
    expect(document.getElementById(field.getAttribute('aria-controls') ?? '')).toContainElement(
      listbox,
    );
    // Touch leaves the keyboard down until the search is tapped.
    expect(screen.getByRole('combobox', { name: 'Search tags' })).not.toHaveFocus();
    fireEvent.click(screen.getByRole('option', { name: 'Research' }));
    expect(onChange).toHaveBeenCalledWith('research');
    expect(field).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape ahead of the drawer, and hands focus back to the field', () => {
    layout({ desktop: false });
    show();
    const field = screen.getByRole('button', { name: 'Parent tag Top level' });
    fireEvent.click(field);
    const search = screen.getByRole('combobox', { name: 'Search tags' });
    expect(search).toHaveFocus();
    // The drawer's Escape listener skips an event whose default was prevented.
    expect(fireEvent.keyDown(search, { key: 'Escape' })).toBe(false);
    expect(field).toHaveAttribute('aria-expanded', 'false');
    expect(field).toHaveFocus();
  });

  it('starts each opening with a fresh search', () => {
    layout({ desktop: false });
    show();
    const field = screen.getByRole('button', { name: 'Parent tag Top level' });
    fireEvent.click(field);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tags' }), {
      target: { value: 'fe' },
    });
    act(() => fireEvent.click(field));
    act(() => fireEvent.click(field));
    expect(screen.getByRole('combobox', { name: 'Search tags' })).toHaveValue('');
    expect(labels()).toHaveLength(options.length);
  });
});
