import type { FastifyInstance } from 'fastify';
import { getActivityDefinition } from '@sims/shared';
import { innerState } from '../agents/cognition.js';
import { WANT_STATUS_LABEL } from '../agents/slow-layer.js';
import type { Simulation } from '../world/simulation.js';

/** D3 意图面板:读当日 wants 脑状态(纯只读),replan 清意图由泵 2s 内自动重生成 */
export function registerScheduleRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/api/admin/characters/:id/schedule', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    const intents = innerState.get(id)?.intents;
    if (intents === undefined || intents === null) {
      return await reply.send({ characterId: id, day: null, source: null, wants: [] });
    }
    return await reply.send({
      characterId: id,
      day: intents.day,
      source: intents.source,
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
