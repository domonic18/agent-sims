import { TOWN_MAP } from '@sims/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { autonomy, hosting, innerState } from './cognition.js';
import type { DayIntents } from './cognition.js';
import { INTENT_ACTIVITY_IDS } from './slow-layer.js';
import type { DbHandle } from '../db/client.js';
import type { runIntent } from '../intents/execute.js';
import type { Simulation } from '../world/simulation.js';
import type { CharacterActivity, WorldCharacter } from '../world/character.js';
import type { AgentDecisionMessage } from '@sims/shared';
import type { MemoryLlm } from './memory-writer.js';
import { AgentScheduler, AUTONOMY_CHECK_INTERVAL_MINUTES, JEV_COOLDOWN_MINUTES } from './scheduler.js';

const CHAR_ID = 'char-1';

function char(overrides: Partial<WorldCharacter>): WorldCharacter {
  return {
    id: CHAR_ID,
    name: '阿测',
    x: 30,
    y: 30,
    path: [],
    energy: 80,
    health: 100,
    coins: 50,
    activity: null,
    housing: null,
    alive: true,
    collapsed: false,
    backpack: {},
    fridge: {},
    score: 0,
    knowledge: 0,
    sleepWindowMinutes: 0,
    sleepDebtEndGameMinutes: null,
    traits: {},
    ...overrides,
  } as WorldCharacter;
}

interface Harness {
  scheduler: AgentScheduler;
  clock: { gameMinutes: number };
  onEvent: (event: WorldEvent) => void;
  intents: Array<Record<string, unknown>>;
  bubbles: AgentDecisionMessage[];
  traceRows: Array<Record<string, unknown>>;
  jevCalls: number;
}

/** 相关叙事事件(self 视角强度 4,空闲即放行既有管线)——C3 起 world.reset 等管理面事件不进分级 */
function chatEvent(tick: number): WorldEvent {
  return {
    type: 'social.chat',
    fromId: CHAR_ID,
    toId: 'npc-1',
    tick,
    content: '你好',
    affinityDelta: 0,
  } as WorldEvent;
}

function activity(activityId: string): CharacterActivity {
  return { activityId, elapsed: 0, anchorKind: null, targetId: null };
}

function finishedEvent(tick: number, activityId: string, reason: string): WorldEvent {
  return {
    type: 'activity.finished',
    characterId: CHAR_ID,
    activityId,
    tick,
    elapsedMinutes: 30,
    reason,
  } as WorldEvent;
}

interface HarnessOpts {
  runIntent?: typeof runIntent;
  /** 额外世界角色(died/revived 事件的主体、救援者等,供 positionOf/距离判定) */
  extraCharacters?: WorldCharacter[];
}

