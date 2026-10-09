import type { WorldEvent, WorldEventsHistoryResponse } from '@sims/shared';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { worldEvents } from '../db/schema/index.js';
import { GameClock } from '../world/clock.js';
import type { Simulation } from '../world/simulation.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).default(100),
  characterId: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  // 逗号分隔的多类型过滤(日志抽屉按分类回填历史,分类→类型映射由前端裁定)
  types: z.string().trim().min(1).optional(),
});

const LIMIT_CAP = 500;

/** 世界历史事件查询(UI-1 C4,无鉴权只读):日志抽屉打开时回填最近事件段。
 * tick 护栏: world_events 跨世界累积(重置/换世界不清理),钳到当前世界 tick
 * 以下,避免翻出旧世界「未来日」的幽灵条目 */
export function registerWorldEventRoutes(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): void {
  app.get('/api/world/events', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { characterId, type, types } = parsed.data;
    const limit = Math.min(parsed.data.limit, LIMIT_CAP);
    const typeList =
      types === undefined
        ? undefined
        : [...new Set(types.split(',').map((item) => item.trim()).filter(Boolean))];
    const currentTick = sim.clock.gameMinutes - BALANCE.START_MINUTE_OF_DAY;
    const rows = await handle.db
      .select()
      .from(worldEvents)
      .where(
        and(
          characterId ? eq(worldEvents.characterId, characterId) : undefined,
          type ? eq(worldEvents.type, type) : undefined,
          typeList !== undefined && typeList.length > 0 ? inArray(worldEvents.type, typeList) : undefined,
          lte(worldEvents.tick, currentTick),
        ),
      )
      .orderBy(desc(worldEvents.id))
      .limit(limit);
    // 1 tick=1 游戏分钟;开局偏移见 BALANCE.START_MINUTE_OF_DAY(reset 时 tick 归零,纪元一致)
    const body: WorldEventsHistoryResponse = {
      entries: rows.map((row) => {
        const clock = new GameClock(BALANCE.START_MINUTE_OF_DAY + row.tick);
        return {
          id: row.id,
          event: row.payload as WorldEvent,
          day: clock.day,
          time: clock.formatTime(),
        };
      }),
    };
    return await reply.send(body);
  });
}
