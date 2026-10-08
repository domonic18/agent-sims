import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { createDb, type DbHandle } from '../db/client.js';
import { characters, memories, worlds } from '../db/schema/index.js';
import { retrieveMemories, scoreMemories, type ScoredMemory } from './memory-retrieval.js';

const NOW = 14_400; // 游戏第 11 天 0 分

function row(overrides: {
  id: string;
  importance?: number;
  gameMinutes?: number | null;
  relevance?: number | null;
  createdAt?: Date;
}) {
  return {
    type: 'event',
    content: `记忆 ${overrides.id}`,
    importance: 5,
    gameMinutes: NOW,
    relevance: null,
    createdAt: new Date(1_000),
    ...overrides,
  };
}

describe('scoreMemories(纯函数,三因子等权)', () => {
  it('归一化锚点:最新/最高分/最相似各拿 1,最旧/最低/最远各拿 0', () => {
    const [newest, mid, oldest] = pick3(
      scoreMemories(
        [
          row({ id: 'newest', importance: 5, gameMinutes: NOW, relevance: 1 }),
          row({ id: 'mid', importance: 10, gameMinutes: NOW - 600, relevance: 0 }),
          row({ id: 'oldest', importance: 1, gameMinutes: NOW - 6_000, relevance: -1 }),
        ],
        NOW,
      ),
    );
    expect(newest.factors.recency).toBe(1);
    expect(oldest.factors.recency).toBe(0);
    expect(mid.factors.importance).toBe(1);
    expect(oldest.factors.importance).toBe(0);
    expect(newest.factors.relevance).toBe(1);
    expect(mid.factors.relevance).toBe(0.5);
    expect(oldest.factors.relevance).toBe(0);
    // score = 三因子之和(浮点一致)
    for (const item of [newest, mid, oldest]) {
      expect(item.score).toBeCloseTo(
        item.factors.recency + item.factors.importance + (item.factors.relevance ?? 0),
        12,
      );
    }
    expect(newest.score).toBeGreaterThan(mid.score);
    expect(mid.score).toBeGreaterThan(oldest.score);
  });

  it('recency 衰减:0.995^(小时龄),600 分龄(10h)在归一化后可推算', () => {
    const [_newest, mid, _oldest] = pick3(
      scoreMemories(
        [
          row({ id: 'newest', gameMinutes: NOW }),
          row({ id: 'mid', gameMinutes: NOW - 600 }),
          row({ id: 'oldest', gameMinutes: NOW - 6_000 }),
        ],
        NOW,
      ),
    );
    const decayed = 0.995 ** 10;
    const floor = 0.995 ** 100;
    expect(mid.factors.recency).toBeCloseTo((decayed - floor) / (1 - floor), 12);
  });

  it('因子缺失:无向量条目 relevance 恒 null 计 0 分,不冒充相似;全体同值退化恒 0.5', () => {
    const mixed = scoreMemories(
      [
        row({ id: 'a', relevance: 0.9 }),
        row({ id: 'b', relevance: null }),
      ],
      NOW,
    )[0]!;
    expect(mixed.factors.relevance).toBe(0.5); // 唯一非 null → 单值退化中性档,仍压过 null 的 0
    const degenerate = scoreMemories(
      [
        row({ id: 'a', importance: 7, gameMinutes: NOW }),
        row({ id: 'b', importance: 7, gameMinutes: NOW }),
      ],
      NOW,
    );
    for (const item of degenerate) {
      expect(item.factors.recency).toBe(0.5);
      expect(item.factors.importance).toBe(0.5);
      expect(item.score).toBeCloseTo(1, 12);
    }
    const noVectors = scoreMemories(
      [
        row({ id: 'a', importance: 1 }),
        row({ id: 'b', importance: 9 }),
      ],
      NOW,
    );
    for (const item of noVectors) expect(item.factors.relevance).toBeNull();
  });

  it('同分并列按 createdAt 新者先;负 gameMinutes 视作 0 龄下界', () => {
    const [first] = pick3(
      scoreMemories(
        [
          row({ id: 'old-row', importance: 5, createdAt: new Date(1_000) }),
          row({ id: 'new-row', importance: 5, createdAt: new Date(2_000) }),
          row({ id: 'pad', importance: 5, createdAt: new Date(500) }),
        ],
        NOW,
      ),
    );
    expect(first.id).toBe('new-row');
    const ancient = scoreMemories([row({ id: 'a', gameMinutes: null })], NOW)[0]!;
    expect(ancient.factors.recency).toBe(0.5); // 单行退化
  });
});

