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
import { useDrawerGesture } from './useDrawerGesture';

export type Detent = 'closed' | 'half' | 'full';

/** Content that takes the drawer over until it is closed (ADR 0009). */
export type DrawerPage = {
  /** Names the page; a new key is a new page. */
  key: string;
  title: string;
  content: ReactNode;
  /** Where a card lifted from this page comes from, for the drag engine. */
  origin?: string;
  /** A short page rises only as far as its content needs, and no higher than full. */
  fit?: boolean;
  /** The dock stays as the page's header, its buttons acting as tabs over the content. */
  dock?: boolean;
};

/**
 * The phone's one drawer (ADR 0009): a glass surface along the bottom edge whose collapsed
 * header is the dock. It rests at three heights, pulled between them by its header. A page
 * replaces what it shows at full height, or at its own height when it fits its content, and
 * closing the page returns it to the height it was at. A docked page keeps the dock above it. A held card sinks it out of the way,
 * unless it is full and its own list is being reordered. Raised, it sits above a full-screen
 * view such as an open task, and its dock rides above the keyboard as a note's dock does in
 * Catch.
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
  gesturesDisabled = false,
  detents = ['closed', 'half', 'full'],
  raised = false,
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
  /** A held card owns its touch, even while grooming the fully open backlog. */
  gesturesDisabled?: boolean;
  /** The heights a pull can settle at. */
  detents?: readonly Detent[];
  raised?: boolean;
}) {
  const surface = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const safe = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const y = useMotionValue(0);
  const opener = useRef<HTMLElement | null>(null);
  // What the drawer leaves off screen at half height, kept clear at the end of its list.
  const [hidden, setHidden] = useState(0);
  const paged = page !== null;
  const docked = paged && !!page.dock;
  // A docked page stays while the drawer settles, so closing it never shows what is beneath.
  const [leaving, setLeaving] = useState<DrawerPage | null>(null);
  const last = useRef(page);
  const shown = page ?? leaving;

  const offsets = () =>
    drawerOffsets(surface.current, head.current, safe.current, page?.fit ? body.current : null);
  const restingAt = (at: ReturnType<typeof offsets>) =>
    sunk ? at.sunk : paged ? at.page : at[detent];

  function settle(next: Detent) {
    // Let go at the height it was at: there is no new detent to move it.
    if (next === detent) animate(y, offsets()[next], reduced ? { duration: 0 } : springs.smooth);
    else onDetent(next);
  }

  useDrawerGesture(surface, {
    disabled: sunk || gesturesDisabled,
    onMove: (dy) => {
      y.stop();
      const at = offsets();
      y.set(Math.min(at.closed, Math.max(paged ? at.page : 0, y.get() + dy)));
    },
    onEnd: (offset, velocity) => {
      const at = offsets();
      if (paged) {
        if (offset > 100 || velocity > 500) onClosePage();
        else animate(y, at.page, reduced ? { duration: 0 } : springs.smooth);
        return;
      }
      const aim = y.get() + velocity * 0.15;
      const nearest = detents.reduce((best, next) =>
        Math.abs(at[next] - aim) < Math.abs(at[best] - aim) ? next : best,
      );
      settle(nearest);
    },
    onCancel: () => animate(y, restingAt(offsets()), reduced ? { duration: 0 } : springs.smooth),
  });

  useBackHandler(detent !== 'closed' && !paged, () => onDetent('closed'));
  useBackHandler(paged, onClosePage);

  const placed = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: placement follows these inputs
  useLayoutEffect(() => {
    const at = offsets();
    setHidden(detent === 'half' && !paged ? at.half : 0);
    const closing = !page && last.current?.dock ? last.current : null;
    last.current = page;
    setLeaving(closing);
    if (placed.current) {
      const settling = animate(y, restingAt(at), reduced ? { duration: 0 } : springs.smooth);
      if (closing) void settling.then(() => setLeaving((now) => (now === closing ? null : now)));
    } else y.jump(restingAt(at));
    placed.current = true;
  }, [sunk, detent, paged, page?.key, y, reduced]);

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
      // A docked page closed from its own tab leaves focus on that tab.
      if (head.current?.contains(document.activeElement)) return;
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, [paged]);

  // Switching tabs makes the new tab the one focus returns to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the page shown
  useEffect(() => {
    const active = document.activeElement;
    if (docked && active instanceof HTMLElement && head.current?.contains(active))
      opener.current = active;
  }, [docked, page?.key]);

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
            className={cn('fixed inset-0 bg-black/30', raised ? 'z-[45]' : 'z-30')}
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
        className={cn(
          'glass-thick fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] bottom-0 mx-auto flex w-full max-w-md flex-col rounded-t-[1.75rem] outline-none',
          raised ? 'z-[45] [translate:0_calc(var(--keyboard)*-1)]' : 'z-30',
        )}
      >
        <div
          ref={safe}
          aria-hidden
          className="pointer-events-none absolute h-[var(--safe-bottom)]"
        />
        <div
          ref={head}
          className={cn(
            'shrink-0 touch-none select-none px-3 pt-3',
            // The dock sits a little higher off the bottom edge than the header of an open drawer.
            detent === 'closed' && !paged ? 'pb-4' : 'pb-2',
          )}
        >
          {page && !docked && (
            <div className="flex h-[var(--dock-height)] items-center gap-2 pl-2">
              <h2 className="flex-1 truncate font-bold font-display text-xl tracking-[-0.01em]">
                {page.title}
              </h2>
              <IconButton label="Close" className="size-11" onClick={onClosePage}>
                <X />
              </IconButton>
            </div>
          )}
          {/* Kept mounted under a page, so focus can return to the dock button that opened it. */}
          <div hidden={paged && !docked} className="relative">
            {dock}
          </div>
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ '--drawer-hidden': `${hidden}px` } as CSSProperties}
        >
          {shown ? (
            <div
              ref={body}
              key={shown.key}
              inert={!page}
              className={cn('flex min-h-0 flex-col', shown.fit ? 'max-h-full' : 'flex-1')}
            >
              {shown.content}
            </div>
          ) : (
            children
          )}
        </div>
      </motion.section>
    </>
  );
}

/**
 * How far down the drawer sits at each detent; `sunk` is out of sight, under a held card, and
 * `page` is where an open page rests: full, or just tall enough for a page that fits.
 */
function drawerOffsets(
  surface: HTMLElement | null,
  head: HTMLElement | null,
  safe: HTMLElement | null,
  fitted: HTMLElement | null,
) {
  const height = surface?.offsetHeight ?? window.innerHeight;
  const peek = (head?.offsetHeight ?? 0) + (safe?.offsetHeight ?? 0);
  // A page clears the safe area itself, so it rises by its header and content alone.
  const page = fitted ? Math.max(0, height - (head?.offsetHeight ?? 0) - fitted.offsetHeight) : 0;
  return { full: 0, half: Math.round(height * 0.42), closed: height - peek, sunk: height, page };
}
