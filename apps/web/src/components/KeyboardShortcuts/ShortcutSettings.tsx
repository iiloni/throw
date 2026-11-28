import { Plus, RotateCcw, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  apple,
  type Bindings,
  bindingsOf,
  chordOf,
  isCustomized,
  planBinding,
  recordingShortcut,
  resetBindings,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type Shortcut,
  setBindings,
  spokenChord,
  useShortcutBindings,
} from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { Keys } from './Keys';

type Problem =
  | { kind: 'reserved'; binding: string; reason: string }
  | { kind: 'builtIn'; binding: string; other: Shortcut }
  | { kind: 'taken'; binding: string; other: Shortcut; replacing: string | null };

/**
 * Settings' Keyboard shortcuts: each shortcut with this device's keys, to record new ones for,
 * take away or put back to their defaults. Built-in keys (a card's, a field's) are listed for
 * reference. Choices are kept on the device, as the board's other preferences are.
 */
export function ShortcutSettings() {
  const bindings = useShortcutBindings();
  const [announcement, setAnnouncement] = useState('');
  const customized = SHORTCUTS.some((item) => isCustomized(item.id));
  return (
    <div className="flex flex-col gap-6" data-shortcut-settings="">
      <p className="px-4 text-muted-foreground text-sm">
        {bindings.shortcuts[0] && (
          <>
            Press <Keys binding={bindings.shortcuts[0]} /> anywhere to see these.{' '}
          </>
        )}
        Keys without {apple ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'} wait while you type. Changes are kept on
        this device.
      </p>
      {SHORTCUT_GROUPS.map(({ group, label }) => (
        <SettingsSection key={group} title={label}>
          {(SHORTCUTS as readonly Shortcut[])
            .filter((item) => item.group === group)
            .map((item) => (
              <ShortcutRow
                key={item.id}
                shortcut={item}
                bindings={bindings}
                onAnnounce={setAnnouncement}
              />
            ))}
        </SettingsSection>
      ))}
      {customized && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => {
            resetBindings();
            setAnnouncement('Every shortcut is back to its default keys.');
          }}
        >
          <RotateCcw aria-hidden />
          Restore all defaults
        </Button>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function ShortcutRow({
  shortcut,
  bindings,
  onAnnounce,
}: {
  shortcut: Shortcut;
  bindings: Bindings;
  onAnnounce(text: string): void;
}) {
  const { id, label, fixed } = shortcut;
  const keys = bindings[id];
  // Recording a new chord: in place of one of the shortcut's keys, or as another (null).
  const [recording, setRecording] = useState<{ replacing: string | null } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const problemAction = useRef<HTMLButtonElement>(null);
  // Where focus goes once recording ends, so it is not left on a control that has gone.
  const [refocus, setRefocus] = useState(false);
  useLayoutEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    (problemAction.current ?? add.current)?.focus({ preventScroll: true });
  }, [refocus]);

  function finish(refocusAfter = true) {
    setRecording(null);
    if (refocusAfter) setRefocus(true);
  }

  function apply(list: readonly string[], binding: string) {
    setBindings(id, list);
    setProblem(null);
    onAnnounce(`${label}: ${spokenChord(binding)}.`);
  }

  function record(binding: string) {
    const replacing = recording?.replacing ?? null;
    const plan = planBinding(id, binding, replacing, bindings);
    if (plan.kind === 'set') apply(plan.list, binding);
    else if (plan.kind === 'unchanged') setProblem(null);
    else if (plan.kind === 'taken')
      setProblem({ kind: 'taken', binding, other: plan.other, replacing });
    else if (plan.kind === 'builtIn') setProblem({ kind: 'builtIn', binding, other: plan.other });
    else setProblem({ kind: 'reserved', binding, reason: plan.reason });
    finish();
  }

  function take(taken: Extract<Problem, { kind: 'taken' }>) {
    setBindings(
      taken.other.id,
      bindingsOf(taken.other.id).filter((item) => item !== taken.binding),
    );
    const plan = planBinding(id, taken.binding, taken.replacing);
    if (plan.kind === 'set') apply(plan.list, taken.binding);
    else setProblem(null);
    setRefocus(true);
  }

  const customized = isCustomized(id);
  return (
    <div className="flex flex-col">
      <div className="flex min-h-14 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{label}</p>
          {fixed && <p className="text-muted-foreground text-sm">Built in</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          {keys.length === 0 && !recording && (
            <span className="px-1 text-muted-foreground text-sm">No shortcut</span>
          )}
          {fixed ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              {keys.map((binding) => (
                <Keys key={binding} binding={binding} />
              ))}
            </span>
          ) : (
            keys.map((binding) =>
              recording?.replacing === binding ? (
                <Recorder key={binding} label={label} onRecord={record} onCancel={finish} />
              ) : (
                <span
                  key={binding}
                  className="inline-flex h-8 items-center rounded-xl bg-background/70 shadow-[0_1px_2px_oklch(0_0_0/0.06)]"
                >
                  <button
                    type="button"
                    aria-label={`Change ${spokenChord(binding)} for ${label}`}
                    className="flex h-full items-center rounded-l-xl pr-1 pl-2 outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setProblem(null);
                      setRecording({ replacing: binding });
                    }}
                  >
                    <Keys binding={binding} spoken={false} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${spokenChord(binding)} from ${label}`}
                    className="flex h-full items-center rounded-r-xl pr-2 pl-1 text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setProblem(null);
                      setBindings(
                        id,
                        keys.filter((item) => item !== binding),
                      );
                      onAnnounce(`Removed ${spokenChord(binding)} from ${label}.`);
                      setRefocus(true);
                    }}
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </span>
              ),
            )
          )}
          {!fixed &&
            (recording?.replacing === null ? (
              <Recorder label={label} onRecord={record} onCancel={finish} />
            ) : (
              <IconButton
                ref={add}
                label={`Add a shortcut for ${label}`}
                onClick={() => {
                  setProblem(null);
                  setRecording({ replacing: null });
                }}
              >
                <Plus />
              </IconButton>
            ))}
          {customized && (
            <IconButton
              label={`Reset ${label} to its default keys`}
              onClick={() => {
                setProblem(null);
                resetBindings(id);
                onAnnounce(`${label} is back to its default keys.`);
                setRefocus(true);
              }}
            >
              <RotateCcw />
            </IconButton>
          )}
        </div>
      </div>
      {problem && (
        <div
          role="alert"
          className="mx-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-foreground/[0.05] px-3 py-2 text-sm"
        >
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <Keys binding={problem.binding} />
            {problem.kind === 'reserved' && <span>is kept for {problem.reason}.</span>}
            {problem.kind === 'builtIn' && (
              <span>is built in for {lower(problem.other.label)}.</span>
            )}
            {problem.kind === 'taken' && <span>already does {lower(problem.other.label)}.</span>}
          </p>
          {problem.kind === 'taken' ? (
            <span className="flex gap-1">
              <Button
                ref={problemAction}
                size="sm"
                variant="secondary"
                onClick={() => take(problem)}
              >
                Use it here
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setProblem(null);
                  setRefocus(true);
                }}
              >
                Keep it there
              </Button>
            </span>
          ) : (
            <Button
              ref={problemAction}
              size="sm"
              variant="ghost"
              onClick={() => {
                setProblem(null);
                setRefocus(true);
              }}
            >
              OK
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * Listens for the next chord, in place of a key or the add button. Escape cancels; Tab and a
 * click elsewhere leave it as it was. While it listens, no shortcut runs from the keys.
 */
function Recorder({
  label,
  onRecord,
  onCancel,
}: {
  label: string;
  onRecord(binding: string): void;
  /** Escape asks for focus back; leaving by Tab or a click keeps it where it went. */
  onCancel(refocus: boolean): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [held, setHeld] = useState<string[]>([]);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    recordingShortcut.set(true);
    return () => recordingShortcut.set(false);
  }, []);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.repeat) return;
    if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey)
      return onCancel(true);
    const binding = chordOf(event.nativeEvent);
    if (!binding) {
      setHeld(modifiersOf(event));
      return;
    }
    onRecord(binding);
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Press the new keys for ${label}, or Escape to cancel`}
      className={cn(
        'inline-flex h-8 min-w-28 items-center justify-center gap-1 rounded-xl px-3 text-sm outline-none',
        'bg-brand/10 text-brand-link ring-2 ring-brand/60',
      )}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => setHeld(modifiersOf(event))}
      onBlur={() => onCancel(false)}
    >
      {held.length > 0 ? (
        <span className="inline-flex gap-0.5" aria-hidden>
          {held.map((key) => (
            <kbd
              key={key}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-[0.3125rem] bg-foreground/[0.08] px-1 font-sans text-[0.6875rem]"
            >
              {key}
            </kbd>
          ))}
        </span>
      ) : (
        'Press keys…'
      )}
    </button>
  );
}

function modifiersOf(event: KeyboardEvent) {
  return [
    event.ctrlKey && (apple ? '⌃' : 'Ctrl'),
    event.altKey && (apple ? '⌥' : 'Alt'),
    event.shiftKey && (apple ? '⇧' : 'Shift'),
    event.metaKey && apple && '⌘',
  ].filter((item): item is string => Boolean(item));
}
