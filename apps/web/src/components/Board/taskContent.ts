import { createContext, type ReactNode } from 'react';
import type { DrawerPage } from '@/components/Drawer/Drawer';

/** What the open task shows in the phone's drawer (ADR 0009): its dock, and a page over it. */
export type TaskDrawerContent = {
  dock: ReactNode;
  page: DrawerPage | null;
  closePage(): void;
};

/** The real task's content enters at the same boundary as its synced board data. */
export const TaskContentContext = createContext<{
  body(taskId: string): ReactNode;
  /** Set while a task is open on a phone; the shell's drawer shows it in place of the board's own dock. */
  drawer?: TaskDrawerContent | null;
} | null>(null);

/** A selection's panels beyond moving it, which the boundary fills with real data. */
export type SelectionPanel = 'priority' | 'size' | 'tags';

/**
 * What a board's selection can do besides move: the real boards' boundaries supply pickers and
 * the trash, and the mock prototype, which has none, only moves.
 */
export type SelectionContent = {
  /** Size is offered only while the server keeps it. */
  sizes: boolean;
  /** A picker for the selected tasks. Tags are offered only for tasks of one project. */
  panel(panel: SelectionPanel, taskIds: string[], onDone: () => void): ReactNode;
  /** Moves the tasks to the trash, with a way to undo it. */
  trash(taskIds: string[]): void;
};

export const SelectionContentContext = createContext<SelectionContent | null>(null);
