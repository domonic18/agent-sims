import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { AssetAnimConfig, AssetStatus } from '@sims/shared';

/**
 * 素材库(M-L.1,design/05):分类树 domain(0)→theme(1)→kind(2) 三层,
 * slug 全树唯一且不可变(worldgen/manifest 引用稳定性)。
 */
export const assetCategories = pgTable('asset_categories', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').references((): AnyPgColumn => assetCategories.id),
  level: integer('level').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const assets = pgTable(
  'assets',
  {
    id: serial('id').primaryKey(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => assetCategories.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    /** 库根(workspace/asset-library)下的相对路径 */
    filePath: text('file_path').notNull(),
    /** 来源溯源,如 public-migration / limezu-singles-331 / manual-upload */
    source: text('source').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    gridW: integer('grid_w').notNull().default(1),
    gridH: integer('grid_h').notNull().default(1),
    anchor: text('anchor').notNull().default('bottom-center'),
    animConfig: jsonb('anim_config').$type<AssetAnimConfig | null>(),
    tier: integer('tier').notNull().default(1),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').$type<AssetStatus>().notNull().default('draft'),
    checksum: text('checksum').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assets_category_idx').on(table.categoryId),
    index('assets_status_idx').on(table.status),
    index('assets_checksum_idx').on(table.checksum),
  ],
);
