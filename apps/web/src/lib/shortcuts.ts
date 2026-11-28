import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { readPreference, watchPreferences, writePreference } from './storage';
import { createStore } from './store';

/**
 * Throw's keyboard shortcuts: what each does, its default keys, the keys this device has chosen
 * instead, and the one listener that runs them.
 *
 * A binding is a chord written `Mod+Alt+Shift+K`: `Mod` is ⌘ on Apple devices and Ctrl
 * elsewhere, and `Ctrl` (Apple only) is the Control key beside it. A key that is itself a
 * shifted character (`?`, `{`) is written as that character, without `Shift`, so it matches
 * whatever layout types it.
 */

export type ShortcutGroup = 'global' | 'board' | 'task';

export const SHORTCUT_GROUPS: ReadonlyArray<{ group: ShortcutGroup; label: string }> = [
  { group: 'global', label: 'Everywhere' },
  { group: 'board', label: 'Boards' },
  { group: 'task', label: 'Open task' },
];

type Definition = {
  id: string;
  group: ShortcutGroup;
  label: string;
  defaults: readonly string[];
  /** Built into a control (a card, a field); listed, but not rebound here. */
  fixed?: boolean;
  /** A fixed set of keys that read as one, such as the arrows, rather than alternatives. */
  together?: boolean;
  /** A chord with a modifier still runs from inside a field or editor. */
  inFields?: boolean;
  /**
   * A chord with a modifier still runs while a dialog, menu or list has the keys; its handler
   * decides what that means.
   */
  inOverlays?: boolean;
};

export const SHORTCUTS = [
  {
    id: 'search',
    group: 'global',
    label: 'Search',
    defaults: ['Mod+K', '/'],
    inFields: true,
    inOverlays: true,
  },
  { id: 'newTask', group: 'global', label: 'New task', defaults: ['N'] },
  {
    id: 'toggleRail',
    group: 'global',
    label: 'Expand or collapse navigation',
    defaults: ['Mod+\\'],
    inFields: true,
  },
  {
    id: 'shortcuts',
    group: 'global',
    label: 'Keyboard shortcuts',
    defaults: ['?', 'Mod+/'],
    inFields: true,
    inOverlays: true,
  },
  {
    id: 'captureFromSearch',
    group: 'global',
    label: 'Create a task from the search words',
    defaults: ['Mod+Enter'],
    fixed: true,
  },
  { id: 'toggleBacklog', group: 'board', label: 'Open or close the backlog', defaults: ['['] },
  { id: 'toggleClosed', group: 'board', label: 'Open or close closed tasks', defaults: [']'] },
  {
    id: 'cardFocus',
    group: 'board',
    label: 'Move between cards',
    defaults: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    fixed: true,
    together: true,
  },
  { id: 'openCard', group: 'board', label: 'Open a card', defaults: ['Enter'], fixed: true },
  {
    id: 'carry',
    group: 'board',
    label: 'Pick up or set down a card',
    defaults: ['Space'],
    fixed: true,
  },
  {
    id: 'carryMove',
    group: 'board',
    label: 'Move a picked-up card',
    defaults: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    fixed: true,
    together: true,
  },
  {
    id: 'clearSelection',
    group: 'board',
    label: 'Put a card back or clear the selection',
    defaults: ['Escape'],
    fixed: true,
  },
  { id: 'taskStatus', group: 'task', label: 'Change status', defaults: ['S'] },
  { id: 'taskPriority', group: 'task', label: 'Change priority', defaults: ['P'] },
  { id: 'taskSize', group: 'task', label: 'Change size', defaults: ['Z'] },
  { id: 'taskTags', group: 'task', label: 'Change tags', defaults: ['T'] },
  { id: 'taskLink', group: 'task', label: 'Link a task', defaults: ['L'] },
  { id: 'taskComment', group: 'task', label: 'Write a comment', defaults: ['C'] },
  { id: 'taskComments', group: 'task', label: 'Show comments', defaults: ['1'] },
  { id: 'taskHistory', group: 'task', label: 'Show history', defaults: ['2'] },
  { id: 'taskLinks', group: 'task', label: 'Show links', defaults: ['3'] },
  {
    id: 'expandTask',
    group: 'task',
    label: 'Expand the task over the board, or collapse it',
    defaults: ['F'],
  },
  {
    id: 'postComment',
    group: 'task',
    label: 'Post or save a comment',
    defaults: ['Mod+Enter'],
    fixed: true,
  },
  { id: 'closeTask', group: 'task', label: 'Close the task', defaults: ['Escape'], fixed: true },
] as const satisfies readonly Definition[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];
export type Shortcut = Definition & { id: ShortcutId };

