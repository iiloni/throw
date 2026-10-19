import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { Drawer, type DrawerPage } from '@/components/Drawer/Drawer';
import { useMedia } from '@/lib/media';

// Settings and trash have no dock at rest. Their shell-owned drawer exists only while a
// form or confirmation is open; TagManager can use the same host as the surrounding screen.
const SurfaceContext = createContext<{
  show: (id: string, page: DrawerPage, close: () => void) => void;
  hide: (id: string) => void;
} | null>(null);

export function ManagementSurfaceProvider({
  children,
  active,
}: {
  children: ReactNode;
  active: boolean;
}) {
  const phone = useMedia('(max-width: 767px)');
  const [surface, setSurface] = useState<{
    id: string;
    page: DrawerPage;
    close: () => void;
  } | null>(null);
  const host = useMemo(
    () => ({
      show: (id: string, page: DrawerPage, close: () => void) => setSurface({ id, page, close }),
      hide: (id: string) => setSurface((current) => (current?.id === id ? null : current)),
    }),
    [],
  );
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
        <div className="contents" inert={!surface} onKeyDown={containFocus}>
          <Drawer
            label={surface?.page.title ?? 'Management'}
            dock={null}
            detent="closed"
            onDetent={() => {}}
            page={surface?.page ?? null}
            sunk={!surface}
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
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const host = useContext(SurfaceContext);
  const desktop = useMedia('(min-width: 768px)');
  const id = useId();
  useEffect(() => {
    if (!open || desktop || !host) return;
    host.show(
      id,
      {
        key: id,
        title,
        content: (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
            {children}
          </div>
        ),
      },
      onClose,
    );
    return () => host.hide(id);
  }, [open, desktop, host, id, title, children, onClose]);
  if (!desktop && host) return null;
  return (
    <BottomSheet
      open={open}
      title={title}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      {children}
    </BottomSheet>
  );
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
