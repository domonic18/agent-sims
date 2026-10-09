import {
  MEMORY_TYPES,
  type MemoryPanelItem,
  type MemoryPanelResponse,
  type MemoryImpressionItem,
  type MemoryImpressionsResponse,
  type MemoryType,
} from '@sims/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { retrieveMemories } from '../agents/memory-retrieval.js';
import type { DbHandle } from '../db/client.js';
import { characterImpressions, characters, memories } from '../db/schema/index.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from '../world/simulation.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().min(1).max(200).optional(),
  type: z.enum(MEMORY_TYPES).optional(), // 层过滤(10-cognition §3: 全员人可见,面板可分层看)
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface PanelRow {
  id: string;
  type: string;
  content: string;
  importance: number;
  gameMinutes: number | null;
  createdAt: Date;
  sourceIds: string[] | null;
}

function toPanelItem(row: PanelRow): MemoryPanelItem {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    importance: row.importance,
    gameMinutes: row.gameMinutes,
    createdAt: row.createdAt.toISOString(),
    ...(row.sourceIds !== null && row.sourceIds.length > 0 ? { sourceIds: row.sourceIds } : {}),
  };
}

/** insight 溯源解析(C1): 批量取 source_ids 原文回填 sources;无命中不回填 */
async function attachSources(handle: DbHandle, items: MemoryPanelItem[]): Promise<void> {
  const ids = [...new Set(items.flatMap((item) => item.sourceIds ?? []))];
  if (ids.length === 0) return;
  const rows = await handle.db
    .select({ id: memories.id, content: memories.content })
    .from(memories)
    .where(inArray(memories.id, ids));
  const contentById = new Map(rows.map((row) => [row.id, row.content]));
  for (const item of items) {
    if (item.sourceIds === undefined) continue;
    const sources = item.sourceIds
      .map((id) => contentById.get(id))
      .filter((content): content is string => content !== undefined);
    if (sources.length > 0) item.sources = sources;
  }
}

/** 角色不在活跃世界时(旧世界/离线)检索的 recency 基准:该角色记忆的最新游戏时刻 */
async function fallbackGameMinutes(handle: DbHandle, characterId: string): Promise<number> {
  const [row] = await handle.db
    .select({ max: sql<number | null>`max(${memories.gameMinutes})` })
    .from(memories)
    .where(eq(memories.characterId, characterId));
  return row?.max ?? 0;
}

type PanelRoute = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** 记忆面板查询处理器(q 缺省=时间倒序浏览;q 存在=三因子检索,embed 失败降级双因子+notice;
 * type=层过滤;洞察带溯源)。admin 路由与公开只读路由(/api/world,游客可看)共用同一实现,
 * 鉴权差异由各路由层自行把关 */
export function memoriesPanelHandler(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): PanelRoute {
  return async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { limit, q, type } = parsed.data;
    const [character] = await handle.db
      .select({ name: characters.name })
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1);
    if (!character) {
      return await reply.code(404).send({ error: '角色不存在' });
    }
    if (q === undefined) {
      const rows = await handle.db
        .select({
          id: memories.id,
          type: memories.type,
          content: memories.content,
          importance: memories.importance,
          gameMinutes: memories.gameMinutes,
          createdAt: memories.createdAt,
          sourceIds: memories.sourceIds,
        })
        .from(memories)
        .where(
          type === undefined
            ? eq(memories.characterId, id)
            : and(eq(memories.characterId, id), eq(memories.type, type)),
        )
        .orderBy(desc(memories.createdAt))
        .limit(limit);
      const items = rows.map(toPanelItem);
      await attachSources(handle, items);
      const body: MemoryPanelResponse = {
        characterId: id,
        name: character.name,
        mode: 'recent',
        notice: null,
        items,
      };
      return await reply.send(body);
    }
    let notice: string | null = null;
    let queryVector: number[] | undefined;
    try {
      const emb = await app.llm.embed('embedding', [q], {
        taskType: 'memory.search',
        characterId: id,
      });
      queryVector = emb.vector;
    } catch (err) {
      notice = '向量化不可用,已回退时间+重要度双因子排序';
      logTech('warn', 'memory', '检索向量化失败,降级双因子', {
        characterId: id,
        err: errMsg(err),
      });
    }
    const currentGameMinutes = sim.characters.has(id)
      ? sim.clock.gameMinutes
      : await fallbackGameMinutes(handle, id);
    const scored = await retrieveMemories(handle, {
      characterId: id,
      currentGameMinutes,
      queryVector,
    });
    const items = scored
      .filter((m) => type === undefined || m.type === type)
      .slice(0, limit)
      .map((m) => ({
        ...toPanelItem(m),
        score: m.score,
        factors: m.factors,
      }));
    await attachSources(handle, items);
    const body: MemoryPanelResponse = {
      characterId: id,
      name: character.name,
      mode: 'search',
      notice,
      items,
    };
    return await reply.send(body);
  };
}

/** 关系印象处理器(10-cognition §4.2;admin 与公开只读路由共用) */
export function impressionsHandler(handle: DbHandle): PanelRoute {
  return async (request, reply) => {
    const { id } = request.params as { id: string };
    const [character] = await handle.db
      .select({ name: characters.name })
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1);
    if (!character) {
      return await reply.code(404).send({ error: '角色不存在' });
    }
    const rows = await handle.db
      .select({
        aboutId: characterImpressions.aboutId,
        aboutName: characters.name,
        content: characterImpressions.content,
        gameMinutes: characterImpressions.gameMinutes,
        updatedAt: characterImpressions.updatedAt,
      })
      .from(characterImpressions)
      .innerJoin(characters, eq(characters.id, characterImpressions.aboutId))
      .where(eq(characterImpressions.characterId, id))
      .orderBy(desc(characterImpressions.updatedAt));
    const items: MemoryImpressionItem[] = rows.map((row) => ({
      aboutId: row.aboutId,
      aboutName: row.aboutName,
      content: row.content,
      gameMinutes: row.gameMinutes,
      updatedAt: row.updatedAt.toISOString(),
    }));
    const body: MemoryImpressionsResponse = { characterId: id, name: character.name, items };
    return await reply.send(body);
  };
}

/** M4b/A3 记忆面板 admin API(公开只读镜像见 api/character-memory.ts) */
export function registerMemoryRoutes(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): void {
  app.get('/api/admin/characters/:id/memories', async (request, reply) => {
    await memoriesPanelHandler(app, handle, sim)(request, reply);
  });

  app.get('/api/admin/characters/:id/impressions', async (request, reply) => {
    await impressionsHandler(handle)(request, reply);
  });
}
