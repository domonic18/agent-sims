import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { setupIntegrationDb } from './helpers/integration.js';
import { characters, memories, worlds } from '../src/db/schema/index.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { MemoryWriter } from '../src/agents/memory-writer.js';
import { Simulation } from '../src/world/simulation.js';

const { handle, up: dbUp } = await setupIntegrationDb();

const WORLD_ID = '00000000-0000-4000-8000-00000000a201';
// 单一 id 贯穿:sim 角色 key 与 characters 表主键共用同一 uuid
const CHAR_A = '00000000-0000-4000-8000-00000000a202';
const CHAR_B = '00000000-0000-4000-8000-00000000a203';

async function insertFixtures(): Promise<void> {
  await handle.db
    .insert(worlds)
    .values({ id: WORLD_ID, name: 'vitest-mem镇', status: 'active', config: {} })
    .onConflictDoNothing();
  await handle.db
    .insert(characters)
    .values([
      {
        id: CHAR_A,
        worldId: WORLD_ID,
        tier: 'resident',
        name: '阿泽',
        gender: 'male',
        persona: {},
        position: { x: 0, y: 0 },
        stats: {},
      },
      {
        id: CHAR_B,
        worldId: WORLD_ID,
        tier: 'resident',
        name: '苏晚',
        gender: 'female',
        persona: {},
        position: { x: 1, y: 1 },
        stats: {},
      },
    ])
    .onConflictDoNothing();
}

async function clearFixtures(): Promise<void> {
  await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
  await handle.db.delete(characters).where(eq(characters.id, CHAR_A));
  await handle.db.delete(characters).where(eq(characters.id, CHAR_B));
}

async function memoryRows(characterId: string) {
  return handle.db.select().from(memories).where(eq(memories.characterId, characterId));
}

async function until(cond: () => Promise<boolean>, ms = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!(await cond())) {
    if (Date.now() - startedAt > ms) throw new Error('memory-writer 等待超时');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function stubLlm(impl: {
  score?: number;
  failScore?: boolean;
  failEmbed?: boolean;
  hangScore?: boolean;
}): { llm: MemoryLlm; scoreCalls: () => number; release: () => void } {
  let scoreCallCount = 0;
  let release: (() => void) | null = null;
  const hung = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    scoreCalls: () => scoreCallCount,
    release: () => release?.(),
    llm: {
      systemOne: async (_slot, _state, _questions, _task) => {
        scoreCallCount += 1;
        if (impl.failScore) throw new Error('stub jev down');
        if (impl.hangScore) {
          await hung;
          throw new Error('stub hung then fail');
        }
        return {
          model: 'stub-jev',
          answers: {
            importance: {
              type: 'score',
              score: impl.score ?? 5,
              legend: {},
              probabilities: {},
              confidence: 1,
            },
          },
          promptTokens: 10,
          completionTokens: 2,
        };
      },
      embed: async () => {
        if (impl.failEmbed) throw new Error('stub embedding down');
        return { vector: new Array(2048).fill(0.01), promptTokens: 7 };
      },
    },
  };
}

function buildSimWithCharacters(): Simulation {
  const sim = new Simulation();
  sim.characters.set(CHAR_A, { name: '阿泽' } as never);
  sim.characters.set(CHAR_B, { name: '苏晚' } as never);
  return sim;
}

