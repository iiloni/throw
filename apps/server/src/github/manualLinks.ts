import { type linkGithubRequestSchema, parseGithubLink, sameGithubRepository } from '@throw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { z } from 'zod';
import { db, type Transaction } from '../db/client';
import { githubConnections, taskGithubLinks as links, projects, tasks } from '../db/schema';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';
import type { WriteActor } from '../lib/writeActor';
import { activeTask, publicLink, recordLink, taskFields } from './linkData';

const visible = (tx: Transaction, actor: WriteActor, taskId: string) =>
  and(
    eq(tasks.id, taskId),
    inArray(tasks.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
  );
export class LinkError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 400,
  ) {
    super(message);
  }
}
export async function addGithubLink(
  actor: WriteActor,
  taskId: string,
  input: z.infer<typeof linkGithubRequestSchema>,
) {
  const item = parseGithubLink(input.url);
  if (!item) throw new LinkError('Invalid GitHub URL', 400);
  if (item.kind === 'issue' && (input.state === 'draft' || input.state === 'merged'))
    throw new LinkError('An issue must be open or closed', 400);
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select(taskFields)
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(visible(tx, actor, taskId), activeTask(tx)))
      .for('share', { of: tasks });
    if (!task) throw new LinkError('Task not found', 404);
    const [connection] = await tx
      .select({ repo: githubConnections.repository, enabled: githubConnections.enabled })
      .from(githubConnections)
      .where(eq(githubConnections.projectId, task.projectId))
      .for('no key update');
    if (!connection?.enabled || !sameGithubRepository(connection.repo, item.repo))
      throw new LinkError('The link must belong to the connected repository', 409);
    const known = await tx
      .select()
      .from(links)
      .where(
        and(
          eq(links.projectId, task.projectId),
          eq(links.repo, item.repo),
          eq(links.kind, item.kind),
          eq(links.number, item.number),
        ),
      );
    const existing = known.find((link) => link.taskId === taskId);
    if (existing) return { link: publicLink(existing), txid: null };
    const source = known[0];
    const [row] = await tx
      .insert(links)
      .values({
        ...source,
        ...item,
        id: uuidv7(),
        taskId,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        title: source?.title ?? input.title ?? `${item.repo}#${item.number}`,
        state: source?.state ?? input.state ?? 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    await recordLink(tx, task, row!, null, row!.state, actor);
    return { link: publicLink(row!), txid: await currentTxid(tx) };
  });
}
export async function removeGithubLink(actor: WriteActor, taskId: string, linkId: string) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select(taskFields)
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(visible(tx, actor, taskId));
    if (!task) throw new LinkError('Task not found', 404);
    const [row] = await tx
      .delete(links)
      .where(
        and(
          eq(links.id, linkId),
          eq(links.taskId, taskId),
          eq(links.workspaceId, task.workspaceId),
        ),
      )
      .returning();
    if (!row) return { txid: null };
    await recordLink(tx, task, row, row.state, null, actor);
    return { txid: await currentTxid(tx) };
  });
}
