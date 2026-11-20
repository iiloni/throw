import { mcpTools } from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createComment } from '../lib/commentWrites';
import { createTask, updateTask } from '../lib/taskWrites';
import { findTask, requireTask } from './read';
import { addCommentTool, createTaskTool, moveTaskTool, updateTaskTool } from './write';

vi.mock('../lib/commentWrites', () => ({ createComment: vi.fn() }));
vi.mock('../lib/taskWrites', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('./read', () => ({
  findTask: vi.fn(),
  requireProject: vi.fn(),
  requireTask: vi.fn(),
  exposeChanges: (changes: unknown[]) => changes,
  ToolError: class extends Error {},
}));

const actor = { tokenId: uuidv7(), userId: 'owner', workspaceId: uuidv7(), viaTokenName: 'Agent' };
const task = { id: uuidv7(), key: 'THR-2' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTask).mockResolvedValue(task);
});

describe('MCP write tools', () => {
  test('uses the same create identity on retry, scoped to the calling token', async () => {
    vi.mocked(createTask).mockResolvedValue({ txid: null, changes: [] });
    const input = mcpTools.create_task.input.parse({
      projectId: uuidv7(),
      title: 'Stacked work',
      parent: 'THR-2',
      operationId: uuidv7(),
    });
    await createTaskTool(actor, input);
    await createTaskTool(actor, input);
    await createTaskTool({ ...actor, tokenId: uuidv7() }, input);
    const [first, second, third] = vi.mocked(createTask).mock.calls.map(([, body]) => body);
    expect(first).toMatchObject({ parentId: task.id, title: 'Stacked work' });
    expect(first!.id).toBe(second!.id);
    expect(first!.id).not.toBe(third!.id);
  });

  test('passes the observed description version to the conflict rule and returns its outcome', async () => {
    vi.mocked(updateTask).mockResolvedValue({
      txid: null,
      refused: [{ field: 'description', reason: 'stale' }],
      changes: [
        {
          field: 'description',
          previous: uuidv7(),
          requested: uuidv7(),
          applied: false,
          reason: 'stale',
        },
      ],
    });
    const before = uuidv7();
    const input = mcpTools.update_task.input.parse({
      task: 'THR-2',
      changes: { description: { before, after: '**Draft**' } },
    });
    const result = await updateTaskTool(actor, input);
    expect(updateTask).toHaveBeenCalledWith(
      actor,
      task.id,
      expect.objectContaining({
        changes: {
          description: {
            before,
            after: {
              version: expect.any(String),
              document: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Draft', styles: { bold: true } }],
                },
              ],
            },
          },
        },
      }),
      undefined,
    );
    expect(result.changes).toEqual([expect.objectContaining({ applied: false, reason: 'stale' })]);
  });

  test('passes an unreachable neighbor as an invalid placement without losing the status edit', async () => {
    vi.mocked(findTask).mockResolvedValue(undefined);
    vi.mocked(updateTask).mockResolvedValue({ txid: 2, refused: [], changes: [] });
    const before = { statusId: uuidv7(), priority: 3, parentId: null };
    const statusId = uuidv7();
    await moveTaskTool(
      actor,
      mcpTools.move_task.input.parse({
        task: task.id,
        before,
        statusId,
        placement: { side: 'before', neighbor: 'THR-9' },
      }),
    );
    expect(updateTask).toHaveBeenCalledWith(
      actor,
      task.id,
      expect.objectContaining({
        changes: { statusId: { before: before.statusId, after: statusId } },
      }),
      { before, relative: null },
    );
  });

  test('a blank comment cannot reach the shared write function', async () => {
    await expect(addCommentTool(actor, { task: task.id, body: '\n ' })).rejects.toThrow(
      'Write some text',
    );
    expect(createComment).not.toHaveBeenCalled();
  });
});
