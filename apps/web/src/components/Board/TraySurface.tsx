import { cn } from '@/lib/utils';

/** The prototype's bottom tray, shared by the project board and task controls. */
export const traySurface = 'glass-thick flex flex-col rounded-t-[1.75rem]';

export function TrayGrip({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('mx-auto h-1 w-9 rounded-full bg-foreground/20', className)} />
  );
}
