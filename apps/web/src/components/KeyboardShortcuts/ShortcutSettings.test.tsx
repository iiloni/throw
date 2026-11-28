import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { bindingsOf, resetBindings } from '@/lib/shortcuts';
import { ShortcutSettings } from './ShortcutSettings';

afterEach(() => {
  act(() => resetBindings());
  localStorage.clear();
});

function row(label: string) {
  return screen.getByText(label, { selector: 'p' }).closest('.flex-col') as HTMLElement;
}

function record(label: string, init: KeyboardEventInit) {
  fireEvent.click(screen.getByRole('button', { name: `Add a shortcut for ${label}` }));
  const recorder = screen.getByRole('button', {
    name: `Press the new keys for ${label}, or Escape to cancel`,
  });
  expect(recorder).toHaveFocus();
  fireEvent.keyDown(recorder, init);
}

describe('ShortcutSettings', () => {
  it('lists every shortcut by where it works, with built-in keys for reference only', () => {
    render(<ShortcutSettings />);
    for (const name of ['Everywhere', 'Boards', 'Open task'])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Control K for Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Slash for Search' })).toBeInTheDocument();
    const close = row('Close the task');
    expect(within(close).getByText('Built in')).toBeInTheDocument();
    expect(within(close).queryByRole('button')).toBeNull();
  });

  it('records another key for a shortcut and keeps it', () => {
    render(<ShortcutSettings />);
    record('New task', { key: 'N', code: 'KeyN', shiftKey: true });
    expect(bindingsOf('newTask')).toEqual(['N', 'Shift+N']);
    expect(screen.getByRole('button', { name: 'Change Shift N for New task' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('New task: Shift N.');
    expect(screen.getByRole('button', { name: 'Add a shortcut for New task' })).toHaveFocus();
  });

  it('changes one key in place', () => {
    render(<ShortcutSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Change Slash for Search' }));
    fireEvent.keyDown(screen.getByRole('button', { name: /Press the new keys for Search/ }), {
      key: 'j',
      code: 'KeyJ',
      ctrlKey: true,
    });
    expect(bindingsOf('search')).toEqual(['Mod+K', 'Mod+J']);
  });

  it('offers to move a key another shortcut uses', () => {
    render(<ShortcutSettings />);
    record('New task', { key: 'k', code: 'KeyK', ctrlKey: true });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('already does search');
    expect(bindingsOf('newTask')).toEqual(['N']);
    expect(within(alert).getByRole('button', { name: 'Use it here' })).toHaveFocus();
    fireEvent.click(within(alert).getByRole('button', { name: 'Use it here' }));
    expect(bindingsOf('newTask')).toEqual(['N', 'Mod+K']);
    expect(bindingsOf('search')).toEqual(['/']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses keys the browser, the editor or a built-in control keeps', () => {
    render(<ShortcutSettings />);
    record('New task', { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent('is kept for Copy');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    record('New task', { key: 'Enter', code: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('is built in for open a card');
    expect(bindingsOf('newTask')).toEqual(['N']);
  });

  it('waits through modifiers, and Escape cancels', () => {
    render(<ShortcutSettings />);
    record('New task', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    const recorder = screen.getByRole('button', { name: /Press the new keys for New task/ });
    expect(recorder).toHaveTextContent('Shift');
    fireEvent.keyDown(recorder, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('button', { name: /Press the new keys/ })).toBeNull();
    expect(bindingsOf('newTask')).toEqual(['N']);
  });

  it('removes keys and puts one shortcut, or all, back to their defaults', () => {
    render(<ShortcutSettings />);
    expect(screen.queryByRole('button', { name: 'Restore all defaults' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove N from New task' }));
    expect(bindingsOf('newTask')).toEqual([]);
    expect(within(row('New task')).getByText('No shortcut')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset New task to its default keys' }));
    expect(bindingsOf('newTask')).toEqual(['N']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove P from Change priority' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore all defaults' }));
    expect(bindingsOf('taskPriority')).toEqual(['P']);
  });
});
