import { useNavigate } from '@tanstack/react-router';
import { Settings2 } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { Button } from '@/components/ui/button';
import {
  bindingsOf,
  chordOf,
  overlayOpen,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type Shortcut,
  useShortcut,
  useShortcutBindings,
} from '@/lib/shortcuts';
import { createStore } from '@/lib/store';
import { ShortcutKeys } from './Keys';

export const shortcutsHelpOpen = createStore(false);

const close = () => shortcutsHelpOpen.set(false);

/**
 * The cheat sheet `?` opens: every shortcut with the keys this device has for it, grouped by
 * where it works. The shell hosts it, so it is a centred dialog on desktop and a page of the
 * drawer on a phone (ADR 0009).
 */
export function ShortcutsHelp() {
  const open = shortcutsHelpOpen.use();
  const navigate = useNavigate();
  useShortcut('shortcuts', () => {
    // Its own keys close it again; anything else holding the keys keeps them.
    if (shortcutsHelpOpen.get()) return close();
    if (overlayOpen()) return false;
    shortcutsHelpOpen.set(true);
  });
  // Open, the sheet is a dialog, which keeps plain keys from the page's shortcuts: the `?` that
  // opened it closes it from here.
  useEffect(() => {
    if (!open) return;
    function closeOnOwnKeys(event: KeyboardEvent) {
      const chord = chordOf(event);
      if (!chord || event.defaultPrevented || event.repeat) return;
      if (!bindingsOf('shortcuts').includes(chord)) return;
      event.preventDefault();
      close();
    }
    window.addEventListener('keydown', closeOnOwnKeys);
    return () => window.removeEventListener('keydown', closeOnOwnKeys);
  }, [open]);
  const customize = useCallback(() => {
    close();
    void navigate({ to: '/settings/shortcuts' });
  }, [navigate]);
  return (
    <ManagementSurface open={open} title="Keyboard shortcuts" onClose={close}>
      {open && <ShortcutSheet onCustomize={customize} />}
    </ManagementSurface>
  );
}

function ShortcutSheet({ onCustomize }: { onCustomize: () => void }) {
  const bindings = useShortcutBindings();
  return (
    <div className="flex flex-col gap-5 pb-1" data-shortcut-sheet="">
      {SHORTCUT_GROUPS.map(({ group, label }) => {
        const rows = (SHORTCUTS as readonly Shortcut[]).filter(
          (item) => item.group === group && bindings[item.id].length > 0,
        );
        if (rows.length === 0) return null;
        return (
          <section key={group} aria-label={label} className="flex flex-col gap-1">
            <h3 className="px-1 font-medium text-muted-foreground text-sm">{label}</h3>
            <dl className="flex flex-col divide-y divide-foreground/[0.06] rounded-2xl bg-foreground/[0.05]">
              {rows.map((item) => (
                <div key={item.id} className="flex min-h-11 items-center gap-3 px-3.5 py-2">
                  <dt className="min-w-0 flex-1 text-sm">{item.label}</dt>
                  <dd>
                    <ShortcutKeys
                      id={item.id}
                      all
                      together={item.together}
                      className="justify-end"
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      <Button variant="ghost" className="self-start" onClick={onCustomize}>
        <Settings2 aria-hidden />
        Customize shortcuts
      </Button>
    </div>
  );
}
