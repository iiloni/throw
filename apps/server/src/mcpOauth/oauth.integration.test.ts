import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_PROTOCOL_HEADER,
  createMcpTokenResponseSchema,
  mcpTools,
  oauthCallbackSchema,
  oauthGrantsSchema,
} from '@throw/shared';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppType } from '../app';
import { dumpDatabase, restoreDatabase } from '../backups/postgres';
import { migrationsFolder } from '../db/migrations';

const tokenPair = z.object({ access_token: z.string(), refresh_token: z.string() });
const origin = 'http://localhost:3000';
const resource = `${origin}/api/mcp`;
const redirect = 'https://connector.example/callback';
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const base = process.env.THROW_TEST_POSTGRES;
describe.skipIf(!base)('MCP OAuth against Postgres', () => {
  const database = `throw_oauth_test_${randomUUID().replaceAll('-', '')}`;
  let control: postgres.Sql;
  let sql: postgres.Sql;
  let app: AppType;
  let session: string;
  let client: string;
  let workspace: string;
  function request(path: string, init: RequestInit = {}) {
    return app.request(origin + path, {
      ...init,
      headers: { Host: 'localhost:3000', [API_PROTOCOL_HEADER]: '1', ...init.headers },
    });
  }
  function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }
  const owner = () => ({ Authorization: `Bearer ${session}` });
  function authorize(overrides: Record<string, string> = {}) {
    return request(
      `/api/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', resource, response_type: 'code', state: 'opaque state', ...overrides })}`,
    );
  }
  async function pending() {
    const response = await authorize();
    expect(response.status).toBe(302);
    const id = new URL(response.headers.get('Location')!).searchParams.get('requestId');
    return {
      path: `/api/mcp-oauth/requests/${id}`,
      headers: { ...owner(), Cookie: response.headers.get('Set-Cookie')!.split(';')[0]! },
    };
  }
  function token(values: Record<string, string>) {
    return request('/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ resource, client_id: client, ...values }),
    });
  }
  async function approved() {
    const { path, headers } = await pending();
    const approved = await post(
      `${path}/approve`,
      { workspaceId: workspace, name: 'Agent' },
      headers,
    );
    expect(approved.status).toBe(200);
    const callback = new URL(oauthCallbackSchema.parse(await approved.json()).callbackUrl);
    expect(callback.searchParams.get('state')).toBe('opaque state');
    return {
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code')!,
      redirect_uri: redirect,
      code_verifier: verifier,
    };
  }
  async function call(access: string, name: string, args: Record<string, unknown>) {
    const r = await post(
      '/api/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      { Authorization: `Bearer ${access}`, Accept: 'application/json, text/event-stream' },
    );
    expect(r.status).toBe(200);
    const body = z
      .object({
        result: z.object({ isError: z.boolean().optional(), structuredContent: z.unknown() }),
      })
      .parse(await r.json());
    expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
    return body.result.structuredContent;
  }
  beforeAll(async () => {
    control = postgres(base!);
    await control`CREATE DATABASE ${control(database)}`;
    const url = new URL(base!);
    url.pathname = database;
    vi.stubEnv('DATABASE_URL', url.href);
    const clientDb = await import('../db/client');
    sql = clientDb.sql;
    await migrate(clientDb.db, { migrationsFolder });
    app = (await import('../app')).createApp();
    const signup = await post(
      '/api/auth/sign-up/email',
      { name: 'Owner', email: 'owner@example.com', password: 'password123' },
      { Origin: origin },
    );
    session = signup.headers.get('set-auth-token')!;
    const [row] = await sql`select id from workspaces`;
    workspace = row!.id;
    const r = await post('/api/oauth/register', {
      client_name: 'Example connector',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
    });
    expect(r.status).toBe(201);
    const metadata = z
      .object({ grant_types: z.array(z.string()), client_id: z.string() })
      .parse(await r.json());
    expect(metadata.grant_types).toEqual(['authorization_code', 'refresh_token']);
    client = metadata.client_id;
  }, 60000);
  afterAll(async () => {
    await sql?.end();
    if (control) {
      await control`DROP DATABASE IF EXISTS ${control(database)}`;
      await control.end();
    }
    vi.unstubAllEnvs();
  });
  it('discovers both metadata documents from the canonical challenge and guards preflight', async () => {
    const response = await request('/api/mcp');
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ]) {
      const r = await request(path);
      expect(await r.json()).toMatchObject({ resource, authorization_servers: [origin] });
      expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    expect(await (await request('/.well-known/oauth-authorization-server')).json()).toMatchObject({
      issuer: origin,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ['S256'],
    });
    for (const path of [
      '/api/oauth/register',
      '/api/oauth/token',
      '/.well-known/oauth-authorization-server',
    ]) {
      expect((await request(path, { method: 'OPTIONS' })).status).toBe(204);
      expect(
        (await request(path, { method: 'OPTIONS', headers: { Host: 'elsewhere.example' } })).status,
      ).toBe(403);
    }
  });
  it('inspects browser-bound consent, refuses invalid requests and denies once', async () => {
    for (const overrides of [
      { code_challenge_method: 'plain' },
      { resource: origin },
      { redirect_uri: 'https://other.example' },
      { client_id: 'https://127.0.0.1/client.json' },
    ] as Record<string, string>[])
      expect((await authorize(overrides)).status).toBe(400);
    const { path, headers } = await pending();
    expect((await request(path, { headers: owner() })).status).toBe(404);
    expect((await request(path, { headers: { Cookie: headers.Cookie } })).status).toBe(401);
    expect(await (await request(path, { headers })).json()).toMatchObject({
      clientName: 'Example connector',
      clientDomain: null,
      redirectHost: 'connector.example',
      workspaces: [{ id: workspace }],
    });
    const denied = await post(`${path}/deny`, {}, headers);
    expect(
      new URL(oauthCallbackSchema.parse(await denied.json()).callbackUrl).searchParams.get('error'),
    ).toBe('access_denied');
    expect(
      (await post(`${path}/approve`, { name: 'Agent', workspaceId: workspace }, headers)).status,
    ).toBe(404);
  });
  it('binds exchanges, preserves replay and attribution across rotation and revokes on reuse', async () => {
    const params = await approved();
    for (const invalid of [
      { code_verifier: 'x'.repeat(43) },
      { resource: origin },
      { client_id: 'other' },
      { redirect_uri: origin },
    ] as Record<string, string>[])
      expect((await token({ ...params, ...invalid })).status).toBe(400);
    const issued = tokenPair.parse(await (await token(params)).json());
    const operation = { name: 'Integration', operationId: uuidv7() };
    const changes = async (access: string, args: Record<string, unknown>) =>
      mcpTools.list_changes.output.parse(await call(access, 'list_changes', args));
    const { cursor } = await changes(issued.access_token, {});
    const first = await call(issued.access_token, 'create_project', operation);
    const refresh = { grant_type: 'refresh_token', refresh_token: issued.refresh_token };
    const rotated = tokenPair.parse(await (await token(refresh)).json());
    expect(rotated.refresh_token).not.toBe(issued.refresh_token);
    expect(await call(rotated.access_token, 'create_project', operation)).toEqual(first);
    expect((await changes(rotated.access_token, { since: cursor })).changes).toEqual([]);
    expect(
      (await changes(rotated.access_token, { since: cursor, includeOwn: true })).changes,
    ).toContainEqual(
      expect.objectContaining({ actor: expect.objectContaining({ viaToken: 'Agent' }) }),
    );
    expect((await token(refresh)).status).toBe(400);
    expect(
      (await request('/api/mcp', { headers: { Authorization: `Bearer ${rotated.access_token}` } }))
        .status,
    ).toBe(401);
    expect((await token({ ...refresh, refresh_token: rotated.refresh_token })).status).toBe(400);
  });
  it('serializes concurrent code redemption and revokes the first exchange on replay', async () => {
    const params = await approved();
    const responses = await Promise.all([token(params), token(params)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const pair = tokenPair.parse(await responses.find((r) => r.status === 200)!.json());
    expect(
      (await request('/api/mcp', { headers: { Authorization: `Bearer ${pair.access_token}` } }))
        .status,
    ).toBe(401);
  });
  it('accepts static tokens and lists and revokes disconnected grants after membership ends', async () => {
    const staticToken = createMcpTokenResponseSchema.parse(
      await (
        await post('/api/mcp-tokens', { name: 'Static', workspaceId: workspace }, owner())
      ).json(),
    );
    expect(
      mcpTools.list_workspaces.output.parse(await call(staticToken.token, 'list_workspaces', {}))
        .items[0]!.id,
    ).toBe(workspace);
    const issued = tokenPair.parse(await (await token(await approved())).json());
    const [member] =
      await sql`DELETE FROM workspace_members WHERE workspace_id=${workspace} RETURNING user_id`;
    expect(
      (await request('/api/mcp', { headers: { Authorization: `Bearer ${issued.access_token}` } }))
        .status,
    ).toBe(401);
    const { grants } = oauthGrantsSchema.parse(
      await (await request('/api/mcp-oauth/grants', { headers: owner() })).json(),
    );
    expect(grants).toHaveLength(1);
    expect(
      (
        await request(`/api/mcp-oauth/grants/${grants[0]!.id}`, {
          method: 'DELETE',
          headers: owner(),
        })
      ).status,
    ).toBe(204);
    expect(await sql`select digest from oauth_tickets`).toHaveLength(0);
    await sql`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (${workspace},${member!.user_id},'owner')`;
  });
  it('omits OAuth secrets from archives and clears live grants when restoring', async () => {
    await token(await approved());
    await pending();
    const dir = await mkdtemp(join(tmpdir(), 'throw-oauth-backup-'));
    const url = new URL(base!);
    url.pathname = database;
    const archive = join(dir, 'database.dump');
    try {
      await dumpDatabase(url.href, archive);
      const catalog = execFileSync('pg_restore', ['--list', archive], { encoding: 'utf8' });
      for (const table of ['mcp_tokens', 'oauth_clients', 'oauth_requests', 'oauth_tickets']) {
        expect(catalog).not.toContain(`TABLE DATA public ${table} `);
        expect(await sql`SELECT 1 FROM ${sql(table)} LIMIT 1`).toHaveLength(1);
      }
      await restoreDatabase(url.href, archive, { workDir: dir, migrationsFolder });
      for (const table of ['mcp_tokens', 'oauth_clients', 'oauth_requests', 'oauth_tickets']) {
        expect(await sql`SELECT 1 FROM ${sql(table)} LIMIT 1`).toHaveLength(0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
