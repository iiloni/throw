import { Redo2, Undo2 } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useCallback, useSyncExternalStore } from 'react';
import type { EditorControls } from '@/components/DescriptionEditor/editorControls';
import { FloatingToolbar } from '@/components/FloatingToolbar/FloatingToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

const noSubscribe = () => () => {};
const noState = () => null;

/**
 * Whether an editor has anything to undo or redo, which is when its history toolbar shows.
 * Only that answer re-renders the caller, not every move of the caret.
 */
export function useHasHistory(controls: EditorControls | null) {
  const hasHistory = useCallback(() => {
    const state = controls?.getState();
    return !!state && (state.canUndo || state.canRedo);
  }, [controls]);
  return useSyncExternalStore(controls?.subscribe ?? noSubscribe, hasHistory);
}

/**
 * Catch's undo and redo for the task's description. It shows once the description has
 * history, and its buttons never take focus, so the caret and keyboard stay where they were.
 */
export function HistoryToolbar({
  controls,
  floating = false,
  hidden = false,
  className,
}: {
  controls: EditorControls | null;
  /** Above a phone's dock, sliding in from the side, rather than in the pane's header. */
  floating?: boolean;
  /** Slides the toolbar away for something that takes its place. */
  hidden?: boolean;
  className?: string;
}) {
  const state = useSyncExternalStore(
    controls?.subscribe ?? noSubscribe,
    controls?.getState ?? noState,
  );

  return (
    <AnimatePresence>
      {state && (state.canUndo || state.canRedo) && !hidden && (
        <FloatingToolbar
          key="history"
          label="Undo and redo"
          from={floating ? 'left' : 'top'}
          // In the header it wears the header's pills beside it.
          surfaceClassName={floating ? undefined : 'rounded-full'}
          className={className}
        >
          {[
            { label: 'Undo', icon: Undo2, enabled: state.canUndo, run: controls?.undo },
            { label: 'Redo', icon: Redo2, enabled: state.canRedo, run: controls?.redo },
          ].map(({ label, icon: Icon, enabled, run }) => (
            <IconButton
              key={label}
              label={label}
              disabled={!enabled}
              // Keep the selection and virtual keyboard while tapping history controls.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                haptics.selection();
                run?.();
              }}
              tooltipSide={floating ? 'top' : 'bottom'}
              className={cn(
                '[&_svg]:size-5',
                floating ? 'size-11 rounded-[calc(var(--dock-radius)-0.25rem)]' : 'size-10',
              )}
            >
              <Icon />
            </IconButton>
          ))}
        </FloatingToolbar>
      )}
    </AnimatePresence>
  );
}
