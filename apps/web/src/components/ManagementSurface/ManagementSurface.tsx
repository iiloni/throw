import type { ReactNode, RefObject } from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { useLentDrawerPage, useLentDrawerPageOpen } from '@/components/Drawer/DrawerHost';
import { useDesktop } from '@/lib/media';

/**
 * A management form or picker: on a phone, a page lent to the shell's drawer (ADR 0009) over
 * whatever screen is open, board or not, with the screen inert behind it; on a desktop, a
 * centred dialog.
 */
export function ManagementSurface({
  open,
  title,
  children,
  onClose,
  initialFocusRef,
  fit = false,
  dismiss,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** On a phone, rise only as far as the content needs, as a short list does. */
  fit?: boolean;
  /** The field the surface opens on, so typing can start at once. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** On a phone, steps back within the surface before Back or Escape closes it. */
  dismiss?: () => boolean;
}) {
  const desktop = useDesktop();
  const hosted = useLentDrawerPage(
    open && !desktop
      ? {
          key: 'management',
          title,
          fit,
          dismiss,
          focus: initialFocusRef,
          content: (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
              {children}
            </div>
          ),
        }
      : null,
    onClose,
  );
  if (!desktop && hosted) return null;
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
 * Whether a phone management page is currently open above the screen, so page-level gestures
 * behind it can stand down cleanly.
 */
export const useManagementSurfaceOpen = useLentDrawerPageOpen;
