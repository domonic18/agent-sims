import { bigint, boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** 世界状态单行表(id 恒为 1),世界模拟的持久化锚点 */
export const worldState = pgTable('world_state', {
  id: integer('id').primaryKey(),
  tick: bigint('tick', { mode: 'number' }).notNull().default(0),
  paused: boolean('paused').notNull().default(false),
  timeScale: integer('time_scale').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 世界记录(M3.6k):每次"创建世界"一行;单活跃世界+归档——同时至多一个
 * active,创建新世界时旧的转 closed。config 存创建配置快照(人物清单含预留字段)。
 */
export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'), // active | closed
  config: jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

/**
 * 世界存档多档(C6):管理员手动保存的模拟现场快照,payload 为
 * SimulationArchive 全量 JSON(tick/时钟/角色/社交/维护/资源/货架/控制面)。
 * 归属保存时活跃世界;load 校验 worldId 与当前活跃世界一致。
 */
export const worldArchives = pgTable('world_archives', {
  id: uuid('id').primaryKey().defaultRandom(),
  worldId: uuid('world_id')
    .notNull()
    .references(() => worlds.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