const definitions = new Map<string, Shortcut>(SHORTCUTS.map((item) => [item.id, item]));

export function shortcutOf(id: ShortcutId): Shortcut {
  return definitions.get(id)!;
}

const isShortcutId = (id: string): id is ShortcutId => definitions.has(id);

// --- Chords -------------------------------------------------------------------------------

export const apple =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

type Chord = { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string };

const NAMED_KEYS = new Set([
  'Escape',
  'Enter',
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Hyper',
  'Super',
  'CapsLock',
  'Fn',
  'FnLock',
  'NumLock',
  'ScrollLock',
  'Dead',
  'Process',
  'Unidentified',
]);

/** A key that prints a character with no case (`?`, `[`, `1`): its shift is in the character. */
const caseless = (key: string) => key.length === 1 && key.toLowerCase() === key.toUpperCase();

function serialize({ mod, ctrl, alt, shift, key }: Chord) {
  return [mod && 'Mod', ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', key]
    .filter(Boolean)
    .join('+');
}

/** Reads a written chord back into its parts; null for anything that is not one. */
export function parseChord(binding: string): Chord | null {
  // The key may itself be `+`, written last after its own separator.
  const match = /^((?:(?:Mod|Ctrl|Alt|Shift)\+)*)(.+)$/.exec(binding);
  if (!match) return null;
  const modifiers = match[1]!.split('+').filter(Boolean);
  const key = match[2]!;
  if (new Set(modifiers).size !== modifiers.length) return null;
  if (!NAMED_KEYS.has(key) && !(key.length === 1 && key !== ' ' && key === key.toUpperCase()))
    return null;
  const chord = {
    mod: modifiers.includes('Mod'),
    ctrl: modifiers.includes('Ctrl'),
    alt: modifiers.includes('Alt'),
    shift: modifiers.includes('Shift'),
    key,
  };
  const modified = chord.mod || chord.ctrl || chord.alt;
  // A shifted character is written as the character, except a digit a modifier names by place.
  if (chord.shift && caseless(key) && !(modified && /^\d$/.test(key))) return null;
  // Written in the one canonical order, so two spellings of a chord cannot both be bound.
  return serialize(chord) === binding ? chord : null;
}

export const isChord = (binding: string) => parseChord(binding) !== null;

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
> & { getModifierState?: (key: string) => boolean };

/**
 * The chord a keydown presses, written as bindings are; null for a modifier on its own, or a
 * chord this platform has no name for (the Windows key elsewhere than on an Apple device).
 */
export function chordOf(event: KeyEventLike): string | null {
  const { code } = event;
  let key = event.key;
  if (MODIFIER_KEYS.has(key)) return null;
  // AltGr types a layout's characters (`[` on a German keyboard) and is not a modifier here.
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  const ctrlKey = event.ctrlKey && !altGraph;
  const altKey = event.altKey && !altGraph;
  if (!apple && event.metaKey) return null;
  const mod = apple ? event.metaKey : ctrlKey;
  const ctrl = apple && ctrlKey;
  // With a modifier held, a letter or digit is named by its place: Option on a Mac types `˚`
  // for K, and a non-Latin layout types its own letter.
  const physical = /^Key([A-Z])$|^Digit(\d)$/.exec(code ?? '');
  if ((mod || ctrl || altKey) && physical) key = physical[1] ?? physical[2]!;
  else if (key === ' ' || key === 'Spacebar') key = 'Space';
  else if (key === 'Esc') key = 'Escape';
  else if (key.length === 1) key = key.toUpperCase();
  else if (!NAMED_KEYS.has(key)) return null;
  // `?` is Shift and `/` on one layout and its own key on another: the character says it all.
  const shift = event.shiftKey && !(caseless(key) && !((mod || ctrl || altKey) && physical));
  return serialize({ mod, ctrl, alt: altKey, shift, key });
}

const hasCommandModifier = (chord: Chord) => chord.mod || chord.ctrl || chord.alt;

const KEY_SYMBOLS: Record<string, string> = {
  Escape: 'Esc',
  Enter: apple ? '↩' : 'Enter',
  Space: 'Space',
  Tab: apple ? '⇥' : 'Tab',
  Backspace: apple ? '⌫' : 'Backspace',
  Delete: apple ? '⌦' : 'Del',
  Insert: 'Ins',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** The keycaps a chord is drawn as, in this platform's terms (⌘ ⌥ ⇧, or Ctrl Alt Shift). */
export function chordKeys(binding: string): string[] {
  const chord = parseChord(binding);
  if (!chord) return [];
  const modifiers = apple
    ? [chord.ctrl && '⌃', chord.alt && '⌥', chord.shift && '⇧', chord.mod && '⌘']
    : [chord.mod && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift'];
  return [
    ...modifiers.filter((item): item is string => Boolean(item)),
    KEY_SYMBOLS[chord.key] ?? chord.key,
  ];
}

const SPOKEN_KEYS: Record<string, string> = {
  Escape: 'Escape',
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  '/': 'Slash',
  '\\': 'Backslash',
  '?': 'Question mark',
  '[': 'Left bracket',
  ']': 'Right bracket',
  '.': 'Period',
  ',': 'Comma',
};

/** A chord as words, for a screen reader: “Command K”, “Control Shift P”. */
export function spokenChord(binding: string) {
  const chord = parseChord(binding);
  if (!chord) return binding;
  return [
    chord.ctrl && 'Control',
    chord.mod && (apple ? 'Command' : 'Control'),
    chord.alt && (apple ? 'Option' : 'Alt'),
    chord.shift && 'Shift',
    SPOKEN_KEYS[chord.key] ?? chord.key,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The chord in `aria-keyshortcuts`' terms. */
export function ariaChord(binding: string) {
  const chord = parseChord(binding);
  if (!chord) return '';
  return [
    chord.ctrl && 'Control',
    chord.mod && (apple ? 'Meta' : 'Control'),
    chord.alt && 'Alt',
    chord.shift && 'Shift',
    chord.key === 'Space' ? 'Space' : chord.key,
  ]
    .filter(Boolean)
    .join('+');
}

/**
 * Chords the browser, the system or the text editor already mean something by. Binding one
 * would take it from them where a shortcut runs, so recording one is refused with the reason.
 */
const RESERVED: Record<string, string> = {
  Tab: 'moving focus',
  'Shift+Tab': 'moving focus',
  'Mod+A': 'Select all',
  'Mod+C': 'Copy',
  'Mod+X': 'Cut',
  'Mod+V': 'Paste',
  'Mod+Shift+V': 'Paste as plain text',
  'Mod+Z': 'Undo',
  'Mod+Shift+Z': 'Redo',
  'Mod+Y': 'Redo',
  'Mod+B': 'Bold',
  'Mod+I': 'Italic',
  'Mod+U': 'Underline',
  'Mod+E': 'Code',
  'Mod+Shift+S': 'Strikethrough',
  'Mod+S': 'the browser’s Save',
  'Mod+F': 'the browser’s Find',
  'Mod+G': 'the browser’s Find again',
  'Mod+P': 'the browser’s Print',
  'Mod+L': 'the address bar',
  'Mod+R': 'reloading the page',
  'Mod+Shift+R': 'reloading the page',
  'Mod+T': 'a new tab',
  'Mod+Shift+T': 'reopening a tab',
  'Mod+W': 'closing the tab',
  'Mod+N': 'a new window',
  'Mod+Shift+N': 'a private window',
  'Mod+Q': 'quitting the browser',
  'Mod+H': 'hiding the app',
  'Mod+M': 'minimizing the window',
  'Mod+D': 'bookmarking the page',
  'Mod+Alt+I': 'the browser’s developer tools',
  'Mod+Shift+I': 'the browser’s developer tools',
  'Mod+Shift+J': 'the browser’s developer tools',
  'Mod+Shift+C': 'the browser’s developer tools',
  F5: 'reloading the page',
  F11: 'full screen',
  F12: 'the browser’s developer tools',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, n) => [`Mod+${n + 1}`, 'switching tabs'])),
  ...Object.fromEntries(
    Array.from({ length: 3 }, (_, n) => [`Mod+Alt+${n + 1}`, `Heading ${n + 1}`]),
  ),
  'Mod+Shift+7': 'a numbered list',
  'Mod+Shift+8': 'a bulleted list',
  'Mod+Shift+9': 'a checklist',
};

export function reservedFor(binding: string): string | null {
  return RESERVED[binding] ?? null;
}

// --- What this device has chosen ----------------------------------------------------------

const STORAGE_KEY = 'throw-keyboard-shortcuts';
const overridesSchema = z.record(z.string(), z.array(z.string()));
type Overrides = Partial<Record<ShortcutId, string[]>>;
export type Bindings = Record<ShortcutId, readonly string[]>;

const defaults = Object.fromEntries(
  SHORTCUTS.map((item) => [item.id, item.defaults]),
) as unknown as Bindings;

/** The device's choices that still name a shortcut that can change, and chords that parse. */
function readOverrides(): Overrides {
  const raw = readPreference(STORAGE_KEY, overridesSchema, {});
  const overrides: Overrides = {};
  for (const [id, list] of Object.entries(raw)) {
    if (!isShortcutId(id) || shortcutOf(id).fixed) continue;
    overrides[id] = [...new Set(list.filter(isChord))];
  }
  return overrides;
}

let cached: { overrides: Overrides; bindings: Bindings } | null = null;
let watching = false;

function snapshot() {
  // Read again only after a preference changes, so a keydown costs nothing to look up.
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    watchPreferences(() => {
      cached = null;
    });
  }
  if (!cached) {
    const overrides = readOverrides();
    cached = { overrides, bindings: { ...defaults, ...overrides } };
  }
  return cached;
}

const watchBindings = (listener: () => void) =>
  watchPreferences(() => {
    cached = null;
    listener();
  });

/** Every shortcut's keys on this device. */
export function currentBindings(): Bindings {
  return snapshot().bindings;
}

export function bindingsOf(id: ShortcutId): readonly string[] {
  return currentBindings()[id];
}

export function isCustomized(id: ShortcutId) {
  return snapshot().overrides[id] !== undefined;
}

export function useShortcutBindings(): Bindings {
  return useSyncExternalStore(watchBindings, currentBindings);
}

export function useBindings(id: ShortcutId): readonly string[] {
  return useShortcutBindings()[id];
}

function store(overrides: Overrides) {
  cached = null;
  writePreference(STORAGE_KEY, overrides);
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Sets a shortcut's keys; its defaults again are kept as no choice at all. */
export function setBindings(id: ShortcutId, list: readonly string[]) {
  const definition = shortcutOf(id);
  if (definition.fixed) return;
  const next = [...new Set(list.filter(isChord))];
  const { [id]: _, ...rest } = snapshot().overrides;
  store(same(next, definition.defaults) ? rest : { ...rest, [id]: next });
}

export function resetBindings(id?: ShortcutId) {
  if (id === undefined) return store({});
  const { [id]: _, ...rest } = snapshot().overrides;
  store(rest);
}

/** The shortcuts other than `except` that already use a chord, on this device's keys. */
export function usersOf(binding: string, except?: ShortcutId, bindings = currentBindings()) {
  return SHORTCUTS.filter((item) => item.id !== except && bindings[item.id].includes(binding));
}

export type BindingPlan =
  | { kind: 'set'; list: string[] }
  | { kind: 'unchanged' }
  | { kind: 'reserved'; reason: string }
  | { kind: 'builtIn'; other: Shortcut }
  | { kind: 'taken'; other: Shortcut };

/**
 * What recording `binding` for a shortcut would do: add it (or put it in place of `replacing`),
 * or why not. A chord another shortcut uses is offered to take from it; a built-in one, or one
 * the browser or editor keeps, is refused.
 */
export function planBinding(
  id: ShortcutId,
  binding: string,
  replacing: string | null = null,
  bindings = currentBindings(),
): BindingPlan {
  const own = bindings[id];
  if (own.includes(binding)) return { kind: 'unchanged' };
  const reason = reservedFor(binding);
  if (reason) return { kind: 'reserved', reason };
  const [other] = usersOf(binding, id, bindings) as Shortcut[];
  if (other) return other.fixed ? { kind: 'builtIn', other } : { kind: 'taken', other };
  const list =
    replacing !== null && own.includes(replacing)
      ? own.map((item) => (item === replacing ? binding : item))
      : [...own, binding];
  return { kind: 'set', list };
}

// --- Running them -------------------------------------------------------------------------

/** A handler declines a press by returning false, which leaves it to the page. */
// biome-ignore lint/suspicious/noConfusingVoidType: handlers that run are usually written without a return.
export type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

const handlers = new Map<ShortcutId, Array<{ current: ShortcutHandler }>>();
/** Set while Settings records a chord, so pressing one does not also run it. */
export const recordingShortcut = createStore(false);

const TEXT_INPUTS =
  /^(?:text|search|url|tel|email|password|number|date|datetime-local|month|time|week)$/;

/** Whether keys pressed in `target` type into it, so a plain key is the user's text. */
export function typingIn(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (
    target.closest(
      '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    )
  )
    return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.test(target.type || 'text');
  return target.closest('[role="textbox"], [role="searchbox"], [role="combobox"]') !== null;
}

// The phone's open task is a dialog of its own, but its shortcuts are what it is open for.
const OVERLAYS =
  '[role="dialog"]:not([data-task-screen]), [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Whether a dialog, menu, list or popover has the keys: open over the page, or holding focus.
 * Tooltips do not count; they close on the next key.
 */
export function overlayOpen() {
  if (document.querySelector(OVERLAYS)) return true;
  for (const popper of document.querySelectorAll('[data-radix-popper-content-wrapper]'))
    if (!popper.querySelector('[data-slot="tooltip-content"], [role="tooltip"]')) return true;
  return false;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.repeat || recordingShortcut.get())
    return;
  const binding = chordOf(event);
  if (!binding) return;
  const chord = parseChord(binding)!;
  const bindings = currentBindings();
  const typing = typingIn(event.target);
  let overlay: boolean | null = null;
  const covered = () => {
    overlay ??= overlayOpen();
    return overlay;
  };
  for (const definition of SHORTCUTS as readonly Shortcut[]) {
    if (definition.fixed || !bindings[definition.id].includes(binding)) continue;
    const stack = handlers.get(definition.id);
    if (!stack?.length) continue;
    // Plain keys are text in a field and an overlay's own keys over the page; only a chord
    // with a modifier can reach past either, where its shortcut allows.
    const command = hasCommandModifier(chord);
    if (typing && !(definition.inFields && command)) continue;
    if (!(definition.inOverlays && command) && covered()) continue;
    // The most recently mounted handler is the innermost: a subtask's pane over its parent's.
    for (const handler of [...stack].reverse()) {
      if (handler.current(event) === false) continue;
      event.preventDefault();
      return;
    }
  }
}

function register(id: ShortcutId, handler: { current: ShortcutHandler }) {
  if (handlers.size === 0) window.addEventListener('keydown', onKeyDown);
  const stack = handlers.get(id) ?? [];
  handlers.set(id, [...stack, handler]);
  return () => {
    const rest = (handlers.get(id) ?? []).filter((item) => item !== handler);
    if (rest.length) handlers.set(id, rest);
    else handlers.delete(id);
    if (handlers.size === 0) window.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * Runs `handler` when one of the shortcut's keys is pressed, while `enabled`. Plain keys never
 * run while typing in a field or editor or while a dialog, menu or list has the keys; a chord
 * with a modifier does where its shortcut is defined to.
 */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler, enabled = true) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    return register(id, latest);
  }, [id, enabled]);
}
