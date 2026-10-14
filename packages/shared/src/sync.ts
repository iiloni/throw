import { z } from 'zod';

/**
 * What a write endpoint returns: the Postgres transaction id, so the client can wait for
 * Electric to stream the write back. Null when the write was already applied (a replay of a
 * create or delete that reached the server before), so there is nothing new to wait for.
 */
export const txidResponseSchema = z.object({ txid: z.number().int().nullable() });

export type TxidResponse = z.infer<typeof txidResponseSchema>;

/**
 * A time set by the server, as an ISO 8601 string in UTC with milliseconds
 * (`2026-10-14T09:30:00.000Z`), so times compare as strings. A device holds a placeholder
 * from its own clock until the synced row arrives; no write carries one.
 */
export const timestampSchema = z.iso.datetime();

/**
 * Electric sends `timestamptz` as Postgres prints it (`2026-10-14 09:30:00.123456+00`).
 * Rows are read as `timestampSchema` strings.
 */
export function parseTimestamptz(value: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      value,
    );
  if (!match) return new Date(value).toISOString();
  const [, date, time, fraction = '', zone = 'Z'] = match;
  const offset =
    zone === 'Z'
      ? 'Z'
      : zone.length === 3
        ? `${zone}:00`
        : zone.replace(/(\d{2})(\d{2})$/, '$1:$2');
  return new Date(`${date}T${time}.${fraction.padEnd(3, '0').slice(0, 3)}${offset}`).toISOString();
}
