import {
  COLORS,
  compareTags,
  deriveProjectKey,
  type McpInput,
  mcpTools,
  positionBetween,
  STARTER_STATUSES,
} from '@throw/shared';
import type { Transaction } from '../db/client';
import type { McpActor } from '../lib/mcpTokens';
import {
  createProject,
  findProject,
  lockBoardProject,
  railProjects,
  updateProject,
} from '../lib/projectWrites';
import { categoryStatuses, createStatus, findStatus, updateStatus } from '../lib/statusWrites';
import {
  compareStructurePositions,
  planSiblingAppend,
  planSiblingMove,
} from '../lib/structureOrder';
import { lockTagTree, projectTags } from '../lib/tagTree';
import { createTag, findTag, setTagPositions, updateTag } from '../lib/tagWrites';
import { ToolError } from './read';
import { structureOperation } from './structureOperations';
import { writeId } from './writeId';

type Change = { before: unknown; after: unknown };
type AfterValues<T> = { [K in keyof T]: NonNullable<T[K]> extends { after: infer V } ? V : never };

function different(current: object, before: object) {
  return Object.entries(before)
    .filter(
      ([field, value]) => JSON.stringify(Reflect.get(current, field)) !== JSON.stringify(value),
    )
    .map(([field]) => field);
}

function planEdit<T extends Record<string, Change | undefined>>(current: object, changes: T) {
  const entries = Object.entries(changes).flatMap(([field, change]) =>
    change === undefined ? [] : [[field, change] as const],
  );
  const before = Object.fromEntries(entries.map(([field, change]) => [field, change.before]));
  const patch = Object.fromEntries(
    entries
      .filter(([field, change]) => different(current, { [field]: change.after }).length > 0)
      .map(([field, change]) => [field, change.after]),
  ) as Partial<AfterValues<T>>;
  return { conflicts: different(current, before), patch };
}

function outcome<T>(operationId: string, current: T, conflicts: string[] = []) {
  return {
    operationId,
    current,
    conflicts,
    outcome: conflicts.length ? ('conflict' as const) : ('applied' as const),
  };
}

async function projectView(tx: Transaction, actor: McpActor, id: string) {
  const project = await findProject(tx, actor, id);
  if (!project || project.deletedAt) throw new ToolError('Project not found.');
  return { ...project, trashed: false };
}

export function createProjectTool(actor: McpActor, input: McpInput<'create_project'>) {
  const { operationId, name, key, color, icon } = input;
  return structureOperation(
    actor,
    'create_project',
    input,
    mcpTools.create_project.output,
    async (tx) => {
      const rows = (await railProjects(tx, actor, actor.workspaceId)).sort(
        compareStructurePositions,
      );
      const used = new Set(rows.map((row) => row.color));
      const { position, reindex } = planSiblingAppend(rows);
      for (const row of reindex) await updateProject(tx, actor, row.id, { position: row.position });
      const id = writeId(actor, operationId, 'project');
      const result = await createProject(tx, actor, {
        id,
        workspaceId: actor.workspaceId,
        name,
        key: key ?? deriveProjectKey(name),
        color:
          color ?? COLORS.find((color) => !used.has(color)) ?? COLORS[rows.length % COLORS.length]!,
        icon: icon ?? null,
        position,
        statuses: STARTER_STATUSES.map((status) => ({
          ...status,
          id: writeId(actor, operationId, `starter/${status.category}`),
          position: positionBetween(null, null),
          isDefault: true,
        })),
      });
      if (result === 'no-workspace') throw new ToolError('Workspace not found.');
      if (result === 'taken' || result === null)
        throw new ToolError('Project ID is already in use.');
      return outcome(operationId, await projectView(tx, actor, id));
    },
  );
}

export function updateProjectTool(actor: McpActor, input: McpInput<'update_project'>) {
  const { operationId, projectId, changes } = input;
  return structureOperation(
    actor,
    'update_project',
    input,
    mcpTools.update_project.output,
    async (tx) => {
      const current = await projectView(tx, actor, projectId);
      const { conflicts, patch } = planEdit(current, changes);
      if (conflicts.length) return outcome(operationId, current, conflicts);
      const result = await updateProject(tx, actor, projectId, patch);
      if (result === 'key-taken') throw new ToolError('Another project has this key.');
      return outcome(operationId, await projectView(tx, actor, projectId));
    },
  );
}

export function moveProjectTool(actor: McpActor, input: McpInput<'move_project'>) {
  const { operationId, projectId, before, placement } = input;
  return structureOperation(
    actor,
    'move_project',
    input,
    mcpTools.move_project.output,
    async (tx) => {
      const current = await projectView(tx, actor, projectId);
      const conflicts = different(current, before);
      if (conflicts.length) return outcome(operationId, current, conflicts);
      const rows = (await railProjects(tx, actor, actor.workspaceId)).sort(
        compareStructurePositions,
      );
      const updates = planSiblingMove(rows, projectId, placement);
      if (!updates)
        throw new ToolError('Choose another active project in this workspace as the neighbor.');
      for (const row of updates) await updateProject(tx, actor, row.id, { position: row.position });
      return outcome(operationId, await projectView(tx, actor, projectId));
    },
  );
}

async function activeProject(tx: Transaction, actor: McpActor, id: string) {
  const project = await lockBoardProject(tx, actor, id);
  if (!project || project.deletedAt) throw new ToolError('Project not found.');
}

async function lockedStatus(tx: Transaction, actor: McpActor, id: string) {
  const found = await findStatus(tx, actor, id);
  if (!found) throw new ToolError('Status not found.');
  await activeProject(tx, actor, found.projectId);
  return statusView(tx, actor, id);
}

