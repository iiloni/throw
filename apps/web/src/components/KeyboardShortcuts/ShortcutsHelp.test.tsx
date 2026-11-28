import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetBindings, setBindings } from '@/lib/shortcuts';
import { ShortcutsHelp, shortcutsHelpOpen } from './ShortcutsHelp';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

beforeEach(() => {
  // A desktop window: the sheet is a centred dialog.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  act(() => {
    shortcutsHelpOpen.set(false);
    resetBindings();
  });
  vi.unstubAllGlobals();
  navigate.mockReset();
});

const press = (init: KeyboardEventInit) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });

it('opens with ? and lists the keys this device has, grouped by where they work', async () => {
  act(() => setBindings('newTask', ['Shift+N']));
  render(<ShortcutsHelp />);
  press({ key: '?', code: 'Slash', shiftKey: true });
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  const everywhere = within(dialog).getByRole('region', { name: 'Everywhere' });
  expect(within(everywhere).getByText('New task').closest('div')).toHaveTextContent('Shift N');
  expect(within(dialog).getByRole('region', { name: 'Open task' })).toHaveTextContent(
    'Close the task',
  );
  press({ key: '?', code: 'Slash', shiftKey: true });
  expect(shortcutsHelpOpen.get()).toBe(false);
});

it('opens with Ctrl/⌘+/ from a field, and leads to Settings to change the keys', async () => {
  render(
    <>
      <input aria-label="Title" />
      <ShortcutsHelp />
    </>,
  );
  act(() => screen.getByRole('textbox', { name: 'Title' }).focus());
  press({ key: '?', code: 'Slash', shiftKey: true });
  expect(shortcutsHelpOpen.get()).toBe(false);
  press({ key: '/', code: 'Slash', ctrlKey: true });
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Customize shortcuts' }));
  expect(navigate).toHaveBeenCalledWith({ to: '/settings/shortcuts' });
  expect(shortcutsHelpOpen.get()).toBe(false);
});
