import { X } from 'lucide-react';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { Dialog } from 'radix-ui';
import { type ReactNode, type RefObject, useRef } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { useBackHandler } from '@/lib/backButton';
import { useMedia } from '@/lib/media';
import { springs } from '@/lib/motion';

/** Catch's glass sheet, with a centred dialog on desktop and dragging confined to the grip. */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  initialFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  useBackHandler(open, () => onOpenChange(false));
  const opener = useRef<HTMLElement | null>(null);
  const controls = useDragControls();
  const desktop = useMedia('(min-width: 768px)');
  const reduced = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/30"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.25 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              onOpenAutoFocus={(event) => {
                const active = document.activeElement;
                opener.current =
                  active instanceof HTMLElement &&
                  active.matches('button, a') &&
                  !active.closest('[role=menu]')
                    ? active
                    : document.querySelector<HTMLElement>('[data-shell-menu]');
                if (initialFocusRef?.current) {
                  event.preventDefault();
                  initialFocusRef.current.focus();
                }
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const target = opener.current?.isConnected
                  ? opener.current
                  : document.querySelector<HTMLElement>('[data-shell-menu]');
                target?.focus();
              }}
            >
              <motion.div
                className="glass-thick fixed inset-x-3 bottom-[calc(var(--keyboard)+max(var(--safe-bottom),0.75rem))] z-50 mx-auto flex max-h-[min(85dvh,calc(100dvh-var(--keyboard)-var(--safe-top)-max(var(--safe-bottom),0.75rem)-1rem))] max-w-md flex-col rounded-[28px] pb-4 outline-none md:top-1/2 md:bottom-auto md:-translate-y-1/2"
                initial={{ y: reduced ? 0 : desktop ? 16 : '110%', opacity: desktop ? 0 : 1 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: reduced ? 0 : desktop ? 16 : '110%', opacity: desktop ? 0 : 1 }}
                transition={reduced ? { duration: 0 } : springs.smooth}
                drag={desktop ? false : 'y'}
                dragControls={controls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 100 || info.velocity.y > 500) onOpenChange(false);
                }}
              >
                <div
                  aria-hidden
                  className="flex touch-none justify-center pt-2.5 pb-1 md:hidden"
                  onPointerDown={(event) => controls.start(event)}
                >
                  <span className="h-1 w-9 rounded-full bg-foreground/20" />
                </div>
                <div className="flex items-center justify-between px-5 pt-3 pb-3">
                  <Dialog.Title className="font-display font-semibold text-xl tracking-[-0.01em]">
                    {title}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <IconButton label="Close">
                      <X />
                    </IconButton>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
                <div className="min-h-0 overflow-y-auto overscroll-contain px-5">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
