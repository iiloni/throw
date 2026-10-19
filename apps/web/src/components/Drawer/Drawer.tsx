import { X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  type MotionStyle,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
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
 * floats above the dock, which rides above the keyboard with it. A page opened over the card
 * takes the keyboard's place rather than stacking on it, so the card glides between the two
 * instead of bouncing as one leaves and the other arrives.
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
  move = null,
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
  /**
   * Where held or selected cards are sent (ADR 0009). The header becomes it and the drawer
   * rests just tall enough to show it, its content sinking out of sight but staying mounted,
   * since a touch ends if the element it began on goes. The backlog being groomed at full
   * height keeps its place, and the move target floats at its foot instead.
   */
  move?: ReactNode;
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
  const moving = move !== null;
  const grooming = moving && detent === 'full' && !paged;
  const moveInHead = moving && !grooming;
  const carded = card !== null;
  const modal = paged || carded;
  // Read by effects that run once per opening, after the props that opened them.
  const latest = useRef({ page, card });
  latest.current = { page, card };
  // How far an open page lifts the dock. Over a card, the keyboard and a page share that
  // room, unless the page has a field of its own being typed in, which needs both.
  const closedAt = useRef(0);
  const reveal = useTransform(y, (at) => `${closedAt.current - at}px`);
  const [typingInPage, setTypingInPage] = useState(false);
  const holding = useRef(0);
  const closeTop = () => (paged ? onClosePage() : card?.onClose());
  // A docked page stays while the drawer settles, so closing it never shows what is beneath.
  const [leaving, setLeaving] = useState<DrawerPage | null>(null);
  const last = useRef(page);
  const shown = page ?? leaving;

  const offsets = () => {
    const at = drawerOffsets(
      surface.current,
      head.current,
      safe.current,
      page?.fit ? body.current : null,
    );
    closedAt.current = at.closed;
    return at;
  };
  const restingAt = (at: ReturnType<typeof offsets>) =>
    moveInHead ? at.closed : sunk ? at.sunk : paged ? at.page : at[detent];

  function settle(next: Detent) {
    // Let go at the height it was at: there is no new detent to move it.
    if (next === detent) animate(y, offsets()[next], reduced ? { duration: 0 } : springs.smooth);
    else onDetent(next);
  }

  useDrawerGesture(surface, {
    disabled: sunk || moving || gesturesDisabled,
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
    const opening = paged && !last.current;
    last.current = page;
    setLeaving(closing);
    const run = ++holding.current;
    if (placed.current) {
      // A picker opened over the card is already as high as the keyboard it replaces, hidden
      // behind it, so the dock only follows the keyboard down to where the picker ends.
      if (opening && carded && !typingInPage)
        y.jump(Math.min(y.get(), at.closed - Math.min(keyboardHeight(), at.closed - at.page)));
      const settle = () =>
        run === holding.current
          ? animate(y, restingAt(at), reduced ? { duration: 0 } : springs.smooth)
          : undefined;
      // Closing a picker over the card sends focus back to its field, and the keyboard rises a
      // moment later. The picker holds its room until then, so the card does not dip between.
      const field = latest.current.card?.focus?.current;
      const settling =
        closing && field && !typingInPage && !reduced
          ? keyboardReturn(closedAt.current - y.get(), () => run !== holding.current).then(settle)
          : Promise.resolve(settle());
      void settling.then(() => {
        if (run !== holding.current) return;
        if (closing) setLeaving((now) => (now === closing ? null : now));
        if (!paged) setTypingInPage(false);
      });
    } else y.jump(restingAt(at));
    placed.current = true;
  }, [sunk, detent, paged, page?.key, y, reduced, moveInHead]);

  // The move target opens into a grid and closes again under the card; the drawer rises and
  // falls with it so exactly the target shows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: offsets reads refs
  useLayoutEffect(() => {
    const element = head.current;
    if (!moveInHead || !element) return;
    const observer = new ResizeObserver(() =>
      animate(y, offsets().closed, reduced ? { duration: 0 } : springs.snappy),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [moveInHead, reduced, y]);

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
        // The whole visible drawer, safe area too, opens the move target under a held card.
        data-drop-expand={moveInHead ? '' : undefined}
        data-origin={page ? page.origin : origin}
        style={{ y, '--drawer-reveal': reveal } as MotionStyle}
        className={cn(
          'glass-thick fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] mx-auto flex w-full max-w-md flex-col rounded-t-[1.75rem] outline-none',
          raised ? 'z-[45]' : 'z-30',
          // Over a card, the drawer keeps its full height and the keyboard rides under the dock
          // until a page reaches past it, so a picker settles low, by the fingers.
          carded && !typingInPage
            ? 'bottom-0 [translate:0_calc(max(0px,var(--keyboard)-var(--drawer-reveal))*-1)]'
            : raised || carded
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
          {moveInHead && move}
          {page && !docked && !moveInHead && (
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
          <div hidden={(paged && !docked) || moveInHead} className="relative">
            {dock}
          </div>
        </div>
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col transition-opacity duration-150',
            // Sunk under the move target; still mounted, so a touch begun in it carries on.
            moveInHead && 'opacity-0',
          )}
          style={{ '--drawer-hidden': `${hidden}px` } as CSSProperties}
        >
          {shown ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: notes where focus went, without handling it
            <div
              ref={body}
              key={shown.key}
              inert={!page}
              onFocus={(event) => {
                if (carded && page && typing(event.target)) setTypingInPage(true);
              }}
              className={cn('flex min-h-0 flex-col', shown.fit ? 'max-h-full' : 'flex-1')}
            >
              {shown.content}
            </div>
          ) : (
            children
          )}
          {grooming && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col justify-end">
              <div
                data-drop-expand=""
                className="glass-thick pointer-events-auto rounded-t-[1.75rem] px-3 pt-3 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.25)]"
              >
                {move}
              </div>
            </div>
          )}
        </div>
      </motion.section>
    </>
  );
}

function keyboardHeight() {
  return Number.parseFloat(document.documentElement.style.getPropertyValue('--keyboard')) || 0;
}

function typing(element: EventTarget) {
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element.matches('textarea, input:not([type="checkbox"], [type="radio"], [type="button"])'))
  );
}

/**
 * Resolves once the keyboard has risen past `height` or come to rest, or after a while if it
 * never comes, as with a hardware keyboard.
 */
function keyboardReturn(height: number, cancelled: () => boolean) {
  const start = performance.now();
  return new Promise<void>((resolve) => {
    let previous = -1;
    const step = () => {
      if (cancelled()) return;
      const keyboard = keyboardHeight();
      const rested = keyboard > 0 && keyboard === previous;
      if (keyboard >= height || rested || performance.now() - start > 600) return resolve();
      previous = keyboard;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
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
