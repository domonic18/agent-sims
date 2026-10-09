import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import type { Simulation } from '../world/simulation.js';
import { impressionsHandler, memoriesPanelHandler } from '../admin-api/memories.js';

/** 记忆面板公开只读镜像(游客/观众可看):与 admin 路由共用同一 handler,
 * 免鉴权——直播/观察场景观众经游戏页「记忆」弹窗了解角色内心(仅查看,无写操作) */
export function registerCharacterMemoryRoutes(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): void {
  app.get('/api/world/characters/:id/memories', memoriesPanelHandler(app, handle, sim));
  app.get('/api/world/characters/:id/impressions', impressionsHandler(handle));
}
