import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { MapStats, MapStatus, TileMapDefinition } from '@sims/shared';

/**
 * 自定义地图库(MS-1):编辑器保存的 TileMapDefinition 声明式定义。
 * 世界创建时全量快照进 worlds.config(非引用),删除地图不影响存量世界。
 */
export const maps = pgTable(
  'maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<MapStatus>().notNull().default('draft'),
    sizePreset: text('size_preset').notNull().default('small'),
    definition: jsonb('definition').$type<TileMapDefinition>().notNull(),
    stats: jsonb('stats').$type<MapStats>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [index('maps_status_idx').on(table.status, table.updatedAt)],
);

/**
 * AI 改图线程索引(MS-1 批C):id 即 langgraph thread_id(checkpointer 存对话),
 * 这里只做列表/归属;文档以编辑器为数据源,不落库。
 */
export const mapAgentThreads = pgTable(
  'map_agent_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id').references(() => maps.id, { onDelete: 'set null' }),
    title: text('title').notNull().default('新对话'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('map_agent_threads_map_idx').on(table.mapId, table.updatedAt)],
);
