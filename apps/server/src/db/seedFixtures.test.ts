import {
  activityEntrySchema,
  commentSchema,
  createTagSchema,
  relationRole,
  STARTER_STATUSES,
  TAG_ICONS,
  type Tag,
  tagWriteIssue,
  taskRelationSchema,
  taskSchema,
  taskTagSchema,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import {
  buildProjectFixtures,
  buildRelationFixtures,
  buildTags,
  DEMO_PROJECTS,
  DEMO_RELATIONS,
  HOUSE_COMMENTS,
  HOUSE_CREATED_DAYS_AGO,
  HOUSE_TAGS,
  HOUSE_TASKS,
  THROW_COMMENTS,
  THROW_CREATED_DAYS_AGO,
  THROW_EXTRA_STATUSES,
  THROW_TAGS,
  THROW_TASKS,
} from './seedFixtures';

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

const projects = [
  {
    name: 'Throw',
    tags: THROW_TAGS,
    tasks: THROW_TASKS,
    comments: THROW_COMMENTS,
    extras: THROW_EXTRA_STATUSES,
    createdDaysAgo: THROW_CREATED_DAYS_AGO,
  },
  {
    name: 'House move',
    tags: HOUSE_TAGS,
    tasks: HOUSE_TASKS,
    comments: HOUSE_COMMENTS,
    extras: [],
    createdDaysAgo: HOUSE_CREATED_DAYS_AGO,
  },
];

it('gives each demo project a bundled icon', () => {
  for (const project of DEMO_PROJECTS) expect(TAG_ICONS).toContain(project.icon);
});

const workspaceId = uuidv7();
const userId = 'seeded-admin';
const now = new Date('2026-11-22T12:00:00.000Z');

function build(project: (typeof projects)[number]) {
  const scope = { workspaceId, projectId: uuidv7() };
  const tagRows = buildTags(project.tags, scope);
  const statuses = [
    ...STARTER_STATUSES.map((s) => ({ ...s, isDefault: true })),
    ...project.extras.map(([name, category]) => ({ name, category, isDefault: false })),
  ].map((status) => ({ ...status, id: uuidv7() }));
  const fixtures = buildProjectFixtures({
    scope,
    userId,
    now,
    statuses,
    tags: tagRows.map(({ id, name }) => ({ id, name })),
    tasks: project.tasks,
    comments: project.comments,
    createdDaysAgo: project.createdDaysAgo,
  });
  return { scope, tagRows, statuses, fixtures };
}

describe.each(projects)('$name fixtures', (project) => {
  const { tagRows, fixtures } = build(project);

  it('makes a valid tag tree', () => {
    const tags = tagRows.map((row) => ({ ...row, position: row.position ?? null }) as Tag);
    for (const tag of tags) {
      const { workspaceId: _workspaceId, position: _position, ...create } = tag;
      expect(createTagSchema.safeParse(create).error).toBeUndefined();
      expect(tagWriteIssue(tag, tags)).toBeNull();
    }
  });

  it('makes tasks that parse as synced rows', () => {
    for (const task of fixtures.tasks) {
      const { updatedAt: _updatedAt, ...synced } = task;
      const row = {
        ...synced,
        closedAt: iso(task.closedAt),
        deletedAt: iso(task.deletedAt),
        createdAt: iso(task.createdAt),
      };
      expect(taskSchema.strict().safeParse(row).error).toBeUndefined();
      expect(task.description === null).toBe(task.descriptionVersion === null);
    }
    for (const row of fixtures.taskTags) expect(taskTagSchema.parse(row)).toEqual(row);
    expect(fixtures.tasks.map((task) => task.number)).toEqual(
      fixtures.tasks.map((_, index) => index + 1),
    );
  });

  it('covers tags, sizes, descriptions and the trash', () => {
    const { tasks } = fixtures;
    expect(tasks.some((task) => task.primaryTagId === null)).toBe(true);
    expect(tasks.some((task) => task.primaryTagId !== null)).toBe(true);
    expect(fixtures.taskTags.length).toBeGreaterThan(0);
    expect(tasks.some((task) => task.size === null)).toBe(true);
    expect(tasks.some((task) => task.description !== null)).toBe(true);
    expect(tasks.some((task) => task.parentId !== null)).toBe(true);
    expect(tasks.some((task) => task.deletedAt !== null)).toBe(true);
    expect(tasks.some((task) => task.closedAt !== null)).toBe(true);
  });

  it('records history as the server writes it', () => {
    const taskById = new Map(fixtures.tasks.map((task) => [task.id, task]));
    for (const entry of fixtures.activity) {
      const { feedOrder: _feedOrder, ...synced } = entry;
      const parsed = activityEntrySchema
        .strict()
        .safeParse({ ...synced, createdAt: iso(entry.createdAt) });
      expect(parsed.error).toBeUndefined();
      const task = taskById.get(entry.taskId)!;
      expect(entry.createdAt!.getTime()).toBeGreaterThanOrEqual(task.createdAt!.getTime());
      expect(entry.createdAt!.getTime()).toBeLessThanOrEqual(now.getTime());
    }
    const created = fixtures.activity.filter((entry) => entry.kind === 'created');
    expect(created.map((entry) => entry.id)).toEqual(fixtures.tasks.map((task) => task.id));
    expect(fixtures.activity.some((entry) => entry.kind === 'updated')).toBe(true);
  });

  it('writes comments by the seeded user after their tasks', () => {
    const taskById = new Map(fixtures.tasks.map((task) => [task.id, task]));
    for (const comment of fixtures.comments) {
      const parsed = commentSchema.strict().safeParse({
        ...comment,
        createdAt: iso(comment.createdAt),
        editedAt: null,
      });
      expect(parsed.error).toBeUndefined();
      expect(comment.userId).toBe(userId);
      expect(comment.createdAt!.getTime()).toBeGreaterThan(
        taskById.get(comment.taskId)!.createdAt!.getTime(),
      );
    }
    expect(fixtures.commentActivity.map((entry) => entry.commentId)).toEqual(
      fixtures.comments.map((comment) => comment.id),
    );
  });
});

it('links tasks within and across the demo projects as the server records it', () => {
  const built = new Map(projects.map((project) => [project.name, build(project)]));
  const lookup = ({ project, ref }: { project: string; ref: string }) => {
    const { scope, fixtures } = built.get(project)!;
    const id = fixtures.refs.get(ref)!;
    const task = fixtures.tasks.find((row) => row.id === id)!;
    return {
      id,
      projectId: scope.projectId,
      identifier: `${project}-${task.number}`,
      createdAt: task.createdAt!,
    };
  };
  const { relations, activity } = buildRelationFixtures({
    workspaceId,
    userId,
    now,
    task: lookup,
    relations: DEMO_RELATIONS,
  });
  for (const row of relations) {
    expect(
      taskRelationSchema.strict().parse({ ...row, createdAt: iso(row.createdAt) }),
    ).toBeTruthy();
  }
  expect(new Set(relations.map((row) => row.kind))).toEqual(
    new Set(['blocks', 'duplicates', 'relates_to']),
  );
  const projectOf = new Map(
    [...built.values()].flatMap(({ scope, fixtures }) =>
      fixtures.tasks.map((task) => [task.id, scope.projectId]),
    ),
  );
  expect(
    relations.some((row) => projectOf.get(row.sourceTaskId) !== projectOf.get(row.targetTaskId)),
  ).toBe(true);

  expect(activity).toHaveLength(relations.length * 2);
  for (const entry of activity) {
    const { feedOrder: _feedOrder, ...synced } = entry;
    expect(
      activityEntrySchema.strict().safeParse({ ...synced, createdAt: iso(entry.createdAt) }).error,
    ).toBeUndefined();
  }
  const release = lookup({ project: 'Throw', ref: 'release' });
  const blockers = relations
    .filter((row) => relationRole(row, release.id)?.role === 'blocked_by')
    .map((row) => row.sourceTaskId);
  expect(blockers).toHaveLength(4);
});
