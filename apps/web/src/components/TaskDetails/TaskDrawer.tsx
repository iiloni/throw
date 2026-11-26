import type { Status, Task } from '@throw/shared';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { projectOf } from '@/components/Board/model';
import { board, current } from '@/components/Board/state';
import { ScrollBox } from '@/components/ui/scroll-area';
import { useBackHandler } from '@/lib/backButton';
import { springs } from '@/lib/motion';
import {
  type DockPanel,
  panelTitle,
  TaskControls,
  TaskDockRow,
  type TaskPanel,
  TaskPanelContent,
  useOpenTaskPanel,
} from './TaskControls';

/**
 * The task's dock on desktop, below its card, as Catch's split view docks a note's controls
 * (ADR 0009: desktop has no drawer). A panel grows the dock upward, over the card's foot. It owns
 * the Escape, Back and outside-tap dismissal around the same controls and panels a phone
 * shows in the board's drawer.
 */
export function TaskDrawer({ task, statuses }: { task: Task; statuses: Status[] }) {
  const [panel, setPanel] = useState<TaskPanel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const id = useId();
  const reduced = useReducedMotion();
  const project = projectOf(current(board.use()).project, task);
  const collapse = useCallback(() => {
    setPanel(null);
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
  }, []);
  useOpenTaskPanel(
    task.id,
    useCallback(
      (next, element) => {
        if (panel === next && element && trigger.current === element) {
          collapse();
          return;
        }
        if (element) trigger.current = element;
        setPanel(next);
      },
      [panel, collapse],
    ),
  );
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
      const target = event.target as Node;
      if (
        !root.current?.contains(target) &&
        !trigger.current?.contains(target) &&
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
  function toggle(next: DockPanel, element: HTMLButtonElement) {
    trigger.current = element;
    setPanel(panel === next ? null : next);
  }
  const content = panel && (
    <TaskPanelContent
      panel={panel}
      task={task}
      statuses={statuses}
      project={project}
      onDone={collapse}
      onLink={() => setPanel('relations')}
      onClose={collapse}
    />
  );
  // The dock keeps its place in the pane's flow below the card, so it rises with the keyboard
  // and the safe area. As Catch's split view docks a note, it is one glass surface of a fixed
  // width that grows upward over the card's foot to show a panel, with no header of its own.
  // The panel comes after the controls in the DOM so Tab reaches it from the control that
  // opened it.
  return (
    <div
      ref={root}
      data-task-drawer=""
      className="relative mt-3 flex h-[var(--dock-height)] shrink-0 justify-center"
    >
      <div className="glass absolute bottom-0 z-10 flex w-full max-w-md flex-col overflow-hidden rounded-[var(--dock-radius)]">
        <div className="order-last">
          <TaskDockRow>
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
          </TaskDockRow>
        </div>
        {/* As Catch's note toolbar: each panel grows out of the dock on its own, so moving to
            another folds the last one away as the next one opens. */}
        <AnimatePresence initial={false}>
          {panel && (
            <DockPanelFrame
              key={panel}
              id={`${id}-${panel}`}
              label={panelTitle[panel]}
              reduced={!!reduced}
            >
              {panel === 'relations' || panel === 'tags' ? (
                // These scroll their own lists beneath fixed controls.
                <div className="flex max-h-[min(55dvh,28rem)] flex-col overflow-hidden [--tags-max:min(55dvh,28rem)]">
                  {content}
                </div>
              ) : (
                <ScrollBox className="max-h-[min(55dvh,28rem)] [--scrollbar-inset:0.5rem]">
                  {content}
                </ScrollBox>
              )}
            </DockPanelFrame>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** One panel of the dock. A leaving one is inert, so Tab and clicks only reach the next one. */
function DockPanelFrame({
  id,
  label,
  reduced,
  children,
}: {
  id: string;
  label: string;
  reduced: boolean;
  children: ReactNode;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      id={id}
      role="region"
      aria-label={label}
      inert={!isPresent}
      className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      {children}
    </motion.div>
  );
}
