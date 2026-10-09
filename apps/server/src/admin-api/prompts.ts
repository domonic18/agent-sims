import type { FastifyInstance } from 'fastify';
import { listPrompts } from '../prompts/registry.js';
import { requireAdmin } from './auth.js';

/** 外置提示词查看(只读): 启动时 registry 已全量加载,此处直接读内存 */
export function registerPromptRoutes(app: FastifyInstance): void {
  app.get('/api/admin/prompts', async (request, reply) => {
    if (!requireAdmin(request, reply)) return null;
    return await reply.send(listPrompts());
  });
}
