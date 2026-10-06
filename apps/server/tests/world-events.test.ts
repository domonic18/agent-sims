import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorldEventsHistoryResponse } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { worldEvents } from '../src/db/schema/index.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate);库不可达时整组跳过
const TEST_TYPE = 'vitest.world-event';

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

beforeAll(async () => {
  if (!dbUp) return;
  await handle.db.delete(worldEvents).where(eq(worldEvents.type, TEST_TYPE));
}, 30_000);

afterAll(async () => {
  if (!dbUp) return;
  await handle.db.delete(worldEvents).where(eq(worldEvents.type, TEST_TYPE));
  await handle.client.end();
});

const get = async (url: string) => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
};

describe.skipIf(!dbUp)('GET /api/world/events 历史事件查询(UI-1 C4)', () => {
  it('空表返回空列表', async () => {
    const res = await get(`/api/world/events?type=${TEST_TYPE}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<WorldEventsHistoryResponse>().entries).toEqual([]);
  });

  it('倒序返回(id 大者在前)并带换算游戏时刻', async () => {
    await handle.db.insert(worldEvents).values([
      { type: TEST_TYPE, characterId: 'char-a', tick: 100, payload: { type: TEST_TYPE, tick: 100, note: '甲' } },
      { type: TEST_TYPE, characterId: 'char-b', tick: 200, payload: { type: TEST_TYPE, tick: 200, note: '乙' } },
    ]);
    const res = await get(`/api/world/events?type=${TEST_TYPE}`);
    expect(res.statusCode).toBe(200);
    const { entries } = res.json<WorldEventsHistoryResponse>();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.id).toBeGreaterThan(entries[1]!.id);
    // tick=200 → 480+200=680 分 → 第1天 11:20;tick=100 → 580 分 → 第1天 09:40
    expect(entries[0]).toMatchObject({ day: 1, time: '11:20' });
    expect(entries[1]).toMatchObject({ day: 1, time: '09:40' });
  });

  it('characterId 过滤', async () => {
    const res = await get(`/api/world/events?type=${TEST_TYPE}&characterId=char-a`);
    expect(res.statusCode).toBe(200);
    const { entries } = res.json<WorldEventsHistoryResponse>();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event).toMatchObject({ note: '甲' });
  });

  it('limit 超上限时截断到 500 而非拒绝', async () => {
    const res = await get('/api/world/events?limit=99999');
    expect(res.statusCode).toBe(200);
  });

  it('limit 非法时 400', async () => {
    const res = await get('/api/world/events?limit=0');
    expect(res.statusCode).toBe(400);
  });
});
