import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { env } from '../config/env.js';
import { createDb } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

const { db, client } = createDb(env.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder });
  console.log('[db] 迁移完成');
} finally {
  await client.end();
}
