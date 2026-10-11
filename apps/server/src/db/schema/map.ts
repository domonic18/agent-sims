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
