import type { FastifyInstance } from 'fastify';
import {
  validateRecipes,
  type CraftRecipeId,
  type RecipeDef,
  type WorldRecipesView,
} from '@sims/shared';
import type { Simulation } from '../world/simulation.js';
import { whenParamPersistIdle } from '../world/param-persist.js';

/**
 * 每世界配方读写(2026-10-07 配置化):GET 取运行时全集,PUT 校验后热改并
 * 广播 world.recipes(经事件流转发多端,param-persist 回写活跃世界存档,
 * 响应前冲刷持久化链)。新增/删除配方不在本期(id 封闭联合)。
 */
export function registerWorldRecipeRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/api/admin/world-recipes', async (request, reply) => {
    const view: WorldRecipesView = { recipes: sim.recipes };
    return await reply.send(view);
  });

  app.put('/api/admin/world-recipes', async (request, reply) => {
    const body = (request.body ?? {}) as { recipes?: unknown };
    const errors = validateRecipes(body.recipes);
    if (errors.length > 0) {
      return await reply.code(400).send({ error: errors.join('; ') });
    }
    sim.updateRecipes(body.recipes as Record<CraftRecipeId, RecipeDef>);
    await whenParamPersistIdle(); // 存档真相随响应返回,读改写无窗口
    const view: WorldRecipesView = { recipes: sim.recipes };
    return await reply.send(view);
  });
}