function harness(
  startGameMinutes: number,
  worldChar: WorldCharacter,
  llm?: Partial<MemoryLlm>,
  opts?: HarnessOpts,
): Harness {
  // 与 GameClock 同语义的轻量时钟(day/minuteOfDay 由 gameMinutes 派生)
  const clock = {
    gameMinutes: startGameMinutes,
    get day(): number {
      return Math.floor(this.gameMinutes / 1440);
    },
    get minuteOfDay(): number {
      return this.gameMinutes % 1440;
    },
  };
  let eventHandler: ((event: WorldEvent) => void) | null = null;
  const sim = {
    clock,
    map: { definition: TOWN_MAP, activityAnchors: () => [] as Array<never> },
    characters: new Map([
      [worldChar.id, worldChar] as const,
      ...(opts?.extraCharacters ?? []).map((c) => [c.id, c] as const),
    ]),
    socials: new Map(),
    // E1 rule/want 世界查询与 townNeeds 读的世界表(空=无货/无节点/无损耗)
    shopStock: new Map<string, number>(),
    resourceNodes: new Map<string, never>(),
    maintenanceSpots: new Map<string, never>(),
    recipe: () => null,
    events: {
      subscribe: (fn: (event: WorldEvent) => void) => {
        eventHandler = fn;
        return () => {
          eventHandler = null;
        };
      },
    },
  } as unknown as Simulation;
  const intents: Array<Record<string, unknown>> = [];
  const runIntentStub =
    opts?.runIntent ??
    (((simArg: unknown, intent: Record<string, unknown>) => {
      intents.push(intent);
      void simArg;
      return { ok: true, message: 'ok' };
    }) as typeof runIntent);
  const bubbles: AgentDecisionMessage[] = [];
  const traceRows: Array<Record<string, unknown>> = [];
  const handle = {
    db: {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          traceRows.push(v);
          return Promise.resolve();
        },
      }),
      // 内心状态写穿(fire-and-forget):静默成功
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      // 记忆/印象定点查询(dialogue 上下文等):空结果集
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
    },
  } as unknown as DbHandle;
  let jevCalls = 0;
  const llmStub: MemoryLlm = {
    systemOne: () => {
      jevCalls += 1;
      if (llm?.systemOne === undefined) return Promise.reject(new Error('no jev'));
      return llm.systemOne('jev', '', {}, { taskType: 'agent.jev_micro' });
    },
    embed: () => Promise.reject(new Error('unused')),
    chat: (_slot, messages, task) => {
      if (llm?.chat === undefined) return Promise.reject(new Error('no chat'));
      return llm.chat(_slot, messages, task);
    },
    chatStructured: (slot, messages, tool, task, parse) => {
      if (llm?.chatStructured === undefined) return Promise.reject(new Error('no chatStructured'));
      return llm.chatStructured(slot, messages, tool, task, parse);
    },
  };
  const scheduler = new AgentScheduler({
    sim,
    handle,
    llm: llmStub,
    onBubble: (m) => bubbles.push(m),
    runIntent: runIntentStub,
  });
  return {
    scheduler,
    clock,
    onEvent: (event) => eventHandler?.(event),
    intents,
    bubbles,
    traceRows,
    get jevCalls() {
      return jevCalls;
    },
  };
}

describe('AgentScheduler(M4c 认知泵)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autonomy.enable(CHAR_ID);
  });
  afterEach(() => {
    autonomy.disable(CHAR_ID);
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    vi.useRealTimers();
  });

  it('阈值巡检: 饥饿角色 rule react 吃背包食物,气泡+trace 落库', () => {
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    vi.advanceTimersByTime(2_000);
    expect(h.intents).toEqual([{ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' }]);
    expect(h.bubbles).toHaveLength(1);
    expect(h.bubbles[0]!.text).toContain('苹果');
    const react = h.traceRows.find((r) => r.decision !== null && (r.decision as { conclusion?: string }).conclusion === 'react');
    expect(react).toBeDefined();
    expect(react!.triggerType).toBe('threshold');
    expect(react!.characterId).toBe(CHAR_ID);
    h.scheduler.dispose();
  });

  it('同一 15 分块只巡检一次;continue 采样每 20 次记 1 条 trace', () => {
    const h = harness(0, char({}));
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] }); // 屏蔽回落意图,专注巡检节拍
    for (let i = 0; i < 25; i += 1) {
      h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES;
      vi.advanceTimersByTime(2_000);
    }
    expect(h.intents).toHaveLength(0); // 数值健康全程 continue
    expect(h.jevCalls).toBe(0); // 巡检路径不触发 jev
    expect(h.traceRows).toHaveLength(1); // 25 次 continue 采样 1 条
    expect((h.traceRows[0]!.decision as { conclusion: string }).conclusion).toBe('continue');
    h.scheduler.dispose();
  });

  it('事件驱动: 相关叙事事件放行管线,rule react 直接落地不进 jev', () => {
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    h.onEvent({ type: 'work_task.cancelled', characterId: CHAR_ID, targetId: 'spot-1', tick: 1 } as WorldEvent);
    expect(h.intents).toEqual([{ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' }]);
    expect(h.jevCalls).toBe(0);
    const react = h.traceRows.find((r) => (r.decision as { conclusion?: string }).conclusion === 'react');
    expect(react!.triggerType).toBe('eventbus');
    h.scheduler.dispose();
  });

  it('jev 微决策: rule 未命中时选候选去公园;30 分冷却内不重复调用', async () => {
    const park = TOWN_MAP.places.find((p) => p.id === 'park')!;
    const llm: Partial<MemoryLlm> = {
      systemOne: () =>
        Promise.resolve({
          model: 'stub',
          answers: { next: { type: 'choice', choice: '公园', probabilities: {}, confidence: 1 } },
        }) as never,
    };
    const h = harness(0, char({}), llm);
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] }); // 屏蔽回落意图
    h.onEvent(chatEvent(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(1);
    expect(h.intents).toEqual([
      { type: 'move_to', characterId: CHAR_ID, x: park.entrance.x, y: park.entrance.y },
    ]);
    expect(h.bubbles[0]!.text).toContain('公园');
    // 冷却内再来事件:静默(不再调 jev、不再产意图)
    h.clock.gameMinutes += JEV_COOLDOWN_MINUTES - 1;
    h.onEvent(chatEvent(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(1);
    expect(h.intents).toHaveLength(1);
    h.scheduler.dispose();
  });

  it('jev 槽不可用: 回落 continue 并记一条 jev trace,不产意图不阻塞', async () => {
    const h = harness(0, char({}));
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] }); // 屏蔽回落意图
    h.onEvent(chatEvent(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.intents).toHaveLength(0);
    expect(h.jevCalls).toBe(1);
    const jevTrace = h.traceRows.find((r) => (r.decision as { layer?: string }).layer === 'jev');
    expect(jevTrace).toBeDefined();
    expect((jevTrace!.decision as { conclusion: string }).conclusion).toBe('continue');
    h.scheduler.dispose();
  });

  it('非自治角色不进泵;dispose 后停摆', () => {
    autonomy.disable(CHAR_ID);
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    vi.advanceTimersByTime(4_000);
    h.onEvent(chatEvent(1));
    expect(h.intents).toHaveLength(0);
    autonomy.enable(CHAR_ID);
    h.scheduler.dispose();
    h.onEvent(chatEvent(2));
    vi.advanceTimersByTime(4_000);
    expect(h.intents).toHaveLength(0);
  });
});

