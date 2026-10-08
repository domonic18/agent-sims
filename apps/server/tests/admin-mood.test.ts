import { eq } from 'drizzle-orm';
import type { CharacterMoodResponse } from '@sims/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { characterMoods, characters, worlds } from '../src/db/schema/index.js';
import { issueAdminToken } from '../src/utils/token.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate);库不可达时整组跳过
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

const WORLD_ID = '00000000-0000-4000-8000-00000000c601';
const CHAR_ID = '00000000-0000-4000-8000-00000000c602';
const PARTNER_ID = '00000000-0000-4000-8000-00000000c603';

async function until(cond: () => Promise<boolean>, ms = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!(await cond())) {
    if (Date.now() - startedAt > ms) throw new Error('admin-mood 等待超时');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function authHeader(): string {
  const issued = issueAdminToken({
    username: 'vitest',
    masterKey: env.MASTER_KEY,
    ttlMs: 3_600_000,
  });
  return `Bearer ${issued.token}`;
}

describe.skipIf(!dbUp)('情绪面板 API(C2: 事件打标+衰减聚合+历史)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const get = async (id = CHAR_ID): Promise<{ statusCode: number; body: CharacterMoodResponse }> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${id}/mood`,
      headers: { authorization: authHeader() },
    });
    return { statusCode: res.statusCode, body: res.json() };
  };

  const moodRowCount = async (id: string): Promise<number> => {
    const rows = await handle.db
      .select({ delta: characterMoods.delta })
      .from(characterMoods)
      .where(eq(characterMoods.characterId, id));
    return rows.length;
  };

  beforeAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.db
      .insert(worlds)
      .values({ id: WORLD_ID, name: 'vitest-情绪镇', status: 'active', config: {} })
      .onConflictDoNothing();
    for (const [id, name] of [
      [CHAR_ID, '阿泽'],
      [PARTNER_ID, '苏晚'],
    ] as const) {
      await handle.db.insert(characters).values({
        id,
        worldId: WORLD_ID,
        tier: 'resident',
        name,
        gender: 'male',
        persona: {},
        position: { x: 0, y: 0 },
        stats: {},
      });
    }
    app = buildApp();
    app.simulation.spawnCharacter(CHAR_ID, 8, 12, '阿泽');
    app.simulation.spawnCharacter(PARTNER_ID, 9, 12, '苏晚');
  }, 30_000);

  beforeEach(async () => {
    await handle.db.delete(characterMoods).where(eq(characterMoods.characterId, CHAR_ID));
    await handle.db.delete(characterMoods).where(eq(characterMoods.characterId, PARTNER_ID));
  });

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await app.close();
    await handle.client.end();
  });

  it('GET: 无情绪记录返回零值当前态与空历史', async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('阿泽');
    expect(res.body.current).toEqual({ valence: 0, labels: [], since: null });
    expect(res.body.history).toEqual([]);
  });

  it('事件打标: 做出成品+倒下落库,当前态聚合 valence=-0.2,历史新→旧', async () => {
    app.simulation.events.emit({
      type: 'craft.completed',
      characterId: CHAR_ID,
      recipeId: 'chair',
      tick: 1,
    });
    app.simulation.events.emit({
      type: 'character.died',
      characterId: CHAR_ID,
      tick: 2,
      revivable: true,
    });
    await until(async () => (await moodRowCount(CHAR_ID)) === 2);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body.current.valence).toBeCloseTo(-0.2, 5);
    expect(res.body.current.labels).toContain('倒下了');
    expect(res.body.current.labels).toContain('做出成品');
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0]?.labels).toEqual(['倒下了']); // 新→旧
    expect(res.body.history[1]?.labels).toEqual(['做出成品']);
  });

  it('衰减: 半衰期 240 分,480 分钟前的 +0.4 冲量衰减到 0.1', async () => {
    const now = app.simulation.clock.gameMinutes;
    await handle.db.insert(characterMoods).values({
      characterId: CHAR_ID,
      delta: 0.4,
      labels: ['获救'],
      gameMinutes: now - 480,
    });
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body.current.valence).toBeCloseTo(0.1, 5);
    expect(res.body.current.labels).toEqual(['获救']);
    expect(res.body.current.since).toBe(now - 480);
  });

  it('结交: friendship.formed 双方各落一条冲量', async () => {
    app.simulation.events.emit({
      type: 'friendship.formed',
      aId: CHAR_ID,
      bId: PARTNER_ID,
      tick: 3,
      title: '挚友',
    });
    await until(async () => (await moodRowCount(PARTNER_ID)) === 1);
    const res = await get(PARTNER_ID);
    expect(res.statusCode).toBe(200);
    expect(res.body.current.valence).toBeCloseTo(0.5, 5);
    expect(res.body.current.labels).toEqual(['和阿泽结交了']);
  });

  it('404: 角色不存在', async () => {
    const res = await get('00000000-0000-4000-8000-00000000c6ff');
    expect(res.statusCode).toBe(404);
  });
});
