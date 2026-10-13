import { DEFAULT_WORKSPACE_NAME, positionBetween } from '@throw/shared';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { type Db, db } from '../db/client';
import { workspaceMembers, workspaces } from '../db/schema';

type Queryable = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** The workspaces a user belongs to, for `inArray` on a table's `workspaceId`. */
export const memberWorkspaces = (queryable: Queryable, userId: string) =>
  queryable
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

export async function isMember(queryable: Queryable, userId: string, workspaceId: string) {
  const [row] = await queryable
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));
  return row !== undefined;
}

/** Every account starts with a workspace, so there is somewhere to put a first project. */
export async function createDefaultWorkspace(userId: string) {
  await db.transaction(async (tx) => {
    const id = uuidv7();
    await tx
      .insert(workspaces)
      .values({ id, name: DEFAULT_WORKSPACE_NAME, position: positionBetween(null, null) });
    await tx.insert(workspaceMembers).values({ workspaceId: id, userId, role: 'owner' });
  });
}
