import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect } from '@playwright/test';
import type { Tag, UpdateTask } from '../packages/shared/src';
import { type createAccount, shapeRows } from './helpers';
export type Account = Awaited<ReturnType<typeof createAccount>>;
export async function tagProject(request: APIRequestContext, owner: Account) {
  const [workspace] = await shapeRows(request, 'workspaces', owner.headers);
  const project = {
    id: randomUUID(),
    workspaceId: String(workspace?.id),
    name: 'Tags',
    color: 'teal',
    icon: null,
    position: 'a0',
    key: 'TAG',
    statuses: ['backlog', 'active', 'done', 'cancelled'].map((category) => ({
      id: randomUUID(),
      name: category,
      category,
      position: 'a0',
      isDefault: true,
    })),
  };
  expect(
    (await request.post('/api/projects', { headers: owner.headers, data: project })).status(),
  ).toBe(201);
  return project;
}
export async function newTag(
  request: APIRequestContext,
  owner: Account,
  projectId: string,
  fields: Partial<Tag> = {},
) {
  const tag = {
    id: randomUUID(),
    projectId,
    name: 'Tag',
    parentId: null,
    icon: null,
    color: null,
    ...fields,
  };
  expect((await request.post('/api/tags', { headers: owner.headers, data: tag })).status()).toBe(
    201,
  );
  return tag;
}
export async function taggedTask(
  request: APIRequestContext,
  owner: Account,
  projectId: string,
  fields: Record<string, unknown> = {},
) {
  const task = {
    id: randomUUID(),
    projectId,
    title: 'Task',
    description: null,
    descriptionVersion: null,
    parentId: null,
    position: 'a0',
    ...fields,
  };
  const response = await request.post('/api/tasks', { headers: owner.headers, data: task });
  expect(response.status()).toBe(201);
  return task;
}
export async function tagTaskUpdate(
  request: APIRequestContext,
  owner: Account,
  taskId: string,
  changes: UpdateTask['changes'],
  changeId = randomUUID(),
) {
  const response = await request.patch(`/api/tasks/${taskId}`, {
    headers: owner.headers,
    data: { changeId, changes },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
