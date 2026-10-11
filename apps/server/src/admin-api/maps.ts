import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ACTIVITY_IDS,
  validateMapDefinition,
  WORLDGEN_SIZE_GRIDS,
  type MapDetailResponse,
  type MapListResponse,
  type MapStats,
  type MapSummaryItem,
  type TileMapDefinition,
} from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { maps } from '../db/schema/index.js';

const pointSchema = z.object({ x: z.number().int(), y: z.number().int() });
const rectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

/** 家具 kind 为开放联合(string & {});activityId 锚定封闭活动集 */
const furnitureSchema = z.object({
  kind: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  activityId: z.enum(ACTIVITY_IDS).optional(),
  use: pointSchema.optional(),
  sprite: z.string().min(1).optional(),
  facing: z.enum(['north', 'south', 'east', 'west']).optional(),
});

const placeSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(40),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  entrance: pointSchema,
  door: pointSchema.optional(),
  furniture: z.array(furnitureSchema).optional(),
  floorTile: z.string().min(1).optional(),
  wallTile: z.string().min(1).optional(),
});

const decorEntrySchema = z.object({
  slug: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  solid: z.boolean().optional(),
  w: z.number().int().min(1).optional(),
  h: z.number().int().min(1).optional(),
});

const decorSchema = z.object({
  trees: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
  lamps: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
  flowers: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
  bushes: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
  props: z.array(decorEntrySchema).optional(),
  flats: z.array(decorEntrySchema).optional(),
  pond: rectSchema.optional(),
});

/** TileMapDefinition 边界 schema(admin 写入与批C agent 工具共用;语义校验靠 validateMapDefinition) */
export const TileMapDefinitionSchema = z.object({
  width: z.number().int().min(8).max(256),
  height: z.number().int().min(8).max(256),
  blockedRects: z.array(rectSchema),
  paths: z.array(rectSchema.extend({ tile: z.string().min(1).optional() })),
  places: z.array(placeSchema),
  patches: z.array(rectSchema.extend({ tile: z.string().min(1) })).optional(),
  fences: z.array(rectSchema).optional(),
  townCore: rectSchema.optional(),
  resources: z
    .array(
      z.object({
        kind: z.enum(['berry_bush', 'junk_pile', 'tree', 'rock', 'metal_pile', 'apple_tree', 'wheat_patch']),
        x: z.number().int(),
        y: z.number().int(),
      }),
    )
    .optional(),
  decor: decorSchema.optional(),
});

const writeSchema = z.object({
  name: z.string().trim().min(1, '地图名不能为空').max(40),
  description: z.string().trim().max(200).default(''),
  sizePreset: z.string().trim().max(20).optional(),
  definition: TileMapDefinitionSchema,
});

/** 尺寸档推断:命中 worldgen 尺寸档记档名,否则 custom(仅列表展示用) */
function inferSizePreset(definition: TileMapDefinition): string {
  for (const [preset, grid] of Object.entries(WORLDGEN_SIZE_GRIDS)) {
    if (grid.width === definition.width && grid.height === definition.height) return preset;
  }
  return 'custom';
}

function computeStats(definition: TileMapDefinition): MapStats {
  return { width: definition.width, height: definition.height, placeCount: definition.places.length };
}

type MapRow = typeof maps.$inferSelect;

function toSummary(row: MapRow): MapSummaryItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    sizePreset: row.sizePreset,
    stats: row.stats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

function toDetail(row: MapRow): MapDetailResponse {
  return { ...toSummary(row), definition: row.definition };
}

/** 语义校验(zod 只保结构):收集全部问题,非法地图一律 400 */
function definitionIssues(definition: TileMapDefinition): string[] {
  return validateMapDefinition(definition).map((issue) => issue.message);
}

/**
 * 自定义地图库 API(MS-1):列表(不带 definition)/详情/整体写入(草稿、已发布均可改,
 * 改后重校验)/发布(draft→published,语义零问题才放行)/归档(published→archived)/删除
 * (硬删;世界创建即快照进 config,删除不影响存量世界)。
 */
