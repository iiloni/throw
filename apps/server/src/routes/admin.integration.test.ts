import { randomUUID } from 'node:crypto';
import {
  API_PROTOCOL_HEADER,
  createInviteResponseSchema,
  INVITE_HEADER,
  invitesResponseSchema,
  resetUserPasswordResponseSchema,
  usersResponseSchema,
} from '@throw/shared';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppType } from '../app';
import { migrationsFolder } from '../db/migrations';

const signupResponse = z.object({ user: z.object({ id: z.string(), role: z.string() }) });
const testPostgres = process.env.THROW_TEST_POSTGRES;

// Run inside the worktree stack. Each suite migrates and drops its own empty database.
describe.skipIf(!testPostgres)('admin API against Postgres', { timeout: 30_000 }, () => {
  const database = `throw_admin_test_${randomUUID().replaceAll('-', '')}`;
  let control: postgres.Sql;
  let sql: postgres.Sql;
  let app: AppType;
  let env: typeof import('../env').env;
  let admin: { id: string; token: string };

  function request(path: string, method = 'GET', body?: unknown, token?: string, invite?: string) {
    return app.request(`http://localhost:3000/api/${path}`, {
      method,
      headers: {
        [API_PROTOCOL_HEADER]: '1',
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(invite === undefined ? {} : { [INVITE_HEADER]: invite }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const signup = (name: string, invite?: string) =>
    request(
      'auth/sign-up/email',
      'POST',
      { name, email: `${randomUUID()}@example.com`, password: 'password123' },
      undefined,
      invite,
    );
  async function account(name: string) {
    const response = await signup(name);
    expect(response.status, await response.clone().text()).toBe(200);
    return {
      ...signupResponse.parse(await response.json()).user,
      token: response.headers.get('set-auth-token')!,
    };
  }
  const act = (path: string, method = 'GET', body?: unknown) =>
    request(`admin/${path}`, method, body, admin.token);
  async function waitForBlockedRequest(pid: number) {
    await expect
      .poll(async () => {
        const [row] =
          await sql`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        return row!.waiting;
      })
      .toBe(true);
  }
  async function issue() {
    const response = await act('invites', 'POST', { label: 'Guest' });
    expect(response.status).toBe(201);
    return createInviteResponseSchema.parse(await response.json());
  }

  beforeAll(async () => {
    control = postgres(testPostgres!);
    await control`CREATE DATABASE ${control(database)}`;
    const url = new URL(testPostgres!);
    url.pathname = database;
    vi.stubEnv('DATABASE_URL', url.href);
    ({ env } = await import('../env'));
    const client = await import('../db/client');
    sql = client.sql;
    await migrate(client.db, { migrationsFolder });
    app = (await import('../app')).createApp();
    env.REGISTRATION = 'closed';
    admin = await account('Admin');
  }, 60_000);
  beforeEach(() => {
    env.REGISTRATION = 'open';
  });
  afterAll(async () => {
    await sql?.end();
    if (control) {
      await control`DROP DATABASE IF EXISTS ${control(database)}`;
      await control.end();
    }
    vi.unstubAllEnvs();
  });

  it('guards the directory, invites and backups and forbids self administration', async () => {
    const member = await account('Member');
    for (const path of ['users', 'invites', 'backups']) {
      expect((await request(`admin/${path}`, 'GET', undefined, member.token)).status).toBe(403);
    }
    expect((await act(`users/${admin.id}/role`, 'PATCH', { role: 'user' })).status).toBe(409);
    expect((await act(`users/${admin.id}/reset-password`, 'POST')).status).toBe(409);
    expect((await act(`users/${admin.id}`, 'DELETE')).status).toBe(409);
    const first = await account('Directory %_ First');
    const second = await account('Directory %_ Second');
    await account('Directory XX Decoy');
    for (const [offset, expected] of [first, second].entries()) {
      const response = await act(`users?search=%25_&limit=1&offset=${offset}`);
      const { users, total } = usersResponseSchema.parse(await response.json());
      expect(total).toBe(2);
      expect(users).toMatchObject([{ id: expected.id, lastLoginAt: expect.any(String) }]);
    }
  });

  it('rejects an actor demoted after the guard while their mutation waits for the lock', async () => {
    const actor = await account('Second admin');
    const target = await account('Target');
    expect((await act(`users/${actor.id}/role`, 'PATCH', { role: 'admin' })).status).toBe(200);
    let pending: Promise<Response> | undefined;
    await sql.begin(async (tx) => {
      const [lock] =
        await tx`SELECT pg_backend_pid() AS pid, pg_advisory_xact_lock(hashtext('throw-admin-roles'))`;
      await tx`UPDATE "user" SET role='user' WHERE id=${actor.id}`;
      pending = Promise.resolve(
        request(`admin/users/${target.id}/role`, 'PATCH', { role: 'admin' }, actor.token),
      );
      await waitForBlockedRequest(lock!.pid);
    });
    expect((await pending!).status).toBe(403);
    expect(await sql`SELECT role FROM "user" WHERE id=${target.id}`).toMatchObject([
      { role: 'user' },
    ]);
  });

  it('keeps a reset effective when sign-in is already verifying the credential', async () => {
    const target = await account('Concurrent reset');
    const [row] = await sql`SELECT email FROM "user" WHERE id=${target.id}`;
    const { auth } = await import('../auth');
    const { password } = await auth.$context;
    const verify = password.verify;
    const verifier = vi.spyOn(password, 'verify').mockImplementationOnce(async (input) => {
      const valid = await verify(input);
      expect(valid).toBe(true);
      expect((await act(`users/${target.id}/reset-password`, 'POST')).status).toBe(200);
      return valid;
    });
    try {
      const login = await request('auth/sign-in/email', 'POST', {
        email: row!.email,
        password: 'password123',
      });
      expect(login.status).toBe(401);
      expect(login.headers.has('set-auth-token')).toBe(false);
      expect(await sql`SELECT id FROM session WHERE user_id=${target.id}`).toHaveLength(0);
    } finally {
      verifier.mockRestore();
    }
  });

  it('resets credentials, revokes sessions and deletes only last-member workspaces', async () => {
    const target = await account('Reset');
    const [row] = await sql`SELECT email FROM "user" WHERE id=${target.id}`;
    const login = (password: string) =>
      request('auth/sign-in/email', 'POST', { email: row!.email, password });
    const second = await login('password123');
    expect(second.status).toBe(200);
    const reset = await act(`users/${target.id}/reset-password`, 'POST');
    expect(reset.headers.get('cache-control')).toBe('no-store');
    const { temporaryPassword } = resetUserPasswordResponseSchema.parse(await reset.json());
    for (const token of [target.token, second.headers.get('set-auth-token')!]) {
      expect((await request('mcp-tokens', 'GET', undefined, token)).status).toBe(401);
    }
    expect((await login('password123')).status).toBe(401);
    expect((await login(temporaryPassword)).status).toBe(200);
    const [personal] =
      await sql`SELECT workspace_id FROM workspace_members WHERE user_id=${target.id}`;
    const [shared] =
      await sql`SELECT workspace_id FROM workspace_members WHERE user_id=${admin.id}`;
    await sql`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (${shared!.workspace_id},${target.id},'member')`;
    const project = randomUUID();
    const status = randomUUID();
    const task = randomUUID();
    await sql`INSERT INTO projects(id,workspace_id,name,color,position,key) VALUES
      (${project},${personal!.workspace_id},'Personal','teal','a0','PER')`;
    await sql`INSERT INTO statuses(id,workspace_id,project_id,name,category,position,is_default)
      VALUES (${status},${personal!.workspace_id},${project},'Done','done','a0',true)`;
    await sql`INSERT INTO tasks(id,workspace_id,project_id,status_id,number,title,position,priority)
      VALUES (${task},${personal!.workspace_id},${project},${status},1,'Private task','a0',1)`;
    const history = randomUUID();
    await sql`INSERT INTO structure_activity (id,workspace_id,entity_type,entity_id,kind,changes,user_id)
      VALUES (${history},${shared!.workspace_id},'project',gen_random_uuid(),'created','[]',${target.id})`;
    expect((await act(`users/${target.id}`, 'DELETE')).status).toBe(200);
    expect(await sql`SELECT id FROM workspaces WHERE id=${personal!.workspace_id}`).toHaveLength(0);
    expect(await sql`SELECT id FROM tasks WHERE id=${task}`).toHaveLength(0);
    expect(await sql`SELECT user_id FROM structure_activity WHERE id=${history}`).toMatchObject([
      { user_id: null },
    ]);
    expect((await login(temporaryPassword)).status).toBe(401);
  });

  it('enforces registration modes, expiry, revocation and a single successful claim', async () => {
    const { invite, token } = await issue();
    env.REGISTRATION = 'closed';
    expect((await signup('Closed', token)).status).toBe(403);
    env.REGISTRATION = 'invite';
    expect((await signup('Missing')).status).toBe(403);
    const attempts = await Promise.all([signup('Guest', token), signup('Other', token)]);
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 403]);
    const winner = signupResponse.parse(await attempts.find((r) => r.ok)!.json()).user;
    const list = await act('invites');
    const text = await list.text();
    expect(text).not.toContain(token);
    expect(invitesResponseSchema.parse(JSON.parse(text)).invites).toContainEqual(
      expect.objectContaining({
        id: invite.id,
        usedAt: expect.any(String),
        usedBy: expect.objectContaining({ email: expect.any(String) }),
      }),
    );
    await act(`invites/${invite.id}`, 'DELETE');
    expect(await sql`SELECT id FROM "user" WHERE id=${winner.id}`).toHaveLength(1);
    env.REGISTRATION = 'open';
    const revoked = await issue();
    await act(`invites/${revoked.invite.id}`, 'DELETE');
    expect((await signup('Revoked', revoked.token)).status).toBe(403);
    const expired = await issue();
    await sql`UPDATE invites SET expires_at=now() WHERE id=${expired.invite.id}`;
    expect((await signup('Expired', expired.token)).status).toBe(403);
  });

  it('rolls back the invite and account when credential creation fails', async () => {
    const { token, invite } = await issue();
    await sql`ALTER TABLE account ADD CONSTRAINT reject_new_credentials CHECK (false) NOT VALID`;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await signup('Retry', token)).ok).toBe(false);
    } finally {
      log.mockRestore();
      await sql`ALTER TABLE account DROP CONSTRAINT reject_new_credentials`;
    }
    expect(await sql`SELECT used_at,used_by FROM invites WHERE id=${invite.id}`).toMatchObject([
      { used_at: null, used_by: null },
    ]);
    expect(await sql`SELECT id FROM "user" WHERE name='Retry'`).toHaveLength(0);
    expect((await signup('Retry', token)).status).toBe(200);
  });

  it('counts unexpired invites after acquiring the admin lock', async () => {
    await sql`DELETE FROM invites`;
    await sql`INSERT INTO invites(token_hash,created_by,expires_at)
      SELECT gen_random_uuid()::text, ${admin.id}, now()+interval '1 day' FROM generate_series(1,100)`;
    let pending: Promise<Response> | undefined;
    await sql.begin(async (tx) => {
      const [lock] =
        await tx`SELECT pg_backend_pid() AS pid, pg_advisory_xact_lock(hashtext('throw-admin-roles'))`;
      pending = Promise.resolve(act('invites', 'POST', {}));
      await waitForBlockedRequest(lock!.pid);
      await tx`UPDATE invites SET expires_at=statement_timestamp()`;
    });
    expect((await pending!).status).toBe(201);
  });

  it('enforces the usable limit across concurrent creators', async () => {
    await sql`DELETE FROM invites`;
    await sql`INSERT INTO invites(token_hash,created_by,expires_at)
      SELECT gen_random_uuid()::text, ${admin.id}, now()+interval '1 day' FROM generate_series(1,99)`;
    const results = await Promise.all([act('invites', 'POST', {}), act('invites', 'POST', {})]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});
