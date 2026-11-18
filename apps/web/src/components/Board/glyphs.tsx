import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Category, Priority } from './model';

/**
 * A status drawn by its category, so it reads the same in every project: an open dashed ring
 * for the backlog, a half-filled one for active work, a full one for done, a struck one for
 * cancelled.
 */
export function StatusGlyph({ category, className }: { category: Category; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn('size-3.5 shrink-0', category === 'cancelled' && 'opacity-60', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        strokeDasharray={category === 'backlog' ? '2.2 2.6' : undefined}
      />
      {category === 'active' && (
        <path d="M8 4.2a3.8 3.8 0 0 1 0 7.6z" fill="currentColor" stroke="none" />
      )}
      {category === 'done' && (
        <>
          <circle cx="8" cy="8" r="6" fill="currentColor" />
          <path d="m5.4 8.2 1.8 1.8 3.4-3.8" stroke="var(--tint, var(--card))" />
        </>
      )}
      {category === 'cancelled' && <path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4" />}
    </svg>
  );
}

const PRIORITY_ICONS = [ChevronsUp, ChevronUp, null, ChevronDown, ChevronsDown] as const;

/** A card's rank. The default rank draws nothing: most cards have it, and it is not news. */
export function PriorityGlyph({
  priority,
  name,
  className,
}: {
  priority: Priority;
  name: string;
  className?: string;
}) {
  const Icon = PRIORITY_ICONS[priority - 1];
  if (!Icon) return null;
  return (
    <span
      role="img"
      aria-label={`Priority: ${name}`}
      title={name}
      className={cn('shrink-0', priority === 1 && 'text-destructive', className)}
    >
      <Icon className="size-4" strokeWidth={priority === 1 ? 2.75 : 2.25} aria-hidden />
    </span>
  );
}
