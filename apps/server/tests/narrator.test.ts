import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NarrativeHistoryEntry, SelfNarrative, WorldEvent } from '@sims/shared';
import { Narrator } from '../src/agents/narrator.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { MemoryWriter } from '../src/agents/memory-writer.js';
import { setupIntegrationDb } from './helpers/integration.js';
import { characters, memories, worlds } from '../src/db/schema/index.js';
import { Simulation } from '../src/world/simulation.js';

const { handle, up: dbUp } = await setupIntegrationDb();

const WORLD_ID = '00000000-0000-4000-8000-00000000a306';
const CHAR_A = '00000000-0000-4000-8000-00000000a307';
const PARTNER_B = '00000000-0000-4000-8000-00000000a308';

/** 周级间隔(7 游戏日)阈值之上的「已到期」推进量,不依赖 BALANCE 具体值 */
const AGED = 20_000;

interface RecordedChat {
  slot: string;
  messages: Array<{ role: string; content: string }>;
  taskType?: string;
}

function stubLlm(replies: Array<string | Error>): { llm: MemoryLlm; chats: RecordedChat[] } {
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

function buildSim(): Simulation {
  const sim = new Simulation();
  sim.characters.set(CHAR_A, { name: '阿泽' } as never);
  sim.characters.set(PARTNER_B, { name: '苏晚' } as never);
  sim.clock.advance(1320);
  return sim;
}

function harness(sim: Simulation, replies: Array<string | Error>) {
  const { llm, chats } = stubLlm(replies);
  const writer = new MemoryWriter(sim, handle, llm);
  const narrator = new Narrator(sim, handle, llm, writer);
  return {
    chats,
    dispose: () => {
      narrator.dispose();
      writer.dispose();
    },
  };
}

async function personaOf(id: string = CHAR_A): Promise<Record<string, unknown>> {
  const rows = await handle.db
    .select({ persona: characters.persona })
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);
  return (rows[0]?.persona ?? {}) as Record<string, unknown>;
}

async function setPersona(id: string, persona: Record<string, unknown>): Promise<void> {
  await handle.db.update(characters).set({ persona }).where(eq(characters.id, id));
}

async function narrativeOf(id: string = CHAR_A): Promise<SelfNarrative | null> {
  const value = (await personaOf(id)).selfNarrative;
  return value === undefined || value === null ? null : (value as SelfNarrative);
}

async function insertInsight(content: string, gameMinutes: number, importance = 7): Promise<void> {
  await handle.db.insert(memories).values({
    characterId: CHAR_A,
    type: 'insight',
    content,
    importance,
    gameMinutes,
    consolidatedAt: null,
  });
}

async function insightRows(): Promise<string[]> {
  const rows = await handle.db
    .select({ content: memories.content })
    .from(memories)
    .where(eq(memories.characterId, CHAR_A));
  return rows.map((r) => r.content);
}