describe('AgentScheduler(D3 意图执行)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autonomy.enable(CHAR_ID);
  });
  afterEach(() => {
    autonomy.disable(CHAR_ID);
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    vi.useRealTimers();
  });

  const studyIntentsLlm: Partial<MemoryLlm> = {
    chatStructured: (_slot, _messages, _tool, _task, parse) => {
      const parsed = parse({ wants: [{ activity: 'study', urgency: 0.8, why: '想学点东西' }] });
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
  };

  it('无当日意图即生成:slow chat 合法 JSON→wants 落脑+day_rollover trace(不再写记忆)', async () => {
    const h = harness(480, char({}), studyIntentsLlm);
    await vi.advanceTimersByTimeAsync(2_000);
    const state = innerState.get(CHAR_ID)?.intents;
    expect(state?.source).toBe('llm');
    expect(state?.day).toBe(0);
    expect(state?.wants[0]).toMatchObject({ activityId: 'study', why: '想学点东西', status: 'pending' });
    const rollover = h.traceRows.find((r) => r.triggerType === 'day_rollover');
    expect((rollover!.perception as { wants: number }).wants).toBe(1);
    h.scheduler.dispose();
  });

  it('slow 槽不可用→个性化回落 wants 照样驱动行动(消灭空转)', async () => {
    // bias 钉死 study:回落按倾向分去随机化(否则随机挑中就地可开的活动会直接 start_activity)
    hosting.set(CHAR_ID, {
      mode: 'policy',
      policyText: null,
      compiled: {
        focus: ['study'],
        avoid: INTENT_ACTIVITY_IDS.filter((id) => id !== 'study'),
      },
    });
    const h = harness(0, char({})); // llm 未配置 chatStructured→composeIntents 回落
    await vi.advanceTimersByTimeAsync(2_000);
    expect(innerState.get(CHAR_ID)?.intents?.source).toBe('fallback');
    expect(innerState.get(CHAR_ID)?.intents?.wants.map((w) => w.activityId)).toEqual(['study']);
    h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents.length).toBeGreaterThanOrEqual(1);
    expect(h.intents[0]).toMatchObject({ type: 'move_to', characterId: CHAR_ID });
    h.scheduler.dispose();
  });

  it('意图两段式:高分 want 先 move_to 合法场所入口,执行即标 doing', async () => {
    const studyPlaces = ['library', 'home-a']
      .map((id) => TOWN_MAP.places.find((p) => p.id === id)!)
      .filter((p) => p !== undefined);
    const h = harness(480, char({}), studyIntentsLlm);
    await vi.advanceTimersByTimeAsync(2_000); // 意图生成
    h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES; // 495,巡检块边界
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1);
    expect(h.intents[0]).toMatchObject({ type: 'move_to', characterId: CHAR_ID });
    const spot = h.intents[0] as { x: number; y: number };
    // 执行器随机选点:命中学习合法场所(library/home-a)之一
    const legal = new Set(studyPlaces.map((p) => `${p.entrance.x},${p.entrance.y}`));
    expect(legal.has(`${spot.x},${spot.y}`)).toBe(true);
    expect(h.bubbles[0]!.text).toContain('想学点东西');
    expect(h.bubbles[0]!.text).toMatch(/图书馆|公寓/);
    const react = h.traceRows.find((r) => (r.decision as { layer?: string }).layer === 'plan');
    expect(react).toBeDefined();
    expect(innerState.get(CHAR_ID)?.intents?.wants[0]?.status).toBe('doing');
    // D4:开始执行即落关注点(决策理由一句话,访谈/检索/jev 注入用)
    expect(innerState.get(CHAR_ID)?.focus?.text).toBe('想学点东西');
    h.scheduler.dispose();
  });

  it('rule 压力优先于意图:饥饿时先吃苹果,want 不抢跑', async () => {
    const h = harness(480, char({ energy: 20, backpack: { apple: 1 } }), studyIntentsLlm);
    await vi.advanceTimersByTimeAsync(2_000); // 意图生成
    h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES;
    await vi.advanceTimersByTimeAsync(2_000);
    // 桩不改数值,rule 每个巡检块都先于意图 react 吃苹果
    expect(h.intents[0]).toEqual({ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' });
    expect(h.intents.every((i) => i.type === 'eat_item')).toBe(true);
    h.scheduler.dispose();
  });

  it('不可执行 want 当场废弃:无居所 rest→abandoned 落库', async () => {
    const h = harness(480, char({ housing: null }), studyIntentsLlm);
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      wants: [{ id: 'w0-0', activityId: 'rest', why: '累了', urgency: 0.9, status: 'pending', createdAtMin: 480 }],
    });
    h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES; // 跨出首巡检块
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(0);
    expect(innerState.get(CHAR_ID)?.intents?.wants[0]?.status).toBe('abandoned');
    h.scheduler.dispose();
  });

  it('activity.finished 结算 want:完成 done/欠费 abandoned/中断回 pending', () => {
    const h = harness(480, char({}), studyIntentsLlm);
    const intentsOf = (): DayIntents => innerState.get(CHAR_ID)!.intents!;
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      wants: [{ id: 'w0-0', activityId: 'meal', why: '馋了', urgency: 0.8, status: 'doing', createdAtMin: 480 }],
    });
    h.onEvent(finishedEvent(500, 'meal', 'completed'));
    expect(intentsOf().wants[0]!.status).toBe('done');
    intentsOf().wants[0]!.status = 'doing';
    h.onEvent(finishedEvent(520, 'meal', 'insufficient_coins'));
    expect(intentsOf().wants[0]!.status).toBe('abandoned');
    intentsOf().wants[0]!.status = 'doing';
    h.onEvent(finishedEvent(540, 'meal', 'interrupted'));
    expect(intentsOf().wants[0]!.status).toBe('pending');
    h.scheduler.dispose();
  });

  it('意图被拒:30 分退避,连续 3 拒清当日意图并记 replan trace', async () => {
    const h = harness(480, char({}), studyIntentsLlm, {
      runIntent: (() => ({ ok: false, message: '知识不足,须先学习' })) as unknown as typeof runIntent,
    });
    await vi.advanceTimersByTimeAsync(2_000); // 意图生成
    for (let i = 0; i < 5; i += 1) {
      h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES; // 495/510/525/540/555
      await vi.advanceTimersByTimeAsync(2_000);
    }
    const planReacts = h.traceRows.filter((r) => (r.decision as { layer?: string }).layer === 'plan');
    expect(planReacts.length).toBe(3); // 退避吞掉 510/540 两块
    expect(h.traceRows.some((r) => (r.perception as { replan?: boolean }).replan === true)).toBe(true);
    expect(innerState.get(CHAR_ID)?.intents).toBeNull(); // 第 3 拒后已清,待重生成
    h.scheduler.dispose();
  });

  it('跨日重生成:次日意图按新 day 生成并恢复执行', async () => {
    const h = harness(480, char({}), studyIntentsLlm);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(innerState.get(CHAR_ID)?.intents?.day).toBe(0);
    h.clock.gameMinutes = 1440 + 480; // 次日 08:00
    await vi.advanceTimersByTimeAsync(2_000); // ensureIntents 生成次日意图
    expect(innerState.get(CHAR_ID)?.intents?.day).toBe(1);
    h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES; // 跨出巡检块边界
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents[0]).toMatchObject({ type: 'move_to', characterId: CHAR_ID });
    h.scheduler.dispose();
  });
});

