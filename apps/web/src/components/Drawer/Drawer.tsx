import { X } from 'lucide-react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
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
  /**
   * Closes something open inside the page (a list or panel) before Back or Escape closes the
   * page itself, returning whether it did.
   */
  dismiss?: () => boolean;
  /**
   * A field the page opens on, focused in place of the drawer so the keyboard rises with it.
   * Without one, focus goes to the drawer itself.
   */
  focus?: RefObject<HTMLElement | null>;
};

/**
 * A card floating above the collapsed drawer, as Catch's quick note floats above its dock.
 * The dock beneath holds the card's controls, and a docked page opened from them rises with
 * the card riding above it.
 */
export type DrawerCard = {
  key: string;
  title: string;
  content: ReactNode;
  /** The field the card opens on; closing a page over the card returns here. */
  focus?: RefObject<HTMLElement | null>;
  onClose: () => void;
};

/**
 * The phone's one drawer (ADR 0009): a glass surface along the bottom edge whose collapsed
 * header is the dock. It rests at three heights, pulled between them by its header. A page
 * replaces what it shows at full height, or at its own height when it fits its content, and
 * closing the page returns it to the height it was at. A docked page keeps the dock above it. A held card sinks it out of the way,
 * unless it is full and its own list is being reordered. Raised, it sits above a full-screen
 * view such as an open task, and its dock rides above the keyboard as a note's dock does in
 * Catch. Otherwise an open page ends above the keyboard, so its input stays in view. A card
 * floats above the dock, which rides above the keyboard with it.
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
  card = null,
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
  card?: DrawerCard | null;
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
  const carded = card !== null;
  const modal = paged || carded;
  // Read by effects that run once per opening, after the props that opened them.
  const latest = useRef({ page, card });
  latest.current = { page, card };
  const closeTop = () => (paged ? onClosePage() : card?.onClose());
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
  const dismissPage = useRef(page?.dismiss);
  dismissPage.current = page?.dismiss;
  useBackHandler(paged, () => {
    if (!dismissPage.current?.()) onClosePage();
  });
  useBackHandler(carded && !paged, () => latest.current.card?.onClose());

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
  // close button would open its tooltip, which takes the first Escape. A page hides the dock,
  // which drops the focus of a dock button that opened it, so the opener is noted while
  // rendering, before that commit.
  const wasPaged = useRef(false);
  const wasCarded = useRef(false);
  const cardOpener = useRef<HTMLElement | null>(null);
  if (paged !== wasPaged.current || carded !== wasCarded.current) {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (paged && !wasPaged.current) opener.current = active;
    if (carded && !wasCarded.current) cardOpener.current = active;
    wasPaged.current = paged;
    wasCarded.current = carded;
  }
  useEffect(() => {
    if (!paged) return;
    (latest.current.page?.focus?.current ?? surface.current)?.focus({ preventScroll: true });
    return () => {
      // Over a card, closing a page goes back to writing it.
      const field = latest.current.card?.focus?.current;
      if (field?.isConnected) return field.focus({ preventScroll: true });
      // A docked page closed from its own tab leaves focus on that tab.
      if (head.current?.contains(document.activeElement)) return;
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, [paged]);
  useEffect(() => {
    if (!carded) return;
    (latest.current.card?.focus?.current ?? surface.current)?.focus({ preventScroll: true });
    return () => {
      if (cardOpener.current?.isConnected) cardOpener.current.focus({ preventScroll: true });
    };
  }, [carded]);

  // Switching tabs makes the new tab the one focus returns to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the page shown
  useEffect(() => {
    const active = document.activeElement;
    if (docked && active instanceof HTMLElement && head.current?.contains(active))
      opener.current = active;
  }, [docked, page?.key]);

  useEffect(() => {
    if (!modal) return;
    function close(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"]')) return;
      event.preventDefault();
      if (!paged) latest.current.card?.onClose();
      else if (!dismissPage.current?.()) onClosePage();
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [modal, paged, onClosePage]);

  return (
    <>
      <AnimatePresence>
        {modal && (
          <motion.div
            key="scrim"
            aria-hidden
            className={cn('fixed inset-0 bg-black/30', raised ? 'z-[45]' : 'z-30')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.25 }}
            onClick={closeTop}
          />
        )}
      </AnimatePresence>
      <motion.section
        ref={surface}
        role={modal ? 'dialog' : undefined}
        aria-modal={modal || undefined}
        aria-label={page?.title ?? card?.title ?? label}
        tabIndex={-1}
        data-detent={detent}
        data-page={page?.key}
        data-drop-block=""
        data-origin={page ? page.origin : origin}
        style={{ y }}
        className={cn(
          'glass-thick fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] mx-auto flex w-full max-w-md flex-col rounded-t-[1.75rem] outline-none',
          raised ? 'z-[45]' : 'z-30',
          raised || (carded && !paged)
            ? 'bottom-0 [translate:0_calc(var(--keyboard)*-1)]'
            : paged
              ? 'bottom-[var(--keyboard)]'
              : 'bottom-0',
        )}
      >
        <AnimatePresence>
          {card && (
            <motion.div
              key={card.key}
              data-drawer-card=""
              // Writing in the card again puts away a page opened over it.
              onFocusCapture={() => {
                if (paged) onClosePage();
              }}
              className="absolute inset-x-3 bottom-full mb-3 flex max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--dock-height)-3rem)] flex-col overflow-hidden rounded-[28px] bg-card text-card-foreground shadow-[0_24px_60px_-12px_oklch(0_0_0/0.45)]"
              // Grows out of the dock's create button, below the card's bottom-right corner.
              style={{ transformOrigin: 'calc(100% - 2rem) calc(100% + 3rem)' }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : { opacity: 0, scale: 0.3, transition: springs.smooth }
              }
              transition={reduced ? { duration: 0 } : springs.bouncy}
            >
              {card.content}
            </motion.div>
          )}
        </AnimatePresence>
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
