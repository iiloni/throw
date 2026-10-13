import { FlaskConical, RotateCcw } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { useThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { DEFAULT_VARIANTS, resetBoard, useVariants, type Variants } from './state';

function Choice<T extends string | boolean>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: [value: T, label: string][];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="py-2">
      <legend className="font-medium text-sm">{label}</legend>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      <div className="mt-1.5 flex gap-1 rounded-xl bg-foreground/[0.06] p-1">
        {options.map(([option, name]) => (
          <button
            key={String(option)}
            type="button"
            aria-pressed={option === value}
            onClick={() => onChange(option)}
            className={cn(
              'h-8 min-w-0 flex-1 truncate rounded-lg px-2 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
              option === value
                ? 'bg-card font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Switches between the alternatives under test. Exists only in the prototype. */
export function PrototypePanel({ side = 'right' }: { side?: 'right' | 'bottom' }) {
  const [variants, setVariants] = useVariants();
  const [theme, setTheme] = useThemePreference();
  const set = <K extends keyof Variants>(key: K, value: Variants[K]) =>
    setVariants({ ...variants, [key]: value });
  const group = (title: string, children: ReactNode) => (
    <section className="border-border border-t pt-2 first:border-t-0 first:pt-0">
      <h3 className="font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
        {title}
      </h3>
      {children}
    </section>
  );
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label="Prototype options" className="size-10">
          <FlaskConical />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="shell-menu glass-thick z-50 max-h-[calc(100dvh-1.5rem)] w-80 max-w-[calc(100vw-1.5rem)] space-y-2 overflow-y-auto rounded-3xl p-4 outline-none"
        >
          {group(
            'Priority zones',
            <>
              <Choice
                label="At rest"
                hint="What marks the zones when nothing is held."
                value={variants.zonesAtRest}
                options={[
                  ['always', 'Labels'],
                  ['edge', 'Edge mark'],
                  ['drag', 'Nothing'],
                ]}
                onChange={(value) => set('zonesAtRest', value)}
              />
              <Choice
                label="Under a held card"
                hint="Stretch folds the other zones into rails. In place keeps the column and dims them."
                value={variants.zoneModel}
                options={[
                  ['stretch', 'Stretch'],
                  ['inPlace', 'In place'],
                ]}
                onChange={(value) => set('zoneModel', value)}
              />
              <Choice
                label="Priority on the card"
                value={variants.priorityGlyph}
                options={[
                  [true, 'Chevrons'],
                  [false, 'Hidden'],
                ]}
                onChange={(value) => set('priorityGlyph', value)}
              />
            </>,
          )}
          {group(
            'Drag',
            <Choice
              label="Lift"
              value={variants.lift}
              options={[
                ['tilt', 'Leans as it moves'],
                ['flat', 'Stays level'],
              ]}
              onChange={(value) => set('lift', value)}
            />,
          )}
          {group(
            'Subtasks',
            <>
              <Choice
                label="Tapping a subtask"
                value={variants.subtaskTap}
                options={[
                  ['popout', 'Pop-out card'],
                  ['open', 'Opens it'],
                ]}
                onChange={(value) => set('subtaskTap', value)}
              />
              <Choice
                label="Status on the parent card"
                value={variants.subtaskStatusInPlace}
                options={[
                  [true, 'Changeable'],
                  [false, 'Shown only'],
                ]}
                onChange={(value) => set('subtaskStatusInPlace', value)}
              />
            </>,
          )}
          {group(
            'Phone moves',
            <Choice
              label="Sending a card to any status"
              hint="Hold a card to lift it. Lift and set down to select."
              value={variants.phoneMoves}
              options={[
                ['grid', 'Dock grid'],
                ['strip', 'Dock strip'],
                ['sheet', 'Move sheet'],
              ]}
              onChange={(value) => set('phoneMoves', value)}
            />,
          )}
          {group(
            'Layout',
            <>
              <Choice
                label="Backlog and closed width"
                value={variants.sideWidth}
                options={[
                  ['compact', 'Compact'],
                  ['roomy', 'Roomy'],
                ]}
                onChange={(value) => set('sideWidth', value)}
              />
              <Choice
                label="Column surfaces"
                hint="A faint surface behind each zone and column, as in Catch's deck."
                value={variants.surfaces}
                options={[
                  [true, 'Shown'],
                  [false, 'Bare'],
                ]}
                onChange={(value) => set('surfaces', value)}
              />
              <Choice
                label="Theme"
                value={theme}
                options={[
                  ['system', 'System'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
                onChange={setTheme}
              />
            </>,
          )}
          <button
            type="button"
            onClick={() => {
              resetBoard();
              setVariants(DEFAULT_VARIANTS);
            }}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-foreground/[0.06] font-medium text-sm outline-none hover:bg-foreground/[0.1] focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <RotateCcw aria-hidden className="size-4" />
            Reset data and options
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
