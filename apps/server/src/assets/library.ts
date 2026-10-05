import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { asc, eq } from 'drizzle-orm';
import type { AssetAnimConfig, AssetDomain, AssetStatus } from '@sims/shared';
import type { Db } from '../db/client.js';
import { assetCategories, assets } from '../db/schema/asset.js';
import { pngSize } from './png.js';

/**
 * PNG 收边(去透明边距,规范库形态:内容底边即图像底边,渲染底对齐契约)。
 * Singles 源文件带边距(如床源 32x48/内容 32x38),入库统一 trim。
 */
export function trimPng(buffer: Buffer): Buffer {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return buffer; // 全透明原样
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = ((minY + y) * width + (minX + x)) * 4;
      const dst = (y * w + x) * 4;
      out.data[dst] = data[src]!;
      out.data[dst + 1] = data[src + 1]!;
      out.data[dst + 2] = data[src + 2]!;
      out.data[dst + 3] = data[src + 3]!;
    }
  }
  return PNG.sync.write(out);
}

/** 导入清单条目:源文件 + 分类归属 + 元数据(清单版本化于 import-plan.ts) */
export interface ImportItem {
  slug: string;
  name: string;
  domain: AssetDomain;
  theme: string;
  /** kind 层 slug;tile/props 类无 kind,挂 theme 层兜底 */
  kind?: string;
  sourcePath: string;
  source: string;
  gridW?: number;
  gridH?: number;
  anchor?: string;
  anim?: AssetAnimConfig | null;
  tags?: string[];
  status?: AssetStatus;
  /** 入库前 trim 透明边距(Singles 源带边距) */
  trim?: boolean;
}

export interface ImportReport {
  created: number;
  skipped: number;
  updated: number;
  errors: string[];
}

interface CategoryRow {
  id: number;
  parentId: number | null;
  level: number;
  slug: string;
  name: string;
}

const DOMAIN_NAMES: Record<AssetDomain, string> = {
  outdoor: '户外',
  indoor: '室内',
  character: '角色',
  survival: '生存',
};
const DOMAIN_ORDER: Record<AssetDomain, number> = {
  outdoor: 0,
  indoor: 1,
  character: 2,
  survival: 3,
};

/** 分类节点复用或创建(slug 唯一;存在即复用,不修改既有名称) */
export async function ensureCategory(
  db: Db,
  spec: { level: number; slug: string; name: string },
  parentId: number | null,
  sortOrder: number,
): Promise<number> {
  const existing = await db
    .select({ id: assetCategories.id })
    .from(assetCategories)
    .where(eq(assetCategories.slug, spec.slug))
    .limit(1);
  if (existing.length > 0) return existing[0]!.id;
  const inserted = await db
    .insert(assetCategories)
    .values({ ...spec, parentId, sortOrder })
    .returning({ id: assetCategories.id });
  return inserted[0]!.id;
}

async function ensureCategoryChain(
  db: Db,
  domain: AssetDomain,
  theme: string,
  kind: string | undefined,
): Promise<number> {
  const domainId = await ensureCategory(
    db,
    { level: 0, slug: domain, name: DOMAIN_NAMES[domain] },
    null,
    DOMAIN_ORDER[domain] ?? 99,
  );
  const themeId = await ensureCategory(db, { level: 1, slug: theme, name: theme }, domainId, 0);
  if (kind === undefined) return themeId;
  return ensureCategory(db, { level: 2, slug: kind, name: kind }, themeId, 0);
}

/**
 * 批量导入(checksum 幂等):同 slug 已存在且 checksum 一致 → 跳过;
 * checksum 变化 → 覆盖库文件与元数据。文件落库根 {domain}/{theme}/{slug}.png。
 */
