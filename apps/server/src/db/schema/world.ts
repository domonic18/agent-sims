import { bigint, boolean, integer, pgTable, timestamp } from 'drizzle-orm/pg-core';

/** 世界状态单行表(id 恒为 1),世界模拟的持久化锚点 */
export const worldState = pgTable('world_state', {
  id: integer('id').primaryKey(),
  tick: bigint('tick', { mode: 'number' }).notNull().default(0),
  paused: boolean('paused').notNull().default(false),
  timeScale: integer('time_scale').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
