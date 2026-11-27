import { useUpdateReady } from '@/lib/updateReady';
import { cn } from '@/lib/utils';

/**
 * A small brand dot on the ways into Settings while an update is waiting, after Catch's. It is
 * only drawn: the control it marks says so with `aria-description` (`UPDATE_READY_DESCRIPTION`),
 * so its name stays its own and nothing is announced twice.
 */
export function UpdateDot({ className }: { className?: string }) {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <span
      aria-hidden
      data-update-dot=""
      className={cn('size-2 shrink-0 rounded-full bg-brand', className)}
    />
  );
}
