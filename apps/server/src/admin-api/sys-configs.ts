import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { SYS_CONFIG_FIELDS, type SysConfigView } from '@sims/shared';
import { z } from 'zod';
import { applyBalanceOverrides, BALANCE, BALANCE_DEFAULTS, validateBalanceOverrides } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { sysConfigs } from '../db/schema/index.js';
import { requireAdmin } from './auth.js';

const putSchema = z.object({
  updates: z.record(z.string(), z.unknown()),
});

async function readOverrides(handle: DbHandle): Promise<Record<string, number>> {
  const [row] = await handle.db.select().from(sysConfigs).where(eq(sysConfigs.id, 1)).limit(1);
  return (row?.overrides as Record<string, number> | undefined) ?? {};
}

/** 启动时应用 DB 覆盖(失败回退默认值,由调用方兜底) */
export async function loadSysConfigOverrides(handle: DbHandle): Promise<void> {
  applyBalanceOverrides(await readOverrides(handle));
}

// 启动加载只做一次:后续 buildApp 实例(测试多 app 并发)不得用过期 DB 值覆盖热更新
let overridesLoaded: Promise<void> | null = null;

export function loadSysConfigOverridesOnce(handle: DbHandle): Promise<void> {
  overridesLoaded ??= loadSysConfigOverrides(handle).catch((err: unknown) => {
    overridesLoaded = null; // 失败允许重试(如下次实例再试)
    throw err;
  });
  return overridesLoaded;
}

function effectiveView(): Record<string, number> {
  const balance = BALANCE as unknown as Record<string, number>;
  return Object.fromEntries(SYS_CONFIG_FIELDS.map((field) => [field.key, balance[field.key]!]));
}

export function registerSysConfigRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/sys-config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const view: SysConfigView = {
      fields: SYS_CONFIG_FIELDS,
      defaults: BALANCE_DEFAULTS,
      overrides: await readOverrides(handle),
      effective: effectiveView(),
    };
    return await reply.send(view);
  });

  app.put('/api/admin/sys-config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = putSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '请求参数不合法' });
    }
    const errors = validateBalanceOverrides(parsed.data.updates);
    if (errors.length > 0) {
      return await reply.code(400).send({
        error: errors.map((e) => `${e.key}: ${e.reason}`).join('; '),
      });
    }
    // 全量替换语义:表单按开放字段全集编辑,存即热更 BALANCE
    const updates: Record<string, number> = {};
    for (const field of SYS_CONFIG_FIELDS) {
      const value = parsed.data.updates[field.key];
      if (typeof value === 'number') updates[field.key] = value;
    }
    applyBalanceOverrides(updates);
    await handle.db
      .insert(sysConfigs)
      .values({ id: 1, overrides: updates, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: sysConfigs.id,
        set: { overrides: updates, updatedAt: new Date() },
      });
    const view: SysConfigView = {
      fields: SYS_CONFIG_FIELDS,
      defaults: BALANCE_DEFAULTS,
      overrides: updates,
      effective: effectiveView(),
    };
    return await reply.send(view);
  });

  app.post('/api/admin/sys-config/reset', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    applyBalanceOverrides(BALANCE_DEFAULTS);
    await handle.db.delete(sysConfigs).where(eq(sysConfigs.id, 1));
    const view: SysConfigView = {
      fields: SYS_CONFIG_FIELDS,
      defaults: BALANCE_DEFAULTS,
      overrides: {},
      effective: effectiveView(),
    };
    return await reply.send(view);
  });
}