describe('AgentScheduler(C3 事件响应层,10-cognition §7.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autonomy.enable(CHAR_ID);
  });
  afterEach(() => {
    autonomy.disable(CHAR_ID);
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    vi.useRealTimers();
  });

  const respondLlm: Partial<MemoryLlm> = {
    systemOne: () =>
      Promise.resolve({
        model: 'stub',
        answers: { next: { type: 'choice', choice: 'respond', probabilities: {}, confidence: 1 } },
      }) as never,
  };
  const continueLlm: Partial<MemoryLlm> = {
    systemOne: () =>
      Promise.resolve({
        model: 'stub',
        answers: { next: { type: 'choice', choice: 'continue', probabilities: {}, confidence: 1 } },
      }) as never,
  };
  const diedEvent = (tick: number): WorldEvent =>
    ({ type: 'character.died', characterId: 'other-1', tick, revivable: true }) as WorldEvent;

  it('忙碌漫步中有人倒下: ⑤评估 respond→move_to 打断,want 固定退避期满回意图', async () => {
    const worldChar = char({ activity: activity('stroll') });
    const h = harness(480, worldChar, respondLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 32, y: 30 })],
    });
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      wants: [{ id: 'w0-0', activityId: 'stroll', why: '透透气', urgency: 0.9, status: 'doing', createdAtMin: 480 }],
    });
    h.onEvent(diedEvent(480));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(1); // ⑤ 中断评估恰好一次
    expect(h.intents[0]).toEqual({ type: 'move_to', characterId: CHAR_ID, x: 32, y: 30 });
    expect(h.bubbles[0]?.text).toContain('看看');
    const react = h.traceRows.find(
      (r) =>
        (r.decision as { layer?: string }).layer === 'triage' &&
        (r.decision as { conclusion?: string }).conclusion === 'react',
    );
    expect((react!.perception as { gate?: string }).gate).toBe('pass_assess');
    // 退避期内(480+30=510 前)want 层静默
    worldChar.activity = null;
    h.clock.gameMinutes = 500;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1);
    // 期满:重新评分择条,回意图(去散步)
    h.clock.gameMinutes = 510;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(2);
    expect(h.intents[1]).toMatchObject({ type: 'move_to', characterId: CHAR_ID });
    h.scheduler.dispose();
  });

  it('退避为绝对 gameMinutes 语义:次日同时刻不误判仍在退避', async () => {
    const worldChar = char({ activity: activity('stroll') });
    const h = harness(480, worldChar, respondLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 32, y: 30 })],
    });
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      wants: [{ id: 'w0-0', activityId: 'stroll', why: '透透气', urgency: 0.9, status: 'doing', createdAtMin: 480 }],
    });
    h.onEvent(diedEvent(480));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.intents).toHaveLength(1); // respond 打断生效,退避至 510(绝对值)
    worldChar.activity = null; // 世界侧活动已终止
    h.clock.gameMinutes = 1440 + 480; // 次日 08:00,与中断同 minuteOfDay
    await vi.advanceTimersByTimeAsync(2_000); // ensureIntents 生成次日意图
    h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES; // 跨出巡检块边界
    await vi.advanceTimersByTimeAsync(2_000); // 巡检回意图
    expect(h.intents.length).toBeGreaterThan(1);
    // 次日意图为 fallback 随机候选,产出的可能是 move_to 或就地 start_activity
    expect(h.intents[1]).toMatchObject({ characterId: CHAR_ID });
    h.scheduler.dispose();
  });

  it('评估 continue: 不产意图,trace 记一行 assess=continue', async () => {
    const h = harness(480, char({ activity: activity('stroll') }), continueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 32, y: 30 })],
    });
    h.onEvent(diedEvent(480));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.intents).toHaveLength(0);
    const row = h.traceRows.find((r) => (r.perception as { assess?: string }).assess === 'continue');
    expect(row).toBeDefined();
    expect((row!.decision as { conclusion: string }).conclusion).toBe('continue');
    h.scheduler.dispose();
  });

  it('预算护栏: 同事件去重+30 分冷却+日 4 次上限,超限不再烧模型', async () => {
    const h = harness(480, char({ activity: activity('stroll') }), respondLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 32, y: 30 })],
    });
    for (let i = 0; i < 4; i += 1) {
      h.onEvent(diedEvent(480 + i));
      await vi.advanceTimersByTimeAsync(0);
      h.clock.gameMinutes += 30; // 跨出冷却窗口
    }
    expect(h.jevCalls).toBe(4);
    h.onEvent(diedEvent(480)); // 同事件键:去重
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(4);
    h.onEvent(diedEvent(600)); // 新事件:日预算已耗尽
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(4);
    h.scheduler.dispose();
  });

  it('睡眠不可打断: died 排事后处理,空闲后巡检补执行 move_to', async () => {
    const worldChar = char({ activity: activity('sleep') });
    const h = harness(480, worldChar, respondLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 33, y: 30 })],
    });
    h.onEvent(diedEvent(480));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(0); // 容忍度 none:不评估不打断
    expect(h.intents).toHaveLength(0);
    worldChar.activity = null;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toEqual([{ type: 'move_to', characterId: CHAR_ID, x: 33, y: 30 }]);
    expect(h.bubbles[0]?.text).toContain('看看');
    h.scheduler.dispose();
  });

  it('获救道谢: 台账由 accepted 喂,复活即当面对救者说固定台词(零模型不打断)', () => {
    const h = harness(480, char({}), undefined, {
      extraCharacters: [char({ id: 'rescuer-1', name: '阿泽', x: 31, y: 30 })],
    });
    h.onEvent({
      type: 'work_task.accepted',
      characterId: 'rescuer-1',
      targetId: CHAR_ID,
      task: 'rescue',
      tick: 479,
    } as WorldEvent);
    h.onEvent({ type: 'character.revived', characterId: CHAR_ID, tick: 480 } as WorldEvent);
    expect(h.jevCalls).toBe(0);
    expect(h.intents).toEqual([
      { type: 'chat', characterId: CHAR_ID, targetId: 'rescuer-1', line: '多谢相救！' },
    ]);
    h.scheduler.dispose();
  });
});

