import { Monitor, Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const THEMES = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: unknown }>;

/** A segmented control for the app's theme, as Catch's settings have it. */
export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  return (
    <fieldset className="grid min-w-0 grid-cols-3 gap-1 p-1.5">
      <legend className="sr-only">Theme</legend>
      {THEMES.map(({ value: theme, label, icon: Icon }) => {
        const selected = value === theme;
        return (
          <button
            key={theme}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (selected) return;
              haptics.selection();
              onChange(theme);
            }}
            className={cn(
              'relative flex flex-col items-center gap-1 rounded-xl py-2.5 font-medium text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId="theme-indicator"
                data-slot="theme-indicator"
                aria-hidden
                className="absolute inset-0 rounded-xl bg-card shadow-sm"
                transition={springs.snappy}
              />
            )}
            <Icon className="relative size-5" aria-hidden />
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
