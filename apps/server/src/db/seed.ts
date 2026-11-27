import {
  deriveProjectKey,
  positionBetween,
  STARTER_STATUSES,
  type StatusCategory,
  taskIdentifier,
} from '@throw/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { auth } from '../auth';
import { demoRepository, demoSecret, simulatedEvent } from '../dev/githubEvents';
import { env } from '../env';
import { githubSecretKey } from '../github/config';
import { dispatchGithubEvent } from '../github/dispatch';
import { newWebhookToken } from '../github/secrets';
import { memberWorkspaces } from '../lib/workspaces';
import { encryptSecret } from '../webhooks/signing';
import { sql as connection, db, type Transaction } from './client';
import {
  commentActivity,
  comments,
  githubConnections,
  githubDeliveries,
  projects,
  statuses,
  tags,
  taskActivity,
  taskRelations,
  tasks,
  taskTags,
  user,
} from './schema';
import {
  buildProjectFixtures,
  buildRelationFixtures,
  buildTags,
  type CommentSpec,
  DEMO_PROJECTS,
  DEMO_RELATIONS,
  HOUSE_COMMENTS,
  HOUSE_CREATED_DAYS_AGO,
  HOUSE_TAGS,
  HOUSE_TASKS,
  type SeededTask,
  type StatusRow,
  type TagSpec,
  type TaskSpec,
  THROW_COMMENTS,
  THROW_CREATED_DAYS_AGO,
  THROW_EXTRA_STATUSES,
  THROW_GITHUB_EVENTS,
  THROW_TAGS,
  THROW_TASKS,
} from './seedFixtures';

/**
 * Idempotent development fixtures. `basic` creates the admin account; `demo`
 * adds a regular user and two sample projects with tags, sizes, descriptions, comments,
 * history, trash and relations between them (`seedFixtures.ts`). A project is filled only
 * while it has never had a task, and relations only in the run that filled both, so a rerun
 * never duplicates rows or overwrites edits.
 */
const profile = process.env.THROW_SEED_PROFILE ?? 'none';

const ACCOUNTS = {
  admin: { name: 'Admin', email: 'admin@example.com', password: 'adminadmin' },
  user: { name: 'Demo User', email: 'user@example.com', password: 'userpassword' },
};

async function ensureAccount(account: (typeof ACCOUNTS)[keyof typeof ACCOUNTS]) {
  const [existing] = await db.select().from(user).where(eq(user.email, account.email));
  if (existing) return existing.id;
  const result = await auth.api.signUpEmail({ body: account });
  console.log(`Seeded account ${account.email} / ${account.password}`);
  return result.user.id;
}

async function ensureDemoProjects(userId: string) {
  // Signing up made the account's first workspace.
  const [workspace] = await memberWorkspaces(db, userId);
  if (!workspace) return;
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspace.id))
    .limit(1);
  if (existing) return;
  let position: string | null = null;
  const rows = DEMO_PROJECTS.map((project) => {
    position = positionBetween(position, null);
    const key = deriveProjectKey(project.name);
    return { ...project, id: uuidv7(), workspaceId: workspace.id, position, key };
  });
  await db.transaction(async (tx) => {
    await tx.insert(projects).values(rows);
    await tx.insert(statuses).values(
      rows.flatMap((project) =>
        STARTER_STATUSES.map((status) => ({
          ...status,
          id: uuidv7(),
          workspaceId: workspace.id,
          projectId: project.id,
          position: positionBetween(null, null),
          isDefault: true,
        })),
      ),
    );
  });
  console.log(`Seeded ${DEMO_PROJECTS.length} demo projects`);
}

type SeededProject = { workspaceId: string; tasks: Map<string, SeededTask> };

/**
 * Lock a seeded project and fill it once: only while it has never had a task. Answers the
 * tasks it made by ref, or null when the project was already filled.
 */
