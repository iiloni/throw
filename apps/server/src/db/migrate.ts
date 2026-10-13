import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client';
import { migrationsFolder } from './migrations';

await migrate(db, { migrationsFolder });
await sql.end();
console.log('Migrations applied');