describe.skipIf(!dbUp)('MemoryWriter(M4b/A2)', () => {
  beforeAll(async () => {
    if (!dbUp) return;
    await clearFixtures();
    await insertFixtures();
  });

  beforeEach(async () => {
    // 隔离:清掉上一测试在两夹具角色下遗留的记忆行,until 计数才从 0 起算
    await handle.db.delete(memories).where(inArray(memories.characterId, [CHAR_A, CHAR_B]));
  });

  afterAll(async () => {
    if (!dbUp) return;
    await clearFixtures();
    await handle.client.end();
  });

  it('闭环:事件→Jev 打分→向量化→落库(gameMinutes 盖戳)', async () => {
    const sim = buildSimWithCharacters();
    sim.clock.advance(600); // 游戏时间推进(默认起点之上 +600)
    const minutesAtWrite = sim.clock.gameMinutes;
    const { llm, scoreCalls } = stubLlm({ score: 8 });
    const writer = new MemoryWriter(sim, handle, llm);
    const event: WorldEvent = {
      type: 'activity.finished',
      characterId: CHAR_A,
      activityId: 'study',
      tick: 10,
      elapsedMinutes: 60,
      reason: 'completed',
    };
    sim.events.emit(event);
    await until(async () => (await memoryRows(CHAR_A)).length === 1);
    const [row] = await memoryRows(CHAR_A);
    expect(row.type).toBe('event');
    expect(row.characterId).toBe(CHAR_A); // 事件 id 即表主键(单一 id 贯穿)
    expect(row.content).toBe('我学习了 60 分钟');
    expect(row.importance).toBe(9); // score 答案为量表下标 0 起:stub 回 8 → 第 9 档
    expect(row.embedding).toHaveLength(2048);
    expect(row.gameMinutes).toBe(minutesAtWrite);
    expect(scoreCalls()).toBe(1);
    writer.dispose();
  });

  it('双兜底:Jev 挂→中位 5,embedding 挂→空向量,记忆仍落库', async () => {
    const sim = buildSimWithCharacters();
    const { llm } = stubLlm({ failScore: true, failEmbed: true });
    const writer = new MemoryWriter(sim, handle, llm);
    sim.events.emit({
      type: 'craft.completed',
      characterId: CHAR_A,
      recipeId: 'craft_berry_pie',
      tick: 11,
    });
    await until(async () => (await memoryRows(CHAR_A)).length === 1);
    const [row] = await memoryRows(CHAR_A);
    expect(row.content).toBe('我做成了一批浆果派');
    expect(row.importance).toBe(5);
    expect(row.embedding).toBeNull();
    writer.dispose();
  });

  it('对话/结交/工作/死亡/白名单:模板与类型正确,控制事件不入记忆', async () => {
    const sim = buildSimWithCharacters();
    const { llm } = stubLlm({ score: 6 });
    const writer = new MemoryWriter(sim, handle, llm);
    sim.events.emit({
      type: 'social.chat',
      fromId: CHAR_A,
      toId: CHAR_B,
      tick: 12,
      content: '今天菜价真贵',
      affinityDelta: 0.2,
    });
    sim.events.emit({ type: 'world.control', action: 'pause', tick: 13 } as WorldEvent);
    sim.events.emit({ type: 'work_task.completed', characterId: CHAR_B, targetId: 't1', task: 'clean', pay: 12, tick: 14 });
    sim.events.emit({ type: 'friendship.formed', aId: CHAR_A, bId: CHAR_B, tick: 15, title: '朋友' });
    sim.events.emit({ type: 'character.died', characterId: CHAR_B, tick: 16, revivable: true });
    await until(async () => (await memoryRows(CHAR_A)).length === 2);
    await until(async () => (await memoryRows(CHAR_B)).length === 2);
    const aRows = await memoryRows(CHAR_A);
    const chat = aRows.find((row) => row.type === 'dialogue');
    expect(chat?.content).toBe('我和苏晚聊了聊:今天菜价真贵');
    expect(aRows.find((row) => row.content === '我和苏晚结成了朋友')).toBeDefined();
    const bRows = await memoryRows(CHAR_B);
    expect(bRows.find((row) => row.content.includes('清扫') && row.content.includes('12 金币'))).toBeDefined();
    expect(bRows.find((row) => row.content === '我倒下了,等待救治')).toBeDefined();
    const total = await handle.db
      .select()
      .from(memories)
      .where(inArray(memories.characterId, [CHAR_A, CHAR_B]));
    expect(total).toHaveLength(4); // world.control 未产生任何记忆;dev 库他处记忆行不计入
    writer.dispose();
  });

  it('护栏:挂起占满 6 条并发管线,第 7 条新事件丢弃,最终落 6 条', async () => {
    const sim = buildSimWithCharacters();
    const { llm, release } = stubLlm({ hangScore: true });
    const writer = new MemoryWriter(sim, handle, llm);
    for (let i = 0; i < 7; i += 1) {
      sim.events.emit({
        type: 'craft.completed',
        characterId: CHAR_A,
        recipeId: 'craft_berry_pie',
        tick: 20 + i,
      });
    }
    release();
    await until(async () => (await memoryRows(CHAR_A)).length === 6, 5000);
    await new Promise((resolve) => setTimeout(resolve, 100)); // 确认不再增长
    expect((await memoryRows(CHAR_A)).length).toBe(6);
    writer.dispose();
  });

  it('直写 type 参数(M5): dream 类型透传落库,importance 调用方给定', async () => {
    const sim = buildSimWithCharacters();
    const { llm } = stubLlm({});
    const writer = new MemoryWriter(sim, handle, llm);
    await writer.writeManual(CHAR_A, '我梦见河边结了冰,鱼在冰下游', 7, 'dream');
    const [row] = await memoryRows(CHAR_A);
    expect(row.type).toBe('dream');
    expect(row.importance).toBe(7);
    expect(row.embedding).toHaveLength(2048); // 走同一条 persist 管线
    writer.dispose();
  });
});
