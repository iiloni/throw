#!/usr/bin/env node
// Explicitly disposable: never reads an operator's .env or reuses a Compose project.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = `throw_smoke_${randomBytes(6).toString('hex')}`;
const image = `throw:smoke-${project}`;
const work = mkdtempSync(join(tmpdir(), 'throw-production-'));
const secret = () => randomBytes(32).toString('hex');
const envFile = join(work, '.env');
const override = join(work, 'override.yaml');
writeFileSync(
  envFile,
  `${Object.entries({
    COMPOSE_PROFILES: 'throw',
    THROW_IMAGE: image,
    POSTGRES_PASSWORD: secret(),
    CATCH_DATABASE_PASSWORD: secret(),
    THROW_DATABASE_PASSWORD: secret(),
    CATCH_AUTH_SECRET: secret(),
    THROW_AUTH_SECRET: secret(),
    CATCH_ELECTRIC_SECRET: secret(),
    THROW_ELECTRIC_SECRET: secret(),
    CATCH_URL: 'http://localhost:3000',
    THROW_URL: 'http://localhost:3000',
  })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
  { mode: 0o600 },
);
writeFileSync(
  override,
  `services:\n  throw:\n    ports: !override\n      - '127.0.0.1::3000'\n    environment:\n      AUTH_RATE_LIMIT: false\n`,
);
const compose = [
  'compose',
  '--project-name',
  project,
  '--env-file',
  envFile,
  '--project-directory',
  join(root, 'deploy/combined'),
  '-f',
  join(root, 'deploy/combined/compose.yaml'),
  '-f',
  override,
];
function run(args, { capture = false, input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  });
  if (!allowFailure && result.status !== 0) {
    if (capture) process.stderr.write(result.stderr ?? '');
    throw new Error(`Docker ${args[0]} failed (${result.status})`);
  }
  return result.stdout?.trim() ?? '';
}
const dc = (args, options) => run([...compose, ...args], options);
const sql = (query, database = 'throw', role = 'throw') =>
  dc(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      role,
      '-d',
      database,
      '-At',
    ],
    { capture: true, input: query },
  );
try {
  run([
    'build',
    '--target',
    'production',
    '--build-arg',
    'THROW_CHANNEL=preview',
    '--build-arg',
    'THROW_VERSION=0.0.1-preview',
    '-t',
    image,
    '.',
  ]);
  dc(['up', '-d', '--wait', '--wait-timeout', '180']);
  const address = dc(['port', 'throw', '3000'], { capture: true });
  let base = `http://${address}`;
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const web = await fetch(base);
  assert.match(await web.text(), /Throw/);
  const metadata = await fetch(`${base}/build.json`);
  assert.equal(metadata.headers.get('cache-control'), 'no-store');
  assert.match((await metadata.json()).id, /^[\da-f-]{36}$/);
  dc([
    'exec',
    '-T',
    'throw',
    'node',
    '--input-type=module',
    '-e',
    `import { readFileSync, readdirSync } from 'node:fs';
     const id = JSON.parse(readFileSync('/app/web/build.json', 'utf8')).id;
     if (!readdirSync('/app/web/assets').filter(f => f.endsWith('.js')).some(f => readFileSync('/app/web/assets/' + f, 'utf8').includes(id))) throw new Error('Client and build.json IDs differ');`,
  ]);
  const worker = await fetch(`${base}/sw.js`);
  assert.equal(worker.headers.get('cache-control'), 'no-store');
  assert.match(await worker.text(), /SKIP_WAITING/);
  const signup = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email: 'smoke@example.com', name: 'Smoke', password: secret() }),
  });
  if (!signup.ok) throw new Error(`Sign-up failed (${signup.status}): ${await signup.text()}`);
  const token = signup.headers.get('set-auth-token');
  assert.ok(token);
  const updates = await fetch(`${base}/api/updates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.deepEqual(await updates.json(), { version: '0.0.1-preview', channel: 'preview' });
  const id = randomUUID();
  sql(`INSERT INTO workspaces (id, name, position) VALUES ('${id}', 'before backup', 'a1');`);
  sql(
    "CREATE TABLE smoke_sibling (value text); INSERT INTO smoke_sibling VALUES ('Catch stays intact');",
    'catch',
    'catch',
  );
  assert.equal(sql('SELECT count(*) FROM session;'), '1');
  const made = dc(['exec', '-T', 'throw', 'node', 'dist/backups/cli.mjs', 'create'], {
    capture: true,
  });
  const name = made.split(/\s/)[0];
  assert.match(name, /^throw-backup-.*-manual.zip$/);
  dc(['exec', '-T', 'throw', 'node', 'dist/backups/cli.mjs', 'inspect', name]);
  sql(`UPDATE workspaces SET name = 'after backup' WHERE id = '${id}';`);
  // Restore into the same live tables; observe their identity as Electric does.
  const oid = sql("SELECT 'public.workspaces'::regclass::oid;");
  dc(['stop', 'throw']);
  dc(['run', '--rm', '-T', 'throw', 'node', 'dist/backups/cli.mjs', 'restore', name, '--yes']);
  assert.equal(sql(`SELECT name FROM workspaces WHERE id = '${id}';`), 'before backup');
  assert.equal(sql('SELECT count(*) FROM session;'), '0');
  assert.equal(sql("SELECT 'public.workspaces'::regclass::oid;"), oid);
  assert.equal(sql('SELECT value FROM smoke_sibling;', 'catch', 'catch'), 'Catch stays intact');
  assert.equal(
    sql(
      "SELECT count(*) FROM pg_database WHERE datname LIKE 'throw_restore_%';",
      'postgres',
      'postgres',
    ),
    '0',
  );
  dc(['up', '-d', '--no-deps', '--wait', 'throw']);
  base = `http://${dc(['port', 'throw', '3000'], { capture: true })}`;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  // Force a release change: startup must back up before migrating/serving the app.
  dc([
    'exec',
    '-T',
    'throw',
    'sh',
    '-c',
    'printf "0.0.0-preview\\n" > /data/backups/.last-version',
  ]);
  dc(['restart', 'throw']);
  base = `http://${dc(['port', 'throw', '3000'], { capture: true })}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await fetch(`${base}/api/health`).catch(() => null))?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const listed = dc(['exec', '-T', 'throw', 'node', 'dist/backups/cli.mjs', 'list'], {
    capture: true,
  });
  assert.match(listed, /-update.zip/);
  dc([
    'exec',
    '-T',
    'throw',
    'sh',
    '-c',
    `printf '%s' '${JSON.stringify({ schedule: { enabled: true, time: '00:00', timeZone: 'UTC', keep: 2 }, lastRunDate: null })}' > /data/backups/schedule.json`,
  ]);
  dc(['restart', 'throw']);
  base = `http://${dc(['port', 'throw', '3000'], { capture: true })}`;
  let scheduled = '';
  for (let attempt = 0; attempt < 60; attempt++) {
    scheduled = dc(['exec', '-T', 'throw', 'node', 'dist/backups/cli.mjs', 'list'], {
      capture: true,
      allowFailure: true,
    });
    if (scheduled.includes('-scheduled.zip')) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.match(scheduled, /-scheduled.zip/);
  console.log(
    'PASS: production boot/migrations/web metadata, non-superuser backup/restore, session exclusion, table identity, sibling database preservation, scratch cleanup, pre-update and scheduled backups.',
  );
} catch (error) {
  dc(['logs', '--tail', '80', 'throw'], { allowFailure: true });
  throw error;
} finally {
  dc(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
  run(['image', 'rm', image], { allowFailure: true });
  rmSync(work, { recursive: true, force: true });
}
