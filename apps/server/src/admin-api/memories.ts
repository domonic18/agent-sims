import {
  type MemoryPanelItem,
  type MemoryPanelResponse,
  type MemoryType,
} from '@sims/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { retrieveMemories } from '../agents/memory-retrieval.js';
import type { DbHandle } from '../db/client.js';
import { characters, memories } from '../db/schema/index.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from '../world/simulation.js';
import { requireAdmin } from './auth.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().min(1).max(200).optional(),
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
}

function toPanelItem(row: PanelRow): MemoryPanelItem {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    importance: row.importance,
    gameMinutes: row.gameMinutes,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 角色不在活跃世界时(旧世界/离线)检索的 recency 基准:该角色记忆的最新游戏时刻 */
async function fallbackGameMinutes(handle: DbHandle, characterId: string): Promise<number> {
  const [row] = await handle.db
    .select({ max: sql<number | null>`max(${memories.gameMinutes})` })
    .from(memories)
    .where(eq(memories.characterId, characterId));
  return row?.max ?? 0;
}

/** M4b/A3 记忆面板 API:q 缺省按时间倒序浏览;q 存在走三因子检索(embed 失败降级双因子+notice) */
export function registerMemoryRoutes(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): void {
  app.get('/api/admin/characters/:id/memories', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { limit, q } = parsed.data;
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
        })
        .from(memories)
        .where(eq(memories.characterId, id))
        .orderBy(desc(memories.createdAt))
        .limit(limit);
      const body: MemoryPanelResponse = {
        characterId: id,
        name: character.name,
        mode: 'recent',
        notice: null,
        items: rows.map(toPanelItem),
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
      limit,
    });
    const body: MemoryPanelResponse = {
      characterId: id,
      name: character.name,
      mode: 'search',
      notice,
      items: scored.map((m) => ({
        ...toPanelItem(m),
        score: m.score,
        factors: m.factors,
      })),
    };
    return await reply.send(body);
  });
}
