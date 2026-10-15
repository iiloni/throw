import { zValidator } from '@hono/zod-validator';
import {
  type ActivityChange,
  createTagSchema,
  type Tag,
  tagSubtreeIds,
  tagWriteIssue,
  updateTagSchema,
} from '@throw/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db, type Transaction } from '../db/client';
import { projects, tags, taskActivity, tasks, taskTags } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { lockTagTree, projectTags } from '../lib/tagTree';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));
class TagError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 = 409,
  ) {
    super(message);
  }
}
const member = (tx: Transaction, userId: string) =>
  inArray(tags.workspaceId, memberWorkspaces(tx, userId));
async function findTag(tx: Transaction, userId: string, id: string) {
  const [tag] = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), member(tx, userId)));
  return tag;
}
function validate(tag: Tag, rows: readonly Tag[]) {
  const issue = tagWriteIssue(tag, rows);
  if (issue) throw new TagError(issue);
}

export const tagRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .onError((error, c) => {
    if (error instanceof TagError) return c.json({ error: error.message }, error.status);
    throw error;
  })
  .post('/', zValidator('json', createTagSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      await lockTagTree(tx, body.projectId);
      const [project] = await tx
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, body.projectId),
            inArray(projects.workspaceId, memberWorkspaces(tx, userId)),
          ),
        )
        .for('key share');
      if (!project) throw new TagError('Project not found', 404);
      const rows = await projectTags(tx, userId, project.id);
      if (rows.some((tag) => tag.id === body.id)) return null;
      const tag = { ...body, projectId: project.id, workspaceId: project.workspaceId };
      validate(tag, rows);
      const inserted = await tx
        .insert(tags)
        .values(tag)
        .onConflictDoNothing()
        .returning({ id: tags.id });
      if (!inserted.length) throw new TagError('Tag id is in use');
      return currentTxid(tx);
    });
    return c.json({ txid }, txid === null ? 200 : 201);
  })
  .patch('/:id', idParam, zValidator('json', updateTagSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const found = await findTag(tx, userId, id);
      if (!found) throw new TagError('Tag not found', 404);
      await lockTagTree(tx, found.projectId);
      const current = await findTag(tx, userId, id);
      if (!current) throw new TagError('Tag not found', 404);
      const candidate = { ...current, ...body };
      validate(candidate, await projectTags(tx, userId, current.projectId));
      if (!Object.entries(body).some(([key, value]) => current[key as keyof Tag] !== value))
        return null;
      await tx
        .update(tags)
        .set(body)
        .where(and(eq(tags.id, id), member(tx, userId)));
      return currentTxid(tx);
    });
    return c.json({ txid });
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const result = await db.transaction(async (tx) => {
      const found = await findTag(tx, userId, id);
      if (!found) return { txid: null };
      await lockTagTree(tx, found.projectId);
      const rows = await projectTags(tx, userId, found.projectId);
      if (!rows.some((tag) => tag.id === id)) return { txid: null };
      const removed = [...tagSubtreeIds(rows, id)];
      const names = new Map(rows.map((tag) => [tag.id, tag.name]));
      const secondary = await tx
        .select()
        .from(taskTags)
        .where(
          and(
            inArray(taskTags.tagId, removed),
            inArray(taskTags.workspaceId, memberWorkspaces(tx, userId)),
          ),
        );
      const secondaryTasks = [...new Set(secondary.map((row) => row.taskId))];
      const affected = await tx
        .select()
        .from(tasks)
        .where(
          and(
            inArray(tasks.workspaceId, memberWorkspaces(tx, userId)),
            or(
              inArray(tasks.primaryTagId, removed),
              secondaryTasks.length ? inArray(tasks.id, secondaryTasks) : undefined,
            ),
          ),
        )
        .orderBy(tasks.id)
        .for('update');
      const primary = affected.filter(
        (task) => task.primaryTagId !== null && removed.includes(task.primaryTagId),
      );
      for (const task of affected) {
        const changes: ActivityChange[] = [];
        if (task.primaryTagId !== null && removed.includes(task.primaryTagId))
          changes.push({
            field: 'primaryTagId',
            previous: task.primaryTagId,
            previousName: names.get(task.primaryTagId) ?? null,
            requested: null,
            requestedName: null,
            applied: true,
          });
        for (const row of secondary.filter((row) => row.taskId === task.id))
          changes.push({
            field: 'secondaryTags',
            tagId: row.tagId,
            previous: row.tagId,
            previousName: names.get(row.tagId) ?? null,
            requested: null,
            requestedName: null,
            applied: true,
          });
        await tx.insert(taskActivity).values({
          id: uuidv7(),
          taskId: task.id,
          projectId: task.projectId,
          workspaceId: task.workspaceId,
          userId,
          kind: 'updated',
          changes,
          // As with task writes, timestamp after taking the task's lock.
          createdAt: sql`clock_timestamp()`,
        });
      }
      // Cleanup is derived from current server rows, never from the deleting device's snapshot.
      if (primary.length)
        await tx
          .update(tasks)
          .set({ primaryTagId: null })
          .where(
            and(
              inArray(
                tasks.id,
                primary.map((task) => task.id),
              ),
              inArray(tasks.workspaceId, memberWorkspaces(tx, userId)),
            ),
          );
      await tx.delete(tags).where(and(inArray(tags.id, removed), member(tx, userId)));
      const txid = await currentTxid(tx);
      return {
        txid,
        ...(primary.length ? { tasksTxid: txid } : {}),
        ...(secondary.length ? { secondaryTagsTxid: txid } : {}),
      };
    });
    return c.json(result);
  });