async function ensureDemoContent(
  userId: string,
  name: string,
  fill: (
    tx: Transaction,
    project: typeof projects.$inferSelect,
  ) => Promise<{ count: number; tasks: SeededProject['tasks'] }>,
): Promise<SeededProject | null> {
  const memberships = await memberWorkspaces(db, userId);
  const workspaceIds = memberships.map((workspace) => workspace.id);
  if (workspaceIds.length === 0) return null;
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        inArray(projects.workspaceId, workspaceIds),
        eq(projects.name, name),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!project) return null;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .for('update');
    if (!locked || locked.taskCounter > 0) return null;
    const [existing] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, project.id))
      .limit(1);
    if (existing) return null;
    const { count, tasks: seeded } = await fill(tx, locked);
    await tx
      .update(projects)
      .set({ taskCounter: count })
      .where(and(eq(projects.id, project.id), eq(projects.workspaceId, project.workspaceId)));
    console.log(`Seeded ${count} tasks in ${name}`);
    return { workspaceId: locked.workspaceId, tasks: seeded };
  });
}

async function addStatuses(
  tx: Transaction,
  project: typeof projects.$inferSelect,
  extras: [string, StatusCategory][],
) {
  const allStatuses: (StatusRow & { position: string })[] = await tx
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, project.id));
  for (const [name, category] of extras) {
    if (allStatuses.some((status) => status.name === name)) continue;
    const peers = allStatuses
      .filter((status) => status.category === category)
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    const row = {
      id: uuidv7(),
      workspaceId: project.workspaceId,
      projectId: project.id,
      name,
      category,
      position: positionBetween(peers.at(-1)?.position ?? null, null),
      isDefault: false,
    };
    await tx.insert(statuses).values(row);
    allStatuses.push(row);
  }
  return allStatuses;
}

/** Tags are added only to a project that has none, so a rerun never duplicates them. */
async function ensureTags(
  tx: Transaction,
  project: typeof projects.$inferSelect,
  specs: TagSpec[],
) {
  const existing = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.projectId, project.id));
  if (existing.length) return existing;
  const rows = buildTags(specs, { workspaceId: project.workspaceId, projectId: project.id });
  await tx.insert(tags).values(rows);
  return rows.map(({ id, name }) => ({ id, name }));
}

async function fillProject(
  tx: Transaction,
  project: typeof projects.$inferSelect,
  userId: string,
  content: {
    statuses: [string, StatusCategory][];
    tags: TagSpec[];
    tasks: TaskSpec[];
    comments: CommentSpec[];
    createdDaysAgo: (index: number) => number;
  },
) {
  const allStatuses = await addStatuses(tx, project, content.statuses);
  const projectTags = await ensureTags(tx, project, content.tags);
  const fixtures = buildProjectFixtures({
    scope: { workspaceId: project.workspaceId, projectId: project.id },
    userId,
    now: new Date(),
    statuses: allStatuses,
    tags: projectTags,
    tasks: content.tasks,
    comments: content.comments,
    createdDaysAgo: content.createdDaysAgo,
  });
  await tx.insert(tasks).values(fixtures.tasks);
  if (fixtures.taskTags.length) await tx.insert(taskTags).values(fixtures.taskTags);
  await tx.insert(taskActivity).values(fixtures.activity);
  if (fixtures.comments.length) {
    await tx.insert(comments).values(fixtures.comments);
    await tx.insert(commentActivity).values(fixtures.commentActivity);
  }
  const byId = new Map(fixtures.tasks.map((task) => [task.id, task]));
  const seeded = new Map<string, SeededTask>();
  for (const [ref, id] of fixtures.refs) {
    const task = byId.get(id)!;
    seeded.set(ref, {
      id,
      projectId: project.id,
      identifier: taskIdentifier(project, task)!,
      createdAt: task.createdAt!,
    });
  }
  return { count: fixtures.tasks.length, tasks: seeded, statuses: allStatuses };
}

