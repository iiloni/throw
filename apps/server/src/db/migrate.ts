import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { backUpBeforeUpdate } from '../backups/beforeUpdate';
import { backupConfig } from '../backups/config';
import { env } from '../env';
import { db, sql } from './client';
import { migrationsFolder } from './migrations';

if (env.UPDATE_BACKUPS) await backUpBeforeUpdate(backupConfig, env.UPDATE_BACKUPS_KEPT);
await migrate(db, { migrationsFolder });
await sql.end();
console.log('Migrations applied');