async function statusView(tx: Transaction, actor: McpActor, id: string) {
  const status = await findStatus(tx, actor, id);
  if (!status) throw new ToolError('Status not found.');
  const siblings = await categoryStatuses(tx, actor, status.projectId, status.category);
  const defaultStatus = siblings.find((row) => row.isDefault);
  if (!defaultStatus) throw new ToolError('This category has no default status.');
  return { ...status, defaultStatusId: defaultStatus.id };
}

export function createStatusTool(actor: McpActor, input: McpInput<'create_status'>) {
  const { operationId, projectId, name, category, color } = input;
  return structureOperation(
    actor,
    'create_status',
    input,
    mcpTools.create_status.output,
    async (tx) => {
      await activeProject(tx, actor, projectId);
      const rows = (await categoryStatuses(tx, actor, projectId, category)).sort(
        compareStructurePositions,
      );
      const { position, reindex } = planSiblingAppend(rows);
      for (const row of reindex) await updateStatus(tx, actor, row.id, { position: row.position });
      const id = writeId(actor, operationId, 'status');
      const result = await createStatus(tx, actor, {
        id,
        projectId,
        name,
        category,
        color,
        position,
        isDefault: false,
      });
      if (result === 'no-project') throw new ToolError('Project not found.');
      if (result === null) throw new ToolError('Status ID is already in use.');
      return outcome(operationId, await statusView(tx, actor, id));
    },
  );
}

export function updateStatusTool(actor: McpActor, input: McpInput<'update_status'>) {
  const { operationId, statusId, changes } = input;
  return structureOperation(
    actor,
    'update_status',
    input,
    mcpTools.update_status.output,
    async (tx) => {
      const current = await lockedStatus(tx, actor, statusId);
      if (changes.defaultStatusId && changes.defaultStatusId.after !== statusId)
        throw new ToolError(
          'Set defaultStatusId.after to the statusId that should become the default.',
        );
      const { conflicts, patch } = planEdit(current, changes);
      if (conflicts.length) return outcome(operationId, current, conflicts);
      await updateStatus(tx, actor, statusId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.defaultStatusId !== undefined ? { isDefault: true } : {}),
      });
      return outcome(operationId, await statusView(tx, actor, statusId));
    },
  );
}

export function moveStatusTool(actor: McpActor, input: McpInput<'move_status'>) {
  const { operationId, statusId, before, placement } = input;
  return structureOperation(
    actor,
    'move_status',
    input,
    mcpTools.move_status.output,
    async (tx) => {
      const current = await lockedStatus(tx, actor, statusId);
      const conflicts = different(current, before);
      if (conflicts.length) return outcome(operationId, current, conflicts);
      const rows = (await categoryStatuses(tx, actor, current.projectId, current.category)).sort(
        compareStructurePositions,
      );
      const updates = planSiblingMove(rows, statusId, placement);
      if (!updates)
        throw new ToolError(
          'Choose another status in the same project and category as the neighbor.',
        );
      for (const row of updates) await updateStatus(tx, actor, row.id, { position: row.position });
      return outcome(operationId, await statusView(tx, actor, statusId));
    },
  );
}

async function tagView(tx: Transaction, actor: McpActor, id: string) {
  const tag = await findTag(tx, actor, id);
  if (!tag) throw new ToolError('Tag not found.');
  return tag;
}

async function lockTags(tx: Transaction, actor: McpActor, projectId: string) {
  await projectView(tx, actor, projectId);
  await lockTagTree(tx, projectId);
  await activeProject(tx, actor, projectId);
}

async function lockedTag(tx: Transaction, actor: McpActor, id: string) {
  const found = await tagView(tx, actor, id);
  await lockTags(tx, actor, found.projectId);
  return tagView(tx, actor, id);
}

export function createTagTool(actor: McpActor, input: McpInput<'create_tag'>) {
  const { operationId, ...fields } = input;
  return structureOperation(actor, 'create_tag', input, mcpTools.create_tag.output, async (tx) => {
    await lockTags(tx, actor, fields.projectId);
    const id = writeId(actor, operationId, 'tag');
    if ((await createTag(tx, actor, { id, ...fields })) === null)
      throw new ToolError('Tag ID is already in use.');
    return outcome(operationId, await tagView(tx, actor, id));
  });
}

export function updateTagTool(actor: McpActor, input: McpInput<'update_tag'>) {
  const { operationId, tagId, changes } = input;
  return structureOperation(actor, 'update_tag', input, mcpTools.update_tag.output, async (tx) => {
    const current = await lockedTag(tx, actor, tagId);
    const { conflicts, patch } = planEdit(current, changes);
    if (conflicts.length) return outcome(operationId, current, conflicts);
    await updateTag(tx, actor, tagId, patch);
    return outcome(operationId, await tagView(tx, actor, tagId));
  });
}

export function moveTagTool(actor: McpActor, input: McpInput<'move_tag'>) {
  const { operationId, tagId, before, placement } = input;
  return structureOperation(actor, 'move_tag', input, mcpTools.move_tag.output, async (tx) => {
    const current = await lockedTag(tx, actor, tagId);
    const conflicts = different(current, before);
    if (conflicts.length) return outcome(operationId, current, conflicts);
    const rows = (await projectTags(tx, actor.userId, current.projectId, actor.workspaceId))
      .filter((row) => row.parentId === current.parentId)
      .sort(compareTags);
    const updates = planSiblingMove(rows, tagId, placement);
    if (!updates)
      throw new ToolError(
        'Choose another tag with the same parent in this project as the neighbor.',
      );
    await setTagPositions(tx, actor, current.projectId, updates);
    return outcome(operationId, await tagView(tx, actor, tagId));
  });
}
