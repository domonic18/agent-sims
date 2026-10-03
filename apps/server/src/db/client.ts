import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  client: postgres.Sql;
}

/** 创建数据库连接(db + 底层 client);调用方负责 client.end() */
export function createDb(databaseUrl: string): DbHandle {
  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema });
  return { db, client };
}
