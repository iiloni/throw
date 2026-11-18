import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { backupKindSchema } from '@throw/shared';
import { z } from 'zod';
import { BackupError } from './errors';
import { readZip, type ZipEntry, ZipWriter } from './zip';

/**
 * A backup is a zip of the database dump and a manifest naming every
 * file with its size and SHA-256. The manifest is written last, once the files it describes
 * have been read, and is what makes a zip a Throw backup.
 */
export const MANIFEST = 'manifest.json';
export const DATABASE = 'database.dump';
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

const fileSchema = z.object({
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const databaseInfoSchema = z.object({
  postgres: z.string(),
  migrations: z.number().int().nonnegative(),
  /** When the newest applied migration was generated, to refuse a backup from a newer Throw. */
  latestMigration: z.number().int().nullable(),
  users: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
});
export type DatabaseInfo = z.infer<typeof databaseInfoSchema>;

export const manifestSchema = z.object({
  format: z.literal('throw-backup'),
  formatVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  kind: backupKindSchema.exclude(['upload']),
  appVersion: z.string().nullable(),
  secretFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  database: databaseInfoSchema,
  files: z.record(z.string(), fileSchema),
});
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Identifies the server secret a backup was made under without revealing it. Sessions are
 * signed with the secret, so restoring under another one signs everyone out.
 */
export function secretFingerprint(secret: string) {
  return createHash('sha256').update(`throw-backup:${secret}`).digest('hex');
}

type ArchiveInput = Pick<Manifest, 'kind' | 'appVersion' | 'database'> & {
  createdAt: Date;
  secret: string;
  dumpFile: string;
};

/** Writes a backup to `path`, which must not exist. The caller removes it on failure. */
export async function writeArchive(path: string, input: ArchiveInput): Promise<Manifest> {
  const writer = await ZipWriter.create(path);
  try {
    const files: Manifest['files'] = {};
    const add = async (member: string, source: string, size: number) => {
      const handle = await open(source, 'r');
      try {
        files[member] = await writer.add(member, size, handle.createReadStream());
      } finally {
        await handle.close().catch(() => {});
      }
    };

    await add(DATABASE, input.dumpFile, (await stat(input.dumpFile)).size);
    const manifest: Manifest = {
      format: 'throw-backup',
      formatVersion: 1,
      createdAt: input.createdAt.toISOString(),
      kind: input.kind,
      appVersion: input.appVersion,
      secretFingerprint: secretFingerprint(input.secret),
      database: input.database,
      files,
    };
    const encoded = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writer.add(MANIFEST, encoded.length, [encoded]);
    await writer.finish();
    return manifest;
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

export type Archive = { manifest: Manifest; entries: Map<string, ZipEntry> };

const NOT_A_BACKUP = 'This file is not a Throw backup.';

/** Reads a backup's manifest and checks it against the files in the archive, unread. */
export async function openArchive(path: string): Promise<Archive> {
  const entries = new Map<string, ZipEntry>();
  for (const entry of await readZip(path)) {
    if (entries.has(entry.name)) throw new BackupError('The backup is damaged.');
    entries.set(entry.name, entry);
  }
  const member = entries.get(MANIFEST);
  if (!member || member.size > MAX_MANIFEST_BYTES) throw new BackupError(NOT_A_BACKUP);

  const chunks: Buffer[] = [];
  for await (const chunk of await member.open()) chunks.push(chunk as Buffer);
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BackupError(NOT_A_BACKUP);
  }
  const format = z.object({ format: z.literal('throw-backup'), formatVersion: z.number() });
  const header = format.safeParse(json);
  if (!header.success) throw new BackupError(NOT_A_BACKUP);
  if (header.data.formatVersion !== 1) {
    throw new BackupError('This backup was made by a newer version of Throw.');
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new BackupError('The backup’s manifest is damaged.');
  const manifest = parsed.data;

  if (
    !Object.hasOwn(manifest.files, DATABASE) ||
    entries.size !== Object.keys(manifest.files).length + 1
  ) {
    throw new BackupError('The backup is damaged: its files do not match its manifest.');
  }
  for (const [name, file] of Object.entries(manifest.files)) {
    if (name !== DATABASE || entries.get(name)?.size !== file.size) {
      throw new BackupError('The backup is damaged: its files do not match its manifest.');
    }
  }
  return { manifest, entries };
}

/** Hashes a stream on its way through. */
function hasher() {
  const hash = createHash('sha256');
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { stream, digest: () => hash.digest('hex') };
}

async function checksum(entry: ZipEntry) {
  const hash = createHash('sha256');
  for await (const chunk of await entry.open()) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Reads every file in a backup against its checksum. Catches a truncated or altered archive. */
export async function verifyArchive(path: string): Promise<Archive> {
  const archive = await openArchive(path);
  for (const [name, file] of Object.entries(archive.manifest.files)) {
    if ((await checksum(archive.entries.get(name)!)) !== file.sha256) {
      throw new BackupError(`The backup is damaged: ${name} does not match its checksum.`);
    }
  }
  return archive;
}

/** Copies a file out of a backup, checking it on the way, and only then puts it in place. */
export async function extractFile(
  archive: Archive,
  name: string,
  destination: string,
  mode = 0o600,
) {
  const entry = archive.entries.get(name);
  const expected = archive.manifest.files[name];
  if (!entry || !expected) throw new BackupError(`The backup has no ${name}.`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const { stream, digest } = hasher();
  try {
    await pipeline(await entry.open(), stream, createWriteStream(temporary, { mode }));
    if (digest() !== expected.sha256) {
      throw new BackupError(`The backup is damaged: ${name} does not match its checksum.`);
    }
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
