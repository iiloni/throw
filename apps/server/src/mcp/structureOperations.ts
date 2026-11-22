import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type Transaction } from '../db/client';
import { mcpStructureOperations, mcpTokens, workspaces } from '../db/schema';
import type { McpActor } from '../lib/mcpTokens';
import { memberWorkspaces } from '../lib/workspaces';
import { ToolError } from './read';
import { writeId } from './writeId';

export function structureOperation<T extends z.ZodType>(
  actor: McpActor,
  name: string,
  { operationId, ...input }: { operationId: string },
  output: T,
  write: (tx: Transaction) => Promise<z.input<T>>,
): Promise<z.output<T>> {
  const id = writeId(actor, operationId, 'structure');
  const requestHash = createHash('sha256')
    .update(JSON.stringify([name, input]))
    .digest('hex');
  return db.transaction(async (tx) => {
    // Lock parent before credential, matching the order of workspace deletion.
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, actor.workspaceId),
          inArray(workspaces.id, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
        ),
      )
      .for(name.endsWith('_project') ? 'no key update' : 'key share', { of: workspaces });
    if (!workspace) throw new ToolError('Workspace not found.');
    const [token] = await tx
      .select({ id: mcpTokens.id })
      .from(mcpTokens)
      .where(
        and(
          eq(mcpTokens.id, actor.tokenId),
          eq(mcpTokens.userId, actor.userId),
          inArray(mcpTokens.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
        ),
      )
      .for('key share', { of: mcpTokens });
    if (!token) throw new ToolError('MCP token is no longer available.');

    // Serialize retries across connections before reading the outcome or applying the write.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`structure/${id}`}, 0))`);
    const [previous] = await tx
      .select()
      .from(mcpStructureOperations)
      .where(and(eq(mcpStructureOperations.id, id), eq(mcpStructureOperations.tokenId, token.id)));
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ToolError('That operation ID was already used for a different structure write.');
      return output.parse(previous.result);
    }
    const result = output.parse(await write(tx));
    await tx.insert(mcpStructureOperations).values({ id, tokenId: token.id, requestHash, result });
    return result;
  });
}
