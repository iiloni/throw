import { AnimatePresence, type MotionValue } from 'motion/react';
import {
  type ComponentProps,
  createContext,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { DockFace } from './DockFace';
import { type Detent, Drawer, type DrawerPage } from './Drawer';

type DrawerProps = ComponentProps<typeof Drawer>;

/**
 * What a screen shows in the shell's drawer (ADR 0009): the drawer's own props, less the ones
 * the host owns. Left out, a screen's drawer is a dock at rest with nothing to pull up, out of
 * sight while it has no dock.
 */
export type DrawerSlot = Pick<DrawerProps, 'label' | 'dock'> &
  Partial<Omit<DrawerProps, 'label' | 'dock' | 'screen'>> & {
    /**
     * Names the dock, so a screen whose dock differs from the last one's fades it in across
     * that one, while a screen like the last (another project's board) keeps it still.
     */
    face?: string;
    /** A pull on the page that the drawer rides, as a settings page's does. */
    pull?: MotionValue<number>;
  };

type Lent = { page: DrawerPage; close: () => void };
type Shown = { id: string | null; slot: DrawerSlot | null; lent: Lent | null };

/**
 * The screens' slots and the pages lent over them. The newest slot is the screen on show; a
 * page lent over it (a management form, the project switcher) takes the drawer until it is
 * recalled, and closing the newest one shows any opened before it again.
 */
function createHost() {
  const slots = new Map<string, DrawerSlot>();
  const lent = new Map<string, Lent>();
  const listeners = new Set<() => void>();
  let shown: Shown = { id: null, slot: null, lent: null };
  const publish = () => {
    const id = [...slots.keys()].at(-1) ?? null;
    shown = {
      id,
      slot: id === null ? null : (slots.get(id) ?? null),
      lent: [...lent.values()].at(-1) ?? null,
    };
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => shown,
    /** Sets a screen's slot; a slot already set keeps its place among the others. */
    slot(id: string, slot: DrawerSlot | null) {
      if (slot) slots.set(id, slot);
      else if (!slots.delete(id)) return;
      publish();
    },
    lend(id: string, page: DrawerPage, close: () => void) {
      lent.set(id, { page, close });
      publish();
    },
    recall(id: string) {
      if (lent.delete(id)) publish();
    },
  };
}
type Host = ReturnType<typeof createHost>;

const HostContext = createContext<Host | null>(null);
const LentContext = createContext(false);

type Wrap = (node: ReactNode) => ReactNode;
const unwrapped: Wrap = (node) => node;
const BridgeContext = createContext<Wrap>(unwrapped);

/**
 * The phone's one drawer, owned by the shell (ADR 0009). Screens hand it what to show with
 * `useDrawerSlot` and pages with `useLentDrawerPage`; the drawer stays mounted as screens
 * change, so its glass stays where it is and its dock trades faces rather than being drawn
 * again. While a lent page shows, the rest of the app is inert behind it. Without `enabled`
 * (a desktop, which has no drawer) it renders its children alone, and the hooks do nothing.
 */
export function DrawerHost({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [host] = useState(createHost);
  const lentOpen = useSyncExternalStore(host.subscribe, () => host.get().lent !== null) && enabled;
  useEffect(() => {
    if (!lentOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [lentOpen]);
  return (
    <HostContext.Provider value={enabled ? host : null}>
      <LentContext.Provider value={lentOpen}>
        <div className="contents" inert={lentOpen}>
          {children}
        </div>
        {enabled && <ShellDrawer host={host} />}
      </LentContext.Provider>
    </HostContext.Provider>
  );
}

const NONE = '';
const CLOSED: readonly Detent[] = ['closed'];
const noop = () => {};

function ShellDrawer({ host }: { host: Host }) {
  const { id, slot, lent } = useSyncExternalStore(host.subscribe, host.get);
  const page = lent?.page ?? slot?.page ?? null;
  const dock = slot?.dock ?? null;
  const sunk = slot?.sunk ?? (!dock && !page && !slot?.card);
  const face = slot && dock ? (slot.face ?? slot.label) : NONE;
  // A dock arriving in a drawer that showed none is simply there, as the drawer rises with it
  // or is placed under it; only one dock taking another's place fades across it.
  const [faces, setFaces] = useState({ face, round: 0 });
  if (faces.face !== face)
    setFaces({ face, round: faces.face === NONE ? faces.round + 1 : faces.round });

  const element = useRef<HTMLDivElement>(null);
  const pull = slot?.pull;
  useEffect(() => {
    if (!pull) return;
    // `translate` composes with the drawer's own transform, which springs its heights.
    const follow = (y: number) => {
      const drawer = element.current?.querySelector<HTMLElement>('[data-drawer]');
      if (drawer) drawer.style.translate = y ? `0 ${y}px` : '';
    };
    follow(pull.get());
    const stop = pull.on('change', follow);
    return () => {
      stop();
      follow(0);
    };
  }, [pull]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: contains keyboard focus for the dialog descendant
    <div
      ref={element}
      className="contents"
      inert={sunk && !page}
      onKeyDown={lent ? containFocus : undefined}
    >
      <Drawer
        label={slot?.label ?? 'Drawer'}
        screen={id}
        dock={
          <AnimatePresence key={faces.round} initial={false}>
            <DockFace key={face}>{dock}</DockFace>
          </AnimatePresence>
        }
        detent={slot?.detent ?? 'closed'}
        // A screen that follows the drawer's heights has all three unless it names its own.
        detents={slot?.detents ?? (slot?.onDetent ? undefined : CLOSED)}
        onDetent={slot?.onDetent ?? noop}
        sunk={sunk}
        page={page}
        onClosePage={lent ? lent.close : (slot?.onClosePage ?? noop)}
        origin={slot?.origin}
        // A lent page is pulled down to close it, whatever the screen beneath allows; a bare
        // dock has nothing above it to pull up.
        gesturesDisabled={lent ? false : (slot?.gesturesDisabled ?? !page)}
        raised={slot?.raised}
        card={slot?.card}
        move={slot?.move}
        floatMove={slot?.floatMove}
        onSettle={slot?.onSettle}
      >
        {/* A new screen's content is its own, as its dock is, never the last screen's reused. */}
        <Fragment key={id ?? NONE}>{slot?.children ?? null}</Fragment>
      </Drawer>
    </div>
  );
}

/**
 * Shows `slot` in the shell's drawer while the caller is mounted; the newest caller's slot is
 * the one shown. Pass it on every render: the drawer follows it as the caller's own `<Drawer>`
 * would. A no-op without a host, as on a desktop.
 */
export function useDrawerSlot(slot: DrawerSlot | null) {
  const host = useContext(HostContext);
  const wrap = useContext(BridgeContext);
  const id = useId();
  useLayoutEffect(() => {
    host?.slot(id, slot && bridgeSlot(slot, wrap));
  });
  useLayoutEffect(() => () => host?.slot(id, null), [host, id]);
}

/**
 * Lends `page` to the shell's drawer while it is set, over whatever the screen's slot shows.
 * Returns whether a drawer shows it; without a host, the caller shows it itself.
 */
export function useLentDrawerPage(page: DrawerPage | null, close: () => void) {
  const host = useContext(HostContext);
  const wrap = useContext(BridgeContext);
  const id = useId();
  const open = page !== null;
  useLayoutEffect(() => {
    if (!host || !open) return;
    return () => host.recall(id);
  }, [host, open, id]);
  useLayoutEffect(() => {
    // Keyed by its lender too, so one lent page taking another's place is a new page.
    if (host && page)
      host.lend(id, { ...page, key: `${id}:${page.key}`, content: wrap(page.content) }, close);
  });
  return host !== null;
}

/** Whether a page lent to the drawer is open over the screen, which is inert behind it. */
export function useLentDrawerPageOpen() {
  return useContext(LentContext);
}

/**
 * The drawer draws a screen's content in the shell, outside the screen's own tree, so the
 * contexts that content reads would be the shell's. A boundary that provides contexts its
 * drawer content needs (a board's task content, say) wraps its screens in a bridge, and the
 * content is wrapped in those providers again on its way to the drawer.
 */
export function DrawerBridge({ wrap, children }: { wrap: Wrap; children: ReactNode }) {
  const outer = useContext(BridgeContext);
  const value = useMemo<Wrap>(
    () => (outer === unwrapped ? wrap : (node) => outer(wrap(node))),
    [outer, wrap],
  );
  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

function bridgeSlot(slot: DrawerSlot, wrap: Wrap): DrawerSlot {
  if (wrap === unwrapped) return slot;
  // Empty content stays empty: the drawer reads a missing dock or move target as none.
  const bridge = (node: ReactNode) => (node === null || node === undefined ? node : wrap(node));
  return {
    ...slot,
    dock: bridge(slot.dock),
    children: bridge(slot.children),
    move: bridge(slot.move),
    page: slot.page && { ...slot.page, content: bridge(slot.page.content) },
    card: slot.card && { ...slot.card, content: bridge(slot.card.content) },
  };
}

/** The screen behind a modal page is inert; keep Tab's endpoints inside the drawer too. */
function containFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const dialog = event.currentTarget.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) return;
  const fields = [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((field) => field.getClientRects().length > 0 && !field.closest('[inert]'));
  const first = fields[0];
  const last = fields.at(-1);
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}
