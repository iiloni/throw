import { isUpdateReloadBlocked } from './useUpdateReloadBlocked';

/** Leaving would lose text that lives only in an open editor or form. */
export class DraftOpenError extends Error {}

/**
 * Before the page goes away (an update's reload, signing in again): refuses while a draft
 * outside the outbox is open, then waits for in-flight writes to reach durable storage.
 */
export async function prepareToLeavePage() {
  if (isUpdateReloadBlocked())
    throw new DraftOpenError('Close the open task or draft first, so its text is kept.');
  const { waitForPendingWritesStored } = await import('./collections');
  await waitForPendingWritesStored();
}
