import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { Popover } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { springs } from '@/lib/motion';
import { useThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { type BoardSettings, board, update, useBoardSettings } from './state';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-4 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{label}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
        checked ? 'justify-end bg-brand' : 'justify-start bg-foreground/15',
      )}
    >
      <motion.span
        layout
        transition={springs.snappy}
        className="size-6 rounded-full bg-card shadow-sm"
      />
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [value: T, label: string][];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset
      aria-label={label}
      className="flex shrink-0 gap-1 rounded-xl bg-foreground/[0.06] p-1"
    >
      {options.map(([option, name]) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={cn(
            'h-8 rounded-lg px-3 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
            option === value
              ? 'bg-card font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {name}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The board's look-and-feel settings, as they will appear on the settings page. Here they
 * open from the prototype's frame, with a reset for its mock data.
 */
export function BoardSettingsPanel({
  side = 'right',
  onReset,
}: {
  side?: 'right' | 'bottom';
  onReset?: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label="Board settings" className="size-10">
          <SlidersHorizontal />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="shell-menu glass-thick z-50 max-h-[calc(100dvh-1.5rem)] w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-3xl px-5 py-4 outline-none"
        >
          <h2 className="pb-1 font-display font-semibold text-lg tracking-[-0.01em]">Board</h2>
          <BoardSettingsControls />
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-foreground/[0.06] font-medium text-sm outline-none hover:bg-foreground/[0.1] focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              <RotateCcw aria-hidden className="size-4" />
              Reset the mock data
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function BoardSettingsControls({ includeTheme = true }: { includeTheme?: boolean }) {
  const state = board.use();
  const [settings, setSettings] = useBoardSettings();
  const [theme, setTheme] = useThemePreference();
  const set = <K extends keyof BoardSettings>(key: K, value: BoardSettings[K]) =>
    setSettings({ ...settings, [key]: value });
  return (
    <>
      <Row label="Subtasks as cards">
        <Switch
          label="Subtasks as cards"
          checked={state.subtasksAsCards}
          onChange={(value) => update({ subtasksAsCards: value })}
        />
      </Row>
      <Row label="Priority labels" hint="Name each priority zone in a column.">
        <Switch
          label="Priority labels"
          checked={settings.zoneLabels}
          onChange={(value) => set('zoneLabels', value)}
        />
      </Row>
      <Row label="Priority on cards" hint="Mark cards that are not the default priority.">
        <Switch
          label="Priority on cards"
          checked={settings.cardPriority}
          onChange={(value) => set('cardPriority', value)}
        />
      </Row>
      <Row label="Column backgrounds">
        <Switch
          label="Column backgrounds"
          checked={settings.surfaces}
          onChange={(value) => set('surfaces', value)}
        />
      </Row>
      <Row label="Scrollbars" hint="Off, a faded edge shows where a list goes on.">
        <Switch
          label="Scrollbars"
          checked={settings.scrollbars}
          onChange={(value) => set('scrollbars', value)}
        />
      </Row>
      <Row
        label="Holding a card"
        hint="Compact folds the other priorities away. Full keeps the column as it is."
      >
        <Segmented
          label="Holding a card"
          value={settings.heldColumn}
          options={[
            ['compact', 'Compact'],
            ['full', 'Full'],
          ]}
          onChange={(value) => set('heldColumn', value)}
        />
      </Row>
      {(
        [
          ['backlogRail', 'Backlog'],
          ['closedRail', 'Closed'],
        ] as const
      ).map(([key, label]) => (
        <Row
          key={key}
          label={label}
          hint="Sticky stays at the window's edge. With board scrolls with the columns."
        >
          <Segmented
            label={label}
            value={settings[key]}
            options={[
              ['sticky', 'Sticky'],
              ['bound', 'With board'],
            ]}
            onChange={(value) => set(key, value)}
          />
        </Row>
      ))}
      {includeTheme && (
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={theme}
            options={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            onChange={setTheme}
          />
        </Row>
      )}
    </>
  );
}
