import { changeFeedAfterSchema } from '@throw/shared';
import { z } from 'zod';

// xid8 is unsigned and can outgrow Number's exact range.
const xid = z
  .string()
  .refine(
    (value) => /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn,
  );

const feedOrder = z
  .string()
  .refine(
    (value) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 0x7fff_ffff_ffff_ffffn,
  );

const snapshot = z.string().refine((value) => {
  const [min, max, active, extra] = value.split(':');
  if (extra !== undefined || min === undefined || max === undefined || active === undefined)
    return false;
  if (![min, max].every((part) => xid.safeParse(part).success)) return false;
  const xmin = BigInt(min);
  const xmax = BigInt(max);
  if (xmin < 3n || xmin > xmax) return false;
  let previous = xmin - 1n;
  for (const entry of active === '' ? [] : active.split(',')) {
    if (!xid.safeParse(entry).success) return false;
    const id = BigInt(entry);
    if (id <= previous || id >= xmax) return false;
    previous = id;
  }
  return true;
});

const feedSources = z.enum(['task', 'comment', 'structure']);
const boundary = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('snapshot'), snapshot }),
  z.strictObject({ type: z.literal('time'), after: changeFeedAfterSchema }),
]);

const scope = {
  generation: z.uuid(),
  workspaceId: z.uuid(),
};
const cursorSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...scope, type: z.literal('snapshot'), snapshot }),
  z.strictObject({
    ...scope,
    type: z.literal('page'),
    excludeTokenId: z.uuid().nullable(),
    base: boundary,
    through: snapshot,
    last: z.strictObject({ txid: xid, order: feedOrder, id: z.uuid(), source: feedSources }),
  }),
]);

export type ChangeCursor = z.infer<typeof cursorSchema>;
export type FeedSource = z.infer<typeof feedSources>;
export type FeedBoundary = z.infer<typeof boundary>;

export function encodeChangeCursor(cursor: ChangeCursor) {
  return `v1.${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`;
}

export function parseChangeCursor(value: string): ChangeCursor | null {
  if (!value.startsWith('v1.') || value.length > 512_000) return null;
  const encoded = value.slice(3);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, 'base64url');
  if (decoded.toString('base64url') !== encoded) return null;
  try {
    return cursorSchema.safeParse(JSON.parse(decoded.toString('utf8'))).data ?? null;
  } catch {
    return null;
  }
}

export function snapshotBounds(snapshot: string) {
  const [xmin, xmax] = snapshot.split(':', 2);
  return { xmin: xmin!, xmax: xmax! };
}

export function cursorFitsSnapshot(cursor: ChangeCursor, current: string) {
  const xmax = (snapshot: string) => BigInt(snapshotBounds(snapshot).xmax);
  if (cursor.type === 'snapshot') return xmax(cursor.snapshot) <= xmax(current);
  const through = xmax(cursor.through);
  if (through > xmax(current) || BigInt(cursor.last.txid) >= through) return false;
  if (cursor.through.split(':')[2]?.split(',').includes(cursor.last.txid)) return false;
  if (cursor.base.type === 'time') return true;
  const { xmin, xmax: baseMax } = snapshotBounds(cursor.base.snapshot);
  return (
    BigInt(baseMax) <= through &&
    BigInt(cursor.last.txid) >= BigInt(xmin) &&
    (BigInt(cursor.last.txid) >= BigInt(baseMax) ||
      cursor.base.snapshot.split(':')[2]?.split(',').includes(cursor.last.txid) === true)
  );
}
