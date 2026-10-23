import {
  type Project,
  projectSchema,
  type Status,
  statusSchema,
  type Task,
  taskSchema,
} from '@throw/shared';
import { describe, expect, it } from 'vitest';
import {
  projectKeyIssue,
  settingsSectionSchema,
  statusRemovalIssue,
  statusUsage,
  trashRoots,
} from './projectSettings';
import { writeRefusalMessage } from './writeRefusal';

const workspaceId = '0199a0a0-0000-7000-8000-000000000001';
const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const project = (n: number, fields: Partial<Project> = {}) =>
  projectSchema.parse({
    id: id(n),
    workspaceId,
    name: `Project ${n}`,
    color: 'teal',
    icon: null,
    position: 'a0',
    key: `P${n}`,
    priorityNames: ['', '', '', '', ''],
    deletedAt: null,
    ...fields,
  });
const status: Status = statusSchema.parse({
  id: id(10),
  workspaceId,
  projectId: id(1),
  category: 'active',
  name: 'Building',
  position: 'a0',
  isDefault: true,
});
const task = (n: number, fields: Partial<Task> = {}) =>
  taskSchema.parse({
    id: id(n),
    workspaceId,
    projectId: id(1),
    title: 'Task',
    number: n,
    description: null,
    descriptionVersion: null,
    priority: 3,
    statusId: status.id,
    position: 'a0',
    parentId: null,
    primaryTagId: null,
    closedAt: null,
    deletedAt: null,
    createdAt: '2026-10-19T00:00:00.000Z',
    ...fields,
  });
const deletedAt = '2026-10-19T00:00:00.000Z';

describe('project settings rules', () => {
  it('uses General for unknown sections while retaining valid bookmarked sections', () => {
    expect(settingsSectionSchema.catch('general').parse('statuses')).toBe('statuses');
    expect(settingsSectionSchema.catch('general').parse('unknown')).toBe('general');
  });
  it('validates proposed keys and accounts for workspace scope, trash and settled suffixes', () => {
    const own = project(1);
    for (const key of ['', '1KEY', 'lower', 'ABCDEF2', 'A-B'])
      expect(projectKeyIssue(own, key, [])).toMatch(/1–6/);
    expect(projectKeyIssue(own, 'ABC123', [])).toBeNull();
    expect(projectKeyIssue(own, 'P2', [own, project(2, { deletedAt })])).toContain('in the trash');
    expect(projectKeyIssue(own, 'P2', [project(2, { workspaceId: id(999) })])).toBeNull();
    const settled = project(1, { key: 'ABCDEF2' });
    expect(projectKeyIssue(settled, settled.key!, [settled])).toBeNull();
    expect(projectKeyIssue(project(1, { key: null }), 'NEW', [])).toContain('Connect');
  });
  it('counts all tasks and explains both default and usage blockers', () => {
    const tasks = [task(20), task(21, { deletedAt }), task(22, { projectId: id(2) })];
    expect(statusUsage(status, tasks)).toBe(2);
    expect(statusRemovalIssue(status, [status], 2)).toMatch(/at least one.*2 tasks.*trash/);
    expect(statusRemovalIssue(status, [status, { ...status, id: id(11) }], 0)).toContain(
      'another default',
    );
    expect(statusRemovalIssue({ ...status, isDefault: false }, [status, status], 0)).toBeNull();
  });
  it('lists trash roots once and keeps separately trashed children after restoring their parent', () => {
    const projects = [
      project(1),
      project(2, { deletedAt }),
      project(3, { workspaceId: id(999), deletedAt }),
    ];
    const parent = task(20, { deletedAt });
    const child = task(21, { parentId: parent.id, deletedAt });
    const inherited = task(22, { parentId: parent.id });
    const inProject = task(23, { projectId: id(2), deletedAt });
    const tasks = [parent, child, inherited, inProject];
    expect(trashRoots(projects, tasks, workspaceId)).toEqual({
      projects: [projects[1]],
      tasks: [parent],
    });
    expect(trashRoots(projects, tasks, workspaceId, id(2))).toEqual({ projects: [], tasks: [] });
    expect(
      trashRoots(projects, [{ ...parent, deletedAt: null }, child, inherited], workspaceId, id(1))
        .tasks,
    ).toEqual([child]);
  });
  it('explains recognised server clashes and safely ignores unknown error bodies', () => {
    expect(writeRefusalMessage('{"error":"Another project has this key"}')).toContain(
      'previous key is kept',
    );
    expect(writeRefusalMessage('{"error":"Tasks use this status"}')).toContain('trash');
    for (const body of [
      '<html>bad gateway</html>',
      '{}',
      '{"error":"secret details"}',
      '{"error":"constructor"}',
      '{"error":"toString"}',
    ])
      expect(writeRefusalMessage(body)).toBeNull();
  });
});
