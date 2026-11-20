import { createContext } from 'react';

/** The phone surface lets Catch's edge-pull gesture observe the editor's own scroller. */
export const TaskScrollContext = createContext<((element: HTMLDivElement | null) => void) | null>(
  null,
);

/** Delay BlockNote's mount until Catch's container transform has settled. */
export const TaskEditorReadyContext = createContext(true);

/**
 * The width the desktop pane is set to, which the task lays out for. It is the target rather
 * than a measurement, so the pane's own open and close slide leave the layout alone. Null on a
 * phone, where the task has the whole screen and keeps its stacked layout.
 */
export const TaskPaneWidthContext = createContext<number | null>(null);
