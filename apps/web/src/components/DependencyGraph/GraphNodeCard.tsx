import { Ban, Check, X } from 'lucide-react';
import { motion } from 'motion/react';
import { type KeyboardEvent, type MouseEvent, memo } from 'react';
import { PriorityIcon, StatusGlyph } from '@/components/Board/glyphs';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BOTTLENECK_AT } from './analysis';
import { type GraphNode, nodeLabel } from './graphModel';

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 92;

/**
 * How a node stands while something is singled out: the task in focus, its chain of blockers
 * and dependents, what a highlight marks, or the rest, which fades back.
 */
export type NodeEmphasis = 'focus' | 'chain' | 'marked' | 'dimmed' | 'normal';

function StateBadge({ node }: { node: GraphNode }) {
  if (node.state === 'ready')
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand/15 px-1.5 py-px font-medium text-[0.6875rem] text-brand-link">
        <span aria-hidden className="size-1.5 rounded-full bg-brand" />
        Ready
      </span>
    );
  if (node.state === 'blocked')
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-destructive/12 px-1.5 py-px font-medium text-[0.6875rem] text-destructive">
        <Ban aria-hidden className="size-3" />
        {node.blockedBy > 1 ? `Blocked · ${node.blockedBy}` : 'Blocked'}
      </span>
    );
  const Icon = node.state === 'done' ? Check : X;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-1.5 py-px font-medium text-[0.6875rem] text-foreground/60">
      <Icon aria-hidden className="size-3" strokeWidth={2.5} />
      {node.state === 'done' ? 'Done' : 'Cancelled'}
    </span>
  );
}

/**
 * A task in the graph, drawn as the board's calm card at a fixed size: key and state on top,
 * the title, then its status, priority and how much work waits on it. Ready work carries a
 * jade edge, blocked work a red one, and closed work steps back.
 */
export const GraphNodeCard = memo(function GraphNodeCard({
  node,
  x,
  y,
  open,
  emphasis,
  critical,
  waiting,
  reduced,
  onOpen,
  onPoint,
  onFocusNode,
  onKeyDown,
}: {
  node: GraphNode;
  x: number;
  y: number;
  open: boolean;
  emphasis: NodeEmphasis;
  critical: boolean;
  /** Open tasks waiting on this one, further down included. */
  waiting: number;
  reduced: boolean;
  onOpen: (node: GraphNode, element: HTMLElement) => void;
  onPoint: (id: string | null) => void;
  onFocusNode: (id: string | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void;
}) {
  const closed = node.state === 'done' || node.state === 'cancelled';
  const bottleneck = !closed && waiting >= BOTTLENECK_AT;
  return (
    <motion.button
      type="button"
      data-graph-node={node.id}
      data-state={node.state}
      data-emphasis={emphasis}
      data-critical={critical ? '' : undefined}
      data-color={node.color ?? undefined}
      aria-label={`${nodeLabel(node)}${bottleneck ? `, ${waiting} tasks wait on it` : ''}`}
      aria-current={open ? 'true' : undefined}
      initial={reduced ? false : { opacity: 0, scale: 0.94, x, y }}
      animate={{ opacity: emphasis === 'dimmed' ? 0.35 : closed ? 0.7 : 1, scale: 1, x, y }}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.94 }}
      transition={reduced ? { duration: 0 } : springs.smooth}
      onClick={(event: MouseEvent<HTMLButtonElement>) => onOpen(node, event.currentTarget)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') onPoint(node.id);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') onPoint(null);
      }}
      onFocus={() => onFocusNode(node.id)}
      onBlur={() => onFocusNode(null)}
      onKeyDown={(event) => onKeyDown(event, node.id)}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        'absolute top-0 left-0 flex cursor-pointer select-none flex-col overflow-hidden rounded-2xl border px-3.5 pt-2.5 pb-2 text-left text-card-foreground outline-none [-webkit-touch-callout:none]',
        'shadow-[0_1px_2px_oklch(0_0_0/0.06)] transition-[box-shadow,border-color] hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/60',
        node.color ? 'border-transparent bg-tint' : 'border-border bg-card',
        node.external && 'border-foreground/25 border-dashed',
        critical && 'ring-2 ring-priority-high/80',
        emphasis === 'focus' && 'shadow-lg',
        open && 'ring-2 ring-brand',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-3 left-1 w-[3px] rounded-full',
          node.state === 'ready' && 'bg-brand',
          node.state === 'blocked' && 'bg-destructive/80',
        )}
      />
      <span className="flex min-w-0 items-center gap-1.5 text-foreground/55 text-xs">
        <span className="shrink-0 font-medium tabular-nums">{node.identifier}</span>
        {node.external && node.projectName && (
          <span className="min-w-0 truncate">· {node.projectName}</span>
        )}
        <span className="flex-1" />
        <StateBadge node={node} />
      </span>
      <span
        className={cn(
          'mt-1 line-clamp-2 font-medium text-[0.875rem] leading-snug [overflow-wrap:anywhere]',
          node.state === 'cancelled' && 'line-through decoration-foreground/40',
        )}
      >
        {node.title || 'Untitled task'}
      </span>
      <span className="mt-auto flex min-w-0 items-center gap-1.5 text-foreground/55 text-xs">
        <StatusGlyph category={node.category} color={node.statusColor} className="size-3" />
        <span className="min-w-0 truncate">{node.statusName}</span>
        <span className="flex-1" />
        {bottleneck && (
          <span className="shrink-0 rounded-md bg-foreground/[0.07] px-1.5 font-medium text-foreground/70 tabular-nums">
            Frees {waiting}
          </span>
        )}
        {!closed && <PriorityIcon priority={node.priority} className="size-3.5" />}
      </span>
    </motion.button>
  );
});
