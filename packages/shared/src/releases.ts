import { z } from 'zod';

export const releaseChannelSchema = z.enum(['stable', 'preview', 'dev']);

/** Static web build metadata; deliberately outside the service worker's precache. */
export const webBuildSchema = z.object({ id: z.uuid() });
export type WebBuild = z.infer<typeof webBuildSchema>;
