import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindingsOf,
  chordKeys,
  chordOf,
  isCustomized,
  parseChord,
  planBinding,
  recordingShortcut,
  resetBindings,
  setBindings,
  spokenChord,
  typingIn,
  useShortcut,
} from './shortcuts';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

afterEach(() => {
  resetBindings();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('chordOf', () => {
  it('writes chords as bindings are, with Ctrl as Mod off Apple devices', () => {
    expect(chordOf(key({ key: 'k', code: 'KeyK' }))).toBe('K');
    expect(chordOf(key({ key: 'K', code: 'KeyK', shiftKey: true }))).toBe('Shift+K');
    expect(chordOf(key({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBe('Mod+K');
    expect(chordOf(key({ key: ' ', code: 'Space' }))).toBe('Space');
    expect(chordOf(key({ key: 'Escape', code: 'Escape' }))).toBe('Escape');
  });

  it('names a shifted character by itself, so `?` is the same on any layout', () => {
    expect(chordOf(key({ key: '?', code: 'Slash', shiftKey: true }))).toBe('?');
    expect(chordOf(key({ key: '?', code: 'Slash', shiftKey: true, ctrlKey: true }))).toBe('Mod+?');
    expect(chordOf(key({ key: '/', code: 'Slash', ctrlKey: true }))).toBe('Mod+/');
  });

  it('names a modified letter or digit by its place, whatever it types', () => {
    expect(chordOf(key({ key: 'л', code: 'KeyK', ctrlKey: true }))).toBe('Mod+K');
    expect(chordOf(key({ key: '˚', code: 'KeyK', altKey: true }))).toBe('Alt+K');
    expect(chordOf(key({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }))).toBe(
      'Mod+Shift+1',
    );
  });

  it('has nothing for a modifier alone, or the Windows key', () => {
    expect(chordOf(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull();
    expect(chordOf(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBeNull();
  });

  it('reads AltGr as typing, not a chord', () => {
    const event = key({ key: '[', code: 'Digit8', ctrlKey: true, altKey: true });
    Object.defineProperty(event, 'getModifierState', {
      value: (name: string) => name === 'AltGraph',
    });
    expect(chordOf(event)).toBe('[');
  });
});

describe('parseChord', () => {
  it('takes only the one canonical spelling', () => {
    expect(parseChord('Mod+Shift+K')).not.toBeNull();
    expect(parseChord('Mod+Shift+1')).not.toBeNull();
    expect(parseChord('Mod++')).not.toBeNull();
    expect(parseChord('Shift+Mod+K')).toBeNull();
    expect(parseChord('k')).toBeNull();
    expect(parseChord('Shift+?')).toBeNull();
    expect(parseChord('Mod+Mod+K')).toBeNull();
    expect(parseChord('Mod+Nope')).toBeNull();
  });
});

it('draws and speaks chords in this platform’s terms', () => {
  expect(chordKeys('Mod+Shift+K')).toEqual(['Ctrl', 'Shift', 'K']);
  expect(chordKeys('ArrowUp')).toEqual(['↑']);
  expect(spokenChord('Mod+/')).toBe('Control Slash');
});

describe('planBinding', () => {
  it('adds a free chord, or puts it in place of the one being changed', () => {
    expect(planBinding('newTask', 'Shift+N')).toEqual({ kind: 'set', list: ['N', 'Shift+N'] });
    expect(planBinding('search', 'Mod+J', '/')).toEqual({ kind: 'set', list: ['Mod+K', 'Mod+J'] });
  });

  it('refuses what the browser, editor or a built-in key already means', () => {
    expect(planBinding('newTask', 'Mod+C')).toEqual({ kind: 'reserved', reason: 'Copy' });
    expect(planBinding('newTask', 'Escape')).toMatchObject({
      kind: 'builtIn',
      other: { id: 'clearSelection' },
    });
  });

  it('offers to take a chord another shortcut uses', () => {
    expect(planBinding('newTask', 'Mod+K')).toMatchObject({
      kind: 'taken',
      other: { id: 'search' },
    });
    expect(planBinding('search', 'Mod+K')).toEqual({ kind: 'unchanged' });
  });
});

describe('stored keys', () => {
  it('keeps a choice on the device, and forgets it once it is the default again', () => {
    setBindings('newTask', ['Shift+N']);
    expect(bindingsOf('newTask')).toEqual(['Shift+N']);
    expect(isCustomized('newTask')).toBe(true);
    setBindings('newTask', ['N']);
    expect(isCustomized('newTask')).toBe(false);
    setBindings('newTask', []);
    expect(bindingsOf('newTask')).toEqual([]);
    resetBindings('newTask');
    expect(bindingsOf('newTask')).toEqual(['N']);
  });

  it('ignores stored keys for built-in or unknown shortcuts, and chords that do not parse', () => {
    localStorage.setItem(
      'throw-keyboard-shortcuts',
      JSON.stringify({ closeTask: ['Q'], gone: ['G'], taskTags: ['k', 'Mod+T', 'Mod+T', 'Y'] }),
    );
    window.dispatchEvent(new StorageEvent('storage'));
    expect(bindingsOf('closeTask')).toEqual(['Escape']);
    expect(bindingsOf('taskTags')).toEqual(['Mod+T', 'Y']);
  });
});

describe('useShortcut', () => {
  function press(init: KeyboardEventInit, target: EventTarget = document.body) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('runs on its keys and takes the key from the page', () => {
    const handler = vi.fn();
    renderHook(() => useShortcut('newTask', handler));
    const event = press({ key: 'n', code: 'KeyN' });
    expect(handler).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    press({ key: 'n', code: 'KeyN', repeat: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('follows keys changed while mounted', () => {
    const handler = vi.fn();
    renderHook(() => useShortcut('newTask', handler));
    setBindings('newTask', ['Shift+N']);
    press({ key: 'n', code: 'KeyN' });
    expect(handler).not.toHaveBeenCalled();
    press({ key: 'N', code: 'KeyN', shiftKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('never runs a plain key typed into a field or editor', () => {
    const handler = vi.fn();
    renderHook(() => useShortcut('newTask', handler));
    const input = document.body.appendChild(document.createElement('input'));
    const editor = document.body.appendChild(document.createElement('div'));
    editor.setAttribute('contenteditable', 'true');
    const inner = editor.appendChild(document.createElement('p'));
    expect(press({ key: 'n', code: 'KeyN' }, input).defaultPrevented).toBe(false);
    expect(press({ key: 'n', code: 'KeyN' }, inner).defaultPrevented).toBe(false);
    const checkbox = document.body.appendChild(document.createElement('input'));
    checkbox.type = 'checkbox';
    press({ key: 'n', code: 'KeyN' }, checkbox);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('runs a chord with a modifier from a field only where the shortcut allows', () => {
    const search = vi.fn();
    renderHook(() => useShortcut('search', search));
    const input = document.body.appendChild(document.createElement('input'));
    press({ key: '/', code: 'Slash' }, input);
    expect(search).not.toHaveBeenCalled();
    press({ key: 'k', code: 'KeyK', ctrlKey: true }, input);
    expect(search).toHaveBeenCalledOnce();
  });

  it('leaves plain keys to an open dialog, menu or list', () => {
    const handler = vi.fn();
    renderHook(() => useShortcut('newTask', handler));
    const menu = document.body.appendChild(document.createElement('div'));
    menu.setAttribute('role', 'menu');
    press({ key: 'n', code: 'KeyN' });
    expect(handler).not.toHaveBeenCalled();
    menu.remove();
    // The phone's task screen is a dialog, but the task's own keys are for it.
    const screen = document.body.appendChild(document.createElement('section'));
    screen.setAttribute('role', 'dialog');
    screen.setAttribute('data-task-screen', 'task');
    press({ key: 'n', code: 'KeyN' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('asks the newest handler first, and the next when it declines', () => {
    const outer = vi.fn();
    const inner = vi.fn(() => false);
    renderHook(() => useShortcut('taskStatus', outer));
    const { unmount } = renderHook(() => useShortcut('taskStatus', inner));
    press({ key: 's', code: 'KeyS' });
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).toHaveBeenCalledOnce();
    unmount();
    press({ key: 's', code: 'KeyS' });
    expect(inner).toHaveBeenCalledOnce();
  });

  it('stays still while a shortcut is being recorded, or when disabled', () => {
    const handler = vi.fn();
    const { rerender } = renderHook(({ on }) => useShortcut('newTask', handler, on), {
      initialProps: { on: true },
    });
    recordingShortcut.set(true);
    press({ key: 'n', code: 'KeyN' });
    recordingShortcut.set(false);
    rerender({ on: false });
    press({ key: 'n', code: 'KeyN' });
    expect(handler).not.toHaveBeenCalled();
  });
});

it('knows what typing is', () => {
  const range = document.createElement('input');
  range.type = 'range';
  expect(typingIn(range)).toBe(false);
  expect(typingIn(document.createElement('textarea'))).toBe(true);
  expect(typingIn(document.createElement('button'))).toBe(false);
});
