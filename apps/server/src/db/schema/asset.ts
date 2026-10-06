import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { AssetAnimConfig, AssetStatus } from '@sims/shared';

/**
 * 素材库(M-L.1,design/05):分类树 domain(0)→theme(1)→kind(2) 三层,
 * slug 同层唯一(parent 作用域,全量导入后多主题可各自挂同名 kind)且不可变。
 * 注: domain 层 parent 为 NULL,唯一索引对 NULL 不去重,由应用侧 ensureCategory 查重兜底。
 */
export const assetCategories = pgTable(
  'asset_categories',
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').references((): AnyPgColumn => assetCategories.id),
    level: integer('level').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [uniqueIndex('asset_categories_parent_slug_uq').on(table.parentId, table.slug)],
);

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

/**
 * 素材问题单(UI-2 报错闭环):游戏内信息卡/动画演示器上报,后台审查页流转。
 * dedupe_key = scope:refSlug[:context.key],open 态部分唯一索引使重复上报幂等收敛为同一单。
 */
export const assetIssues = pgTable(
  'asset_issues',
  {
    id: serial('id').primaryKey(),
    scope: text('scope').$type<'asset' | 'anim'>().notNull(),
    /** asset=素材 slug;anim=角色表 slug */
    refSlug: text('ref_slug').notNull(),
    /** 幂等键 scope:refSlug[:context.key],open 态内唯一 */
    dedupeKey: text('dedupe_key').notNull(),
    /** scope=asset 且能对上行时回填 assets.id */
    refId: integer('ref_id'),
    context: jsonb('context').$type<Record<string, unknown> | null>(),
    note: text('note'),
    status: text('status').$type<'open' | 'resolved'>().notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('asset_issues_status_idx').on(table.status),
    uniqueIndex('asset_issues_open_dedupe_uq')
      .on(table.dedupeKey)
      .where(sql`status = 'open'`),
  ],
);
