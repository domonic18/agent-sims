import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { SYS_CONFIG_FIELDS, type SysConfigView } from '@sims/shared';
import { BALANCE, BALANCE_DEFAULTS } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { worlds } from '../db/schema/index.js';
import { requireAdmin } from './auth.js';

function effectiveView(): Record<string, number> {
  const balance = BALANCE as unknown as Record<string, number>;
  return Object.fromEntries(SYS_CONFIG_FIELDS.map((field) => [field.key, balance[field.key]!]));
}

/** 当前活跃世界的参数覆盖(config.rules.params);无活跃世界或未设置时为空 */
async function readActiveWorldParams(handle: DbHandle): Promise<Record<string, number>> {
  const [row] = await handle.db
    .select()
    .from(worlds)
    .where(eq(worlds.status, 'active'))
    .limit(1);
  const config = row?.config as { rules?: { params?: Record<string, number> } } | undefined;
  return config?.rules?.params ?? {};
}

/**
 * 世界参数目录查询(只读):参数已世界化——创建时随世界 config 存档,运行中经
 * /api/world/settings 设置通道修改;本端点供创建向导取 defaults 与后台查看生效值。
 */
export function registerSysConfigRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/sys-config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const view: SysConfigView = {
      fields: SYS_CONFIG_FIELDS,
      defaults: BALANCE_DEFAULTS,
      overrides: await readActiveWorldParams(handle),
      effective: effectiveView(),
    };
    return await reply.send(view);
  });
}
