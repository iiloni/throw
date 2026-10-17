import type { Status, Task } from '@throw/shared';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { board, current } from '@/components/Board/state';
import { TrayGrip, traySurface } from '@/components/Board/TraySurface';
import { IconButton } from '@/components/IconButton/IconButton';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { useBackHandler } from '@/lib/backButton';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { panelTitle, TaskControls, type TaskPanel, TaskPanelContent } from './TaskControls';

const panelHeight: Record<TaskPanel, number> = { status: 304, priority: 304, tags: 384, more: 176 };

/**
 * The task pane's own drawer on desktop, where the shell has none (ADR 0009). It owns the
 * chrome, gestures, Escape and Back around the same controls and panels a phone shows in the
 * board's drawer.
 */
export function TaskDrawer({ task, statuses }: { task: Task; statuses: Status[] }) {
  const [panel, setPanel] = useState<TaskPanel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const reduced = useReducedMotion();
  const project = current(board.use()).project;
  const collapse = useCallback(() => {
    setPanel(null);
    trigger.current?.focus({ preventScroll: true });
  }, []);
  useBackHandler(panel !== null, collapse);
  useEffect(() => {
    if (!panel) return;
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"][aria-labelledby]'))
        return;
      event.preventDefault();
      event.stopPropagation();
      collapse();
    }
    function outside(event: PointerEvent) {
      if (
        !root.current?.contains(event.target as Node) &&
        !document.querySelector('[role="dialog"][aria-labelledby]')
      )
        setPanel(null);
    }
    document.addEventListener('keydown', dismissOnEscape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('keydown', dismissOnEscape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [panel, collapse]);
  function toggle(next: TaskPanel, element: HTMLButtonElement) {
    trigger.current = element;
    setPanel(panel === next ? null : next);
  }
  return (
    <div
      ref={root}
      data-task-drawer=""
      className={cn(
        traySurface,
        'z-10 shrink-0 overflow-hidden pb-[max(var(--safe-bottom),0.5rem)]',
      )}
    >
      <motion.div
        onPanEnd={(_, info) => {
          if (info.offset.y > 35 || info.velocity.y > 300) collapse();
          else if (info.offset.y < -25) setPanel(panel ?? 'status');
        }}
        role="toolbar"
        aria-label="Task controls"
        className="flex touch-none flex-col px-3 pt-2 pb-2"
      >
        <TrayGrip className="mb-2" />
        <TaskControls
          task={task}
          statuses={statuses}
          project={project}
          onOpen={toggle}
          controlProps={(name) => ({
            'aria-expanded': panel === name,
            'aria-controls': `${id}-${name}`,
          })}
        />
      </motion.div>
      <AnimatePresence initial={false}>
        {panel && (
          <motion.div
            key={panel}
            id={`${id}-${panel}`}
            role="region"
            aria-label={panelTitle[panel]}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: panelHeight[panel], opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : springs.smooth}
            className="flex max-h-[min(50dvh,24rem)] flex-col overflow-hidden border-border border-t"
          >
            <div className="flex h-11 shrink-0 items-center justify-between px-5">
              <h2 className="font-semibold text-sm">{panelTitle[panel]}</h2>
              <IconButton label="Collapse task drawer" onClick={collapse}>
                <ChevronDown />
              </IconButton>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <ScrollAreaViewport>
                <TaskPanelContent
                  panel={panel}
                  task={task}
                  statuses={statuses}
                  project={project}
                  onDone={collapse}
                />
              </ScrollAreaViewport>
              <ScrollBar />
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
