import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { setupIntegrationDb } from './helpers/integration.js';
import { characters, dialogues, memories, worlds } from '../src/db/schema/index.js';
import { hosting, innerState } from '../src/agents/cognition.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { MemoryWriter } from '../src/agents/memory-writer.js';
import { attachWorldEventLog } from '../src/world/event-log.js';
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
        persona: { card: { 性格: '安静', 兴趣: '读书' } },
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
  failChat?: boolean;
  chatSentence?: string;
}): {
  llm: MemoryLlm;
  scoreCalls: () => number;
  chatCalls: () => number;
  questions: () => string[];
  release: () => void;
} {
  let scoreCallCount = 0;
  let chatCallCount = 0;
  const questionLog: string[] = [];
  let release: (() => void) | null = null;
  const hung = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    scoreCalls: () => scoreCallCount,
    chatCalls: () => chatCallCount,
    questions: () => questionLog,
    release: () => release?.(),
    llm: {
      systemOne: async (_slot, state, _questions, _task) => {
        scoreCallCount += 1;
        questionLog.push(state);
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
      chat: async () => {
        chatCallCount += 1;
        if (impl.failChat) throw new Error('stub light down');
        return { content: impl.chatSentence ?? '风都变甜了', promptTokens: 5, completionTokens: 3 };
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

  afterEach(() => {
    // D4 脑状态注册表是模块级单例,测试间必须清场
    hosting.delete(CHAR_A);
    hosting.delete(CHAR_B);
    innerState.clear(CHAR_A);
    innerState.clear(CHAR_B);
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
    expect(row.content.startsWith('我学习了 60 分钟。')).toBe(true); // 事实行+第一人称评价句(D4)
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
    // chat 与结交同为 dialogue 类型,管线并发完成顺序不定,按正文定位
    const chat = aRows.find((row) => row.content.includes('聊了聊'));
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

  it('背压(D5):并发 6 条挂起时新事件排队不丢弃,放行后全部落库', async () => {
    const sim = buildSimWithCharacters();
    const { llm, release } = stubLlm({ hangScore: true });
    const writer = new MemoryWriter(sim, handle, llm);
    for (let i = 0; i < 10; i += 1) {
      sim.events.emit({
        type: 'craft.completed',
        characterId: CHAR_A,
        recipeId: 'craft_berry_pie',
        tick: 20 + i,
      });
    }
    expect((await memoryRows(CHAR_A)).length).toBe(0); // 6 在途+4 排队,无丢弃
    release();
    await until(async () => (await memoryRows(CHAR_A)).length === 10, 5000);
    writer.dispose();
  });

  it('背压上限:并发 6+排队 24 共 30 条,第 31 条丢弃', async () => {
    const sim = buildSimWithCharacters();
    const { llm, release } = stubLlm({ hangScore: true });
    const writer = new MemoryWriter(sim, handle, llm);
    for (let i = 0; i < 31; i += 1) {
      sim.events.emit({
        type: 'craft.completed',
        characterId: CHAR_A,
        recipeId: 'craft_berry_pie',
        tick: 30 + i,
      });
    }
    release();
    await until(async () => (await memoryRows(CHAR_A)).length === 30, 10000);
    await new Promise((resolve) => setTimeout(resolve, 100)); // 确认不再增长
    expect((await memoryRows(CHAR_A)).length).toBe(30);
    writer.dispose();
  });

  it('D5 social.chat 经事件落库订阅补写 dialogues(此前表无写入方)', async () => {
    const sim = buildSimWithCharacters();
    const eventLog = attachWorldEventLog(handle, sim.events);
    try {
      sim.events.emit({
        type: 'social.chat',
        fromId: CHAR_A,
        toId: CHAR_B,
        tick: 60,
        content: '「今儿天真好」「是啊」',
        affinityDelta: 0.1,
      });
      await until(async () => {
        const rows = await handle.db.select().from(dialogues).where(eq(dialogues.speakerId, CHAR_A));
        return rows.length >= 1;
      });
      const [row] = await handle.db.select().from(dialogues).where(eq(dialogues.speakerId, CHAR_A));
      expect(row?.listenerId).toBe(CHAR_B);
      expect(row?.content).toBe('「今儿天真好」「是啊」');
    } finally {
      eventLog.dispose();
      await handle.db.delete(dialogues).where(eq(dialogues.speakerId, CHAR_A));
    }
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

  it('D4 重要活动(高偏好)触发轻槽复盘: LLM 句替换模板,lastEvaluation 同步落脑状态', async () => {
    const sim = buildSimWithCharacters();
    hosting.set(CHAR_A, { mode: 'policy', policyText: null, compiled: { focus: ['study'], avoid: [] } });
    const { llm, chatCalls, scoreCalls } = stubLlm({ score: 6, chatSentence: '风都变甜了' });
    const writer = new MemoryWriter(sim, handle, llm);
    sim.events.emit({
      type: 'activity.finished',
      characterId: CHAR_A,
      activityId: 'study',
      tick: 30,
      elapsedMinutes: 60,
      reason: 'completed',
    });
    await until(async () => (await memoryRows(CHAR_A)).length === 1);
    const [row] = await memoryRows(CHAR_A);
    expect(row.content).toBe('我学习了 60 分钟。风都变甜了');
    expect(chatCalls()).toBe(1); // 轻槽恰好一次
    expect(scoreCalls()).toBe(1); // jev 打分照常
    const evaluation = innerState.get(CHAR_A)?.lastEvaluation;
    expect(evaluation?.activityId).toBe('study');
    expect(evaluation?.verdict).toBe('good');
    // lastEvaluation 在事件结算时写确定性评价;轻槽 LLM 句只进记忆正文(上一断言)
    expect(evaluation?.reason).toContain('正合我的心意');
    writer.dispose();
  });

  it('D4 轻槽失败回模板评价句: 记忆仍落库不外抛', async () => {
    const sim = buildSimWithCharacters();
    hosting.set(CHAR_A, { mode: 'policy', policyText: null, compiled: { focus: ['study'], avoid: [] } });
    const { llm, chatCalls } = stubLlm({ failChat: true });
    const writer = new MemoryWriter(sim, handle, llm);
    sim.events.emit({
      type: 'activity.finished',
      characterId: CHAR_A,
      activityId: 'study',
      tick: 31,
      elapsedMinutes: 60,
      reason: 'completed',
    });
    await until(async () => (await memoryRows(CHAR_A)).length === 1);
    const [row] = await memoryRows(CHAR_A);
    expect(row.content.startsWith('我学习了 60 分钟。')).toBe(true);
    expect(row.content).toContain('正合我的心意'); // 模板句含 bias 后缀
    expect(chatCalls()).toBe(1);
    writer.dispose();
  });

  it('D4 复盘节流: 每角色每日 ≤4 次轻槽,超出回模板', async () => {
    const sim = buildSimWithCharacters();
    hosting.set(CHAR_A, { mode: 'policy', policyText: null, compiled: { focus: ['study'], avoid: [] } });
    const { llm, chatCalls } = stubLlm({ chatSentence: '风都变甜了' });
    const writer = new MemoryWriter(sim, handle, llm);
    for (let i = 0; i < 5; i += 1) {
      sim.events.emit({
        type: 'activity.finished',
        characterId: CHAR_A,
        activityId: 'study',
        tick: 40 + i,
        elapsedMinutes: 60,
        reason: 'completed',
      });
    }
    await until(async () => (await memoryRows(CHAR_A)).length === 5, 5000);
    const rows = await memoryRows(CHAR_A);
    const llmRetrospects = rows.filter((r) => r.content.includes('风都变甜了'));
    expect(llmRetrospects).toHaveLength(4); // 第 5 条回落模板句
    expect(chatCalls()).toBe(4);
    writer.dispose();
  });

  it('D4 persona 进 jev 题面: 人设卡字段拼入经历问句', async () => {
    const sim = buildSimWithCharacters();
    const { llm, questions } = stubLlm({ score: 6 });
    const writer = new MemoryWriter(sim, handle, llm);
    sim.events.emit({
      type: 'work_task.completed',
      characterId: CHAR_B,
      targetId: 't1',
      task: 'clean',
      pay: 12,
      tick: 50,
    });
    await until(async () => (await memoryRows(CHAR_B)).length === 1);
    const question = questions()[0] ?? '';
    expect(question).toContain('居民「苏晚」(人设: 性格: 安静;兴趣: 读书)的一段经历');
    expect(question).toContain('我做完了一份清扫的活计');
    writer.dispose();
  });
});
