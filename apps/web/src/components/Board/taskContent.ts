import { createContext, type ReactNode } from 'react';

/** The real task's content enters at the same boundary as its synced board data. */
export const TaskContentContext = createContext<{
  body(taskId: string): ReactNode;
} | null>(null);
