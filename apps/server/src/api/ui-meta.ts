import { eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ModelPulseView, UiMetaView } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { appSettings, modelConfigs, tokenUsage } from '../db/schema/index.js';
import { requireAdmin } from '../admin-api/auth.js';

/** 徽标开关的 kv 键(app_settings 首个消费键,后续同类 UI 开关沿用本表) */
const SHOW_MODELS_KEY = 'ui.showModels';

/** 心跳仪表窗口: 30 桶 × 2s = 近 60 秒调用脉冲(心电图数据源) */
const PULSE_BUCKETS = 30;
const PULSE_BUCKET_MS = 2_000;
const PULSE_SLOTS = ['slow', 'light', 'jev'] as const;

/** 徽标视图: 开关 + slow/light/jev 三槽位启用中的模型名(未启用/未配置为 null,不外发 baseUrl/key) */
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
  const modelOf = (slot: 'slow' | 'light' | 'jev'): string | null => {
    const row = bySlot.get(slot);
    return row !== undefined && row.enabled && row.model !== '' ? row.model : null;
  };
  return {
    showModels: settings[0]?.value === true,
    slowModel: modelOf('slow'),
    lightModel: modelOf('light'),
    jevModel: modelOf('jev'),
  };
}

/** 心跳仪表视图: 近窗调用次数按桶聚齐(空桶补零,旧→新),三槽位累计 Token 全史合计 */
async function modelPulseView(handle: DbHandle): Promise<ModelPulseView> {
  const since = new Date(Date.now() - PULSE_BUCKETS * PULSE_BUCKET_MS);
  const [recent, sums] = await Promise.all([
    handle.db
      .select({ createdAt: tokenUsage.createdAt })
      .from(tokenUsage)
      .where(gte(tokenUsage.createdAt, since)),
    handle.db
      .select({
        slot: tokenUsage.slot,
        tokens: sql<string>`coalesce(sum(${tokenUsage.promptTokens} + ${tokenUsage.completionTokens}), 0)::bigint`,
      })
      .from(tokenUsage)
      .where(inArray(tokenUsage.slot, [...PULSE_SLOTS]))
      .groupBy(tokenUsage.slot),
  ]);
  const windowStart = Math.floor(Date.now() / PULSE_BUCKET_MS) * PULSE_BUCKET_MS - (PULSE_BUCKETS - 1) * PULSE_BUCKET_MS;
  const hits = new Map<number, number>();
  for (const row of recent) {
    const idx = Math.floor((row.createdAt.getTime() - windowStart) / PULSE_BUCKET_MS);
    if (idx >= 0 && idx < PULSE_BUCKETS) hits.set(idx, (hits.get(idx) ?? 0) + 1);
  }
  const pulse = Array.from({ length: PULSE_BUCKETS }, (_, i) => hits.get(i) ?? 0);
  const bySlot = new Map(sums.map((row) => [row.slot, Number(row.tokens)] as const));
  return {
    pulse,
    bucketMs: PULSE_BUCKET_MS,
    totals: {
      slow: bySlot.get('slow') ?? 0,
      light: bySlot.get('light') ?? 0,
      jev: bySlot.get('jev') ?? 0,
    },
  };
}

/**
 * 游戏页模型徽标(UI 反馈⑦): 读公开(游客可见的低调提示),开关写收后台。
 * GET  /api/world/ui-meta       徽标数据(公开)
 * GET  /api/world/model-pulse   心跳仪表(公开): 调用脉冲+三槽位累计 Token
 * PUT  /api/admin/ui-settings   {showModels} 开关(admin)
 */
export function registerUiMetaRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/world/ui-meta', async () => await uiMetaView(handle));

  app.get('/api/world/model-pulse', async () => await modelPulseView(handle));

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