// 集成:写入→检索闭环(连 dev compose 的 postgres;库不可达时整组跳过)
const WORLD_ID = '00000000-0000-4000-8000-00000000a301';
const CHAR_ID = '00000000-0000-4000-8000-00000000a302';

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

/** 解构辅助:noUncheckedIndexedAccess 下排序结果取前三(不足即测试夹具错误) */
function pick3(items: ScoredMemory[]): [ScoredMemory, ScoredMemory, ScoredMemory] {
  if (items.length < 3) throw new Error(`断言需要 3 条结果,实际 ${items.length}`);
  return [items[0]!, items[1]!, items[2]!];
}

/** 单位向量:第 i 维为 1(2048 维,与 embedding 槽维度绑定) */
function unitVector(i: number): number[] {
  return new Array(2048).fill(0).map((_, dim) => (dim === i ? 1 : 0));
}

async function insertMemory(overrides: {
  id: string;
  content: string;
  importance: number;
  gameMinutes: number;
  embedding: number[];
  createdAt: Date;
}): Promise<void> {
  await handle.db.insert(memories).values({
    characterId: CHAR_ID,
    type: 'event',
    ...overrides,
  });
}

describe.skipIf(!dbUp)('retrieveMemories(写入→检索闭环)', () => {
  beforeAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.db
      .insert(worlds)
      .values({ id: WORLD_ID, name: 'vitest-检索镇', status: 'active', config: {} })
      .onConflictDoNothing();
    await handle.db.insert(characters).values({
      id: CHAR_ID,
      worldId: WORLD_ID,
      tier: 'resident',
      name: '检索员',
      gender: 'male',
      persona: {},
      position: { x: 0, y: 0 },
      stats: {},
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000a311',
      content: '我学习了 60 分钟',
      importance: 5,
      gameMinutes: NOW,
      embedding: unitVector(0), // 与 query 同向 → relevance 最强
      createdAt: new Date(1_000),
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000a312',
      content: '我做完了一份清扫的活计',
      importance: 10,
      gameMinutes: NOW - 600,
      embedding: unitVector(1), // 与 query 正交
      createdAt: new Date(2_000),
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000a313',
      content: '我倒下了,等待救治',
      importance: 1,
      gameMinutes: NOW - 6_000,
      embedding: unitVector(0).map((v) => -v), // 与 query 反向
      createdAt: new Date(3_000),
    });
    await insertMemory({
      id: '00000000-0000-4000-8000-00000000a314',
      content: '无向量旧记忆',
      importance: 3,
      gameMinutes: NOW - 60,
      embedding: unitVector(0),
      createdAt: new Date(4_000),
    });
  }, 30_000);

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.client.end();
  });

  it('query 同向记忆登顶,三因子明细齐备;limit 截断', async () => {
    const top = await retrieveMemories(handle, {
      characterId: CHAR_ID,
      currentGameMinutes: NOW,
      queryVector: unitVector(0),
      limit: 2,
    });
    expect(top).toHaveLength(2);
    expect(top[0]!.id).toBe('00000000-0000-4000-8000-00000000a311');
    expect(top[0]!.factors.relevance).toBe(1);
    expect(top[1]!.id).toBe('00000000-0000-4000-8000-00000000a312');

    const all = await retrieveMemories(handle, {
      characterId: CHAR_ID,
      currentGameMinutes: NOW,
      queryVector: unitVector(0),
    });
    expect(all.map((m) => m.id)).toEqual([
      '00000000-0000-4000-8000-00000000a311',
      '00000000-0000-4000-8000-00000000a312',
      '00000000-0000-4000-8000-00000000a314',
      '00000000-0000-4000-8000-00000000a313', // 反向+低重要度+最旧 沉底
    ]);
  });

  it('无 query 退化为 recency+importance 双因子,高重要度记忆登顶', async () => {
    const ranked = await retrieveMemories(handle, {
      characterId: CHAR_ID,
      currentGameMinutes: NOW,
    });
    // 清扫 importance 10(归一化 1)压过最新但中庸的学习(0.444)
    expect(ranked.map((m) => m.id)).toEqual([
      '00000000-0000-4000-8000-00000000a312',
      '00000000-0000-4000-8000-00000000a311',
      '00000000-0000-4000-8000-00000000a314',
      '00000000-0000-4000-8000-00000000a313',
    ]);
    for (const item of ranked) expect(item.factors.relevance).toBeNull();
  });
});
