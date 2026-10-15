import { access, constants, mkdir, rename, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupKind } from '@throw/shared';
import { DATABASE, extractFile, type Manifest, verifyArchive, writeArchive } from './archive';
import { BackupError } from './errors';
import {
  databaseInfo,
  dumpDatabase,
  hasThrowData,
  latestKnownMigration,
  restoreDatabase,
} from './postgres';
import { type BackupConfig, clearStaleWork, freeBackupName, pruneBackups, workDir } from './store';

// The database of a moment ago is kept before each restore; these are for undoing one.
const SAFETY_BACKUPS_KEPT = 3;
const SPACE_MARGIN = 32 * 1024 * 1024;

type CreateOptions = {
  kind: Exclude<BackupKind, 'upload'>;
};

/**
 * Backs up the server while it runs. pg_dump reads one consistent database snapshot.
 */
export async function createBackup(config: BackupConfig, options: CreateOptions) {
  // Said plainly up front: a bind mount owned by another user is the usual way this fails.
  await mkdir(config.backupsDir, { recursive: true, mode: 0o700 }).catch(() => {});
  await access(config.backupsDir, constants.W_OK).catch(() => {
    throw new BackupError(
      `The server cannot write to its backups directory, ${config.backupsDir}. ` +
        'Make it writable by the user the server runs as (UID 1000 in the Docker image).',
    );
  });
  await clearStaleWork(config.backupsDir);
  const work = await workDir(config.backupsDir);
  try {
    const database = await databaseInfo(config.databaseUrl);
    const needed = SPACE_MARGIN;
    const space = await statfs(config.backupsDir);
    if (space.bavail * space.bsize < needed) {
      throw new BackupError('There is not enough free space for this backup.');
    }

    const dumpFile = join(work, DATABASE);
    await dumpDatabase(config.databaseUrl, dumpFile);
    const createdAt = new Date();
    const archive = join(work, 'archive.zip');
    await writeArchive(archive, {
      kind: options.kind,
      createdAt,
      appVersion: config.appVersion,
      secret: config.secret,
      database,
      dumpFile,
    });
    const name = await freeBackupName(config.backupsDir, options.kind, createdAt);
    await rename(archive, join(config.backupsDir, name));
    return name;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export type RestoreOutcome = {
  manifest: Manifest;
  /** The database as it was just before, or null on a server that had none. */
  safetyBackup: string | null;
};

/**
 * Puts the server back to a verified backup. Nothing may write to the database
 * meanwhile: the server refuses requests during a restore, and the CLI runs with it stopped.
 */
export async function restoreBackup(config: BackupConfig, path: string): Promise<RestoreOutcome> {
  const archive = await verifyArchive(path);
  const { manifest } = archive;
  const known = await latestKnownMigration(config.migrationsFolder);
  if ((manifest.database.latestMigration ?? 0) > known) {
    throw new BackupError(
      'This backup was made by a newer version of Throw. Update Throw, then restore it.',
    );
  }

  let safetyBackup: string | null = null;
  if (await hasThrowData(config.databaseUrl)) {
    // A restore fills the tables that are there. Under a database a newer Throw has
    // migrated, that would leave this version's rows in that version's schema, with its
    // data migrations never applied to them.
    const { latestMigration } = await databaseInfo(config.databaseUrl);
    if ((latestMigration ?? 0) > known) {
      throw new BackupError(
        'This server’s database was migrated by a newer version of Throw than the one ' +
          'running. Restore with that version, or start this one on an empty database first ' +
          '(see “Going back after a bad update” in docs/backups.md).',
      );
    }
    safetyBackup = await createBackup(config, { kind: 'pre-restore' });
    await pruneBackups(config.backupsDir, 'pre-restore', SAFETY_BACKUPS_KEPT);
  }

  const work = await workDir(config.backupsDir);
  try {
    const dumpFile = join(work, DATABASE);
    await extractFile(archive, DATABASE, dumpFile);
    await restoreDatabase(config.databaseUrl, dumpFile, {
      workDir: work,
      migrationsFolder: config.migrationsFolder,
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  return { manifest, safetyBackup };
}
