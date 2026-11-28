import { X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  type MotionStyle,
  type MotionValue,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  type CSSProperties,
  type FocusEventHandler,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { useBackHandler } from '@/lib/backButton';
import { haptics } from '@/lib/haptics';
import { animateSteadySpring, springs, stopSteady } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { trackDrawerTravel } from './travel';
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
  /**
   * The page opens at half height, as the backlog does, and is pulled up to full and back.
   * Pulled down past half, it closes. Not for a page that fits its content.
   */
  half?: boolean;
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
  /** The floating card element, for gestures that track the whole card. */
  surfaceRef?: RefObject<HTMLDivElement | null>;
  /** Vertical drag offset while a swipe gesture moves the card. */
  y?: MotionValue<number>;
  /** Leave without shrinking into the dock button, once the card lets go (expanding into a task). */
  instantExit?: RefObject<boolean>;
  onClose: () => void;
};

/**
 * The phone's one drawer (ADR 0009): a glass surface along the bottom edge whose collapsed
 * header is the dock. It rests at three heights, pulled between them by its header. A page
 * replaces what it shows at full height, at its own height when it fits its content, or at
 * half height when it asks to, from where it is pulled up to full, and closing the page
 * returns it to the height it was at. A docked page keeps the dock above it. A held card
 * sinks it out of the way, unless it is full and its own list is being reordered. Raised, it
 * sits above a full-screen view such as an open task, and its dock rides above the keyboard as
 * a note's dock does in Catch. A page that fits its content rides above the keyboard too, raised
 * or not, so it follows the keyboard frame by frame even while it is still sliding open; a full
 * or half page ends above the keyboard instead, so its input stays in view. A
 * card floats above the dock, which rides above the keyboard with it. A page opened over the card
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
  floatMove = false,
  onSettle,
  screen = null,
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
  /**
   * The move target is a selection's, chosen from what the drawer shows: while the drawer is
   * open, at half height or on a half page, it floats at the foot as it does over the groomed
   * backlog, so the list stays in view and more of it can be chosen (ADR 0009).
   */
  floatMove?: boolean;
  /** The drawer has come to rest after sliding: work that would hold up its frames can run. */
  onSettle?: () => void;
  /**
   * The screen whose drawer this is, for the shell's drawer that screens share. A screen
   * arriving with nothing in sight, or leaving with nothing, places the drawer at once rather
   * than sliding it: it comes and goes with its page, as each screen's own drawer did.
   */
  screen?: string | null;
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
  // The half page pulled up to full, by key; another page, or this one reopened, starts at half.
  const [expanded, setExpanded] = useState<string | null>(null);
  if (expanded !== null && expanded !== page?.key) setExpanded(null);
  const halfPage = !!page?.half && !page.fit;
  const pageHalf = halfPage && expanded !== page?.key;
  const docked = paged && !!page.dock;
  const moving = move !== null;
  const grooming =
    moving &&
    ((detent === 'full' && !paged) || (floatMove && (paged ? halfPage : detent !== 'closed')));
  const moveInHead = moving && !grooming;
  const carded = card !== null;
  // A fitted page is lifted by the keyboard instead: shortening the surface would move every
  // offset it rests at, and a slide under way could only chase the keyboard there.
  const pageAboveKeyboard = paged && !carded && !page.fit;
  const modal = paged || carded;
  // Read by effects that run once per opening, after the props that opened them.
  const latest = useRef({ page, card, onSettle });
  latest.current = { page, card, onSettle };
  // Retained past the render where `card` clears so an expand can exit without shrinking back.
  const cardExit = useRef<RefObject<boolean> | undefined>(undefined);
  if (card) cardExit.current = card.instantExit;
  const instantCardExit = Boolean(cardExit.current?.current);
  // How far an open page lifts the dock. Over a card, the keyboard and a page share that
  // room, unless the page has a field of its own being typed in, which needs both.
  const closedAt = useRef(0);
  const reveal = useTransform(y, (at) => `${closedAt.current - at}px`);
  // Holds the floating move target at the foot of the screen, wherever the drawer rests.
  const onScreen = useTransform(y, (at) => -at);
  const [typingInPage, setTypingInPage] = useState(false);
  const holding = useRef(0);
  const closeTop = () => (paged ? onClosePage() : card?.onClose());
  // A closing page stays while the drawer settles: a docked page, so closing it never shows what
  // is beneath, and any page going down into the dock, where what is beneath would only mount
  // out of sight, in the frames the drawer needs to start sliding. It stays from the render that
  // closes it, so what is beneath is never mounted and taken down again before the slide.
  const [leaving, setLeaving] = useState<DrawerPage | null>(null);
  const last = useRef(page);
  const collapsing = moveInHead || sunk || detent === 'closed';
  const outgoing = (from: DrawerPage | null) =>
    !page && from && (from.dock || collapsing) ? from : null;
  const shown = page ?? leaving ?? outgoing(last.current);
  // A page opened over one still leaving takes its place outright, as it would from a closed
  // drawer: there is nothing to cross-fade from, and the closed page would linger as a second
  // copy of a form until its fade ran.
  const [opened, setOpened] = useState(0);
  const [pageOpen, setPageOpen] = useState(paged);
  if (paged !== pageOpen) {
    setPageOpen(paged);
    if (paged) setOpened((count) => count + 1);
  }

  const offsets = () => {
    const at = drawerOffsets(
      surface.current,
      head.current,
      safe.current,
      page?.fit ? body.current : null,
    );
    if (pageHalf) at.page = at.half;
    closedAt.current = at.closed;
    return at;
  };
  // Where the drawer is sliding to, for `drawerTravel`, and the slide under way.
  const rest = useRef(0);
  const sliding = useRef<Promise<void> | null>(null);
  const halt = () => {
    sliding.current = null;
    stopSteady(y);
    y.stop();
  };
  const place = (to: number) => {
    halt();
    y.jump(to);
  };
  // The drawer slides by painted frames rather than by the clock (`animateSteadySpring`).
  // Opening or closing a page mounts its content in the slide's first frame, and on a phone
  // that frame ran long enough for a timed spring to land most of the way in one jump.
  // Resolves when the slide completes; never, if another one takes over first.
  // With reduced motion the drawer is placed at once, in the frame that changed it. A
  // zero-length animation would still land a frame later, showing the old height first.
  const slide = (to: number, spring = springs.smooth) => {
    rest.current = to;
    if (reduced) {
      place(to);
      latest.current.onSettle?.();
      return;
    }
    const run = animateSteadySpring(y, to, spring);
    sliding.current = run;
    void run.then(() => {
      if (sliding.current !== run) return;
      sliding.current = null;
      latest.current.onSettle?.();
    });
    return run;
  };
  const restingAt = (at: ReturnType<typeof offsets>) =>
    moveInHead ? at.closed : sunk ? at.sunk : paged ? at.page : at[detent];

  function settle(next: Detent) {
    // Let go at the height it was at: there is no new detent to move it.
    if (next === detent) slide(offsets()[next]);
    else {
      // Coming to rest at another height is a choice among the drawer's heights.
      haptics.selection();
      onDetent(next);
    }
  }

  // Measured once per pull: reading the drawer's heights on every touch move made each move
  // wait on a style and layout pass. Nothing a pull moves changes them.
  const pulled = useRef<ReturnType<typeof offsets> | null>(null);
  const pullOffsets = () => {
    pulled.current ??= offsets();
    return pulled.current;
  };
  useDrawerGesture(surface, {
    disabled: sunk || moving || gesturesDisabled,
    onMove: (dy) => {
      halt();
      // Pulled before it settled, the drawer shows what is beneath again.
      if (leaving) setLeaving(null);
      const at = pullOffsets();
      // A half page rises to full; any other page no higher than where it rests.
      const top = paged && !halfPage ? at.page : 0;
      y.set(Math.min(at.closed, Math.max(top, y.get() + dy)));
    },
    onEnd: (offset, velocity) => {
      const at = pullOffsets();
      pulled.current = null;
      if (page && halfPage) {
        // Settles at the nearer of its two heights, as the backlog does, and closes when let go
        // past half on its way down or flung toward the dock.
        const aim = y.get() + velocity * 0.15;
        const heights = { full: 0, half: at.half, closed: at.closed };
        const nearest = (['full', 'half', 'closed'] as const).reduce((best, next) =>
          Math.abs(heights[next] - aim) < Math.abs(heights[best] - aim) ? next : best,
        );
        if (nearest === 'closed' || (y.get() > at.half && (offset > 100 || velocity > 500))) {
          haptics.selection();
          onClosePage();
        } else if ((nearest === 'full') === pageHalf) {
          haptics.selection();
          setExpanded(nearest === 'full' ? page.key : null);
        } else slide(at.page);
        return;
      }
      if (paged) {
        if (offset > 100 || velocity > 500) {
          haptics.selection();
          onClosePage();
        } else slide(at.page);
        return;
      }
      const aim = y.get() + velocity * 0.15;
      const nearest = detents.reduce((best, next) =>
        Math.abs(at[next] - aim) < Math.abs(at[best] - aim) ? next : best,
      );
      settle(nearest);
    },
    onCancel: () => {
      pulled.current = null;
      slide(restingAt(offsets()));
    },
  });

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    return trackDrawerTravel(element, () => (sliding.current ? rest.current - y.get() : 0));
  }, [y]);

  useBackHandler(detent !== 'closed' && !paged, () => onDetent('closed'));
  const dismissPage = useRef(page?.dismiss);
  dismissPage.current = page?.dismiss;
  useBackHandler(paged, () => {
    if (!dismissPage.current?.()) onClosePage();
  });
  useBackHandler(carded && !paged, () => latest.current.card?.onClose());

  const placed = useRef(false);
  const [, redraw] = useState(0);
  const lastScreen = useRef(screen);
  const wasSunk = useRef(sunk);
  // biome-ignore lint/correctness/useExhaustiveDependencies: placement follows these inputs
  useLayoutEffect(() => {
    const at = offsets();
    setHidden((detent === 'half' && !paged) || pageHalf ? at.half : 0);
    const instant = !placed.current || (screen !== lastScreen.current && (sunk || wasSunk.current));
    lastScreen.current = screen;
    wasSunk.current = sunk;
    const closing = instant ? null : outgoing(last.current);
    // Placed at once, the closing page goes with the screen; this render drew it, so draw again.
    if (instant && outgoing(last.current)) redraw((count) => count + 1);
    const opening = paged && !last.current;
    last.current = page;
    setLeaving(closing);
    const run = ++holding.current;
    if (!instant) {
      // A picker opened over the card is already as high as the keyboard it replaces, hidden
      // behind it, so the dock only follows the keyboard down to where the picker ends.
      if (opening && carded && !typingInPage)
        place(Math.min(y.get(), at.closed - Math.min(keyboardHeight(), at.closed - at.page)));
      const settle = () => (run === holding.current ? slide(restingAt(at)) : undefined);
      // Closing a picker over the card sends focus back to its field, and the keyboard rises a
      // moment later. The picker holds its room until then, so the card does not dip between.
      const field = latest.current.card?.focus?.current;
      const settling =
        closing?.dock && field && !typingInPage && !reduced
          ? keyboardReturn(closedAt.current - y.get(), () => run !== holding.current).then(settle)
          : Promise.resolve(settle());
      void settling.then(() => {
        if (run !== holding.current) return;
        if (closing) setLeaving((now) => (now === closing ? null : now));
        if (!paged) setTypingInPage(false);
      });
    } else place(restingAt(at));
    placed.current = true;
  }, [sunk, detent, paged, page?.key, pageHalf, y, reduced, moveInHead, screen]);

  // A dock that changes height at rest, as one screen's taking another's place may, takes the
  // drawer with it. A slide or a pull under way already aims for the new height.
  const resting = useRef((): number => 0);
  resting.current = () => restingAt(offsets());
  // biome-ignore lint/correctness/useExhaustiveDependencies: slide reads refs
  useLayoutEffect(() => {
    const element = head.current;
    if (moveInHead || !element) return;
    let measured = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      if (element.offsetHeight === measured) return;
      measured = element.offsetHeight;
      if (sliding.current || pulled.current) return;
      const to = resting.current();
      if (Math.abs(to - y.get()) > 0.5) slide(to);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [moveInHead, reduced, y]);

  // The move target floating over a groomed backlog covers its foot, so the list keeps that
  // much room clear at its end too.
  const footer = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  useLayoutEffect(() => {
    const element = footer.current;
    if (!grooming || !element) {
      setFooterHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => setFooterHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [grooming]);

  // A page that fits its content and then changes height, as a picker moving between its
  // lists does, takes the drawer with it. It follows the content's own animation frame by
  // frame rather than springing after it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: offsets reads refs
  useLayoutEffect(() => {
    const element = body.current;
    if (!paged || !page?.fit || !element) return;
    let measured = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      if (element.offsetHeight === measured) return;
      measured = element.offsetHeight;
      pulled.current = null;
      place(offsets().page);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [paged, page?.fit, page?.key, y]);

  // The move target opens into a grid and closes again under the card; the drawer rises and
  // falls with it so exactly the target shows. A target that names its view
  // (`data-move-view`), as a selection's pickers do, is treated as a fitted page is: a new view
  // springs the drawer to its height, and a change within one, such as a picker moving between
  // its tabs, is followed frame by frame rather than chased by a second spring.
  // biome-ignore lint/correctness/useExhaustiveDependencies: offsets reads refs
  useLayoutEffect(() => {
    const element = head.current;
    if (!moveInHead || !element) return;
    const viewOf = () =>
      element.querySelector('[data-move-view]')?.getAttribute('data-move-view') ?? null;
    // Unknown until first observed, so a view already in place when the target mounts
    // springs the drawer to it as any new view does.
    let view: string | null = null;
    const observer = new ResizeObserver(() => {
      const next = viewOf();
      if (next !== null && next === view) {
        const to = offsets().closed;
        place(to);
        // Drawn now, in the frame the view changed height: the value alone is drawn a frame
        // later, and the drawer would trail the view's own spring by that frame.
        if (surface.current) surface.current.style.transform = `translateY(${to}px)`;
      } else slide(offsets().closed, next === null ? springs.snappy : springs.smooth);
      view = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [moveInHead, reduced, y]);

  useLayoutEffect(() => {
    const onResize = () => {
      pulled.current = null;
      const at = offsets();
      place(restingAt(at));
      setHidden((detent === 'half' && !paged) || pageHalf ? at.half : 0);
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

  // A page that takes another's place, as a picker's form does and Back undoes, takes focus
  // with it: what had focus went with the page it was on. Switching tabs keeps it on the tab.
  const lastKey = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the page shown
  useEffect(() => {
    const previous = lastKey.current;
    lastKey.current = page?.key;
    if (!page || previous === undefined || previous === page.key) return;
    if (head.current?.contains(document.activeElement)) return;
    (page.focus?.current ?? surface.current)?.focus({ preventScroll: true });
  }, [page?.key]);

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
        data-drawer=""
        data-detent={detent}
        data-sunk={sunk && !moveInHead && !paged ? '' : undefined}
        data-page={page?.key}
        data-page-height={halfPage ? (pageHalf ? 'half' : 'full') : undefined}
        data-drop-block=""
        // The whole visible drawer, safe area too, opens the move target under a held card.
        data-drop-expand={moveInHead ? '' : undefined}
        data-origin={page ? page.origin : origin}
        style={{ y, '--drawer-reveal': reveal } as MotionStyle}
        // A layer of its own (`will-change`), as Catch's dock is over a note: sliding moves the
        // painted drawer instead of painting it again, with all its cards, on every frame. A
        // transform, unlike opacity or a filter, leaves the glass blurring the board behind it.
        className={cn(
          'fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] mx-auto flex w-full max-w-md flex-col rounded-t-[1.75rem] border border-transparent outline-none will-change-transform',
          raised ? 'z-[45]' : 'z-30',
          // Over a card, the drawer keeps its full height and the keyboard rides under the dock
          // until a page reaches past it, so a picker settles low, by the fingers.
          carded && !typingInPage
            ? 'bottom-0 [translate:0_calc(max(0px,var(--keyboard)-var(--drawer-reveal))*-1)]'
            : // A full page ends above the keyboard even when raised so its top stays in view.
              pageAboveKeyboard
              ? 'bottom-[var(--keyboard)]'
              : raised || carded || paged
                ? 'bottom-0 [translate:0_calc(var(--keyboard)*-1)]'
                : 'bottom-0',
        )}
      >
        {/* The glass continues behind the keyboard's corners while the form stays above it. */}
        <div
          aria-hidden
          className={cn(
            'glass-thick pointer-events-none absolute -inset-x-px -top-px -z-10 rounded-[inherit]',
            pageAboveKeyboard && !page.fit
              ? 'bottom-[calc(-1px-min(var(--keyboard),1.25rem))]'
              : '-bottom-px',
          )}
        />
        <AnimatePresence custom={instantCardExit}>
          {card && (
            <motion.div
              ref={card.surfaceRef}
              key={card.key}
              data-drawer-card=""
              // Writing in the card again puts away a page opened over it.
              onFocusCapture={() => {
                if (paged) onClosePage();
              }}
              // Sits behind the drawer's -z-10 glass so the card's shadow never paints over the dock.
              className="absolute inset-x-3 bottom-full -z-20 mb-3 flex max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--dock-height)-3rem)] flex-col overflow-hidden rounded-[28px] bg-card text-card-foreground shadow-[0_24px_60px_-12px_oklch(0_0_0/0.45)]"
              // Grows out of the dock's create button, below the card's bottom-right corner.
              style={{
                transformOrigin: 'calc(100% - 2rem) calc(100% + 3rem)',
                ...(card.y ? { y: card.y } : {}),
              }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              exit="leave"
              variants={{
                // Expanding, the card holds still until what it opened has painted beneath
                // it, then goes at once (the card's content decides when).
                leave: (instant: boolean) =>
                  instant && !reduced
                    ? { opacity: 1, transition: { duration: 0 } }
                    : reduced
                      ? { opacity: 0, transition: { duration: 0 } }
                      : { opacity: 0, scale: 0.3, y: 0, transition: springs.smooth },
              }}
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
            'relative shrink-0 touch-none select-none px-3 pt-3',
            // The dock sits a little higher off the bottom edge than the header of an open drawer.
            detent === 'closed' && !paged ? 'pb-4' : 'pb-2',
          )}
        >
          {/* The move target and the dock trade places, as the board's dock and a task's do. */}
          <AnimatePresence initial={false}>
            {moveInHead && (
              <MoveFace key="move" reduced={!!reduced}>
                {move}
              </MoveFace>
            )}
          </AnimatePresence>
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
          <motion.div
            hidden={(paged && !docked) || moveInHead}
            className="relative origin-top"
            initial={false}
            // Gone at once under the move target, which takes its place, and back as it leaves.
            animate={moveInHead ? { opacity: 0, scale: 0.92 } : { opacity: 1, scale: 1 }}
            transition={reduced || moveInHead ? { duration: 0 } : springs.smooth}
          >
            {dock}
          </motion.div>
        </div>
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col transition-opacity duration-150',
            // Sunk under the move target; still mounted, so a touch begun in it carries on.
            moveInHead && 'opacity-0',
          )}
          style={{ '--drawer-hidden': `${hidden + footerHeight}px` } as CSSProperties}
        >
          {shown ? (
            // One page taking another's place, as the dock's tabs do, fades across on the
            // drawer's own spring while the drawer moves to the new page's height, as Catch's
            // note toolbar fades its panels with their height. The leaving page lifts out of
            // the flow so the drawer measures only the new one.
            <AnimatePresence key={opened} initial={false} mode="popLayout">
              <PageBody
                key={shown.key}
                bodyRef={body}
                live={!!page}
                reduced={!!reduced}
                onFocus={(event) => {
                  if (carded && page && typing(event.target)) setTypingInPage(true);
                }}
                className={cn(
                  'flex min-h-0 flex-col',
                  // A fitted page lifted by the keyboard keeps to the room above it.
                  shown.fit ? 'max-h-[calc(100%-var(--keyboard))]' : 'flex-1',
                )}
              >
                {shown.content}
              </PageBody>
            </AnimatePresence>
          ) : (
            children
          )}
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col justify-end"
            style={{ y: onScreen }}
          >
            <AnimatePresence initial={false}>
              {grooming && (
                <MoveFooter key="move" footerRef={footer} reduced={!!reduced}>
                  {move}
                </MoveFooter>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.section>
    </>
  );
}

/**
 * The move target in the drawer's header. A leaving one lifts out of the flow, so the drawer
 * measures only the dock coming back, and is inert, so a quick second tap cannot land on it.
 */
function MoveFace({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  const present = useIsPresent();
  return (
    <motion.div
      aria-hidden={!present || undefined}
      inert={!present}
      className={cn('origin-top', !present && 'pointer-events-none absolute inset-x-3 top-3')}
      initial={reduced ? false : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{
        opacity: 0,
        scale: reduced ? 1 : 0.92,
        transition: { duration: reduced ? 0 : 0.16 },
      }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      {children}
    </motion.div>
  );
}

/**
 * The move target floating at the foot of the open drawer, rising in and sinking away. Its
 * glass springs to the height of what it shows, as the drawer does for the target in its
 * header, while a view arriving inside it fades across the one leaving.
 */
function MoveFooter({
  footerRef,
  reduced,
  children,
}: {
  footerRef: RefObject<HTMLDivElement | null>;
  reduced: boolean;
  children: ReactNode;
}) {
  const present = useIsPresent();
  const content = useRef<HTMLDivElement>(null);
  const height = useMotionValue(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the content once mounted
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    height.jump(element.offsetHeight);
    let measured = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      if (element.offsetHeight === measured) return;
      measured = element.offsetHeight;
      if (reduced) height.jump(measured);
      else animate(height, measured, springs.smooth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      height.stop();
    };
  }, []);
  return (
    <motion.div
      aria-hidden={!present || undefined}
      inert={!present}
      initial={reduced ? false : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: reduced ? 0 : 24, opacity: 0 }}
      transition={reduced ? { duration: 0 } : springs.snappy}
    >
      <motion.div
        data-drop-expand={present ? '' : undefined}
        style={{ height }}
        className={cn(
          'glass-thick overflow-hidden rounded-t-[1.75rem] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.25)]',
          present && 'pointer-events-auto',
        )}
      >
        <div
          ref={(element) => {
            content.current = element;
            if (present) footerRef.current = element;
          }}
          className="px-3 pt-3 pb-[calc(var(--safe-bottom)+0.5rem)]"
        >
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** A page's content. Only the page arriving or shown is the drawer's body; a leaving one is inert. */
function PageBody({
  ref,
  bodyRef,
  live,
  reduced,
  onFocus,
  className,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  bodyRef: RefObject<HTMLDivElement | null>;
  live: boolean;
  reduced: boolean;
  onFocus: FocusEventHandler<HTMLDivElement>;
  className: string;
  children: ReactNode;
}) {
  const isPresent = useIsPresent();
  const own = useRef<HTMLDivElement>(null);
  // Before the drawer's own layout effects, which measure the body to place the drawer.
  useLayoutEffect(() => {
    if (!isPresent) return;
    bodyRef.current = own.current;
    return () => {
      if (bodyRef.current === own.current) bodyRef.current = null;
    };
  }, [isPresent, bodyRef]);
  return (
    <motion.div
      ref={(element: HTMLDivElement | null) => {
        own.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      // A leaving page stays drawn while the drawer settles, but is gone to everything else.
      inert={!live || !isPresent}
      aria-hidden={!live || !isPresent || undefined}
      onFocus={onFocus}
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      // Gone quickly, as Catch's reminder pages leave, so the two never read as one muddle.
      exit={{
        opacity: 0,
        transition: reduced ? { duration: 0 } : { duration: 0.16, ease: 'easeIn' },
      }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      {children}
    </motion.div>
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
