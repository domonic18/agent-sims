/**
 * 素材库 manifest 协议(M-L.1,design/05-asset-library-design.md §4):素材库「发布」
 * 产物的清单协议,worldgen(server)与渲染层(web)双端消费的唯一协议源。
 * 发布器生成后经 safeParse 校验使用;version 为 active 素材集内容摘要——
 * 同内容同版本(种子可复现前提),内容变则版本变。
 */
import { z } from 'zod';

export const ASSET_DOMAINS = ['outdoor', 'indoor', 'character', 'survival'] as const;
export type AssetDomain = (typeof ASSET_DOMAINS)[number];

export const ASSET_STATUSES = ['draft', 'active', 'retired'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** 分类树层级: 0=domain / 1=theme / 2=kind */
export const ASSET_CATEGORY_LEVELS = [0, 1, 2] as const;

/** 动画素材帧配置(角色表类);tile/静态家具为 null */
export const AssetAnimConfigSchema = z.object({
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  columns: z.number().int().positive(),
  /** 动画组名 → 基行偏移(如 walk:0/idle:4/lie:8) */
  groups: z.record(z.string(), z.number().int().nonnegative()),
  /** 动画组名 → 帧数 */
  framesPerGroup: z.record(z.string(), z.number().int().positive()),
  /** 动画组名 → 帧率 */
  fps: z.record(z.string(), z.number().positive()),
});
export type AssetAnimConfig = z.infer<typeof AssetAnimConfigSchema>;

export const AssetCategoryEntrySchema = z.object({
  id: z.number().int().positive(),
  level: z.number().int().min(0).max(2),
  slug: z.string().min(1),
  name: z.string().min(1),
  parentId: z.number().int().positive().nullable(),
});
export type AssetCategoryEntry = z.infer<typeof AssetCategoryEntrySchema>;

export const AssetEntrySchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  name: z.string().min(1),
  domain: z.enum(ASSET_DOMAINS),
  /** 挂载分类 slug(kind 层;tile/props 类挂 theme 层兜底) */
  categorySlug: z.string().min(1),
  /** 所属主题分类 slug(domain 直接子级;worldgen 主题道具池用) */
  themeSlug: z.string().min(1),
  /** 相对 manifest.json 的资源路径(如 library/bed.png) */
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  gridW: z.number().int().positive(),
  gridH: z.number().int().positive(),
  /** 渲染锚点约定: bottom-center / top-left / char-082(角色 origin 0.5,0.82) */
  anchor: z.string().min(1),
  anim: AssetAnimConfigSchema.nullable(),
  tier: z.number().int().positive(),
  tags: z.array(z.string()),
});
export type AssetEntry = z.infer<typeof AssetEntrySchema>;

export const AssetManifestSchema = z.object({
  /** active 素材集内容摘要(8 hex);稳定可复现,worldgen 种子派生输入之一 */
  version: z.string().regex(/^[0-9a-f]{8}$/),
  generatedAt: z.string().min(1),
  categories: z.array(AssetCategoryEntrySchema),
  assets: z.array(AssetEntrySchema),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
