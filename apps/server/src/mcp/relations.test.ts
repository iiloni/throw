import { mcpTools } from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTaskRelation,
  deleteTaskRelation,
  findTaskRelation,
} from '../lib/taskRelationWrites';
import { requireTask, taskRelationsOf } from './read';
import { addTaskRelationTool, removeTaskRelationTool } from './write';

vi.mock('../lib/commentWrites', () => ({ createComment: vi.fn() }));
vi.mock('../lib/taskWrites', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('../lib/taskRelationWrites', () => ({
  createTaskRelation: vi.fn(),
  deleteTaskRelation: vi.fn(),
  findTaskRelation: vi.fn(),
}));
vi.mock('./read', () => ({
  findTask: vi.fn(),
  requireProject: vi.fn(),
  requireTask: vi.fn(),
  taskRelationsOf: vi.fn(),
  exposeChanges: (changes: unknown[]) => changes,
  ToolError: class extends Error {},
}));

const actor = { tokenId: uuidv7(), userId: 'owner', workspaceId: uuidv7(), viaTokenName: 'Agent' };
// The blocked task's id sorts after the blocker's, so relates_to swaps them.
const blocker = { id: '019abcd0-0000-7000-8000-000000000001', key: 'OPS-3' };
const blocked = { id: '019abcd0-0000-7000-8000-000000000002', key: 'THR-34' };
const tasks: Record<string, typeof blocker> = { 'THR-34': blocked, 'OPS-3': blocker };
const operationId = '019abcd0-abcd-7abc-8abc-abcdefabcdef';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTask).mockImplementation(async (_, reference) => tasks[reference]!);
  vi.mocked(taskRelationsOf).mockImplementation(async () => ({
    blocked: true,
    relations: vi.mocked(createTaskRelation).mock.results.length
      ? [
          {
            id: (vi.mocked(createTaskRelation).mock.calls.at(-1)![1] as { id: string }).id,
            relation: 'blocked_by' as const,
            task: {
              ...blocker,
              projectId: uuidv7(),
              title: 'Blocker',
              category: 'active' as const,
              effectivelyTrashed: false,
            },
          },
        ]
      : [],
  }));
});

describe('MCP relation tools', () => {
  test('stores blocked_by as the other task blocking, with a retry-stable id', async () => {
    vi.mocked(createTaskRelation).mockImplementation(async (_, input) => ({
      txid: 1,
      relation: { ...input, workspaceId: actor.workspaceId, createdAt: new Date() },
    }));
    const input = mcpTools.add_task_relation.input.parse({
      task: 'THR-34',
      relation: 'blocked_by',
      other: 'OPS-3',
      operationId,
    });
    const first = await addTaskRelationTool(actor, input);
    await addTaskRelationTool(actor, input);
    const [one, two] = vi.mocked(createTaskRelation).mock.calls.map(([, body]) => body);
    expect(one).toMatchObject({
      sourceTaskId: blocker.id,
      targetTaskId: blocked.id,
      kind: 'blocks',
    });
    expect(one!.id).toBe(two!.id);
    expect(first).toMatchObject({ outcome: 'added', relation: { relation: 'blocked_by' } });
  });

  test('reports an existing link and refuses the reverse with guidance', async () => {
    vi.mocked(createTaskRelation).mockResolvedValueOnce({
      txid: null,
      relation: {
        id: uuidv7(),
        workspaceId: actor.workspaceId,
        sourceTaskId: blocker.id,
        targetTaskId: blocked.id,
        kind: 'relates_to',
        createdAt: new Date(),
      },
    });
    vi.mocked(taskRelationsOf).mockImplementationOnce(async () => ({
      blocked: false,
      relations: [
        {
          id: vi.mocked(createTaskRelation).mock.results.length
            ? (await vi.mocked(createTaskRelation).mock.results[0]!.value).relation.id
            : '',
          relation: 'relates_to' as const,
          task: {
            ...blocker,
            projectId: uuidv7(),
            title: 'Blocker',
            category: 'active' as const,
            effectivelyTrashed: false,
          },
        },
      ],
    }));
    const existing = await addTaskRelationTool(
      actor,
      mcpTools.add_task_relation.input.parse({
        task: 'THR-34',
        relation: 'relates_to',
        other: 'OPS-3',
      }),
    );
    expect(existing.outcome).toBe('existing');
    expect(vi.mocked(createTaskRelation).mock.calls[0]![1]).toMatchObject({
      sourceTaskId: blocker.id,
      targetTaskId: blocked.id,
    });

    vi.mocked(createTaskRelation).mockResolvedValueOnce('reverse');
    await expect(
      addTaskRelationTool(
        actor,
        mcpTools.add_task_relation.input.parse({
          task: 'THR-34',
          relation: 'blocks',
          other: 'OPS-3',
        }),
      ),
    ).rejects.toThrow('reverse relation');
    await expect(
      addTaskRelationTool(
        actor,
        mcpTools.add_task_relation.input.parse({
          task: 'THR-34',
          relation: 'blocks',
          other: 'THR-34',
        }),
      ),
    ).rejects.toThrow('itself');
  });

  test('removes by id or by description, and is idempotent', async () => {
    const relationId = uuidv7();
    vi.mocked(findTaskRelation).mockResolvedValue(relationId);
    vi.mocked(deleteTaskRelation).mockResolvedValueOnce(5).mockResolvedValueOnce(null);
    const byPair = await removeTaskRelationTool(
      actor,
      mcpTools.remove_task_relation.input.parse({
        task: 'THR-34',
        relation: 'blocked_by',
        other: 'OPS-3',
      }),
    );
    expect(findTaskRelation).toHaveBeenCalledWith(actor, {
      kind: 'blocks',
      sourceTaskId: blocker.id,
      targetTaskId: blocked.id,
    });
    expect(byPair).toMatchObject({ outcome: 'removed', relationId });
    const again = await removeTaskRelationTool(
      actor,
      mcpTools.remove_task_relation.input.parse({ relationId }),
    );
    expect(again).toMatchObject({ outcome: 'absent', relationId });
    expect(mcpTools.remove_task_relation.input.safeParse({ task: 'THR-34' }).success).toBe(false);
  });
});
