import { isDeepStrictEqual } from 'node:util';
import { uuidv7 } from 'uuidv7';
import type { Transaction } from '../db/client';
import { structureActivity } from '../db/schema';
import type { WriteActor } from './writeActor';

export function recordStructure(
  tx: Transaction,
  actor: WriteActor,
  entityType: typeof structureActivity.$inferInsert.entityType,
  entity: { id: string; workspaceId: string; projectId: string; projectKey: string | null },
  kind: typeof structureActivity.$inferInsert.kind,
  before: object,
  after: object,
) {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [...fields].flatMap((field) => {
    const previous = Reflect.get(before, field) ?? null;
    const next = Reflect.get(after, field) ?? null;
    return kind === 'created' || kind === 'deleted' || !isDeepStrictEqual(previous, next)
      ? [{ field, before: previous, after: next }]
      : [];
  });
  if (changes.length === 0) return;
  return tx.insert(structureActivity).values({
    id: uuidv7(),
    workspaceId: entity.workspaceId,
    projectId: entity.projectId,
    projectKey: entity.projectKey,
    entityType,
    entityId: entity.id,
    kind,
    changes,
    userId: actor.userId,
    viaTokenName: actor.viaTokenName,
    viaTokenId: actor.tokenId,
  });
}
