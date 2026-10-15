import { createContext } from 'react';

/** The phone surface lets Catch's edge-pull gesture observe the editor's own scroller. */
export const TaskScrollContext = createContext<((element: HTMLDivElement | null) => void) | null>(
  null,
);

/** Delay BlockNote's mount until Catch's container transform has settled. */
export const TaskEditorReadyContext = createContext(true);
