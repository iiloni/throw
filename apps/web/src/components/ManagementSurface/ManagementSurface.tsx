import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { Drawer, type DrawerPage } from '@/components/Drawer/Drawer';
import { useDesktop } from '@/lib/media';

// Trash has no dock at rest: its shell-owned drawer exists only while a form or
// confirmation is open. Settings gives it a dock that picks its pages, as Catch's dock does.
// TagManager can use the same host as the surrounding screen.
const SurfaceContext = createContext<{
  show: (id: string, page: DrawerPage, close: () => void) => void;
  hide: (id: string) => void;
  setDock: (dock: ReactNode) => void;
} | null>(null);

export function ManagementSurfaceProvider({
  children,
  active,
}: {
  children: ReactNode;
  active: boolean;
}) {
  // The same query the surfaces use, so the host and its surfaces agree on which one shows.
  const phone = !useDesktop();
  const [surface, setSurface] = useState<{
    id: string;
    page: DrawerPage;
    close: () => void;
  } | null>(null);
  const [dock, setDock] = useState<ReactNode>(null);
  const host = useMemo(
    () => ({
      show: (id: string, page: DrawerPage, close: () => void) => setSurface({ id, page, close }),
      hide: (id: string) => setSurface((current) => (current?.id === id ? null : current)),
      setDock,
    }),
    [],
  );
  const docked = dock !== null;
  const modal = surface !== null;
  useEffect(() => {
    if (!modal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [modal]);
  return (
    <SurfaceContext.Provider value={active ? host : null}>
      <div className="contents" inert={surface !== null}>
        {children}
      </div>
      {phone && active && (
        // biome-ignore lint/a11y/noStaticElementInteractions: contains keyboard focus for the dialog descendant
        <div className="contents" inert={!surface && !docked} onKeyDown={containFocus}>
          <Drawer
            label={surface?.page.title ?? 'Management'}
            dock={dock}
            detent="closed"
            detents={['closed']}
            onDetent={() => {}}
            page={surface?.page ?? null}
            sunk={!surface && !docked}
            // A bare dock has nothing above it to pull up.
            gesturesDisabled={!surface}
            onClosePage={() => surface?.close()}
          >
            {null}
          </Drawer>
        </div>
      )}
    </SurfaceContext.Provider>
  );
}

export function ManagementSurface({
  open,
  title,
  children,
  onClose,
  initialFocusRef,
  fit = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** On a phone, rise only as far as the content needs, as a short list does. */
  fit?: boolean;
  /** The field the surface opens on, so typing can start at once. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const host = useContext(SurfaceContext);
  const desktop = useDesktop();
  const id = useId();
  useEffect(() => {
    if (!open || desktop || !host) return;
    host.show(
      id,
      {
        key: id,
        title,
        fit,
        focus: initialFocusRef,
        content: (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
            {children}
          </div>
        ),
      },
      onClose,
    );
    return () => host.hide(id);
  }, [open, desktop, host, id, title, children, onClose, initialFocusRef, fit]);
  if (!desktop && host) return null;
  return (
    <BottomSheet
      open={open}
      title={title}
      initialFocusRef={initialFocusRef}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      {children}
    </BottomSheet>
  );
}

/**
 * Gives the phone's management drawer a dock while the caller is mounted. A no-op on desktop,
 * which has no drawer, and outside the shell's host.
 */
export function useManagementDock(dock: ReactNode) {
  const host = useContext(SurfaceContext);
  useEffect(() => {
    if (!host) return;
    host.setDock(dock);
  }, [host, dock]);
  useEffect(() => {
    if (!host) return;
    return () => host.setDock(null);
  }, [host]);
}

/** The management background is inert; keep Tab's endpoints inside its phone drawer too. */
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
