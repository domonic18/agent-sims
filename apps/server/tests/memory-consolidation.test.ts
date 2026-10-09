import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { characterImpressions, characters, memories, worlds } from '../src/db/schema/index.js';
import { MemoryConsolidator } from '../src/agents/memory-consolidation.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { MemoryWriter } from '../src/agents/memory-writer.js';
import { Simulation } from '../src/world/simulation.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate+seed);库不可达时整组跳过
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

const WORLD_ID = '00000000-0000-4000-8000-00000000a301';
// 单一 id 贯穿:sim 角色 key 与 characters 表主键共用同一 uuid
const CHAR_A = '00000000-0000-4000-8000-00000000a302';
/** 互动对象(关系印象 upsert 需真实外键行) */
const PARTNER_B = '00000000-0000-4000-8000-00000000a303';

/** 结算推进量:第 2 日 06:00(gameMinutes=纪元 480+1320=1800),清醒日窗口 [-1440, 0) 相对结算点 */
const SETTLED_ADVANCE = 1320;

interface RecordedChat {
  slot: string;
  messages: Array<{ role: string; content: string }>;
  taskType?: string;
}

function dreamLlm(replies: Array<string | Error>): { llm: MemoryLlm; chats: RecordedChat[] } {
  const queue = [...replies];
  const chats: RecordedChat[] = [];
  const llm: MemoryLlm = {
    systemOne: () => Promise.reject(new Error('unused')) as never,
    embed: async () => ({ vector: new Array(2048).fill(0.01), promptTokens: 3 }),
    // 桩语义=replies 即模型要提交的工具入参(JSON 串);非 JSON 字符串原样交 parse 判定(垃圾输出场景)
    chatStructured: (slot, messages, _tool, options, parse) => {
      chats.push({
        slot: String(slot),
        messages: messages as Array<{ role: string; content: string }>,
        taskType: options?.taskType,
      });
      const next = queue.shift();
      if (next === undefined || next instanceof Error) return Promise.reject(new Error('桩耗尽'));
      let raw: unknown;
      try {
        raw = JSON.parse(next);
      } catch {
        raw = next;
      }
      const parsed = parse(raw);
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
    chat: () => Promise.reject(new Error('unused')) as never,
  };
  return { llm, chats };
}

function buildSim(): { sim: Simulation; settledAt: number } {
  const sim = new Simulation();
  sim.characters.set(CHAR_A, { name: '阿泽' } as never);
  sim.clock.advance(SETTLED_ADVANCE);
  return { sim, settledAt: sim.clock.gameMinutes }; // 事件载荷=结算时真实时钟(生产语义)
}

function emitSettled(sim: Simulation, settledAt: number, sleptMinutes = 480): void {
  const event: WorldEvent = {
    type: 'sleep.settled',
    characterId: CHAR_A,
    sleptMinutes,
    gameMinutes: settledAt,
    tick: 1,
  };
  sim.events.emit(event);
}

async function insertMemory(
  content: string,
  gameMinutes: number,
  opts: { consolidated?: boolean; importance?: number } = {},
): Promise<void> {
  await handle.db.insert(memories).values({
    characterId: CHAR_A,
    type: 'event',
    content,
    importance: opts.importance ?? 5,
    gameMinutes,
    consolidatedAt: opts.consolidated === true ? new Date() : null,
  });
}

async function allRows() {
  return handle.db.select().from(memories).where(eq(memories.characterId, CHAR_A));
}

async function dreamRows() {
  const rows = await allRows();
  return rows.filter((row) => row.type === 'dream');
}

async function unconsolidatedCount(): Promise<number> {
  const rows = await handle.db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.characterId, CHAR_A), isNull(memories.consolidatedAt)));
  return rows.length;
}

