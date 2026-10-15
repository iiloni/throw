import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATABASE, extractFile, openArchive, verifyArchive, writeArchive } from './archive';
import { ZipWriter } from './zip';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'throw-archive-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));
async function backup() {
  const dumpFile = join(dir, 'dump');
  await writeFile(dumpFile, 'PGDMP pretend dump');
  const path = join(dir, 'backup.zip');
  const manifest = await writeArchive(path, {
    kind: 'manual',
    createdAt: new Date(),
    appVersion: '0.1.0',
    secret: 'test-secret',
    dumpFile,
    database: { postgres: '17', migrations: 1, latestMigration: 1, users: 2, tasks: 14 },
  });
  return { path, manifest };
}
describe('Throw backup archives', () => {
  it('verifies and extracts the complete database dump', async () => {
    const { path, manifest } = await backup();
    expect(manifest.format).toBe('throw-backup');
    expect(Object.keys(manifest.files)).toEqual([DATABASE]);
    const archive = await verifyArchive(path);
    await extractFile(archive, DATABASE, join(dir, 'restored'));
    expect(await readFile(join(dir, 'restored'), 'utf8')).toBe('PGDMP pretend dump');
  });
  it('rejects changed bytes even when the member size still matches', async () => {
    const { path } = await backup();
    const bytes = await readFile(path);
    bytes.write('BROKE', bytes.indexOf('PGDMP'));
    await writeFile(path, bytes);
    await openArchive(path);
    await expect(verifyArchive(path)).rejects.toThrow(/checksum/);
  });
  it('rejects unexpected members and Catch archives', async () => {
    const { manifest } = await backup();
    for (const foreign of [false, true]) {
      const path = join(dir, `${foreign}.zip`);
      const writer = await ZipWriter.create(path);
      const dump = Buffer.from('PGDMP pretend dump');
      await writer.add(DATABASE, dump.length, [dump]);
      const encoded = Buffer.from(
        JSON.stringify({ ...manifest, ...(foreign ? { format: 'catch-backup' } : {}) }),
      );
      await writer.add('manifest.json', encoded.length, [encoded]);
      if (!foreign) await writer.add('../outside', 1, [Buffer.from('x')]);
      await writer.finish();
      await expect(openArchive(path)).rejects.toThrow();
    }
  });
});
