import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueAdminToken } from '../src/utils/token.js';
import { env } from '../src/config/env.js';
import { schedule } from '../src/agents/cognition.js';
import type { DayPlan } from '../src/agents/slow-layer.js';
import { registerScheduleRoutes } from '../src/admin-api/schedules.js';
import type { Simulation } from '../src/world/simulation.js';

const CHAR_ID = 'char-1';

function buildSim(minuteOfDay: number): Simulation {
  return {
    characters: new Map([[CHAR_ID, { id: CHAR_ID }]]),
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

describe('GET/POST /api/admin/characters/:id/schedule|replan(M4d 日程面板)', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    schedule.clear(CHAR_ID);
    app = Fastify();
    registerScheduleRoutes(app, buildSim(600)); // 10:00
    await app.ready();
  });

  afterEach(async () => {
    schedule.clear(CHAR_ID);
    await app.close();
  });

  it('无计划:day=null/blocks=[]', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/schedule`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ characterId: CHAR_ID, day: null, source: null, blocks: [] });
  });

  it('有计划:label 取活动名,status 按当前时刻派生(done/active/pending)', async () => {
    const plan: DayPlan = {
      day: 3,
      source: 'llm',
      blocks: [
        { startMin: 480, endMin: 540, activityId: 'study' },
        { startMin: 540, endMin: 660, activityId: 'work' },
        { startMin: 1080, endMin: 1200, activityId: 'stroll' },
      ],
    };
    schedule.set(CHAR_ID, plan);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/schedule`,
      headers: { authorization: authHeader() },
    });
    const body = res.json() as { day: number; source: string; blocks: Array<{ label: string; status: string }> };
    expect(body.day).toBe(3);
    expect(body.source).toBe('llm');
    expect(body.blocks.map((b) => b.status)).toEqual(['done', 'active', 'pending']);
    expect(body.blocks.map((b) => b.label)).toEqual(['学习', '杂工', '散步']);
  });

  it('角色不在活跃世界 → 404;replan 清计划后泵自动重生成(此处只验 cleared)', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/characters/char-404/schedule',
      headers: { authorization: authHeader() },
    });
    expect(missing.statusCode).toBe(404);
    schedule.set(CHAR_ID, { day: 1, source: 'fallback', blocks: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/replan`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ characterId: CHAR_ID, cleared: true });
    expect(schedule.get(CHAR_ID)).toBeUndefined();
    const missingReplan = await app.inject({
      method: 'POST',
      url: '/api/admin/characters/char-404/replan',
      headers: { authorization: authHeader() },
    });
    expect(missingReplan.statusCode).toBe(404);
  });
});
