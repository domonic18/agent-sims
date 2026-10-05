import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import type { DbHandle } from '../db/client.js';
import { adminAuditLogs } from '../db/schema/index.js';
import { verifyAdminToken } from '../utils/token.js';

let chain: Promise<void> = Promise.resolve();

/** 等待挂起审计写入完成(测试断言用) */
export function whenAdminAuditIdle(): Promise<void> {
  return chain;
}

/** 操作者提取:登录接口取 body.username,其余从 Bearer token 解出 sub */
function auditUsername(request: FastifyRequest, path: string): string | null {
  if (path === '/api/admin/auth/login') {
    const body = request.body as { username?: unknown } | null;
    return typeof body?.username === 'string' && body.username.length > 0 ? body.username : null;
  }
  const header = request.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const result = verifyAdminToken(token, env.MASTER_KEY);
  return result.valid ? result.username : null;
}

/**
 * 后台操作审计(M-G.1③):非 GET 的 /api/admin 请求一律留痕(含 401/400 失败尝试);
 * 须在注册具体路由前挂载(Fastify hook 只作用于其后注册的路由);串行火后不理。
 */
export function attachAdminAuditLog(app: FastifyInstance, handle: DbHandle): void {
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0]!;
    if (request.method === 'GET' || !path.startsWith('/api/admin')) return;
    const username = auditUsername(request, path);
    chain = chain
      .then(async () => {
        await handle.db.insert(adminAuditLogs).values({
          username,
          method: request.method,
          path,
          statusCode: reply.statusCode,
        });
      })
      .catch((err: unknown) => {
        console.error('[audit-log] 操作审计写入失败', err);
      });
  });
}
