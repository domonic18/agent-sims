import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, count, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ADMIN_API,
  ASSET_STATUSES,
  type AssetAiReviewItem,
  type AssetAiReviewResult,
  type AssetStatus,
} from '@sims/shared';
import { z } from 'zod';
import type { DbHandle } from '../db/client.js';
import { assetCategories, assets } from '../db/schema/index.js';
import { publishManifest } from '../assets/library.js';
import { libraryRoot, publishTarget } from '../assets/paths.js';
import { ModelRouter } from '../llm/router.js';
import { LlmError } from '../llm/types.js';
import { requireAdmin } from './auth.js';

/** 库根与发布目标:dev 下按源码相对定位;容器部署时发布链路随 M-L.3 渲染对接一并处理 */
const LIBRARY_ROOT = libraryRoot();
const PUBLISH_TARGET = publishTarget();

const statusSchema = z.enum(ASSET_STATUSES);

const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(30),
  slug: z
    .string()
    .trim()
    .min(1, 'slug 不能为空')
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/, 'slug 仅小写字母/数字/连字符'),
  parentId: z.number().int().positive().nullable(),
});

const assetPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  gridW: z.number().int().min(1).max(20).optional(),
  gridH: z.number().int().min(1).max(20).optional(),
  anchor: z.string().trim().min(1).max(30).optional(),
  tier: z.number().int().min(1).max(10).optional(),
  tags: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
  status: statusSchema.optional(),
  // 分类迁移(审查视图改 kind):只允许挂到 kind 层(level 2)
  categoryId: z.number().int().positive().optional(),
});

const bulkStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '至少选择一件素材').max(500),
  status: statusSchema,
});

const aiReviewSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '至少选择一件素材').max(10, '单批最多 10 件'),
});

const AI_REVIEW_SYSTEM = [
  '你是像素游戏素材库的审核员。给你一张游戏素材图片和它的登记元数据,判断图片内容与元数据是否相符。',
  '严格只输出一个 JSON 对象,禁止 markdown 围栏,字段如下:',
  '{"match":"yes|no|unsure","see":"图中画的是什么(中文一句话)","kindGuess":"若能判断出家具类型给英文 kind 小写(如 sofa/bed/tv/wardrobe),判断不出则 null","problems":["发现的问题,每条一句中文"],"suggestion":"修正建议(正确的中文或 slug),无则 null"}',
  '重点关注: 图片内容与 slug/名称不符(如 slug 是 sofa 但画的是柜子)、图片裁切错误(残缺/混入相邻素材/错位)、图文明显驴唇不对马嘴。',
].join('\n');

/** 宽松解析视觉模型输出:剥围栏、截取首尾大括号、字段兜底 */
function parseAiReview(content: string): AssetAiReviewResult {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`模型输出非 JSON: ${content.slice(0, 80)}`);
  }
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  return {
    match: raw.match === 'yes' || raw.match === 'no' ? raw.match : 'unsure',
    see: typeof raw.see === 'string' ? raw.see : '',
    kindGuess: typeof raw.kindGuess === 'string' && raw.kindGuess !== '' ? raw.kindGuess : null,
    problems: Array.isArray(raw.problems)
      ? raw.problems.filter((p): p is string => typeof p === 'string')
      : [],
    suggestion:
      typeof raw.suggestion === 'string' && raw.suggestion !== '' ? raw.suggestion : null,
  };
}

interface CategoryRow {
  id: number;
  parentId: number | null;
  level: number;
  slug: string;
  name: string;
  sortOrder: number;
}

/** 收集自身+全部子孙分类 id(树过滤:选 theme 含其下全部 kind) */
function descendantIds(rows: CategoryRow[], rootId: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId !== null) {
      children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
    }
  }
  const out: number[] = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** 沿 parent 链上溯 domain 分类 slug */
function domainOf(rows: Map<number, CategoryRow>, categoryId: number): string {
  let node = rows.get(categoryId);
  while (node !== undefined && node.level > 0 && node.parentId !== null) {
    node = rows.get(node.parentId);
  }
  return node?.slug ?? '';
}

function parseError(reply: FastifyReply, message: string): null {
  void reply.code(400).send({ error: message });
  return null;
}

