import type { FastifyInstance } from 'fastify';
import { getActivityDefinition } from '@sims/shared';
import { schedule } from '../agents/cognition.js';
import type { Simulation } from '../world/simulation.js';
import { requireAdmin } from './auth.js';

/** M4d 日程面板:读当日计划脑状态(纯只读),replan 清计划由泵 2s 内自动重生成 */
export function registerScheduleRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/api/admin/characters/:id/schedule', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    const plan = schedule.get(id);
    if (plan === undefined) {
      return await reply.send({ characterId: id, day: null, source: null, blocks: [] });
    }
    const minuteOfDay = sim.clock.minuteOfDay;
    return await reply.send({
      characterId: id,
      day: plan.day,
      source: plan.source,
      blocks: plan.blocks.map((b) => ({
        startMin: b.startMin,
        endMin: b.endMin,
        activityId: b.activityId,
        label: getActivityDefinition(b.activityId)?.name ?? b.activityId,
        status:
          minuteOfDay < b.startMin ? 'pending' : minuteOfDay < b.endMin ? 'active' : 'done',
      })),
    });
  });

  app.post('/api/admin/characters/:id/replan', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    schedule.clear(id);
    return await reply.send({ characterId: id, cleared: true });
  });
}
