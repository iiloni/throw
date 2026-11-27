import { signedInUserId } from '@/lib/collections';

/** Who wrote a comment or made a change, as the timeline names them. */
export const author = (id: string | null) =>
  id !== null && id === signedInUserId ? 'You' : id ? 'Another member' : 'Deleted member';

export { fullTime } from './history';

/** The surface a comment sits on: a quiet step off the task's own color, in either theme. */
export const commentSurface =
  'rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.07] ring-inset';
