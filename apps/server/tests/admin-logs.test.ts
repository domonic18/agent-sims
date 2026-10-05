import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TechLogEntriesResponse, WorldEventEntriesResponse } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, techLogs, worldEvents } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate);库不可达时整组跳过
const TEST_USERNAME = 'vitest-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const TEST_TYPE = 'vitest.event';
const TEST_MESSAGE = 'vitest-tech-marker';

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
  await handle.db
    .insert(adminUsers)
    .values({ username: TEST_USERNAME, passwordHash: hashPassword(TEST_PASSWORD) })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash: hashPassword(TEST_PASSWORD) },
    });
  await handle.db.delete(worldEvents).where(eq(worldEvents.type, TEST_TYPE));
  await handle.db.delete(techLogs).where(eq(techLogs.message, TEST_MESSAGE));
  await handle.db.insert(worldEvents).values([
    { type: TEST_TYPE, characterId: 'char-a', tick: 100, payload: { type: TEST_TYPE, note: '甲' } },
    { type: TEST_TYPE, characterId: 'char-b', tick: 200, payload: { type: TEST_TYPE, note: '乙' } },
  ]);
  await handle.db.insert(techLogs).values([
    { level: 'error', source: 'vitest', message: TEST_MESSAGE, detail: { code: 42 } },
    { level: 'info', source: 'vitest', message: TEST_MESSAGE },
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
  await handle.db.delete(worldEvents).where(eq(worldEvents.type, TEST_TYPE));
  await handle.db.delete(techLogs).where(eq(techLogs.message, TEST_MESSAGE));
  await handle.client.end();
});

const get = async (url: string) => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  await app.close();
  return res;
};

describe.skipIf(!dbUp)('M-G.1 日志查询 API', () => {
  it('未带 token 访问 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/logs/world-events' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('非法分页参数 400', async () => {
    const res = await get('/api/admin/logs/world-events?page=0');
    expect(res.statusCode).toBe(400);
  });

  it('世界事件按角色过滤,payload 原样回读', async () => {
    const res = await get(`/api/admin/logs/world-events?characterId=char-a&type=${TEST_TYPE}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<WorldEventEntriesResponse>();
    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({ characterId: 'char-a', tick: 100 });
    expect(body.entries[0]!.payload).toMatchObject({ note: '甲' });
  });

  it('世界事件分页协议(total/page/pageSize)', async () => {
    const res = await get(`/api/admin/logs/world-events?type=${TEST_TYPE}&page=1&pageSize=1`);
    expect(res.statusCode).toBe(200);
    const body = res.json<WorldEventEntriesResponse>();
    expect(body.total).toBe(2);
    expect(body.pageSize).toBe(1);
    expect(body.entries).toHaveLength(1);
  });

  it('技术日志按 level 过滤,detail 回读', async () => {
    const res = await get(`/api/admin/logs/tech-logs?level=error&source=vitest`);
    expect(res.statusCode).toBe(200);
    const body = res.json<TechLogEntriesResponse>();
    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({ level: 'error', message: TEST_MESSAGE });
    expect(body.entries[0]!.detail).toMatchObject({ code: 42 });
  });

  it('审计日志接口可达(空过滤不报错)', async () => {
    const res = await get('/api/admin/logs/audit-logs?username=nonexistent-user');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ total: number }>().total).toBe(0);
  });
});
