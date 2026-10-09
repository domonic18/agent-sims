import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { autonomy, hosting } from '../agents/cognition.js';
import type { DbHandle } from '../db/client.js';
import type { Simulation } from '../world/simulation.js';
import { persistHosting } from './hosting.js';

const bodySchema = z.object({ enabled: z.boolean() });

/** M4c 自治开关:显式开启后该角色才进 AgentScheduler 泵(默认全关,玩家角色不被接管) */
export function registerAutonomyRoutes(app: FastifyInstance, handle: DbHandle, sim: Simulation): void {
  app.get('/api/admin/characters/:id/autonomy', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    return await reply.send({ characterId: id, enabled: autonomy.has(id) });
  });

  app.post('/api/admin/characters/:id/autonomy', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: 'body 须为 { enabled: boolean }' });
    }
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    if (parsed.data.enabled) {
      autonomy.enable(id);
    } else {
      autonomy.disable(id);
    }
    persistHosting(app, handle, id, hosting.get(id) ?? null);
    return await reply.send({ characterId: id, enabled: parsed.data.enabled });
  });
}
