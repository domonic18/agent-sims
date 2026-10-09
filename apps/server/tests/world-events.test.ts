import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorldEventsHistoryResponse } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { setupIntegrationDb } from './helpers/integration.js';
import { worldEvents } from '../src/db/schema/index.js';

const TEST_TYPE = 'vitest.world-event';

const { handle, up: dbUp } = await setupIntegrationDb();

beforeAll(async () => {
  if (!dbUp) return;
  await handle.db.delete(worldEvents).where(like(worldEvents.type, `${TEST_TYPE}%`));
}, 30_000);

afterAll(async () => {
  if (!dbUp) return;
  await handle.db.delete(worldEvents).where(like(worldEvents.type, `${TEST_TYPE}%`));
  await handle.client.end();
});

const get = async (url: string, clockGameMinutes?: number) => {
  const app = buildApp(clockGameMinutes !== undefined ? { clockGameMinutes } : {});
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
    // tick 护栏只回当前世界 tick 及以下,世界时钟需拨过待查事件(480+200=680 分)
    const res = await get(`/api/world/events?type=${TEST_TYPE}`, 680);
    expect(res.statusCode).toBe(200);
    const { entries } = res.json<WorldEventsHistoryResponse>();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.id).toBeGreaterThan(entries[1]!.id);
    // tick=200 → 480+200=680 分 → 第1天 11:20;tick=100 → 580 分 → 第1天 09:40
    expect(entries[0]).toMatchObject({ day: 1, time: '11:20' });
    expect(entries[1]).toMatchObject({ day: 1, time: '09:40' });
  });

  it('characterId 过滤', async () => {
    const res = await get(`/api/world/events?type=${TEST_TYPE}&characterId=char-a`, 680);
    expect(res.statusCode).toBe(200);
    const { entries } = res.json<WorldEventsHistoryResponse>();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event).toMatchObject({ note: '甲' });
  });

  it('types 多类型过滤', async () => {
    await handle.db.insert(worldEvents).values([
      { type: `${TEST_TYPE}.a`, characterId: 'char-a', tick: 100, payload: { type: `${TEST_TYPE}.a`, tick: 100 } },
      { type: `${TEST_TYPE}.b`, characterId: 'char-b', tick: 110, payload: { type: `${TEST_TYPE}.b`, tick: 110 } },
      { type: `${TEST_TYPE}.c`, characterId: 'char-c', tick: 120, payload: { type: `${TEST_TYPE}.c`, tick: 120 } },
    ]);
    const res = await get(`/api/world/events?types=${TEST_TYPE}.a,${TEST_TYPE}.c`, 680);
    expect(res.statusCode).toBe(200);
    const { entries } = res.json<WorldEventsHistoryResponse>();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => (entry.event as { type: string }).type).sort()).toEqual([
      `${TEST_TYPE}.a`,
      `${TEST_TYPE}.c`,
    ]);
  });

  it('tick 护栏: 晚于当前世界时钟的事件(旧世界残留)不返回', async () => {
    // 前序用例的同类型残留会干扰计数,先清空本类型
    await handle.db.delete(worldEvents).where(like(worldEvents.type, TEST_TYPE));
    await handle.db.insert(worldEvents).values([
      { type: TEST_TYPE, characterId: 'char-a', tick: 100, payload: { type: TEST_TYPE, tick: 100 } },
      { type: TEST_TYPE, characterId: 'char-b', tick: 999_999, payload: { type: TEST_TYPE, tick: 999_999 } },
    ]);
    const res = await get(`/api/world/events?type=${TEST_TYPE}`, 680);
    expect(res.statusCode).toBe(200);
    const { entries } = res.json<WorldEventsHistoryResponse>();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event).toMatchObject({ tick: 100 });
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
