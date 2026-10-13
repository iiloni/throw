import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.42, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex flex-col items-center gap-3 px-6 pt-16 text-center"
    >
      <span className="flex size-16 items-center justify-center rounded-3xl bg-foreground/[0.06] text-muted-foreground">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="font-display font-semibold text-xl tracking-[-0.01em]">{title}</h2>
      {children && <div className="max-w-xs text-muted-foreground text-sm">{children}</div>}
    </motion.div>
  );
}
