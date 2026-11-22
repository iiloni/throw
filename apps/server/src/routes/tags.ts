import { zValidator } from '@hono/zod-validator';
import { createTagSchema, updateTagSchema } from '@throw/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { requireUser } from '../lib/requireUser';
import { createTag, deleteTag, TagError, updateTag } from '../lib/tagWrites';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const tagRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .onError((error, c) => {
    if (error instanceof TagError) return c.json({ error: error.message }, error.status);
    throw error;
  })
  .post('/', zValidator('json', createTagSchema), async (c) => {
    const actor = { userId: c.get('user')!.id };
    const body = c.req.valid('json');
    const txid = await db.transaction((tx) => createTag(tx, actor, body));
    return c.json({ txid }, txid === null ? 200 : 201);
  })
  .patch('/:id', idParam, zValidator('json', updateTagSchema), async (c) => {
    const actor = { userId: c.get('user')!.id };
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction((tx) => updateTag(tx, actor, id, body));
    return c.json({ txid });
  })
  .delete('/:id', idParam, async (c) => {
    const actor = { userId: c.get('user')!.id };
    const { id } = c.req.valid('param');
    const result = await db.transaction((tx) => deleteTag(tx, actor, id));
    return c.json(result);
  });
