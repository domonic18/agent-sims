import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { UiMetaView } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { appSettings, modelConfigs } from '../db/schema/index.js';
import { requireAdmin } from '../admin-api/auth.js';

/** 徽标开关的 kv 键(app_settings 首个消费键,后续同类 UI 开关沿用本表) */
const SHOW_MODELS_KEY = 'ui.showModels';

/** 徽标视图: 开关 + slow/jev 槽位启用中的模型名(未启用/未配置为 null,不外发 baseUrl/key) */
async function uiMetaView(handle: DbHandle): Promise<UiMetaView> {
  const [rows, settings] = await Promise.all([
    handle.db.select().from(modelConfigs),
    handle.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SHOW_MODELS_KEY))
      .limit(1),
  ]);
  const bySlot = new Map(rows.map((row) => [row.slot, row] as const));
  const modelOf = (slot: 'slow' | 'jev'): string | null => {
    const row = bySlot.get(slot);
    return row !== undefined && row.enabled && row.model !== '' ? row.model : null;
  };
  return {
    showModels: settings[0]?.value === true,
    slowModel: modelOf('slow'),
    jevModel: modelOf('jev'),
  };
}

/**
 * 游戏页模型徽标(UI 反馈⑦): 读公开(游客可见的低调提示),开关写收后台。
 * GET  /api/world/ui-meta      徽标数据(公开)
 * PUT  /api/admin/ui-settings  {showModels} 开关(admin)
 */
export function registerUiMetaRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/world/ui-meta', async () => await uiMetaView(handle));

  app.put('/api/admin/ui-settings', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = z.object({ showModels: z.boolean() }).safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: 'body 须为 {showModels: boolean}' });
    }
    await handle.db
      .insert(appSettings)
      .values({ key: SHOW_MODELS_KEY, value: parsed.data.showModels, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: parsed.data.showModels, updatedAt: new Date() },
      });
    return await reply.send(await uiMetaView(handle));
  });
}