describe('AgentScheduler(C4 自治社交,10-cognition §7.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autonomy.enable(CHAR_ID);
  });
  afterEach(() => {
    autonomy.disable(CHAR_ID);
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    vi.useRealTimers();
  });

  /** 已认识(familiarity 30)且互有好感(60)的关系,入 harness 的 sim.socials */
  function withRelation(h: Harness, otherId = 'other-1'): void {
    const sim = (h.scheduler as unknown as { deps: { sim: { socials: Map<string, unknown> } } })
      .deps.sim;
    sim.socials.set(`${CHAR_ID}|${otherId}`, {
      fromId: CHAR_ID,
      toId: otherId,
      familiarity: 30,
      affinity: 60,
      chatDay: 0,
      chatCount: 0,
      formedNotified: false,
    });
  }

  /** 空当日意图: 屏蔽回落意图抢占 want 层,专注社交通路 */
  function withEmptyIntents(): void {
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] });
  }

  const dialogueLlm: Partial<MemoryLlm> = {
    chat: () =>
      Promise.resolve({ content: '今天天气真好呀', promptTokens: 10, completionTokens: 5 }),
  };

  it('动机点火: 同地熟人过线,light 双句生成→chat 直执,trace 记 motive=social', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    await vi.advanceTimersByTimeAsync(2_000); // 阈值巡检块 0
    expect(h.intents).toEqual([
      {
        type: 'chat',
        characterId: CHAR_ID,
        targetId: 'other-1',
        line: '今天天气真好呀',
        reply: '今天天气真好呀',
      },
    ]);
    expect(h.bubbles[0]?.text).toContain('想找苏晚聊聊天');
    const react = h.traceRows.find(
      (r) => (r.perception as { motive?: string }).motive === 'social',
    );
    expect(react).toBeDefined();
    expect((react!.perception as { llm?: boolean }).llm).toBe(true);
    expect((react!.decision as { layer: string }).layer).toBe('rule');
    h.scheduler.dispose();
  });

  it('LLM 失败回落模板双句: 点火不丢失,line/reply 均为非空模板', async () => {
    const h = harness(480, char({}), undefined, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    await vi.advanceTimersByTimeAsync(2_000);
    const intent = h.intents[0] as { type: string; line?: string; reply?: string } | undefined;
    expect(intent?.type).toBe('chat');
    expect(intent?.line).toBeTruthy();
    expect(intent?.reply).toBeTruthy();
    expect((h.traceRows.find((r) => (r.perception as { motive?: string }).motive === 'social')!
      .perception as { llm?: boolean }).llm).toBe(false);
    h.scheduler.dispose();
  });

  it('同对冷却: 点火后 60 分内静默,冷却过再点;jev 冷却不受影响', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1);
    h.clock.gameMinutes += 30;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1); // 冷却中
    h.clock.gameMinutes += 30;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(2); // 冷却过再点火
    h.scheduler.dispose();
  });

  it('每日主动上限: SOCIAL_DAILY_INITIATE_CAP=6,第 7 次不再点火', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    for (let i = 0; i < 7; i += 1) {
      if (i > 0) h.clock.gameMinutes += 60; // 跨出同对冷却
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(h.intents).toHaveLength(6);
    h.scheduler.dispose();
  });

  it('异地熟人不点火进 jev 池: 桩选「找苏晚聊天」→ approach move_to', async () => {
    const llm: Partial<MemoryLlm> = {
      systemOne: () =>
        Promise.resolve({
          model: 'stub',
          answers: { next: { type: 'choice', choice: '找苏晚聊天', probabilities: {}, confidence: 1 } },
        }) as never,
    };
    const h = harness(480, char({}), llm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 50, y: 50 })],
    });
    withRelation(h);
    withEmptyIntents();
    h.onEvent({ type: 'work_task.cancelled', characterId: CHAR_ID, targetId: 'spot-1', tick: 1 } as WorldEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.intents).toEqual([{ type: 'move_to', characterId: CHAR_ID, x: 50, y: 50 }]);
    expect(h.bubbles[0]?.text).toContain('找苏晚聊聊');
    h.scheduler.dispose();
  });

  it('生成期间走散: 对方被拽远后放弃本轮,不产意图', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1);
    h.clock.gameMinutes += 60;
    // 第二轮点火前把对方挪远(模拟生成期间走散后的下一轮:直接距离判定不点火)
    const other = char({ id: 'other-1', name: '苏晚', x: 60, y: 60 });
    (h.scheduler as unknown as { deps: { sim: { characters: Map<string, WorldCharacter> } } }).deps.sim.characters.set(
      'other-1',
      other,
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1);
    h.scheduler.dispose();
  });
});
