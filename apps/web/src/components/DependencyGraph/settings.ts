import { z } from 'zod';
import { usePersistentState } from '@/lib/storage';

/** What the graph shows and marks, kept on the device as the board's own display settings are. */
export const graphSettingsSchema = z.object({
  showClosed: z.boolean().default(false),
  showIsolated: z.boolean().default(false),
  /** Marks the longest chain of open work, or the open work nothing blocks. */
  highlight: z.enum(['none', 'critical', 'ready']).default('none'),
});
export type GraphSettings = z.infer<typeof graphSettingsSchema>;
export type GraphHighlight = GraphSettings['highlight'];

const GRAPH_SETTINGS_KEY = 'throw-graph-settings';

export function useGraphSettings() {
  return usePersistentState(GRAPH_SETTINGS_KEY, graphSettingsSchema, graphSettingsSchema.parse({}));
}
