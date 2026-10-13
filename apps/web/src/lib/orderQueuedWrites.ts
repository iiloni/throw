import type { OfflineTransaction } from '@tanstack/offline-transactions';

/**
 * Puts the queue back in the order it was written. The outbox stores writes under random
 * ids and orders them by a time in milliseconds, so two made in one go (a new workspace and
 * its first project) could swap after a reload, and the server would refuse the one that
 * came first. Each write's idempotency key is a UUIDv7 (see `write`), which keeps their order.
 */
export function orderQueuedWrites(queued: readonly OfflineTransaction[]): OfflineTransaction[] {
  return [...queued].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0),
  );
}
