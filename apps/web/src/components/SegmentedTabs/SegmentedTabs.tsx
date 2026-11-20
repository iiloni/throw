import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { springs } from '@/lib/motion';

type Tab<TValue extends string> = {
  value: TValue;
  id: string;
  controls: string;
  label: string;
  icon: ReactNode;
};

const offset = (index: number) => (index === 0 ? 'calc(0% + 0rem)' : 'calc(100% + 0.25rem)');
/** The indicator draws in slightly as it goes, and grows back as it returns. */
const AWAY_SCALE = 0.9;

/**
 * Two tabs over their panels. With `collapsible`, choosing the selected tab again hides both
 * panels (`value` is then null) and choosing either tab brings its panel back.
 */
export function SegmentedTabs<TValue extends string>({
  label,
  value,
  onValueChange,
  options,
  collapsible = false,
  disabled = false,
}: {
  label: string;
  value: TValue | null;
  onValueChange: (value: TValue | null) => void;
  options: readonly [Tab<TValue>, Tab<TValue>];
  collapsible?: boolean;
  disabled?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  // With nothing selected, the tab that keyboard focus enters on: the last one chosen, or
  // the one the arrow keys moved to.
  const [anchor, setAnchor] = useState<TValue>(value ?? options[0].value);
  const [previous, setPrevious] = useState(value);
  if (previous !== value) {
    setPrevious(value);
    if (value !== null) setAnchor(value);
  }
  const tabStop = value ?? anchor;
  const index = options.findIndex((option) => option.value === value);

  const x = useMotionValue(offset(Math.max(0, index)));
  const opacity = useMotionValue(value === null ? 0 : 1);
  const scale = useMotionValue(value === null ? AWAY_SCALE : 1);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const spring = reducedMotion ? { duration: 0 } : springs.snappy;
    if (index < 0) {
      // Nothing selected: the indicator leaves from where it is.
      const controls = [animate(opacity, 0, spring), animate(scale, AWAY_SCALE, spring)];
      return () => {
        for (const control of controls) control.stop();
      };
    }
    // One that had already gone comes back at its tab; one still on its way out slides there.
    const controls = [animate(opacity, 1, spring), animate(scale, 1, spring)];
    if (opacity.get() < 0.05) x.set(offset(index));
    else controls.push(animate(x, offset(index), spring));
    return () => {
      for (const control of controls) control.stop();
    };
  }, [index, reducedMotion, opacity, scale, x]);

  return (
    <div
      role="tablist"
      aria-label={label}
      className="relative grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-foreground/5 p-1"
      onKeyDown={(event) => {
        if (disabled) return;
        const from =
          options.find((option) => option.id === (event.target as HTMLElement).id) ??
          options.find((option) => option.value === tabStop)!;
        const next =
          event.key === 'Home'
            ? options[0]
            : event.key === 'End'
              ? options[1]
              : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                ? options.find((option) => option !== from)
                : null;
        if (!next) return;
        event.preventDefault();
        // Arrows follow the open panel, and only move focus while both are hidden.
        if (value === null) setAnchor(next.value);
        else if (next.value !== value) onValueChange(next.value);
        document.getElementById(next.id)?.focus();
      }}
    >
      {/* Keep the spring local when a growing popover moves the entire tab strip. */}
      <motion.span
        aria-hidden
        data-tab-indicator=""
        className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.75rem)/2)] rounded-lg bg-foreground/8 shadow-[inset_0_1px_0_var(--glass-highlight)]"
        style={{ x, opacity, scale }}
      />
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            id={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            // A tab that can close its panel says whether the panel is showing.
            aria-expanded={collapsible ? selected : undefined}
            aria-controls={option.controls}
            tabIndex={tabStop === option.value ? 0 : -1}
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!selected) onValueChange(option.value);
              else if (collapsible) onValueChange(null);
            }}
            className="relative flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {option.icon}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
