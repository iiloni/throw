import { comparePositions, positionBetween, positionSchema, positionsBetween } from '@throw/shared';

type Sibling = { id: string; position: string | null };
type Placement = { side: 'before' | 'after'; neighborId: string };

export function compareStructurePositions(a: { position: string; id: string }, b: typeof a) {
  return comparePositions(a.position, b.position) || comparePositions(a.id, b.id);
}

function between(lower: string | null, upper: string | null) {
  if (lower !== null && upper !== null && lower >= upper) return undefined;
  try {
    return positionSchema.safeParse(positionBetween(lower, upper)).data;
  } catch {
    // REST previously accepted strings that match the schema but are not fractional keys.
    return undefined;
  }
}

/** Calculate a move in the supplied display order while holding the sibling group's write lock. */
export function planSiblingMove(rows: readonly Sibling[], id: string, placement: Placement) {
  const target = rows.find((row) => row.id === id);
  if (!target) return null;
  const siblings = rows.filter((row) => row.id !== id);
  const neighbor = siblings.findIndex((row) => row.id === placement.neighborId);
  if (neighbor < 0) return null;
  const index = neighbor + (placement.side === 'after' ? 1 : 0);
  const lower = siblings[index - 1];
  const upper = siblings[index];
  const position =
    lower?.position === null || upper?.position === null
      ? undefined
      : between(lower?.position ?? null, upper?.position ?? null);
  if (position !== undefined) return position === target.position ? [] : [{ id, position }];

  // Equal/legacy bounds and alphabetical tag siblings have no index between them.
  // Assign fresh indices in the desired order so the neighbor relation is exact.
  siblings.splice(index, 0, target);
  const positions = positionsBetween(null, null, siblings.length);
  return siblings.flatMap((row, i) =>
    row.position === positions[i] ? [] : [{ id: row.id, position: positions[i]! }],
  );
}

export function planSiblingAppend(rows: readonly { id: string; position: string }[]) {
  const position = between(rows.at(-1)?.position ?? null, null);
  if (position !== undefined) return { position, reindex: [] };
  const positions = positionsBetween(null, null, rows.length + 1);
  return {
    position: positions[rows.length]!,
    reindex: rows.flatMap((row, i) =>
      row.position === positions[i] ? [] : [{ id: row.id, position: positions[i]! }],
    ),
  };
}
