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
  /** Set while a task is open on a phone; the board's drawer shows it in place of its own. */
  drawer?: TaskDrawerContent | null;
} | null>(null);
