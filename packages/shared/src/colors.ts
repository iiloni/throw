import { z } from 'zod';

/**
 * Colors in picker order: hues around the wheel, then the earthy and neutral tones. They are
 * Catch's, so the two apps look alike. Keys are stored on rows, so rename one only with a
 * data migration; `dark-blue` shows as "Indigo" for that reason.
 */
export const COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'mint',
  'teal',
  'cyan',
  'blue',
  'dark-blue',
  'violet',
  'purple',
  'magenta',
  'pink',
  'brown',
  'gray',
] as const;

export const colorSchema = z.enum(COLORS);
export type Color = z.infer<typeof colorSchema>;
