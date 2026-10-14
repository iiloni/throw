import { type Color, deriveProjectKey, positionBetween, STARTER_STATUSES } from '@throw/shared';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { auth } from '../auth';
import { memberWorkspaces } from '../lib/workspaces';
import { sql as connection, db } from './client';
import { projects, statuses, user } from './schema';

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

if (profile === 'basic' || profile === 'demo') {
  const adminId = await ensureAccount(ACCOUNTS.admin);
  if (profile === 'demo') {
    await ensureAccount(ACCOUNTS.user);
    await ensureDemoProjects(adminId);
  }
} else if (profile !== 'none') {
  throw new Error(`Unknown THROW_SEED_PROFILE "${profile}". Use none, basic or demo.`);
}

await connection.end();
