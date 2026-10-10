import type { FastifyInstance } from 'fastify';
import { getActivityDefinition } from '@sims/shared';
import { innerState } from '../agents/cognition.js';
import { WANT_STATUS_LABEL } from '../agents/slow-layer.js';
import { getItem } from '@sims/shared';
import type { Simulation } from '../world/simulation.js';

/** D3 意图面板:读当日 wants 脑状态(纯只读),replan 清意图由泵 2s 内自动重生成 */
export function registerScheduleRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/api/admin/characters/:id/schedule', async (request, reply) => {
    const { id } = request.params as { id: string };
    const char = sim.characters.get(id);
    if (char === undefined) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    // 运行态快照(观测性):仲裁-执行失配排查的第一事实源
    const snapshot = {
      x: char.x,
      y: char.y,
      coins: char.coins,
      energy: Math.round(char.energy),
      activity:
        char.activity === null
          ? null
          : { activityId: char.activity.activityId, elapsed: char.activity.elapsed },
      backpack: Object.entries(char.backpack)
        .filter(([, count]) => (count ?? 0) > 0)
        .map(([itemId, count]) => ({
          id: itemId,
          name: getItem(itemId)?.name ?? itemId,
          count: count ?? 0,
          price: getItem(itemId)?.price ?? null,
        })),
    };
    const intents = innerState.get(id)?.intents;
    if (intents === undefined || intents === null) {
      return await reply.send({ characterId: id, day: null, source: null, wants: [], snapshot });
    }
    return await reply.send({
      characterId: id,
      day: intents.day,
      source: intents.source,
      snapshot,
      wants: intents.wants.map((w) => ({
        id: w.id,
        activityId: w.activityId,
        label: getActivityDefinition(w.activityId)?.name ?? w.activityId,
        why: w.why,
        urgency: w.urgency,
        status: w.status,
        statusLabel: WANT_STATUS_LABEL[w.status],
        origin: w.origin,
        expiresAtMin: w.expiresAtMin ?? null,
        targetCharacterId: w.targetCharacterId ?? null,
      })),
    });
  });

  app.post('/api/admin/characters/:id/replan', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    innerState.clearIntents(id);
    return await reply.send({ characterId: id, cleared: true });
  });
}