export function registerMapRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/maps', async (request, reply) => {
    const query = z.object({ status: z.enum(['draft', 'published', 'archived']).optional() }).safeParse(request.query);
    if (!query.success) {
      return await reply.code(400).send({ error: 'status 参数不合法' });
    }
    const rows = query.data.status
      ? await handle.db.select().from(maps).where(eq(maps.status, query.data.status)).orderBy(desc(maps.updatedAt))
      : await handle.db.select().from(maps).orderBy(desc(maps.updatedAt));
    const body: MapListResponse = { items: rows.map(toSummary) };
    return await reply.send(body);
  });

  app.get('/api/admin/maps/:id', async (request, reply) => {
    const [row] = await handle.db
      .select()
      .from(maps)
      .where(eq(maps.id, (request.params as { id: string }).id))
      .limit(1);
    if (!row) return await reply.code(404).send({ error: '地图不存在' });
    return await reply.send(toDetail(row));
  });

  app.post('/api/admin/maps', async (request, reply) => {
    const parsed = writeSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
    }
    const issues = definitionIssues(parsed.data.definition);
    if (issues.length > 0) {
      return await reply.code(400).send({ error: `地图定义非法: ${issues.join('; ')}` });
    }
    const definition = parsed.data.definition as TileMapDefinition;
    const [row] = await handle.db
      .insert(maps)
      .values({
        name: parsed.data.name,
        description: parsed.data.description,
        sizePreset: parsed.data.sizePreset ?? inferSizePreset(definition),
        definition,
        stats: computeStats(definition),
      })
      .returning();
    return await reply.code(201).send(toDetail(row!));
  });

  app.put('/api/admin/maps/:id', async (request, reply) => {
    const parsed = writeSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
    }
    const issues = definitionIssues(parsed.data.definition);
    if (issues.length > 0) {
      return await reply.code(400).send({ error: `地图定义非法: ${issues.join('; ')}` });
    }
    const definition = parsed.data.definition as TileMapDefinition;
    const [row] = await handle.db
      .update(maps)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        sizePreset: parsed.data.sizePreset ?? inferSizePreset(definition),
        definition,
        stats: computeStats(definition),
        updatedAt: new Date(),
      })
      .where(eq(maps.id, (request.params as { id: string }).id))
      .returning();
    if (!row) return await reply.code(404).send({ error: '地图不存在' });
    return await reply.send(toDetail(row));
  });

  app.post('/api/admin/maps/:id/publish', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const [row] = await handle.db.select().from(maps).where(eq(maps.id, id)).limit(1);
    if (!row) return await reply.code(404).send({ error: '地图不存在' });
    if (row.status === 'archived') {
      return await reply.code(400).send({ error: '已归档地图不可发布' });
    }
    const issues = definitionIssues(row.definition);
    if (issues.length > 0) {
      return await reply.code(400).send({ error: `体检未通过,不可发布: ${issues.join('; ')}` });
    }
    const now = new Date();
    const [updated] = await handle.db
      .update(maps)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(eq(maps.id, id))
      .returning();
    return await reply.send(toDetail(updated!));
  });

  app.post('/api/admin/maps/:id/archive', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const [row] = await handle.db.select().from(maps).where(eq(maps.id, id)).limit(1);
    if (!row) return await reply.code(404).send({ error: '地图不存在' });
    if (row.status !== 'published') {
      return await reply.code(400).send({ error: '仅已发布地图可归档(草稿直接删除)' });
    }
    const [updated] = await handle.db
      .update(maps)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(maps.id, id))
      .returning();
    return await reply.send(toDetail(updated!));
  });

  app.delete('/api/admin/maps/:id', async (request, reply) => {
    const [row] = await handle.db
      .delete(maps)
      .where(eq(maps.id, (request.params as { id: string }).id))
      .returning({ id: maps.id });
    if (!row) return await reply.code(404).send({ error: '地图不存在' });
    return await reply.send({ ok: true });
  });
}
