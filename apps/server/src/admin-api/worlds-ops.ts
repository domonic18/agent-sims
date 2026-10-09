import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import { worlds } from '../db/schema/index.js';
import { toView } from './worlds-create.js';

/** 世界运营域路由(关闭/删除),由 worlds.ts 路由表挂载 */
export function registerWorldOpsRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.post('/api/admin/worlds/:id/close', async (request, reply) => {
    const params = request.params as { id: string };
    const [row] = await handle.db.select().from(worlds).where(eq(worlds.id, params.id)).limit(1);
    if (!row) {
      return await reply.code(404).send({ error: '世界不存在' });
    }
    if (row.status === 'active') {
      await handle.db
        .update(worlds)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(worlds.id, params.id));
      app.simulation.setPaused(true); // 保留现场冻结,便于观察归档前状态
    }
    const [fresh] = await handle.db.select().from(worlds).where(eq(worlds.id, params.id)).limit(1);
    return await reply.send(toView(fresh ?? row));
  });

  app.delete('/api/admin/worlds/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const [row] = await handle.db.select().from(worlds).where(eq(worlds.id, params.id)).limit(1);
    if (!row) {
      return await reply.code(404).send({ error: '世界不存在' });
    }
    await handle.db.delete(worlds).where(eq(worlds.id, params.id)); // characters 级联清理
    if (row.status === 'active') {
      app.simulation.reset(); // 删除活跃世界即清场,等待创建下一个
    }
    return await reply.send({ ok: true });
  });
}