async function until(cond: () => Promise<boolean>, ms = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!(await cond())) {
    if (Date.now() - startedAt > ms) throw new Error('narrator 等待超时');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!dbUp)('Narrator(C5 自我叙事演化)', () => {
  beforeAll(async () => {
    if (!dbUp) return;
    await handle.db
      .insert(worlds)
      .values({ id: WORLD_ID, name: 'vitest-叙事镇', status: 'active', config: {} })
      .onConflictDoNothing();
    for (const [id, name, gender] of [
      [CHAR_A, '阿泽', 'male'],
      [PARTNER_B, '苏晚', 'female'],
    ] as const) {
      await handle.db
        .insert(characters)
        .values({
          id,
          worldId: WORLD_ID,
          tier: 'resident',
          name,
          gender,
          persona: {},
          position: { x: 0, y: 0 },
          stats: {},
        })
        .onConflictDoNothing();
    }
  });

  beforeEach(async () => {
    await handle.db.delete(memories).where(eq(memories.characterId, CHAR_A));
    await setPersona(CHAR_A, {});
    await setPersona(PARTNER_B, {});
  });

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.db.delete(characters).where(eq(characters.id, PARTNER_B));
    await handle.db.delete(characters).where(eq(characters.id, CHAR_A));
    await handle.client.end();
  });

  it('未初始化: settled 事件以 bio 兜底建 v1,不烧模型', async () => {
    const sim = buildSim();
    await setPersona(CHAR_A, { bio: '我是个木匠' });
    const h = harness(sim, []);
    sim.events.emit({
      type: 'sleep.settled',
      characterId: CHAR_A,
      sleptMinutes: 480,
      gameMinutes: sim.clock.gameMinutes,
      tick: 1,
    } satisfies WorldEvent);
    await until(async () => (await narrativeOf()) !== null);
    expect(await narrativeOf()).toMatchObject({ text: '我是个木匠', version: 1, traits: [] });
    expect(h.chats).toHaveLength(0);
    h.dispose();
  });

  it('周级修订: 到期+有素材→慢槽改版,旧版入史+写「我对自己的看法变了」insight', async () => {
    const sim = buildSim();
    const now = sim.clock.gameMinutes;
    await setPersona(CHAR_A, {
      selfNarrative: {
        text: '我刚来到小镇',
        traits: ['迷茫'],
        version: 1,
        updatedAtGameMinutes: now - AGED,
      },
    });
    await insertInsight('我发现钓鱼让我平静', now - 100);
    const h = harness(sim, [
      JSON.stringify({
        text: '我是个爱钓鱼的木匠,开始在意身边的人',
        traits: ['手巧', '沉稳'],
        change: '我发现了钓鱼的乐趣',
      }),
    ]);
    sim.events.emit({
      type: 'sleep.settled',
      characterId: CHAR_A,
      sleptMinutes: 480,
      gameMinutes: now,
      tick: 1,
    } satisfies WorldEvent);
    await until(async () => (await narrativeOf())?.version === 2);
    await until(async () =>
      (await insightRows()).some((c) => c.startsWith('我对自己的看法变了')),
    );
    expect(await narrativeOf()).toMatchObject({
      text: '我是个爱钓鱼的木匠,开始在意身边的人',
      version: 2,
    });
    const history = (await personaOf()).narrativeHistory as NarrativeHistoryEntry[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      text: '我刚来到小镇',
      version: 1,
      archivedAtGameMinutes: now - AGED,
    });
    expect(h.chats).toHaveLength(1);
    expect(h.chats[0]).toMatchObject({ slot: 'slow', taskType: 'agent.narrative_evolve' });
    const user = h.chats[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(user).toContain('我发现钓鱼让我平静');
    const insight = (await insightRows()).find((c) => c.startsWith('我对自己的看法变了'));
    expect(insight).toContain('我发现了钓鱼的乐趣');
    h.dispose();
  });

  it('周级未到期: 不修订不烧模型', async () => {
    const sim = buildSim();
    await setPersona(CHAR_A, {
      selfNarrative: {
        text: '刚安顿下来',
        traits: [],
        version: 1,
        updatedAtGameMinutes: sim.clock.gameMinutes,
      },
    });
    await insertInsight('有素材也不行', sim.clock.gameMinutes - 10);
    const h = harness(sim, []);
    sim.events.emit({
      type: 'sleep.settled',
      characterId: CHAR_A,
      sleptMinutes: 480,
      gameMinutes: sim.clock.gameMinutes,
      tick: 1,
    } satisfies WorldEvent);
    await sleep(200);
    expect(h.chats).toHaveLength(0);
    expect((await narrativeOf())?.version).toBe(1);
    h.dispose();
  });

  it('无素材不修订(防漂移): 到期但近 7 日无 insights/relations', async () => {
    const sim = buildSim();
    await setPersona(CHAR_A, {
      selfNarrative: {
        text: '独居的日子',
        traits: [],
        version: 1,
        updatedAtGameMinutes: sim.clock.gameMinutes - AGED,
      },
    });
    const h = harness(sim, []);
    sim.events.emit({
      type: 'sleep.settled',
      characterId: CHAR_A,
      sleptMinutes: 480,
      gameMinutes: sim.clock.gameMinutes,
      tick: 1,
    } satisfies WorldEvent);
    await sleep(200);
    expect(h.chats).toHaveLength(0);
    expect((await narrativeOf())?.version).toBe(1);
    h.dispose();
  });

  it('里程碑 first_rescued: 台账去重+立即修订(不受周级闸),change 带起因', async () => {
    const sim = buildSim();
    await setPersona(CHAR_A, {
      selfNarrative: {
        text: '谁也不认识我',
        traits: [],
        version: 1,
        updatedAtGameMinutes: sim.clock.gameMinutes,
      },
    });
    await insertInsight('镇上的人扶了我一把', sim.clock.gameMinutes - 10);
    const h = harness(sim, [
      JSON.stringify({
        text: '我开始相信这座小镇有人在意我',
        traits: ['感恩'],
        change: '被人救了一命',
      }),
    ]);
    sim.events.emit({
      type: 'character.revived',
      characterId: CHAR_A,
      tick: 1,
    } satisfies WorldEvent);
    await until(async () => (await narrativeOf())?.version === 2);
    await until(async () =>
      (await insightRows()).some((c) => c.startsWith('我对自己的看法变了')),
    );
    expect(((await personaOf()).milestones as string[])).toEqual(['first_rescued']);
    const insight = (await insightRows()).find((c) => c.startsWith('我对自己的看法变了'));
    expect(insight).toContain('起因: 我第一次倒下被人救了回来');
    sim.events.emit({
      type: 'character.revived',
      characterId: CHAR_A,
      tick: 2,
    } satisfies WorldEvent);
    await sleep(150);
    expect(h.chats).toHaveLength(1); // 台账去重: 二次 revived 不再修订
    h.dispose();
  });

  it('缺觉里程碑: debt 顺带累加 sleepDebtCount,满 3 触发 sleep_debt_3 修订', async () => {
    const sim = buildSim();
    await setPersona(CHAR_A, {
      selfNarrative: {
        text: '熬夜是家常便饭',
        traits: [],
        version: 1,
        updatedAtGameMinutes: sim.clock.gameMinutes,
      },
    });
    await insertInsight('我又垮了一天', sim.clock.gameMinutes - 10);
    const h = harness(sim, [
      JSON.stringify({
        text: '我把睡觉当正经事来办',
        traits: ['惜命'],
        change: '连垮三次之后',
      }),
    ]);
    const emitDebt = (): void => {
      sim.events.emit({
        type: 'sleep.debt_applied',
        characterId: CHAR_A,
        sleptMinutes: 100,
        tick: 1,
      } satisfies WorldEvent);
    };
    emitDebt();
    await until(async () => ((await personaOf()).sleepDebtCount as number) === 1);
    emitDebt();
    await until(async () => ((await personaOf()).sleepDebtCount as number) === 2);
    emitDebt();
    await until(async () =>
      ((await personaOf()).milestones as string[] | undefined)?.includes('sleep_debt_3') === true,
    );
    expect(((await personaOf()).sleepDebtCount as number)).toBe(3);
    await until(async () => (await narrativeOf())?.version === 2);
    const insight = (await insightRows()).find((c) => c.startsWith('我对自己的看法变了'));
    expect(insight).toContain('起因: 我接连缺觉垮了三次');
    h.dispose();
  });

  it('friendship.formed: 双方各自入账 first_friend', async () => {
    const sim = buildSim();
    const h = harness(sim, []);
    sim.events.emit({
      type: 'friendship.formed',
      aId: CHAR_A,
      bId: PARTNER_B,
      tick: 1,
      title: '初识',
    } satisfies WorldEvent);
    await until(async () => {
      const a = ((await personaOf(CHAR_A)).milestones as string[] | undefined) ?? [];
      const b = ((await personaOf(PARTNER_B)).milestones as string[] | undefined) ?? [];
      return a.includes('first_friend') && b.includes('first_friend');
    });
    h.dispose();
  });
});
