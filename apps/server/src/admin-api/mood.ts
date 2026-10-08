import { type CharacterMoodResponse } from '@sims/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { readMood, readMoodHistory } from '../agents/mood.js';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/index.js';
import type { Simulation } from '../world/simulation.js';
import { requireAdmin } from './auth.js';

/** C2 情绪面板 API(10-cognition §4.4): 当前态(冲量流水半衰期衰减聚合)+历史(新→旧) */
export function registerMoodRoutes(app: FastifyInstance, handle: DbHandle, sim: Simulation): void {
  app.get('/api/admin/characters/:id/mood', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const [character] = await handle.db
      .select({ name: characters.name })
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1);
    if (!character) {
      return await reply.code(404).send({ error: '角色不存在' });
    }
    const [current, history] = await Promise.all([
      readMood(handle, id, sim.characters.has(id) ? sim.clock.gameMinutes : null),
      readMoodHistory(handle, id),
    ]);
    const body: CharacterMoodResponse = {
      characterId: id,
      name: character.name,
      current,
      history: history.map((row) => ({
        gameMinutes: row.gameMinutes,
        delta: row.delta,
        labels: row.labels,
        createdAt: row.createdAt.toISOString(),
      })),
    };
    return await reply.send(body);
  });
}