async function until(cond: () => Promise<boolean>, ms = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!(await cond())) {
    if (Date.now() - startedAt > ms) throw new Error('memory-consolidation 等待超时');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!dbUp)('MemoryConsolidator(M5 梦境固化)', () => {
  beforeAll(async () => {
    if (!dbUp) return;
    await handle.db
      .insert(worlds)
      .values({ id: WORLD_ID, name: 'vitest-梦镇', status: 'active', config: {} })
      .onConflictDoNothing();
    await handle.db
      .insert(characters)
      .values({
        id: CHAR_A,
        worldId: WORLD_ID,
        tier: 'resident',
        name: '阿泽',
        gender: 'male',
        persona: {},
        position: { x: 0, y: 0 },
        stats: {},
      })
      .onConflictDoNothing();
    await handle.db
      .insert(characters)
      .values({
        id: PARTNER_B,
        worldId: WORLD_ID,
        tier: 'resident',
        name: '苏晚',
        gender: 'female',
        persona: {},
        position: { x: 1, y: 1 },
        stats: {},
      })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    await handle.db.delete(memories).where(eq(memories.characterId, CHAR_A));
    await handle.db.delete(characterImpressions).where(eq(characterImpressions.characterId, CHAR_A));
  });

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.db.delete(characters).where(eq(characters.id, PARTNER_B));
    await handle.db.delete(characters).where(eq(characters.id, CHAR_A));
    await handle.client.end();
  });

  it('闭环: 睡饱→慢槽产 dream+insight+relation 落库,源记忆打 consolidatedAt,产物即标记(单向爬梯)', async () => {
    const { sim, settledAt } = buildSim();
    sim.characters.set(PARTNER_B, { name: '苏晚' } as never); // 互动对象入世界角色表(白名单前提)
    await insertMemory('我在河边钓到一条大鲤鱼', settledAt - 900, { importance: 8 });
    await insertMemory('我在市场买了种子', settledAt - 800);
    await insertMemory('我和苏晚聊了菜价', settledAt - 600, { importance: 6 });
    await insertMemory('远古记忆不入梦', settledAt - 1700); // 窗口外
    await insertMemory('已固化记忆不再入梦', settledAt - 700, { consolidated: true });
    const { llm, chats } = dreamLlm([
      JSON.stringify({
        dreams: [
          { content: '我梦见鲤鱼跃出结冰的河面', importance: 9 },
          { content: '梦里市场空无一人', importance: 4 },
        ],
        insights: [
          { content: '耐心等待就有收获', importance: 7, sources: ['我在河边钓到一条大鲤鱼'] },
        ],
        relations: [{ about: '苏晚', content: '聊得来的邻居,可以亲近' }],
      }),
    ]);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt);
    await until(async () => (await dreamRows()).length === 2);

    const dreams = await dreamRows();
    expect(dreams.map((d) => d.content).sort()).toEqual([
      '我梦见鲤鱼跃出结冰的河面',
      '梦里市场空无一人',
    ]);
    expect(dreams.every((d) => d.gameMinutes === settledAt)).toBe(true); // persist 盖戳=结算时刻
    expect(dreams.map((d) => d.importance).sort()).toEqual([4, 9]); // importance 由慢思考给定
    expect(dreams.every((d) => d.consolidatedAt !== null)).toBe(true); // 产物即标记,不进次夜源池

    expect(chats).toHaveLength(1);
    expect(chats[0]!.slot).toBe('slow');
    expect(chats[0]!.taskType).toBe('agent.dream');
    const system = chats[0]!.messages[0]!.content;
    expect(system).toContain('阿泽'); // 角色名入 system
    const user = chats[0]!.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('我在河边钓到一条大鲤鱼');
    expect(user).toContain('[重要度 8]');
    expect(user).toContain('苏晚'); // 互动者白名单入 prompt
    expect(user).not.toContain('远古记忆不入梦'); // 窗口外排除
    expect(user).not.toContain('已固化记忆不再入梦'); // 已固化排除

    // insight 落库带溯源链(指向鲤鱼记忆 id)且即标记
    const rows = await allRows();
    const insight = rows.find((r) => r.type === 'insight');
    expect(insight?.content).toBe('耐心等待就有收获');
    expect(insight?.consolidatedAt).not.toBeNull();
    const sourceRow = rows.find((r) => r.id === (insight?.sourceIds ?? [])[0]);
    expect(sourceRow?.content).toBe('我在河边钓到一条大鲤鱼');

    // relation 定点写入 impressions(外键真实存在)
    const impressions = await handle.db
      .select()
      .from(characterImpressions)
      .where(eq(characterImpressions.characterId, CHAR_A));
    expect(impressions).toHaveLength(1);
    expect(impressions[0]!.aboutId).toBe(PARTNER_B);
    expect(impressions[0]!.content).toBe('聊得来的邻居,可以亲近');

    // 3 条当日源全部标记固化,产物亦标记;未固化的只剩窗口外 1 条
    await until(async () => (await unconsolidatedCount()) === 1);
    const leftover = await handle.db
      .select({ content: memories.content })
      .from(memories)
      .where(and(eq(memories.characterId, CHAR_A), isNull(memories.consolidatedAt)));
    expect(leftover.map((r) => r.content)).toEqual(['远古记忆不入梦']);
    consolidator.dispose();
    writer.dispose();
  });

  it('没睡饱(sleptMinutes<240): 不触发固化', async () => {
    const { sim, settledAt } = buildSim();
    await insertMemory('只配存进记忆', settledAt - 900);
    const { llm, chats } = dreamLlm([JSON.stringify([{ content: 'x', importance: 5 }])]);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt, 100);
    await sleep(200);
    expect(chats).toHaveLength(0);
    expect(await dreamRows()).toHaveLength(0);
    expect(await unconsolidatedCount()).toBe(1); // 源记忆原样
    consolidator.dispose();
    writer.dispose();
  });

  it('当日无未固化记忆: 不调 LLM 直接返回', async () => {
    const { sim, settledAt } = buildSim();
    const { llm, chats } = dreamLlm([JSON.stringify([{ content: 'x', importance: 5 }])]);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt);
    await sleep(200);
    expect(chats).toHaveLength(0);
    expect(await dreamRows()).toHaveLength(0);
    consolidator.dispose();
    writer.dispose();
  });

  it('慢槽失败: 静默无 dream,源记忆不标记(次夜重试)', async () => {
    const { sim, settledAt } = buildSim();
    await insertMemory('失败夜的见证', settledAt - 900);
    const { llm, chats } = dreamLlm([new Error('slow 挂了')]);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt);
    await sleep(200);
    expect(chats).toHaveLength(1);
    expect(await dreamRows()).toHaveLength(0);
    expect(await unconsolidatedCount()).toBe(1);
    consolidator.dispose();
    writer.dispose();
  });

  it('垃圾输出(非 JSON): 静默无 dream,源记忆不标记', async () => {
    const { sim, settledAt } = buildSim();
    await insertMemory('无梦之夜', settledAt - 900);
    const { llm, chats } = dreamLlm(['昨夜什么都没有梦见。']);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt);
    await sleep(200);
    expect(chats).toHaveLength(1);
    expect(await dreamRows()).toHaveLength(0);
    expect(await unconsolidatedCount()).toBe(1);
    consolidator.dispose();
    writer.dispose();
  });

  it('条目上限: 慢槽回 4 条只取前 3 条', async () => {
    const { sim, settledAt } = buildSim();
    await insertMemory('素材一', settledAt - 900);
    const { llm } = dreamLlm([
      JSON.stringify({
        dreams: [
          { content: '梦一', importance: 5 },
          { content: '梦二', importance: 6 },
          { content: '梦三', importance: 7 },
          { content: '梦四', importance: 8 },
        ],
      }),
    ]);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt);
    await until(async () => (await dreamRows()).length === 3);
    const contents = (await dreamRows()).map((d) => d.content).sort();
    expect(contents).toEqual(['梦一', '梦三', '梦二']);
    consolidator.dispose();
    writer.dispose();
  });

  it('非法条目剔除: 缺 content/importance 的行跳过,合法行照产', async () => {
    const { sim, settledAt } = buildSim();
    await insertMemory('素材二', settledAt - 900);
    const { llm } = dreamLlm([
      JSON.stringify({
        dreams: [
          { content: '   ', importance: 5 },
          { importance: 3 },
          { content: '合法的梦', importance: 99 }, // 钳到 10
        ],
      }),
    ]);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt);
    await until(async () => (await dreamRows()).length === 1);
    const [row] = await dreamRows();
    expect(row.content).toBe('合法的梦');
    expect(row.importance).toBe(10);
    consolidator.dispose();
    writer.dispose();
  });

  it('同角色并发去重: 重复事件只固化一次', async () => {
    const { sim, settledAt } = buildSim();
    await insertMemory('唯一素材', settledAt - 900);
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chats: RecordedChat[] = [];
    const llm: MemoryLlm = {
      systemOne: () => Promise.reject(new Error('unused')) as never,
      embed: async () => ({ vector: new Array(2048).fill(0.01), promptTokens: 3 }),
      chatStructured: async (slot, messages, _tool, options, parse) => {
        chats.push({
          slot: String(slot),
          messages: messages as Array<{ role: string; content: string }>,
          taskType: options?.taskType,
        });
        await gate;
        const parsed = parse({ dreams: [{ content: '迟到的梦', importance: 5 }] });
        if (!parsed.ok) throw new Error(`桩: 校验失败 ${parsed.reason}`);
        return parsed.value;
      },
      chat: () => Promise.reject(new Error('unused')) as never,
    };
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    emitSettled(sim, settledAt);
    emitSettled(sim, settledAt); // 在飞期间重复事件
    release?.();
    await until(async () => (await dreamRows()).length === 1);
    await sleep(100); // 确认第二个事件不再触发
    expect(chats).toHaveLength(1);
    consolidator.dispose();
    writer.dispose();
  });

  it('白天反思: importance 累计越阈触发反射管线(无 dream 段,taskType=agent.reflect)', async () => {
    const { sim } = buildSim();
    const { llm, chats } = dreamLlm([
      JSON.stringify({
        insights: [{ content: '杂事做多了也没什么大不了', importance: 6, sources: ['条目0'] }],
      }),
    ]);
    const writer = new MemoryWriter(sim, handle, llm);
    const consolidator = new MemoryConsolidator(sim, handle, llm, writer);
    // 30 条 × importance 5 = 150,恰触阈值(默认 5 亦为 Jev 打分失败兜底,模拟真实事件流)
    for (let i = 0; i < 30; i += 1) {
      await writer.writeManual(CHAR_A, `条目${i}`, 5);
    }
    await until(async () => chats.length === 1);
    expect(chats[0]!.taskType).toBe('agent.reflect');
    const user = chats[0]!.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('条目'); // 窗口=全部未固化记忆(不限当日)

    const rows = await allRows();
    const insight = rows.find((r) => r.type === 'insight');
    expect(insight?.content).toBe('杂事做多了也没什么大不了');
    expect(insight?.consolidatedAt).not.toBeNull(); // 产物即标记,不进反思源池(单向爬梯)
    expect(await dreamRows()).toHaveLength(0); // 反思不产梦

    await until(async () => (await unconsolidatedCount()) === 14); // top16 源被标记,余 14 条
    consolidator.dispose();
    writer.dispose();
  });
});
