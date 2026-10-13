import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The id of the transaction a write is in. A client waits for Electric to stream that
 * transaction back before it drops its optimistic copy of the change.
 */
export async function currentTxid(tx: Transaction) {
  const [row] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`,
  );
  return Number(row?.txid);
}
