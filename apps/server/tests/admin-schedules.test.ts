import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueAdminToken } from '../src/utils/token.js';
import { env } from '../src/config/env.js';
import { innerState, type DayIntents } from '../src/agents/cognition.js';
import { registerScheduleRoutes } from '../src/admin-api/schedules.js';
import type { Simulation } from '../src/world/simulation.js';

const CHAR_ID = 'char-1';

function buildSim(minuteOfDay: number): Simulation {
  return {
    characters: new Map([
      [
        CHAR_ID,
        {
          id: CHAR_ID,
          x: 12,
          y: 34,
          coins: 7,
          energy: 88.4,
          activity: null,
          backpack: { berry: 3 },
        },
      ],
    ]),
    clock: { minuteOfDay },
  } as unknown as Simulation;
}

function authHeader(): string {
  const issued = issueAdminToken({
    username: 'vitest',
    masterKey: env.MASTER_KEY,
    ttlMs: 3_600_000,
  });
  return `Bearer ${issued.token}`;
}

describe('GET/POST /api/admin/characters/:id/schedule|replan(D3 意图面板)', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    innerState.clear(CHAR_ID);
    app = Fastify();
    registerScheduleRoutes(app, buildSim(600)); // 10:00
    await app.ready();
  });

  afterEach(async () => {
    innerState.clear(CHAR_ID);
    await app.close();
  });

  it('无意图:day=null/wants=[]', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/schedule`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      characterId: CHAR_ID,
      day: null,
      source: null,
      wants: [],
      snapshot: {
        x: 12,
        y: 34,
        coins: 7,
        energy: 88,
        activity: null,
        backpack: [{ id: 'berry', name: '浆果', count: 3, price: 2 }],
      },
    });
  });

  it('有意图:wants 视图带 label/statusLabel,why/urgency 原样透出', async () => {
    const intents: DayIntents = {
      day: 3,
      source: 'llm',
      wants: [
        { id: 'w3-0', activityId: 'study', why: '想学新东西', urgency: 0.9, status: 'done', createdAtMin: 480 },
        { id: 'w3-1', activityId: 'work', why: '挣钱', urgency: 0.8, status: 'doing', createdAtMin: 500 },
        { id: 'w3-2', activityId: 'stroll', why: '透透气', urgency: 0.3, status: 'pending', createdAtMin: 520 },
      ],
    };
    innerState.setIntents(CHAR_ID, intents);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/schedule`,
      headers: { authorization: authHeader() },
    });
    const body = res.json() as {
      day: number;
      source: string;
      wants: Array<{ id: string; label: string; statusLabel: string; urgency: number; why: string }>;
      snapshot: { backpack: Array<{ id: string; count: number; price: number | null }> } | null;
    };
    expect(body.day).toBe(3);
    expect(body.source).toBe('llm');
    expect(body.wants.map((w) => [w.id, w.label, w.statusLabel])).toEqual([
      ['w3-0', '学习', '已完成'],
      ['w3-1', '杂工', '进行中'],
      ['w3-2', '散步', '未做'],
    ]);
    expect(body.wants.map((w) => [w.why, w.urgency])).toEqual([
      ['想学新东西', 0.9],
      ['挣钱', 0.8],
      ['透透气', 0.3],
    ]);
    expect(body.snapshot?.backpack).toEqual([{ id: 'berry', name: '浆果', count: 3, price: 2 }]);
  });

  it('角色不在活跃世界 → 404;replan 清意图交泵重生成(此处只验 cleared)', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/characters/char-404/schedule',
      headers: { authorization: authHeader() },
    });
    expect(missing.statusCode).toBe(404);
    innerState.setIntents(CHAR_ID, { day: 1, source: 'fallback', wants: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/replan`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ characterId: CHAR_ID, cleared: true });
    expect(innerState.get(CHAR_ID)?.intents ?? null).toBeNull();
    const missingReplan = await app.inject({
      method: 'POST',
      url: '/api/admin/characters/char-404/replan',
      headers: { authorization: authHeader() },
    });
    expect(missingReplan.statusCode).toBe(404);
  });
});
