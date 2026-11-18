import { z } from 'zod';

const errorBody = z.object({ error: z.string() });
const messages = new Map([
  [
    'Another project has this key',
    'Another project already uses this key, possibly in the trash. Choose another key. Your previous key is kept.',
  ],
  [
    'Make another status the default first',
    'This status is now the default. Choose another default before deleting it.',
  ],
  [
    'Tasks use this status',
    'Tasks now use this status, including possibly tasks in the trash. Move them before deleting it.',
  ],
]);

/** Only recognised server refusals become user-facing copy; never display an arbitrary body. */
export function writeRefusalMessage(body: string): string | null {
  try {
    const parsed = errorBody.safeParse(JSON.parse(body));
    return parsed.success ? (messages.get(parsed.data.error) ?? null) : null;
  } catch {
    return null;
  }
}
