import type { OfflineTransaction } from '@tanstack/offline-transactions';
import { expect, it } from 'vitest';
import { orderQueuedWrites } from './orderQueuedWrites';

const queued = (idempotencyKey: string, time: number) =>
  ({ idempotencyKey, createdAt: new Date(time) }) as OfflineTransaction;

it('orders writes by time, then by their sortable key within a millisecond', () => {
  const writes = [queued('b', 2), queued('z', 1), queued('a', 2), queued('c', 1)];
  expect(orderQueuedWrites(writes).map((write) => write.idempotencyKey)).toEqual([
    'c',
    'z',
    'a',
    'b',
  ]);
});
