import { describe, expect, it } from 'vitest';
import { priorityName } from './priorities';
import {
  createProjectSchema,
  deriveProjectKey,
  projectKeySchema,
  settleProjectKey,
  updateProjectSchema,
} from './projects';
import { STARTER_STATUSES, statusSetIssue, updateStatusSchema } from './statuses';
import { parseTimestamptz } from './sync';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('project keys', () => {
  it('accepts one to six capitals and digits starting with a letter', () => {
    for (const key of ['C', 'CAT', 'CAT123', 'A1B2C3'])
      expect(projectKeySchema.safeParse(key).success).toBe(true);
    for (const key of ['', 'cat', '1CAT', 'CATCATS', 'CA-T'])
      expect(projectKeySchema.safeParse(key).success).toBe(false);
  });

  it('derives a proposal from a name', () => {
    expect(deriveProjectKey('Catch')).toBe('CAT');
    expect(deriveProjectKey('House move')).toBe('HM');
    expect(deriveProjectKey('Garden')).toBe('GAR');
    expect(deriveProjectKey('2026 roadmap')).toBe('R');
    expect(deriveProjectKey('Café crème')).toBe('CC');
    expect(deriveProjectKey('!!!')).toBe('P');
    expect(deriveProjectKey('a b c d e f g h')).toBe('ABCDEF');
  });

  it('settles a clash with the smallest free number from 2 up', () => {
    expect(settleProjectKey('CAT', new Set())).toBe('CAT');
    expect(settleProjectKey('CAT', new Set(['CAT']))).toBe('CAT2');
    expect(settleProjectKey('CAT', new Set(['CAT', 'CAT2', 'CAT4']))).toBe('CAT3');
    expect(settleProjectKey('CATCAT', new Set(['CATCAT']))).toBe('CATCAT2');
  });
});

describe('creating a project', () => {
  const statuses = STARTER_STATUSES.map((status, index) => ({
    ...status,
    id: id(10 + index),
    position: 'a0',
    isDefault: true,
  }));
  const project = {
    id: id(1),
    workspaceId: id(2),
    name: 'Catch',
    color: 'teal',
    icon: null,
    position: 'a0',
    key: 'CAT',
    statuses,
  };

  it('carries a key and one default status in each category', () => {
    expect(createProjectSchema.safeParse(project).success).toBe(true);
  });

  it('refuses a status set that breaks the project rules', () => {
    const without = statuses.filter((status) => status.category !== 'done');
    expect(createProjectSchema.safeParse({ ...project, statuses: without }).success).toBe(false);
    const twoDefaults = [...statuses, { ...statuses[0]!, id: id(20) }];
    expect(createProjectSchema.safeParse({ ...project, statuses: twoDefaults }).success).toBe(
      false,
    );
    const noDefault = statuses.map((status) =>
      status.category === 'active' ? { ...status, isDefault: false } : status,
    );
    expect(createProjectSchema.safeParse({ ...project, statuses: noDefault }).success).toBe(false);
    const sameId = statuses.map((status) => ({ ...status, id: id(10) }));
    expect(createProjectSchema.safeParse({ ...project, statuses: sameId }).success).toBe(false);
  });

  it('checks every category', () => {
    expect(statusSetIssue(statuses)).toBeNull();
    expect(statusSetIssue([])).toMatch(/backlog/);
  });
});

describe('updating', () => {
  it('lets a project change its key and go to the trash, but not its workspace', () => {
    expect(updateProjectSchema.safeParse({ key: 'NEW', trashed: true }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ workspaceId: id(3) }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ deletedAt: null }).success).toBe(false);
  });

  it('only ever makes a status the default', () => {
    expect(updateStatusSchema.safeParse({ isDefault: true }).success).toBe(true);
    expect(updateStatusSchema.safeParse({ isDefault: false }).success).toBe(false);
    expect(updateStatusSchema.safeParse({ category: 'done' }).success).toBe(false);
  });
});

it('names priorities with the project names, falling back to the defaults', () => {
  const names = ['Now', '', '', '', 'Someday'];
  expect(priorityName(names, 1)).toBe('Now');
  expect(priorityName(names, 3)).toBe('Default');
  expect(priorityName(names, 5)).toBe('Someday');
});

it('reads Postgres times as ISO strings in UTC', () => {
  expect(parseTimestamptz('2026-10-14 17:16:53.843122+00')).toBe('2026-10-14T17:16:53.843Z');
  expect(parseTimestamptz('2026-10-14 17:16:53+02')).toBe('2026-10-14T15:16:53.000Z');
  expect(parseTimestamptz('2026-10-14 17:16:53.5-05:30')).toBe('2026-10-14T22:46:53.500Z');
});
