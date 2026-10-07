import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SYS_CONFIG_FIELDS, type SysConfigView } from '@sims/shared';
import { BALANCE, BALANCE_DEFAULTS } from '../config/balance.js';
import { applySettingParams } from '../api/world-settings.js';
import type { DbHandle } from '../db/client.js';
import { worlds } from '../db/schema/index.js';
import type { Simulation } from '../world/simulation.js';
import { whenParamPersistIdle } from '../world/param-persist.js';
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

const updateBodySchema = z.object({
  params: z.record(z.string(), z.number()),
  reset: z.boolean().optional(),
});

/**
 * 世界参数目录读写:参数已世界化——创建时随世界 config 存档,运行中经
 * /api/world/settings(游戏内)或本端点 PUT/reset(后台)修改,两路共用
 * applySettingParams(校验→setParams→param-persist 回写活跃世界行)。
 * GET 供创建向导取 defaults 与后台查看生效值。
 */
export function registerSysConfigRoutes(app: FastifyInstance, handle: DbHandle, sim: Simulation): void {
  async function sysConfigView(): Promise<SysConfigView> {
    return {
      fields: SYS_CONFIG_FIELDS,
      defaults: BALANCE_DEFAULTS,
      overrides: await readActiveWorldParams(handle),
      effective: effectiveView(),
    };
  }

  app.get('/api/admin/sys-config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return await reply.send(await sysConfigView());
  });

  app.put('/api/admin/sys-config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return await reply.code(400).send({
        error: issue ? `${issue.path.join('.')}: ${issue.message}` : '请求体不合法',
      });
    }
    const error = applySettingParams(sim, parsed.data.params, parsed.data.reset === true);
    if (error !== null) {
      return await reply.code(400).send({ error });
    }
    await whenParamPersistIdle(); // overrides 读自活跃世界行,先冲刷持久化链保证响应即存档真相
    return await reply.send(await sysConfigView());
  });

  app.post('/api/admin/sys-config/reset', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    applySettingParams(sim, {}, true);
    await whenParamPersistIdle();
    return await reply.send(await sysConfigView());
  });
}
