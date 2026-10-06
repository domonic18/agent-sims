import type { WorldEvent, WorldEventsHistoryResponse } from '@sims/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { worldEvents } from '../db/schema/index.js';
import { GameClock } from '../world/clock.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).default(100),
  characterId: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
});

const LIMIT_CAP = 500;

/** 世界历史事件查询(UI-1 C4,无鉴权只读):日志抽屉打开时回填最近事件段 */
export function registerWorldEventRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/world/events', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { characterId, type } = parsed.data;
    const limit = Math.min(parsed.data.limit, LIMIT_CAP);
    const rows = await handle.db
      .select()
      .from(worldEvents)
      .where(
        and(
          characterId ? eq(worldEvents.characterId, characterId) : undefined,
          type ? eq(worldEvents.type, type) : undefined,
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