export async function importAssets(
  db: Db,
  items: ImportItem[],
  libraryRoot: string,
): Promise<ImportReport> {
  const report: ImportReport = { created: 0, skipped: 0, updated: 0, errors: [] };
  for (const item of items) {
    try {
      const raw = await readFile(item.sourcePath);
      const buffer = item.trim === true ? trimPng(raw) : raw;
      const checksum = createHash('sha256').update(buffer).digest('hex');
      const { width, height } = pngSize(buffer);
      const categoryId = await ensureCategoryChain(db, item.domain, item.theme, item.kind);
      const relativePath = path.posix.join(item.domain, item.theme, `${item.slug}.png`);
      const values = {
        categoryId,
        name: item.name,
        slug: item.slug,
        filePath: relativePath,
        source: item.source,
        width,
        height,
        gridW: item.gridW ?? Math.max(1, Math.round(width / 16)),
        gridH: item.gridH ?? Math.max(1, Math.round(height / 16)),
        anchor: item.anchor ?? 'bottom-center',
        animConfig: item.anim ?? null,
        tags: item.tags ?? [],
        status: item.status ?? 'draft',
        checksum,
      };
      const existing = await db
        .select({ id: assets.id, checksum: assets.checksum })
        .from(assets)
        .where(eq(assets.slug, item.slug))
        .limit(1);
      if (existing.length > 0) {
        if (existing[0]!.checksum === checksum) {
          report.skipped += 1;
          continue;
        }
        await db.update(assets).set(values).where(eq(assets.id, existing[0]!.id));
        report.updated += 1;
      } else {
        await db.insert(assets).values(values);
        report.created += 1;
      }
      const target = path.join(libraryRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      if (item.trim === true) {
        await writeFile(target, buffer);
      } else {
        await copyFile(item.sourcePath, target);
      }
    } catch (err) {
      report.errors.push(`${item.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return report;
}

/** 沿 parent 链上溯到 level 0(domain)分类 id */
function traceDomain(categoryById: Map<number, CategoryRow>, categoryId: number): number {
  let current = categoryById.get(categoryId);
  while (current !== undefined && current.level > 0 && current.parentId !== null) {
    current = categoryById.get(current.parentId);
  }
  return current?.id ?? categoryId;
}

export interface PublishResult {
  version: string;
  assetCount: number;
  manifestPath: string;
}

/**
 * 发布 manifest(design/05 §4):读 active 素材 → 拷贝产物 → 写 manifest.json。
 * version = active 集(id:slug:checksum 排序拼接)sha256 前 8 hex——内容稳定则版本稳定,
 * 是 worldgen 种子派生输入之一(design/06)。
 */
export async function publishManifest(
  db: Db,
  libraryRoot: string,
  targetDir: string,
): Promise<PublishResult> {
  const activeAssets = await db
    .select()
    .from(assets)
    .where(eq(assets.status, 'active'))
    .orderBy(asc(assets.id));
  if (activeAssets.length === 0) {
    throw new Error('无 active 素材可发布');
  }
  const categoryRows = await db.select().from(assetCategories).orderBy(asc(assetCategories.id));
  const categoryById = new Map<number, CategoryRow>(categoryRows.map((c) => [c.id, c]));

  const fingerprint = activeAssets.map((a) => `${a.id}:${a.slug}:${a.checksum}`).join('|');
  const version = createHash('sha256').update(fingerprint).digest('hex').slice(0, 8);

  const libraryDir = path.join(targetDir, 'library');
  await mkdir(libraryDir, { recursive: true });
  const entries = [];
  for (const asset of activeAssets) {
    await copyFile(path.join(libraryRoot, asset.filePath), path.join(libraryDir, `${asset.slug}.png`));
    entries.push({
      id: asset.id,
      slug: asset.slug,
      name: asset.name,
      domain: (categoryById.get(traceDomain(categoryById, asset.categoryId))?.slug ??
        'outdoor') as AssetDomain,
      categorySlug: categoryById.get(asset.categoryId)?.slug ?? '',
      url: `library/${asset.slug}.png`,
      width: asset.width,
      height: asset.height,
      gridW: asset.gridW,
      gridH: asset.gridH,
      anchor: asset.anchor,
      anim: asset.animConfig ?? null,
      tier: asset.tier,
      tags: asset.tags,
    });
  }
  const usedCategoryIds = new Set<number>();
  for (const asset of activeAssets) {
    usedCategoryIds.add(asset.categoryId);
    usedCategoryIds.add(traceDomain(categoryById, asset.categoryId));
    let node = categoryById.get(asset.categoryId);
    while (node !== undefined && node.parentId !== null) {
      usedCategoryIds.add(node.parentId);
      node = categoryById.get(node.parentId);
    }
  }
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    categories: categoryRows
      .filter((c) => usedCategoryIds.has(c.id))
      .map((c) => ({ id: c.id, level: c.level, slug: c.slug, name: c.name, parentId: c.parentId })),
    assets: entries,
  };
  const manifestPath = path.join(targetDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { version, assetCount: activeAssets.length, manifestPath };
}