export function registerAssetRoutes(app: FastifyInstance, handle: DbHandle): void {
  const { db } = handle;
  const modelRouter = new ModelRouter(handle);

  app.get(ADMIN_API.assetCategories, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    const rows = await db.select().from(assetCategories).orderBy(asc(assetCategories.sortOrder), asc(assetCategories.id));
    const counts = await db
      .select({ categoryId: assets.categoryId, n: count() })
      .from(assets)
      .groupBy(assets.categoryId);
    const countByCategory = new Map(counts.map((c) => [c.categoryId, Number(c.n)]));
    return rows.map((row) => ({ ...row, assetCount: countByCategory.get(row.id) ?? 0 }));
  });

  app.post(ADMIN_API.assetCategories, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    const parsed = categoryCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return parseError(reply, parsed.error.issues[0]?.message ?? '请求体不合法');
    }
    const { name, slug, parentId } = parsed.data;
    let level = 0;
    if (parentId !== null) {
      const parent = await db
        .select()
        .from(assetCategories)
        .where(eq(assetCategories.id, parentId))
        .limit(1);
      if (parent.length === 0) return parseError(reply, '父分类不存在');
      if (parent[0]!.level >= 2) return parseError(reply, '分类树最深三层(域→主题→类别)');
      level = parent[0]!.level + 1;
    }
    const exists = await db
      .select({ id: assetCategories.id })
      .from(assetCategories)
      .where(
        parentId === null
          ? and(eq(assetCategories.slug, slug), isNull(assetCategories.parentId))
          : and(eq(assetCategories.slug, slug), eq(assetCategories.parentId, parentId)),
      )
      .limit(1);
    if (exists.length > 0) return parseError(reply, `同层 slug 已存在: ${slug}`);
    const inserted = await db
      .insert(assetCategories)
      .values({ name, slug, parentId, level })
      .returning();
    return reply.send(inserted[0]);
  });

  app.patch(`${ADMIN_API.assetCategories}/:id`, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
      const id = Number((request.params as { id: string }).id);
      const parsed = z
        .object({ name: z.string().trim().min(1).max(30) })
        .safeParse(request.body);
      if (!parsed.success) return parseError(reply, '名称不合法');
      const updated = await db
        .update(assetCategories)
        .set({ name: parsed.data.name })
        .where(eq(assetCategories.id, id))
        .returning();
      if (updated.length === 0) return parseError(reply, '分类不存在');
      return reply.send(updated[0]);
    },
  );

  app.delete(`${ADMIN_API.assetCategories}/:id`, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
      const id = Number((request.params as { id: string }).id);
      const childCount = await db
        .select({ n: count() })
        .from(assetCategories)
        .where(eq(assetCategories.parentId, id));
      if (Number(childCount[0]!.n) > 0) return parseError(reply, '存在子分类,先删除子分类');
      const assetCount = await db
        .select({ n: count() })
        .from(assets)
        .where(eq(assets.categoryId, id));
      if (Number(assetCount[0]!.n) > 0) return parseError(reply, '分类下仍有素材,先移除素材');
      const deleted = await db
        .delete(assetCategories)
        .where(eq(assetCategories.id, id))
        .returning({ id: assetCategories.id });
      if (deleted.length === 0) return parseError(reply, '分类不存在');
      return reply.send({ ok: true });
    },
  );

  app.get(ADMIN_API.assets, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    const query = request.query as {
      categoryId?: string;
      status?: string;
      q?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Math.max(1, Number(query.page ?? '1'));
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? '50')));
    const conditions = [];
    if (query.categoryId !== undefined && query.categoryId !== '') {
      const rows = (await db.select().from(assetCategories)) as CategoryRow[];
      conditions.push(inArray(assets.categoryId, descendantIds(rows, Number(query.categoryId))));
    }
    if (query.status !== undefined && query.status !== '') {
      conditions.push(eq(assets.status, query.status as AssetStatus));
    }
    if (query.q !== undefined && query.q.trim() !== '') {
      const needle = `%${query.q.trim()}%`;
      conditions.push(or(ilike(assets.name, needle), ilike(assets.slug, needle)));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const totalRows = await db.select({ n: count() }).from(assets).where(where);
    const items = await db
      .select()
      .from(assets)
      .where(where)
      .orderBy(asc(assets.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const categoryRows = (await db.select().from(assetCategories)) as CategoryRow[];
    const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
    return {
      total: Number(totalRows[0]!.n),
      items: items.map((asset) => ({
        id: asset.id,
        slug: asset.slug,
        name: asset.name,
        categoryId: asset.categoryId,
        categorySlug: categoryById.get(asset.categoryId)?.slug ?? '',
        domain: domainOf(categoryById, asset.categoryId),
        width: asset.width,
        height: asset.height,
        gridW: asset.gridW,
        gridH: asset.gridH,
        anchor: asset.anchor,
        tier: asset.tier,
        tags: asset.tags,
        status: asset.status,
        source: asset.source,
        anim: asset.animConfig ?? null,
      })),
    };
  });

  app.patch('/api/admin/assets/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    const id = Number((request.params as { id: string }).id);
    const parsed = assetPatchSchema.safeParse(request.body);
    if (!parsed.success) return parseError(reply, parsed.error.issues[0]?.message ?? '请求体不合法');
    if (parsed.data.categoryId !== undefined) {
      // 仅实际迁移分类时要求目标为 kind 层——表单原样回传现有 categoryId(可能挂在中层级)不算迁移
      const existing = await db
        .select({ categoryId: assets.categoryId })
        .from(assets)
        .where(eq(assets.id, id))
        .limit(1);
      if (existing.length === 0) return parseError(reply, '素材不存在');
      if (existing[0]!.categoryId !== parsed.data.categoryId) {
        const cat = await db
          .select({ level: assetCategories.level })
          .from(assetCategories)
          .where(eq(assetCategories.id, parsed.data.categoryId))
          .limit(1);
        if (cat.length === 0 || cat[0]!.level !== 2) {
          return parseError(reply, '目标分类不存在或不是 kind 层');
        }
      }
    }
    const updated = await db
      .update(assets)
      .set(parsed.data)
      .where(eq(assets.id, id))
      .returning({ id: assets.id });
    if (updated.length === 0) return parseError(reply, '素材不存在');
    return reply.send({ ok: true });
  });

  app.post(ADMIN_API.assetAiReview, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    const parsed = aiReviewSchema.safeParse(request.body);
    if (!parsed.success) return parseError(reply, parsed.error.issues[0]?.message ?? '请求体不合法');
    const rows = await db
      .select({
        id: assets.id,
        slug: assets.slug,
        name: assets.name,
        filePath: assets.filePath,
        gridW: assets.gridW,
        gridH: assets.gridH,
        tags: assets.tags,
        source: assets.source,
        categorySlug: assetCategories.slug,
      })
      .from(assets)
      .leftJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .where(inArray(assets.id, parsed.data.ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items: AssetAiReviewItem[] = [];
    for (const id of parsed.data.ids) {
      const asset = byId.get(id);
      if (asset === undefined) {
        items.push({ id, slug: '', ok: false, error: '素材不存在' });
        continue;
      }
      try {
        const buffer = readFileSync(path.join(LIBRARY_ROOT, asset.filePath));
        const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
        const meta = [
          `slug: ${asset.slug}`,
          `名称: ${asset.name}`,
          `分类: ${asset.categorySlug ?? '(未分类)'}`,
          `占地: ${asset.gridW}x${asset.gridH} 格`,
          `标签: ${asset.tags.length > 0 ? asset.tags.join('/') : '无'}`,
          `来源: ${asset.source}`,
        ].join('\n');
        const result = await modelRouter.chat(
          'vision',
          [
            { role: 'system', content: AI_REVIEW_SYSTEM },
            { role: 'user', content: `审核这张素材图片。登记元数据:\n${meta}`, images: [dataUrl] },
          ],
          { taskType: 'asset_ai_review', maxTokens: 800, temperature: 0 },
        );
        items.push({ id, slug: asset.slug, ok: true, result: parseAiReview(result.content) });
      } catch (err) {
        const message =
          err instanceof LlmError
            ? `视觉模型调用失败(${err.slot}): ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        items.push({ id, slug: asset.slug, ok: false, error: message });
      }
    }
    return reply.send({ items });
  });

  app.post(ADMIN_API.assetBulkStatus, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    const parsed = bulkStatusSchema.safeParse(request.body);
    if (!parsed.success) return parseError(reply, parsed.error.issues[0]?.message ?? '请求体不合法');
    const updated = await db
      .update(assets)
      .set({ status: parsed.data.status })
      .where(inArray(assets.id, parsed.data.ids))
      .returning({ id: assets.id });
    return reply.send({ updated: updated.length });
  });

  app.post(ADMIN_API.assetPublish, async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    try {
      const result = await publishManifest(db, LIBRARY_ROOT, PUBLISH_TARGET);
      return reply.send(result);
    } catch (err) {
      return parseError(reply, err instanceof Error ? err.message : '发布失败');
    }
  });

  app.get('/api/admin/assets/:id/image', async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    const id = Number((request.params as { id: string }).id);
    const rows = await db
      .select({ filePath: assets.filePath })
      .from(assets)
      .where(eq(assets.id, id))
      .limit(1);
    if (rows.length === 0) {
      reply.code(404);
      return reply.send({ error: '素材不存在' });
    }
    try {
      const buffer = readFileSync(path.join(LIBRARY_ROOT, rows[0]!.filePath));
      reply.header('cache-control', 'private, max-age=60');
      reply.type('image/png');
      return reply.send(buffer);
    } catch {
      reply.code(404);
      return reply.send({ error: '库文件缺失' });
    }
  });

}
