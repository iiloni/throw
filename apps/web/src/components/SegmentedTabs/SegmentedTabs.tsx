import {
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { springs } from '@/lib/motion';

type Tab<TValue extends string> = {
  value: TValue;
  id: string;
  controls: string;
  label: string;
  icon: ReactNode;
};

/** The indicator draws in slightly as it goes, and grows back as it returns. */
const AWAY_SCALE = 0.9;

/**
 * Two or more tabs over their panels. With `collapsible`, choosing the selected tab again hides
 * every panel (`value` is then null) and choosing any tab brings its panel back. `drag` moves
 * the indicator by a share of a tab while a swipe is turning panels (`useTabSwipe`).
 */
export function SegmentedTabs<TValue extends string>({
  label,
  value,
  onValueChange,
  options,
  collapsible = false,
  disabled = false,
  drag,
}: {
  label: string;
  value: TValue | null;
  onValueChange: (value: TValue | null) => void;
  options: readonly [Tab<TValue>, Tab<TValue>, ...Tab<TValue>[]];
  collapsible?: boolean;
  disabled?: boolean;
  drag?: MotionValue<number>;
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

  // Which tab the indicator is over, by index, and in between as it moves.
  const position = useMotionValue(Math.max(0, index));
  const still = useMotionValue(0);
  const dragged = drag ?? still;
  const x = useTransform(() => {
    const at = position.get() + dragged.get();
    // Each step is one tab's width plus the gap between them.
    return `calc(${at * 100}% + ${at * 0.25}rem)`;
  });
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
    // A swipe hands over the indicator from where the finger left it.
    position.jump(position.get() + dragged.get());
    dragged.jump(0);
    // One that had already gone comes back at its tab; one still on its way out slides there.
    const controls = [animate(opacity, 1, spring), animate(scale, 1, spring)];
    if (opacity.get() < 0.05) position.jump(index);
    else controls.push(animate(position, index, spring));
    return () => {
      for (const control of controls) control.stop();
    };
  }, [index, reducedMotion, opacity, scale, position, dragged]);

  const count = options.length;
  return (
    <div
      role="tablist"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      className="relative grid shrink-0 gap-1 rounded-xl bg-foreground/5 p-1"
      onKeyDown={(event) => {
        if (disabled) return;
        const from =
          options.find((option) => option.id === (event.target as HTMLElement).id) ??
          options.find((option) => option.value === tabStop)!;
        const at = options.indexOf(from);
        const next =
          event.key === 'Home'
            ? options[0]
            : event.key === 'End'
              ? options[count - 1]
              : event.key === 'ArrowRight'
                ? options[(at + 1) % count]
                : event.key === 'ArrowLeft'
                  ? options[(at - 1 + count) % count]
                  : null;
        if (!next) return;
        event.preventDefault();
        // Arrows follow the open panel, and only move focus while every panel is hidden.
        if (value === null) setAnchor(next.value);
        else if (next.value !== value) onValueChange(next.value);
        document.getElementById(next.id)?.focus();
      }}
    >
      {/* Keep the spring local when a growing popover moves the entire tab strip. */}
      <motion.span
        aria-hidden
        data-tab-indicator=""
        className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-foreground/8 shadow-[inset_0_1px_0_var(--glass-highlight)]"
        // One tab's share of the strip, less its padding and the gaps between tabs.
        style={{
          x,
          opacity,
          scale,
          width: `calc((100% - ${0.5 + (count - 1) * 0.25}rem) / ${count})`,
        }}
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
