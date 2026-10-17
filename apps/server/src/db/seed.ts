import {
  type Color,
  deriveProjectKey,
  type Priority,
  positionBetween,
  positionsBetween,
  STARTER_STATUSES,
  type StatusCategory,
} from '@throw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { auth } from '../auth';
import { memberWorkspaces } from '../lib/workspaces';
import { sql as connection, db } from './client';
import { projects, statuses, tasks, user } from './schema';

/**
 * Idempotent development fixtures. `basic` creates the admin account; `demo`
 * adds a regular user and sample projects. Never overwrites existing data.
 */
const profile = process.env.THROW_SEED_PROFILE ?? 'none';

const ACCOUNTS = {
  admin: { name: 'Admin', email: 'admin@example.com', password: 'adminadmin' },
  user: { name: 'Demo User', email: 'user@example.com', password: 'userpassword' },
};

const DEMO_PROJECTS: { name: string; color: Color }[] = [
  { name: 'Throw', color: 'amber' },
  { name: 'House move', color: 'teal' },
];

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

/** Add board fixtures to the seeded Throw project only, once, including on older dev stacks. */
async function ensureDemoBoard(userId: string) {
  const memberships = await memberWorkspaces(db, userId);
  const workspaceIds = new Set(memberships.map((workspace) => workspace.id));
  if (workspaceIds.size === 0) return;
  const project = (
    await db
      .select()
      .from(projects)
      .where(inArray(projects.workspaceId, [...workspaceIds]))
  ).find(
    (item) =>
      workspaceIds.has(item.workspaceId) && item.name === 'Throw' && item.deletedAt === null,
  );
  if (!project) return;
  await db.transaction(async (tx) => {
    const [lockedProject] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .for('update');
    if (!lockedProject || lockedProject.taskCounter > 0) return;
    const [existing] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, project.id))
      .limit(1);
    if (existing) return;
    const allStatuses = await tx.select().from(statuses).where(eq(statuses.projectId, project.id));
    const extras: [string, StatusCategory][] = [
      ['Ideas', 'backlog'],
      ['In review', 'active'],
      ['Testing', 'active'],
      ['Released', 'done'],
      ['Duplicate', 'cancelled'],
    ];
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
      allStatuses.push({ ...row, createdAt: new Date(), updatedAt: new Date() });
    }
    const status = (name: string) => allStatuses.find((item) => item.name === name)!;
    const active = allStatuses.find((item) => item.category === 'active' && item.isDefault)!;
    const backlog = allStatuses.find((item) => item.category === 'backlog' && item.isDefault)!;
    const done = allStatuses.find((item) => item.category === 'done' && item.isDefault)!;
    const cancelled = allStatuses.find((item) => item.category === 'cancelled' && item.isDefault)!;
    const fixtureProject = project;
    const positions = positionsBetween(null, null, 50);
    const rows: (typeof tasks.$inferInsert)[] = [];
    function add(
      title: string,
      statusId: string,
      priority: Priority = 3,
      parentId: string | null = null,
      days = 0,
    ) {
      const category = allStatuses.find((item) => item.id === statusId)!.category;
      const row = {
        id: uuidv7(),
        workspaceId: fixtureProject.workspaceId,
        projectId: fixtureProject.id,
        title,
        number: rows.length + 1,
        statusId,
        priority,
        parentId,
        position: positions[rows.length]!,
        closedAt:
          category === 'done' || category === 'cancelled'
            ? new Date(Date.now() - days * 86400000)
            : null,
      };
      rows.push(row);
      return row.id;
    }
    const parent = add('Keep the board useful without a connection', active.id, 1);
    add('Create a task offline', done.id, 3, parent);
    add('Show its number after reconnecting', active.id, 3, parent);
    add('Keep unsent changes across a reload', backlog.id, 3, parent);
    add(
      'A quiet card with room for a long title, even when the board is squeezed beside an open task on a small laptop',
      active.id,
      2,
    );
    const titles = [
      'Subtask progress under the card',
      'Remember the last workspace',
      'Status filters in the backlog',
      'Round the edges of scrolled cards',
      'A place for work still taking shape',
      'Name each priority in settings',
      'Open a task beside the board',
      'Make the tray easy to reach',
      'Use the board in dark mode',
      'Keep focus when a task closes',
      'A column with enough work to scroll',
      'Restore a project from the trash',
      'Try the board with reduced motion',
      'Write the self-hosting guide',
      'Polish the empty state',
      'Prepare the next release',
    ];
    titles.forEach((title, index) => {
      add(title, active.id, ([2, 3, 4, 5] as const)[Math.floor(index / 4)]!);
    });
    add('Review the phone tray', status('In review').id, 2);
    add('Check the last card in a long column', status('Testing').id);
    add('A command palette for later', backlog.id, 2);
    add('Bring notes across from Catch', status('Ideas').id, 4);
    add('Explore milestones', status('Ideas').id, 5);
    add('Make project keys readable', done.id, 3, null, 1);
    add('Ship the responsive shell', status('Released').id, 3, null, 4);
    add('Start with synced tasks', done.id, 3, null, 12);
    add('Import every issue automatically', cancelled.id, 4, null, 2);
    add('Second copy of the tray idea', status('Duplicate').id, 3, null, 8);
    await tx.insert(tasks).values(rows);
    await tx
      .update(projects)
      .set({ taskCounter: rows.length })
      .where(and(eq(projects.id, project.id), eq(projects.workspaceId, project.workspaceId)));
    console.log(`Seeded ${rows.length} board tasks`);
  });
}

if (profile === 'basic' || profile === 'demo') {
  const adminId = await ensureAccount(ACCOUNTS.admin);
  if (profile === 'demo') {
    await ensureAccount(ACCOUNTS.user);
    await ensureDemoProjects(adminId);
    await ensureDemoBoard(adminId);
  }
} else if (profile !== 'none') {
  throw new Error(`Unknown THROW_SEED_PROFILE "${profile}". Use none, basic or demo.`);
}

await connection.end();
