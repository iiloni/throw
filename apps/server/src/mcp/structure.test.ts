import { mcpTools } from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Transaction } from '../db/client';
import {
  createProject,
  findProject,
  lockBoardProject,
  railProjects,
  updateProject,
} from '../lib/projectWrites';
import { categoryStatuses, findStatus, updateStatus } from '../lib/statusWrites';
import { createProjectTool, moveProjectTool, updateStatusTool } from './structure';
import { structureOperation } from './structureOperations';

vi.mock('../lib/projectWrites', () => ({
  createProject: vi.fn(),
  findProject: vi.fn(),
  lockBoardProject: vi.fn(),
  railProjects: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock('../lib/statusWrites', () => ({
  categoryStatuses: vi.fn(),
  findStatus: vi.fn(),
  updateStatus: vi.fn(),
}));
vi.mock('../lib/tagTree', () => ({}));
vi.mock('../lib/tagWrites', () => ({}));
vi.mock('./read', () => ({ ToolError: class extends Error {} }));
vi.mock('./structureOperations', () => ({ structureOperation: vi.fn() }));

const actor = { tokenId: uuidv7(), userId: 'owner', workspaceId: uuidv7(), viaTokenName: 'Agent' };
const project = {
  id: uuidv7(),
  workspaceId: actor.workspaceId,
  name: 'Road map',
  key: 'RM',
  color: 'teal' as const,
  icon: null,
  priorityNames: ['', '', '', '', ''],
  position: 'a0',
  deletedAt: null,
  taskCounter: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies NonNullable<Awaited<ReturnType<typeof findProject>>>;
const tx = {} as Transaction;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(structureOperation).mockImplementation(async (_actor, _name, _input, schema, write) =>
    schema.parse(await write(tx)),
  );
});

test('project creation uses the scoped shared write with stable seed IDs and four defaults', async () => {
  const operationId = uuidv7();
  vi.mocked(railProjects).mockResolvedValue([project]);
  vi.mocked(createProject).mockResolvedValue(1);
  vi.mocked(findProject).mockResolvedValue(project);
  const input = mcpTools.create_project.input.parse({ operationId, name: 'Road map' });
  await createProjectTool(actor, input);
  await createProjectTool(actor, input);
  const [first, retry] = vi.mocked(createProject).mock.calls;
  expect(first).toEqual(retry);
  expect(first).toEqual([
    tx,
    actor,
    expect.objectContaining({
      workspaceId: actor.workspaceId,
      key: 'RM',
      position: 'a1',
      statuses: ['backlog', 'active', 'done', 'cancelled'].map((category) =>
        expect.objectContaining({ category, isDefault: true }),
      ),
    }),
  ]);
});

test('a stale move returns the current position without touching the rail or updating a project', async () => {
  vi.mocked(findProject).mockResolvedValue(project);
  const input = mcpTools.move_project.input.parse({
    operationId: uuidv7(),
    projectId: project.id,
    before: { position: 'a9' },
    placement: { side: 'after', neighborId: uuidv7() },
  });
  expect(await moveProjectTool(actor, input)).toMatchObject({
    outcome: 'conflict',
    current: { position: 'a0' },
    conflicts: ['position'],
  });
  expect(railProjects).not.toHaveBeenCalled();
  expect(updateProject).not.toHaveBeenCalled();
});

test('default changes compare the observed category default and send only the server promotion', async () => {
  const old = {
    id: uuidv7(),
    projectId: project.id,
    workspaceId: actor.workspaceId,
    name: 'In progress',
    color: null,
    position: 'a0',
    category: 'active' as const,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const target = { ...old, name: 'Testing', id: uuidv7(), position: 'a1', isDefault: false };
  const promoted = { ...target, isDefault: true };
  vi.mocked(lockBoardProject).mockResolvedValue(project);
  vi.mocked(findStatus)
    .mockResolvedValueOnce(target)
    .mockResolvedValueOnce(target)
    .mockResolvedValueOnce(promoted);
  vi.mocked(categoryStatuses)
    .mockResolvedValueOnce([old, target])
    .mockResolvedValueOnce([promoted]);

  const input = mcpTools.update_status.input.parse({
    operationId: uuidv7(),
    statusId: target.id,
    changes: { defaultStatusId: { before: old.id, after: target.id } },
  });
  expect(await updateStatusTool(actor, input)).toMatchObject({
    outcome: 'applied',
    current: { defaultStatusId: target.id, isDefault: true },
  });
  expect(updateStatus).toHaveBeenCalledExactlyOnceWith(tx, actor, target.id, { isDefault: true });
});