async function seedThrowGithub(
  tx: Transaction,
  project: typeof projects.$inferSelect,
  userId: string,
  seeded: Map<string, SeededTask>,
  allStatuses: StatusRow[],
) {
  const connection = {
    id: uuidv7(),
    workspaceId: project.workspaceId,
    projectId: project.id,
    repository: demoRepository,
  };
  const created = await tx
    .insert(githubConnections)
    .values({
      ...connection,
      createdBy: userId,
      webhookToken: newWebhookToken(),
      encryptedWebhookSecret: encryptSecret(demoSecret(env.BETTER_AUTH_SECRET), githubSecretKey),
    })
    .onConflictDoNothing({ target: githubConnections.projectId })
    .returning({ id: githubConnections.id });
  if (!created.length) return;
  const now = Date.now();
  for (const fixture of THROW_GITHUB_EVENTS) {
    const spec =
      'ref' in fixture ? THROW_TASKS.find((task) => task.ref === fixture.ref) : undefined;
    const key = 'ref' in fixture ? seeded.get(fixture.ref)!.identifier : undefined;
    for (const command of fixture.events) {
      const receivedAt = new Date(now - fixture.daysAgo * 86400000);
      const deliveryId = uuidv7();
      const item = simulatedEvent(command, demoRepository, key, {
        now: receivedAt,
        pr: 'pr' in fixture ? fixture.pr : undefined,
        tag: 'v0.1.0',
        title: spec?.title,
      });
      await tx
        .insert(githubDeliveries)
        .values({ connectionId: connection.id, deliveryId, event: item.event, receivedAt });
      const handled = await dispatchGithubEvent(tx, { connection, deliveryId, ...item });
      if (handled.status === 'ignored') throw new Error(handled.reason);
      await tx
        .update(githubConnections)
        .set({
          lastDeliveryAt: receivedAt,
          lastDeliveryId: deliveryId,
          lastDeliveryEvent: item.event,
          lastDeliveryStatus: 'ok',
        })
        .where(eq(githubConnections.id, connection.id));
    }
  }
  // Enable rules after replaying the history so the board opens in its curated layout.
  const status = (name: string) => allStatuses.find((s) => s.name === name)!.id;
  await tx
    .update(githubConnections)
    .set({
      prDraftOpenedStatusId: status('In progress'),
      prReadyForReviewStatusId: status('In review'),
      prMergedStatusId: status('Done'),
      prClosedStatusId: status('Cancelled'),
      issueClosedStatusId: status('Done'),
    })
    .where(eq(githubConnections.id, connection.id));
}

/** Links the demo projects' tasks, once both were filled in this run. */
async function seedDemoRelations(userId: string, seeded: Record<string, SeededProject>) {
  const workspaceId = Object.values(seeded)[0]!.workspaceId;
  const fixtures = buildRelationFixtures({
    workspaceId,
    userId,
    now: new Date(),
    task: ({ project, ref }) => {
      const task = seeded[project]?.tasks.get(ref);
      if (!task) throw new Error(`Unknown task "${ref}" in ${project}`);
      return task;
    },
    relations: DEMO_RELATIONS,
  });
  await db.transaction(async (tx) => {
    await tx.insert(taskRelations).values(fixtures.relations);
    await tx.insert(taskActivity).values(fixtures.activity);
  });
  console.log(`Seeded ${fixtures.relations.length} task relations`);
}

if (profile === 'basic' || profile === 'demo') {
  const adminId = await ensureAccount(ACCOUNTS.admin);
  if (profile === 'demo') {
    await ensureAccount(ACCOUNTS.user);
    await ensureDemoProjects(adminId);
    const throwProject = await ensureDemoContent(adminId, 'Throw', async (tx, project) => {
      const filled = await fillProject(tx, project, adminId, {
        statuses: THROW_EXTRA_STATUSES,
        tags: THROW_TAGS,
        tasks: THROW_TASKS,
        comments: THROW_COMMENTS,
        createdDaysAgo: THROW_CREATED_DAYS_AGO,
      });
      await seedThrowGithub(tx, project, adminId, filled.tasks, filled.statuses);
      return filled;
    });
    const houseProject = await ensureDemoContent(adminId, 'House move', (tx, project) =>
      fillProject(tx, project, adminId, {
        statuses: [],
        tags: HOUSE_TAGS,
        tasks: HOUSE_TASKS,
        comments: HOUSE_COMMENTS,
        createdDaysAgo: HOUSE_CREATED_DAYS_AGO,
      }),
    );
    if (throwProject && houseProject)
      await seedDemoRelations(adminId, { Throw: throwProject, 'House move': houseProject });
  }
} else if (profile !== 'none') {
  throw new Error(`Unknown THROW_SEED_PROFILE "${profile}". Use none, basic or demo.`);
}

await connection.end();
