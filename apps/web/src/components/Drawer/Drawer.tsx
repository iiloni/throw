import { X } from 'lucide-react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { useBackHandler } from '@/lib/backButton';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type Detent = 'closed' | 'half' | 'full';

/** Content that takes the drawer over at full height until it is closed (ADR 0009). */
export type DrawerPage = {
  /** Names the page; a new key is a new page. */
  key: string;
  title: string;
  content: ReactNode;
  /** Where a card lifted from this page comes from, for the drag engine. */
  origin?: string;
};

/**
 * The phone's one drawer (ADR 0009): a glass surface along the bottom edge whose collapsed
 * header is the dock. It rests at three heights, pulled between them by its header. A page
 * replaces what it shows at full height, and closing the page returns it to the height it
 * was at. A held card sinks it out of the way, unless it is full and its own list is being
 * reordered.
 */
export function Drawer({
  label,
  dock,
  children,
  detent,
  onDetent,
  sunk = false,
  page,
  onClosePage,
  origin,
}: {
  label: string;
  /** The header at rest: the dock when collapsed. */
  dock: ReactNode;
  children: ReactNode;
  detent: Detent;
  onDetent: (detent: Detent) => void;
  sunk?: boolean;
  page: DrawerPage | null;
  onClosePage: () => void;
  origin?: string;
}) {
  const surface = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const safe = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const y = useMotionValue(0);
  const panFrom = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  // What the drawer leaves off screen at half height, kept clear at the end of its list.
  const [hidden, setHidden] = useState(0);
  const paged = page !== null;

  const offsets = () => drawerOffsets(surface.current, head.current, safe.current);
  const restingAt = (at: ReturnType<typeof offsets>) =>
    sunk ? at.sunk : paged ? at.full : at[detent];

  function settle(next: Detent) {
    // Let go at the height it was at: there is no new detent to move it.
    if (next === detent) animate(y, offsets()[next], reduced ? { duration: 0 } : springs.smooth);
    else onDetent(next);
  }

  useBackHandler(detent !== 'closed' && !paged, () => onDetent('closed'));
  useBackHandler(paged, onClosePage);

  const placed = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: placement follows these inputs
  useLayoutEffect(() => {
    const at = offsets();
    setHidden(detent === 'half' && !paged ? at.half : 0);
    if (placed.current) animate(y, restingAt(at), reduced ? { duration: 0 } : springs.smooth);
    else y.jump(restingAt(at));
    placed.current = true;
  }, [sunk, detent, paged, y, reduced]);

  useLayoutEffect(() => {
    const onResize = () => {
      const at = offsets();
      y.jump(restingAt(at));
      setHidden(detent === 'half' && !paged ? at.half : 0);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // A page is modal: focus moves into the drawer and returns to what opened it. Focusing the
  // close button would open its tooltip, which takes the first Escape.
  useEffect(() => {
    if (!paged) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement ? active : null;
    surface.current?.focus({ preventScroll: true });
    return () => {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, [paged]);

  useEffect(() => {
    if (!paged) return;
    function close(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"]')) return;
      event.preventDefault();
      onClosePage();
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [paged, onClosePage]);

  return (
    <>
      <AnimatePresence>
        {paged && (
          <motion.div
            key="scrim"
            aria-hidden
            className="fixed inset-0 z-30 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.25 }}
            onClick={onClosePage}
          />
        )}
      </AnimatePresence>
      <motion.section
        ref={surface}
        role={paged ? 'dialog' : undefined}
        aria-modal={paged || undefined}
        aria-label={page?.title ?? label}
        tabIndex={-1}
        data-detent={detent}
        data-page={page?.key}
        data-drop-block=""
        data-origin={page ? page.origin : origin}
        style={{ y }}
        className="glass-thick fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] bottom-0 z-30 mx-auto flex w-full max-w-md flex-col rounded-t-[1.75rem] outline-none"
      >
        <div
          ref={safe}
          aria-hidden
          className="pointer-events-none absolute h-[var(--safe-bottom)]"
        />
        <motion.div
          ref={head}
          className={cn(
            'shrink-0 touch-none select-none px-3 pt-2',
            // The dock sits a little higher off the bottom edge than the header of an open drawer.
            detent === 'closed' && !paged ? 'pb-4' : 'pb-2',
          )}
          onPanStart={() => {
            panFrom.current = y.get();
          }}
          onPan={(_, info) => {
            const at = offsets();
            y.set(Math.min(at.closed, Math.max(0, panFrom.current + info.offset.y)));
          }}
          onPanEnd={(_, info) => {
            const at = offsets();
            if (paged) {
              if (info.offset.y > 100 || info.velocity.y > 500) onClosePage();
              else animate(y, at.full, reduced ? { duration: 0 } : springs.smooth);
              return;
            }
            const aim = y.get() + info.velocity.y * 0.15;
            const nearest = (['full', 'half', 'closed'] as const).reduce((best, next) =>
              Math.abs(at[next] - aim) < Math.abs(at[best] - aim) ? next : best,
            );
            settle(nearest);
          }}
        >
          <div aria-hidden className="mx-auto mb-2 h-1 w-9 rounded-full bg-foreground/20" />
          {page ? (
            <div className="flex h-[var(--dock-height)] items-center gap-2 pl-2">
              <h2 className="flex-1 truncate font-bold font-display text-xl tracking-[-0.01em]">
                {page.title}
              </h2>
              <IconButton label="Close" className="size-11" onClick={onClosePage}>
                <X />
              </IconButton>
            </div>
          ) : (
            dock
          )}
        </motion.div>
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ '--drawer-hidden': `${hidden}px` } as CSSProperties}
        >
          {page ? (
            <div key={page.key} className="flex min-h-0 flex-1 flex-col">
              {page.content}
            </div>
          ) : (
            children
          )}
        </div>
      </motion.section>
    </>
  );
}

/** How far down the drawer sits at each detent; `sunk` is out of sight, under a held card. */
function drawerOffsets(
  surface: HTMLElement | null,
  head: HTMLElement | null,
  safe: HTMLElement | null,
) {
  const height = surface?.offsetHeight ?? window.innerHeight;
  const peek = (head?.offsetHeight ?? 0) + (safe?.offsetHeight ?? 0);
  return { full: 0, half: Math.round(height * 0.42), closed: height - peek, sunk: height };
}
