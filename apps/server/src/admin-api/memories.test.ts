import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { MemoryLlm } from '../agents/memory-writer.js';
import { env } from '../config/env.js';
import { createDb, type DbHandle } from '../db/client.js';
import { characters, memories, worlds } from '../db/schema/index.js';
import { issueAdminToken } from '../utils/token.js';

const WORLD_ID = '00000000-0000-4000-8000-00000000b301';
const CHAR_ID = '00000000-0000-4000-8000-00000000b302';
const NOW = 14_400; // 游戏第 11 天 0 分

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

/** 单位向量:第 i 维为 1(2048 维,与 embedding 槽维度绑定) */
function unitVector(i: number): number[] {
  return new Array(2048).fill(0).map((_, dim) => (dim === i ? 1 : 0));
}

function stubLlm(vector: number[] | Error): MemoryLlm {
  return {
    systemOne: () => Promise.reject(new Error('测试桩不触发 systemOne')),
    embed: () =>
      vector instanceof Error ? Promise.reject(vector) : Promise.resolve({ vector, promptTokens: 0 }),
    chat: () => Promise.reject(new Error('测试桩不触发 chat')),
    chatStructured: () => Promise.reject(new Error('测试桩不触发 chatStructured')),

  };
}

function authHeader(): string {
  const issued = issueAdminToken({
    username: 'vitest',
    masterKey: env.MASTER_KEY,
    ttlMs: 3_600_000,
  });
  return `Bearer ${issued.token}`;
}

async function insertMemory(overrides: {
  id: string;
  content: string;
  importance: number;
  gameMinutes: number;
  embedding: number[] | null;
  createdAt: Date;
}): Promise<void> {
  await handle.db.insert(memories).values({
    characterId: CHAR_ID,
    type: 'event',
    ...overrides,
  });
}

describe.skipIf(!dbUp)('GET /api/admin/characters/:id/memories', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.db
      .insert(worlds)
      .values({ id: WORLD_ID, name: 'vitest-记忆面板镇', status: 'active', config: {} })
      .onConflictDoNothing();
    await handle.db.insert(characters).values({
      id: CHAR_ID,
      worldId: WORLD_ID,
      tier: 'resident',
      name: '忆事公',
      gender: 'male',
      persona: {},
      position: { x: 0, y: 0 },
      stats: {},
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000b311',
      content: '我学习了 60 分钟',
      importance: 5,
      gameMinutes: NOW,
      embedding: unitVector(0),
      createdAt: new Date(1_000),
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000b312',
      content: '我做完了一份清扫的活计',
      importance: 10,
      gameMinutes: NOW - 600,
      embedding: unitVector(1),
      createdAt: new Date(2_000),
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000b313',
      content: '我倒下了,等待救治',
      importance: 1,
      gameMinutes: NOW - 6_000,
      embedding: unitVector(0).map((v) => -v),
      createdAt: new Date(3_000),
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000b314',
      content: '无向量旧记忆',
      importance: 3,
      gameMinutes: NOW - 60,
      embedding: null,
      createdAt: new Date(4_000),
    });
    app = buildApp();
  }, 30_000);

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.client.end();
    await app.close();
  });

  it('无凭证 401;未知角色 404', async () => {
    const anon = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/memories`,
    });
    expect(anon.statusCode).toBe(401);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/characters/00000000-0000-4000-8000-00000000bfff/memories',
      headers: { authorization: authHeader() },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('browse 模式:createdAt 倒序,不带 score/factors', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/memories`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      characterId: CHAR_ID,
      name: '忆事公',
      mode: 'recent',
      notice: null,
    });
    expect(body.items.map((m: { id: string }) => m.id)).toEqual([
      '00000000-0000-4000-8000-00000000b314',
      '00000000-0000-4000-8000-00000000b313',
      '00000000-0000-4000-8000-00000000b312',
      '00000000-0000-4000-8000-00000000b311',
    ]);
    for (const item of body.items) {
      expect(item.score).toBeUndefined();
      expect(item.factors).toBeUndefined();
    }
  });

  it('search 模式:llm 桩注单位向量,三因子排序同向登顶', async () => {
    app.llm = stubLlm(unitVector(0));
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/memories?q=${encodeURIComponent('学习')}`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('search');
    expect(body.notice).toBeNull();
    expect(body.items.map((m: { id: string }) => m.id)).toEqual([
      '00000000-0000-4000-8000-00000000b311',
      '00000000-0000-4000-8000-00000000b312',
      '00000000-0000-4000-8000-00000000b314',
      '00000000-0000-4000-8000-00000000b313',
    ]);
    expect(body.items[0].factors.relevance).toBe(1);
    expect(body.items[3].factors.relevance).toBe(0); // 反向+最旧沉底
  });

  it('embed 失败降级双因子排序并带 notice;limit 截断与 400', async () => {
    app.llm = stubLlm(new Error('槽位未配置'));
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/memories?q=${encodeURIComponent('学习')}`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('search');
    expect(body.notice).toContain('双因子');
    expect(body.items.map((m: { id: string }) => m.id)).toEqual([
      '00000000-0000-4000-8000-00000000b312',
      '00000000-0000-4000-8000-00000000b311',
      '00000000-0000-4000-8000-00000000b314',
      '00000000-0000-4000-8000-00000000b313',
    ]);
    const truncated = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/memories?limit=2`,
      headers: { authorization: authHeader() },
    });
    expect(truncated.json().items).toHaveLength(2);
    const bad = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/memories?limit=0`,
      headers: { authorization: authHeader() },
    });
    expect(bad.statusCode).toBe(400);
  });
});
