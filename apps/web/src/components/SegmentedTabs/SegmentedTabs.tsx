import {
  animate,
  type MotionValue,
  motion,
  motionValue,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { afterPaint, animateSteadySpring, springs, stopSteady } from '@/lib/motion';

export type Tab<TValue extends string> = {
  value: TValue;
  id: string;
  controls: string;
  label: string;
  icon: ReactNode;
  /** Quiet mark after the label, such as a dot for an open blocker. */
  badge?: ReactNode;
  /** Animated out of the tab strip when its content moves elsewhere (e.g. the side column). */
  hidden?: boolean;
};

/** The indicator draws in slightly as it goes, and grows back as it returns. */
const AWAY_SCALE = 0.9;
/** Below this tablist width (px) with 3+ visible tabs, inactive tabs collapse to icons only. */
const COMPACT_WIDTH = 368;
/** Relative flex weight of the active tab when inactive tabs show icons only. */
const ACTIVE_WEIGHT = 2.2;

/**
 * Segmented tabs over their panels. With `collapsible`, choosing the selected tab again hides
 * all panels (`value` is then null) and choosing any tab brings its panel back. `drag` moves
 * the indicator by a share of a tab while a swipe is turning panels (`useTabSwipe`). A tab can
 * animate in and out via `hidden` on `springs.pane`, and on narrow containers with 3+ visible
 * tabs inactive tabs show only their icons while the active tab expands to show its label.
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
  options: readonly Tab<TValue>[];
  collapsible?: boolean;
  disabled?: boolean;
  drag?: MotionValue<number>;
}) {
  const reducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(0);
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const measure = () => setListWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const visible = options.filter((option) => !option.hidden);
  const compact = visible.length > 2 && listWidth > 0 && listWidth < COMPACT_WIDTH;
  // With nothing selected, the tab that keyboard focus enters on: the last one chosen, or
  // the one the arrow keys moved to.
  const [anchor, setAnchor] = useState<TValue>(value ?? visible[0]?.value ?? options[0]!.value);
  const [previous, setPrevious] = useState(value);
  if (previous !== value) {
    setPrevious(value);
    if (value !== null) setAnchor(value);
  }
  const rawStop = value ?? anchor;
  const tabStop = visible.some((option) => option.value === rawStop)
    ? rawStop
    : (visible[0]?.value ?? options[0]!.value);
  const index = visible.findIndex((option) => option.value === value);

  // Each tab's share of the strip (0 hidden, 1 shown) and label expansion (0 icon-only, 1 label).
  const presencesRef = useRef<MotionValue<number>[] | null>(null);
  const expandedRef = useRef<MotionValue<number>[] | null>(null);
  if (!presencesRef.current || presencesRef.current.length !== options.length) {
    presencesRef.current = options.map((option) => motionValue(option.hidden ? 0 : 1));
    expandedRef.current = options.map((option) =>
      motionValue(!compact || value === option.value ? 1 : 0),
    );
  }
  const presences = presencesRef.current;
  const expanded = expandedRef.current!;
  const compactMv = useMotionValue(compact ? 1 : 0);

  const firstHidden = useRef(true);
  const hiddenKey = options.map((option) => (option.hidden ? '0' : '1')).join('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: hiddenKey tracks every option's hidden flag
  useEffect(() => {
    if (firstHidden.current) {
      firstHidden.current = false;
      return;
    }
    const stops: (() => void)[] = [];
    for (let i = 0; i < options.length; i++) {
      const target = options[i]!.hidden ? 0 : 1;
      const presence = presences[i]!;
      if (reducedMotion) {
        stopSteady(presence);
        presence.jump(target);
      } else if (presence.get() !== target) {
        const cancel = afterPaint(() => {
          void animateSteadySpring(presence, target, springs.pane);
        });
        stops.push(() => {
          cancel();
          stopSteady(presence);
        });
      }
    }
    return () => {
      for (const stop of stops) stop();
    };
  }, [hiddenKey, reducedMotion]);

  // Animate compact mode and per-tab label expansion when switching tabs or resizing across the breakpoint.
  const firstCompact = useRef(true);
  const compactReady = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tracks active tab and compact state
  useLayoutEffect(() => {
    // Before the first ResizeObserver measurement arrives, jump into place without animating.
    const instant =
      reducedMotion || firstCompact.current || (!compactReady.current && listWidth > 0);
    if (firstCompact.current) firstCompact.current = false;
    if (listWidth > 0) compactReady.current = true;
    const targetCompact = compact ? 1 : 0;
    if (instant) {
      compactMv.jump(targetCompact);
      for (let i = 0; i < options.length; i++) {
        expanded[i]!.jump(!compact || value === options[i]!.value ? 1 : 0);
      }
      return;
    }
    const controls = [
      animate(compactMv, targetCompact, springs.snappy),
      ...options.map((option, i) =>
        animate(expanded[i]!, !compact || value === option.value ? 1 : 0, springs.snappy),
      ),
    ];
    return () => {
      for (const control of controls) control.stop();
    };
  }, [compact, value, listWidth > 0, reducedMotion]);

  // Which visible tab the indicator is over, and in between as it moves.
  const position = useMotionValue(Math.max(0, index));
  const still = useMotionValue(0);
  const dragged = drag ?? still;
  const visibleOptionIndices = options.flatMap((option, i) => (option.hidden ? [] : [i]));

  // Live flex weight of option `i` (accounts for presence, compact mode, and label expansion).
  const weightOf = (i: number) =>
    presences[i]!.get() * (1 + compactMv.get() * (ACTIVE_WEIGHT - 1) * expanded[i]!.get());

  const indicatorGeometry = () => {
    const weights = options.map((_, i) => weightOf(i));
    const totalWeight = Math.max(
      1,
      weights.reduce((sum, w) => sum + w, 0),
    );
    const totalPresence = Math.max(
      1,
      presences.reduce((sum, presence) => sum + presence.get(), 0),
    );
    // Horizontal padding (0.5rem) plus gaps scaled by active shares: 0.25rem * (totalPresence + 1).
    const chromeRem = 0.25 * (totalPresence + 1);
    const count = visibleOptionIndices.length;
    if (count === 0) return { leftShare: 0, leftGap: 0, widthShare: 0, chromeRem };
    const at = Math.max(0, Math.min(count - 1, position.get() + dragged.get()));
    const lo = Math.floor(at);
    const hi = Math.min(count - 1, Math.ceil(at));
    const t = at - lo;
    const slotMetrics = (visPos: number) => {
      const optIndex = visibleOptionIndices[visPos] ?? 0;
      let beforeW = 0;
      let gapP = 0;
      for (let j = 0; j < optIndex; j++) beforeW += weights[j]!;
      for (let j = 1; j <= optIndex; j++) gapP += presences[j]!.get();
      return {
        leftShare: beforeW / totalWeight,
        leftGap: gapP * 0.25,
        widthShare: weights[optIndex]! / totalWeight,
      };
    };
    const a = slotMetrics(lo);
    const b = slotMetrics(hi);
    return {
      leftShare: a.leftShare + (b.leftShare - a.leftShare) * t,
      leftGap: a.leftGap + (b.leftGap - a.leftGap) * t,
      widthShare: a.widthShare + (b.widthShare - a.widthShare) * t,
      chromeRem,
    };
  };

  const width = useTransform(() => {
    const { widthShare, chromeRem } = indicatorGeometry();
    return `calc(${widthShare} * (100% - ${chromeRem}rem))`;
  });
  // Express horizontal offset in terms of the indicator's own width (leftShare / widthShare * 100%)
  // so the pill stays GPU-composited on `transform` even when tabs have unequal widths.
  const x = useTransform(() => {
    const { leftShare, leftGap, widthShare } = indicatorGeometry();
    const pct = widthShare > 0 ? (leftShare / widthShare) * 100 : 0;
    return `calc(${pct}% + ${leftGap}rem)`;
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

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      data-compact={compact ? '' : undefined}
      className="relative flex shrink-0 rounded-xl bg-foreground/5 p-1"
      onKeyDown={(event) => {
        if (disabled || visible.length === 0) return;
        const byTarget = visible.findIndex(
          (option) => option.id === (event.target as HTMLElement).id,
        );
        const fromIndex = Math.max(
          0,
          byTarget >= 0 ? byTarget : visible.findIndex((option) => option.value === tabStop),
        );
        const next =
          event.key === 'Home'
            ? visible[0]
            : event.key === 'End'
              ? visible[visible.length - 1]
              : event.key === 'ArrowRight'
                ? visible[(fromIndex + 1) % visible.length]
                : event.key === 'ArrowLeft'
                  ? visible[(fromIndex - 1 + visible.length) % visible.length]
                  : null;
        if (!next) return;
        event.preventDefault();
        // Arrows follow the open panel, and only move focus while all are hidden.
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
        style={{ width, x, opacity, scale }}
      />
      {options.map((option, i) => (
        <TabSlot
          key={option.value}
          option={option}
          presence={presences[i]!}
          expanded={expanded[i]!}
          compactMv={compactMv}
          first={i === 0}
          selected={value === option.value}
          collapsible={collapsible}
          tabStop={tabStop === option.value}
          disabled={disabled}
          onSelect={() => {
            if (value !== option.value) onValueChange(option.value);
            else if (collapsible) onValueChange(null);
          }}
        />
      ))}
    </div>
  );
}

function TabSlot<TValue extends string>({
  option,
  presence,
  expanded,
  compactMv,
  first,
  selected,
  collapsible,
  tabStop,
  disabled,
  onSelect,
}: {
  option: Tab<TValue>;
  presence: MotionValue<number>;
  expanded: MotionValue<number>;
  compactMv: MotionValue<number>;
  first: boolean;
  selected: boolean;
  collapsible: boolean;
  tabStop: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const labelWidth = useRef(120);
  // Keep the label's natural width fresh so collapsing/expanding interpolates smoothly.
  useLayoutEffect(() => {
    const width = labelRef.current?.scrollWidth;
    if (option.label && width && width > 0) labelWidth.current = width;
  }, [option.label]);

  const flexGrow = useTransform(
    () => presence.get() * (1 + compactMv.get() * (ACTIVE_WEIGHT - 1) * expanded.get()),
  );
  const marginLeft = useTransform(() => (first ? '0rem' : `${presence.get() * 0.25}rem`));
  // Fades in once room opens and out before getting squished, matching the side column.
  const opacity = useTransform(() => {
    const p = presence.get();
    return p >= 1 ? 1 : Math.max(0, (p - 0.3) / 0.7);
  });
  const overflow = useTransform(() => (presence.get() >= 0.999 ? 'visible' : 'hidden'));
  const visibility = useTransform(() => (presence.get() <= 0.001 ? 'hidden' : 'visible'));

  const labelMaxWidth = useTransform(() => {
    const e = expanded.get();
    if (e >= 0.999) return '100%';
    if (e <= 0.001) return '0px';
    return `${Math.max(0, e * labelWidth.current).toFixed(1)}px`;
  });
  const labelMarginLeft = useTransform(() => `${Math.max(0, expanded.get()) * 0.5}rem`);
  const labelOpacity = useTransform(() => {
    const e = expanded.get();
    return e >= 0.999 ? 1 : Math.max(0, (e - 0.25) / 0.75);
  });

  return (
    <motion.div
      inert={option.hidden}
      aria-hidden={option.hidden || undefined}
      className="flex min-w-0 basis-0"
      style={{ flexGrow, marginLeft, opacity, overflow, visibility }}
    >
      <button
        id={option.id}
        type="button"
        role="tab"
        aria-selected={selected}
        // A tab that can close its panel says whether the panel is showing.
        aria-expanded={collapsible ? selected : undefined}
        aria-controls={option.controls}
        tabIndex={tabStop ? 0 : -1}
        disabled={disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onSelect}
        className="relative flex min-h-11 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-2.5 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {option.icon}
        <motion.span
          ref={labelRef}
          className="relative min-w-0 truncate"
          style={{ maxWidth: labelMaxWidth, marginLeft: labelMarginLeft, opacity: labelOpacity }}
        >
          {option.label}
        </motion.span>
        {option.badge}
      </button>
    </motion.div>
  );
}
