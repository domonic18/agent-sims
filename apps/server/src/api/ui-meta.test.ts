import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { createDb, type DbHandle } from '../db/client.js';
import { tokenUsage } from '../db/schema/index.js';

/** 测试标记任务类型:清理时按此删,不碰真实用量数据 */
const MARK = 'vitest-model-pulse';

let handle: DbHandle;

const dbUp = await (async () => {
  handle = createDb(env.DATABASE_URL);
  try {
    await handle.client`SELECT 1`;
    return true;
  } catch {
    await handle.client.end().catch(() => {});
    return false;
  }
})();

async function insertUsage(slot: 'slow' | 'light' | 'jev', prompt: number, completion: number): Promise<void> {
  await handle.db.insert(tokenUsage).values({
    slot,
    taskType: MARK,
    promptTokens: prompt,
    completionTokens: completion,
    createdAt: new Date(),
  });
}

describe.skipIf(!dbUp)('GET /api/world/model-pulse', () => {
  beforeAll(async () => {
    await handle.db.delete(tokenUsage).where(eq(tokenUsage.taskType, MARK));
    await insertUsage('slow', 12_000, 3_000);
    await insertUsage('slow', 800, 200);
    await insertUsage('light', 500, 100);
    await insertUsage('jev', 90, 10);
  });

  afterAll(async () => {
    await handle.db.delete(tokenUsage).where(eq(tokenUsage.taskType, MARK));
    await handle.client.end().catch(() => {});
  });

  it('返回 30 桶脉冲与三槽位累计 Token', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/world/model-pulse' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pulse: number[]; bucketMs: number; totals: Record<string, number> };
    expect(body.pulse).toHaveLength(30);
    expect(body.bucketMs).toBe(2_000);
    // 刚插入的 4 条落在最新桶内: 末桶计数≥4
    expect(body.pulse[body.pulse.length - 1]).toBeGreaterThanOrEqual(4);
    expect(body.totals.slow).toBeGreaterThanOrEqual(16_000);
    expect(body.totals.light).toBeGreaterThanOrEqual(600);
    expect(body.totals.jev).toBeGreaterThanOrEqual(100);
    await app.close();
  });
});
