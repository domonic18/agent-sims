import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TokenUsageEntriesResponse, TokenUsageSummary } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, tokenUsage } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate+seed);库不可达时整组跳过
const TEST_USERNAME = 'vitest-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const TEST_TASK_TYPE = 'vitest_token'; // 测试行标记,断言与清理都按它圈定

let handle: DbHandle;
let token = '';

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

beforeAll(async () => {
  if (!dbUp) return;
  // 并行测试文件共享 vitest-admin:每次强制重置密码+不删除,避免彼此删号的登录竞态
  await handle.db
    .insert(adminUsers)
    .values({ username: TEST_USERNAME, passwordHash: hashPassword(TEST_PASSWORD) })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash: hashPassword(TEST_PASSWORD) },
    });
  await handle.db.delete(tokenUsage).where(eq(tokenUsage.taskType, TEST_TASK_TYPE));
  await handle.db.insert(tokenUsage).values([
    { slot: 'light', taskType: TEST_TASK_TYPE, promptTokens: 100, completionTokens: 50, cost: '0' },
    { slot: 'light', taskType: TEST_TASK_TYPE, promptTokens: 200, completionTokens: 20, cost: '0' },
    { slot: 'embedding', taskType: TEST_TASK_TYPE, promptTokens: 30, completionTokens: 0, cost: '0' },
  ]);
  const login = await buildApp().inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });
  token = login.json<{ token: string }>().token;
}, 30_000);

afterAll(async () => {
  if (!dbUp) return;
  await handle.db.delete(tokenUsage).where(inArray(tokenUsage.taskType, [TEST_TASK_TYPE]));
  await handle.client.end();
});

const get = async (url: string) => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  await app.close();
  return res;
};

describe.skipIf(!dbUp)('token 用量统计 API', () => {
  it('未带 token 访问 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/token-usage/summary' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('非法 window 400', async () => {
    const res = await get('/api/admin/token-usage/summary?window=bad');
    expect(res.statusCode).toBe(400);
  });

  it('summary 返回 KPI/趋势/三向分布/topCalls,趋势桶连续补零', async () => {
    const res = await get('/api/admin/token-usage/summary?window=7d');
    expect(res.statusCode).toBe(200);
    const body = res.json<TokenUsageSummary>();
    expect(body.window).toBe('7d');
    // dev 库可能已有其他调用记录,断言「至少包含」测试行
    expect(body.kpi.calls).toBeGreaterThanOrEqual(3);
    expect(body.kpi.totalTokens).toBeGreaterThanOrEqual(400);
    const vitest = body.byTaskType.find((row) => row.taskType === TEST_TASK_TYPE);
    expect(vitest).toMatchObject({ promptTokens: 330, completionTokens: 70, totalTokens: 400, calls: 3 });
    const light = body.bySlot.find((row) => row.slot === 'light');
    expect(light?.totalTokens).toBeGreaterThanOrEqual(370);
    expect(body.byCharacter.some((row) => row.characterId === null && row.calls >= 3)).toBe(true);
    // 7d 趋势=7 个日桶(今日+前 6 天),全部有标签
    expect(body.trend).toHaveLength(7);
    expect(body.trend.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.bucket))).toBe(true);
    expect(body.trend.reduce((sum, point) => sum + point.totalTokens, 0)).toBeGreaterThanOrEqual(400);
    expect(body.topCalls.length).toBeGreaterThan(0);
    expect(body.topCalls.length).toBeLessThanOrEqual(5);
  });

  it('summary 今日窗口趋势按小时且 24 桶', async () => {
    const res = await get('/api/admin/token-usage/summary?window=today');
    expect(res.statusCode).toBe(200);
    const body = res.json<TokenUsageSummary>();
    expect(body.trend).toHaveLength(24);
    expect(body.trend.every((point) => /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(point.bucket))).toBe(true);
  });

  it('entries 按槽位+任务类型精确过滤,分页正确', async () => {
    const res = await get(
      `/api/admin/token-usage/entries?window=all&slot=light&taskType=${TEST_TASK_TYPE}&page=1&pageSize=1`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<TokenUsageEntriesResponse>();
    expect(body.total).toBe(2);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ slot: 'light', taskType: TEST_TASK_TYPE, characterName: null });
    const page2 = await get(
      `/api/admin/token-usage/entries?window=all&slot=light&taskType=${TEST_TASK_TYPE}&page=2&pageSize=1`,
    );
    expect(page2.json<TokenUsageEntriesResponse>().entries).toHaveLength(1);
  });

  it('趋势按北京时区归桶(UTC 库跨日 8 小时是关键边界)', async () => {
    const before = (await get('/api/admin/token-usage/summary?window=all')).json<TokenUsageSummary>();
    const TZ_MS = 8 * 3_600_000;
    const beijingDayStartUtc = Math.floor((Date.now() + TZ_MS) / 86_400_000) * 86_400_000 - TZ_MS;
    // 哨兵 A: 北京今日 00:30(UTC 时刻在前一个 UTC 日);哨兵 B: 北京昨日 23:00
    await handle.db.insert(tokenUsage).values([
      { slot: 'light', taskType: TEST_TASK_TYPE, promptTokens: 10, completionTokens: 0, cost: '0', createdAt: new Date(beijingDayStartUtc + 30 * 60_000) },
      { slot: 'light', taskType: TEST_TASK_TYPE, promptTokens: 20, completionTokens: 0, cost: '0', createdAt: new Date(beijingDayStartUtc - 60 * 60_000) },
    ]);
    try {
      const after = (await get('/api/admin/token-usage/summary?window=all')).json<TokenUsageSummary>();
      const diff = (label: string): number =>
        (after.trend.find((p) => p.bucket === label)?.totalTokens ?? 0) -
        (before.trend.find((p) => p.bucket === label)?.totalTokens ?? 0);
      const today = new Date(Date.now() + TZ_MS).toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() + TZ_MS - 86_400_000).toISOString().slice(0, 10);
      expect(diff(today)).toBe(10);
      expect(diff(yesterday)).toBe(20);
    } finally {
      await handle.db
        .delete(tokenUsage)
        .where(and(eq(tokenUsage.taskType, TEST_TASK_TYPE), eq(tokenUsage.promptTokens, 10)));
      await handle.db
        .delete(tokenUsage)
        .where(and(eq(tokenUsage.taskType, TEST_TASK_TYPE), eq(tokenUsage.promptTokens, 20)));
    }
  });

  it('entries 非法 uuid/超长 taskType 400', async () => {
    expect((await get('/api/admin/token-usage/entries?characterId=not-a-uuid')).statusCode).toBe(400);
    expect((await get(`/api/admin/token-usage/entries?taskType=${'x'.repeat(81)}`)).statusCode).toBe(400);
  });
});
