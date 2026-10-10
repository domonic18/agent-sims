import { TOWN_MAP } from '@sims/shared';
import { TileMap } from '../world/map.js';
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
function chatEvent(tick: number, toId = 'npc-1'): WorldEvent {
  return {
    type: 'social.chat',
    fromId: CHAR_ID,
    toId,
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
  /** 资源节点表(采集/驱力 forage 通道测试用) */
  resourceNodes?: Array<[string, { id: string; kind: string; x: number; y: number; charges: number | null; respawnAtDay: number | null }]>;
  /** 用真 TileMap(含 isWalkable/寻路)替换无地形 mock——节点寻址类测试必开 */
  useTileMap?: boolean;
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
    map:
      opts?.useTileMap === true
        ? TileMap.fromDefinition(TOWN_MAP)
        : { definition: TOWN_MAP, activityAnchors: () => [] as Array<never> },
    characters: new Map([
      [worldChar.id, worldChar] as const,
      ...(opts?.extraCharacters ?? []).map((c) => [c.id, c] as const),
    ]),
    socials: new Map(),
    // E1 rule/want 世界查询与 townNeeds 读的世界表(空=无货/无节点/无损耗)
    shopStock: new Map<string, number>(),
    resourceNodes: new Map(opts?.resourceNodes ?? []),
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

  it('阈值巡检: 饥饿写驱力 want 即择条执行吃背包食物,气泡+trace 落库', () => {
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] }); // 驱力写 want 须有当日容器
    vi.advanceTimersByTime(2_000);
    expect(h.intents).toEqual([{ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' }]);
    expect(h.bubbles[0]!.text).toContain('苹果');
    expect(innerState.get(CHAR_ID)?.intents?.wants[0]).toMatchObject({
      activityId: 'eat',
      origin: 'drive',
      status: 'doing',
    });
    const react = h.traceRows.find((r) => r.decision !== null && (r.decision as { conclusion?: string }).conclusion === 'react');
    expect(react).toBeDefined();
    expect(react!.triggerType).toBe('threshold');
    expect(react!.characterId).toBe(CHAR_ID);
    h.scheduler.dispose();
  });

  it('同一 15 分块只巡检一次;数值健康空想零动作零 trace', () => {
    const h = harness(0, char({}));
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] }); // 屏蔽回落意图,专注巡检节拍
    for (let i = 0; i < 25; i += 1) {
      h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES;
      vi.advanceTimersByTime(2_000);
    }
    expect(h.intents).toHaveLength(0); // 数值健康全程无压力无候选
    expect(h.jevCalls).toBe(0); // 巡检路径不触发 jev
    expect(h.traceRows).toHaveLength(0); // wantSelect 空手静默(null),不再有 continue 采样行
    h.scheduler.dispose();
  });

  it('事件驱动: 相关叙事事件放行管线,驱力 want 即时执行不进 jev', () => {
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] });
    h.onEvent({ type: 'work_task.cancelled', characterId: CHAR_ID, targetId: 'spot-1', tick: 1 } as WorldEvent);
    expect(h.intents).toEqual([{ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' }]);
    expect(h.jevCalls).toBe(0); // want 已接上执行,本轮不惊动 jev
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
    innerState.get(CHAR_ID)!.intents!.wants[0]!.status = 'done'; // 桩无 activity.finished,手动结算冲动 want
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

  it('驱力压过 plan want: 饥饿时先吃苹果(体力闸拦下 study),want 不抢跑', async () => {
    const h = harness(480, char({ energy: 20, backpack: { apple: 1 } }), studyIntentsLlm);
    await vi.advanceTimersByTimeAsync(2_000); // 意图生成
    h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES;
    await vi.advanceTimersByTimeAsync(2_000);
    // 桩不改数值:驱力 eat 唯一 eligible(energy 20≤闸线,study 非基础被体力闸拦下),
    // 每个巡检块都重评执行吃苹果
    expect(h.intents[0]).toEqual({ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' });
    expect(h.intents.every((i) => i.type === 'eat_item')).toBe(true);
    h.scheduler.dispose();
  });

  it('不可执行 want 当场废弃:无居所 rest→abandoned 落库', async () => {
    const h = harness(480, char({ housing: null }), studyIntentsLlm);
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      wants: [{ id: 'w0-0', activityId: 'rest', why: '累了', origin: 'plan', urgency: 0.9, status: 'pending', createdAtMin: 480 }],
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
      wants: [{ id: 'w0-0', activityId: 'meal', why: '馋了', origin: 'plan', urgency: 0.8, status: 'doing', createdAtMin: 480 }],
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

  it('forage 执行链端到端(wantWorld 注入回归): 饿汉+浆果丛必须产出走向采集的意图而非空手废弃', async () => {
    // 复刻决策观测镇老周式绝境: energy 25 触发饥饿,coins 0 买不起,背包空,
    // 身旁有浆果丛——写侧预检(ruleWorld)与执行侧(wantWorld)必须同源可见该节点;
    // E6.2 平移曾漏注入 nearestEdibleNode 令执行恒 stuck→abandoned,饿死循环。
    // 坐标取 TOWN_MAP 相邻可行走格(25,25)+(26,25):角色站不可走格会令寻路预检失败;
    // 起始 gm 600(白天档): 夜间 sleep 驱力 0.85 会压过 forage 0.8,白天 0.7 则稳输
    const h = harness(
      600,
      char({ x: 25, y: 25, energy: 25, coins: 0 }),
      undefined,
      {
        resourceNodes: [
          ['bush-1', { id: 'bush-1', kind: 'berry_bush', x: 26, y: 25, charges: 3, respawnAtDay: null }],
        ],
        useTileMap: true,
      },
    );
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] }); // 屏蔽回落意图,专注驱力链
    vi.advanceTimersByTime(2_000);
    expect(h.intents.length).toBeGreaterThanOrEqual(1);
    expect(['move_to', 'work_task']).toContain(h.intents[0]!.type);
    expect(h.bubbles[0]!.text).toContain('采'); // 「饿得不行,店也没的买,采点吃的」
    const forageWant = innerState
      .get(CHAR_ID)
      ?.intents?.wants.find((w) => w.activityId === 'forage');
    expect(forageWant).toBeDefined();
    expect(forageWant!.status).toBe('doing');
    h.scheduler.dispose();
  });

  it('sell_goods 空包候选期拦截: 空背包时卖货 want 不进评分池,次优 work 正常择条而非全天空转', async () => {
    // 复刻观测镇空转案例: sell_goods 0.9 稳压 work 0.7(jitter ±5% 不重叠),
    // 缺候选期拦截时它夺冠→E6.3 契约免评续做→每拍执行答 backpack_empty 锁死白天;
    // 拦截后空包不评分(pending 保留,采到货自然复活),仲裁落到 work
    const h = harness(600, char({ coins: 50, energy: 80 }));
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      wants: [
        { id: 'w0-sell', activityId: 'sell_goods', why: '卖货换钱', origin: 'plan', urgency: 0.9, status: 'pending', createdAtMin: 600 },
        { id: 'w0-work', activityId: 'work', why: '打杂工挣钱', origin: 'plan', urgency: 0.7, status: 'pending', createdAtMin: 600 },
      ],
    });
    vi.advanceTimersByTime(2_000);
    expect(h.intents.length).toBeGreaterThanOrEqual(1); // 修复前=0: sell_goods 空转无意图
    const wants = innerState.get(CHAR_ID)?.intents?.wants ?? [];
    expect(wants.find((w) => w.id === 'w0-sell')?.status).toBe('pending'); // 跳过不废弃,等背包有货
    expect(wants.find((w) => w.id === 'w0-work')?.status).toBe('doing');
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
    autonomy.disable('rescuer-1');
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    innerState.clear('rescuer-1');
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

  it('忙碌漫步中有人倒下: ⑤评估 respond→写事件 want 不打断,闲时评分调度去救援', async () => {
    const worldChar = char({ activity: activity('stroll') });
    const h = harness(480, worldChar, respondLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 32, y: 30, alive: false })],
    });
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      // stroll 钉 0.4:E6.3 在契语义下 rescue 是挑战者,须恒过 stroll×WANT_SEIZE_RATIO
      // 1.4=0.56;rescue 最低抖动 0.85×0.95=0.8075 恒压过,评分竞争保确定性
      wants: [{ id: 'w0-0', activityId: 'stroll', why: '透透气', origin: 'plan', urgency: 0.4, status: 'doing', createdAtMin: 480 }],
    });
    h.onEvent(diedEvent(480));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(1); // ⑤ 中断评估恰好一次
    expect(h.intents).toHaveLength(0); // 忙碌不打断:rescue want 只入账
    expect(
      innerState.get(CHAR_ID)!.intents!.wants.find((w) => w.activityId === 'rescue'),
    ).toMatchObject({ origin: 'event', targetCharacterId: 'other-1', status: 'pending' });
    const assess = h.traceRows.find((r) => (r.perception as { gate?: string }).gate === 'pass_assess');
    expect(assess).toBeDefined();
    expect(h.traceRows.find((r) => (r.perception as { gate?: string }).gate === 'event_want')).toBeDefined();
    // 活动结束:闲时评分调度,rescue 压过 stroll → move_to 去看苏晚
    worldChar.activity = null;
    h.clock.gameMinutes = 495;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toEqual([{ type: 'move_to', characterId: CHAR_ID, x: 32, y: 30 }]);
    expect(h.bubbles[0]?.text).toContain('看看');
    expect(
      innerState.get(CHAR_ID)!.intents!.wants.find((w) => w.activityId === 'rescue')!.status,
    ).toBe('doing');
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

  it('睡眠 defer 溶解: 不评估不打断,died 落为事件 want,醒后闲时调度去救援', async () => {
    const worldChar = char({ activity: activity('sleep') });
    const h = harness(480, worldChar, undefined, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 33, y: 30, alive: false })],
    });
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] });
    h.onEvent(diedEvent(480));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(0); // 容忍度 none:不评估不打断,直接写 want
    expect(h.intents).toHaveLength(0); // 忙碌:want 只入账不动身
    expect(
      innerState.get(CHAR_ID)!.intents!.wants.find((w) => w.activityId === 'rescue'),
    ).toMatchObject({ origin: 'event', status: 'pending' });
    worldChar.activity = null;
    h.clock.gameMinutes = 495; // 跨出巡检块边界
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toEqual([{ type: 'move_to', characterId: CHAR_ID, x: 33, y: 30 }]);
    expect(h.bubbles[0]?.text).toContain('看看');
    h.scheduler.dispose();
  });

  it('获救道谢: 台账由 accepted 喂,复活写社交事件 want,召唤恩人两阶段聊天', async () => {
    const dialogueLlm: Partial<MemoryLlm> = {
      chatStructured: (_slot, _messages, _tool, _task, parse) => {
        const parsed = parse({ line: '小事一桩,别放心上', wantsMore: false });
        if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
        return Promise.resolve(parsed.value);
      },
    };
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'rescuer-1', name: '阿泽', x: 31, y: 30 })],
    });
    const sim = (h.scheduler as unknown as { deps: { sim: { socials: Map<string, unknown> } } }).deps.sim;
    for (const [fromId, toId] of [
      [CHAR_ID, 'rescuer-1'],
      ['rescuer-1', CHAR_ID],
    ] as const) {
      sim.socials.set(`${fromId}|${toId}`, {
        fromId,
        toId,
        familiarity: 30,
        affinity: 60,
        chatDay: 0,
        chatCount: 0,
        formedNotified: false,
      });
    }
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] });
    autonomy.enable('rescuer-1');
    innerState.setIntents('rescuer-1', { day: 0, source: 'llm', wants: [] });
    h.onEvent({
      type: 'work_task.accepted',
      characterId: 'rescuer-1',
      targetId: CHAR_ID,
      task: 'rescue',
      tick: 479,
    } as WorldEvent);
    h.onEvent({ type: 'character.revived', characterId: CHAR_ID, tick: 480 } as WorldEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(0); // respond 通道不评估不惊动 jev
    // 道谢=socialize 事件 want(我名下,doing 静候聊天落地),聊天由恩人应答生成
    expect(
      innerState
        .get(CHAR_ID)!
        .intents!.wants.find((w) => w.origin === 'event' && w.targetCharacterId === 'rescuer-1'),
    ).toMatchObject({ activityId: 'socialize', urgency: 0.9, status: 'doing' });
    const chat = h.intents[0] as { type: string; characterId: string; targetId: string; lines?: string[] } | undefined;
    expect(chat?.type).toBe('chat');
    expect(chat?.characterId).toBe('rescuer-1'); // 应答方(恩人)执行生成,chat 归其名下
    expect(chat?.targetId).toBe(CHAR_ID);
    expect(chat?.lines![0]).toBe('小事一桩,别放心上');
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
    autonomy.disable('other-1');
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    innerState.clear('other-1');
    vi.useRealTimers();
  });

  /** 已认识(familiarity 30)且互有好感(60)的关系,入 harness 的 sim.socials;
   * 生产关系双向各存一条(meetByProximity),应答方执行生成要查反向键 */
  function withRelation(h: Harness, otherId = 'other-1'): void {
    const sim = (h.scheduler as unknown as { deps: { sim: { socials: Map<string, unknown> } } })
      .deps.sim;
    for (const [fromId, toId] of [
      [CHAR_ID, otherId],
      [otherId, CHAR_ID],
    ] as const) {
      sim.socials.set(`${fromId}|${toId}`, {
        fromId,
        toId,
        familiarity: 30,
        affinity: 60,
        chatDay: 0,
        chatCount: 0,
        formedNotified: false,
      });
    }
  }

  /** 空当日意图: 屏蔽回落意图抢占 want 层,专注社交通路 */
  function withEmptyIntents(): void {
    innerState.setIntents(CHAR_ID, { day: 0, source: 'llm', wants: [] });
  }

  /** 应答方可召唤(E6.2 两阶段会合):对方自治+空当日意图容器,能收 event want
   * 并应答——召唤→executeWants(target)→应答方执行生成(chat 意图归其名下) */
  function withResponder(): void {
    autonomy.enable('other-1');
    innerState.setIntents('other-1', { day: 0, source: 'llm', wants: [] });
  }

  const dialogueLlm: Partial<MemoryLlm> = {
    chatStructured: (_slot, _messages, _tool, _task, parse) => {
      const parsed = parse({ line: '今天天气真好呀', wantsMore: false });
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
  };

  it('动机点火(E6.4 布尔门槛): 同地熟人+冷却外→驱力 want→召唤,应答方执行生成,trace 记 motive=social', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    withResponder();
    await vi.advanceTimersByTimeAsync(2_000); // 阈值巡检块 0
    const intent = h.intents[0] as
      | { type: string; targetId: string; lines?: string[] }
      | undefined;
    expect(intent?.type).toBe('chat');
    expect(intent?.targetId).toBe(CHAR_ID); // 应答方执行生成,chat 归其名下
    expect(intent?.lines![0]).toBe('今天天气真好呀'); // 应答方(执行者)先说
    expect(intent?.lines).toHaveLength(2); // 终止后听者句模板保底
    expect(h.bubbles[0]?.text).toContain('阿测'); // 聊天落地气泡(和阿测聊聊天)
    const wantTrace = h.traceRows.find(
      (r) => (r.decision as { intent?: string }).intent === 'want:socialize',
    );
    expect(wantTrace).toBeDefined(); // E6: 动机先写驱力 want;E6.2 首触只召唤零模型
    const react = h.traceRows.find(
      (r) =>
        (r.perception as { motive?: string; llm?: boolean }).motive === 'social' &&
        (r.perception as { llm?: boolean }).llm === true,
    );
    expect(react).toBeDefined();
    expect((react!.decision as { layer: string }).layer).toBe('rule');
    h.scheduler.dispose();
  });

  it('LLM 失败回落模板双句: 点火不丢失,lines 均为非空模板', async () => {
    const h = harness(480, char({}), undefined, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    withResponder();
    await vi.advanceTimersByTimeAsync(2_000);
    const intent = h.intents[0] as { type: string; lines?: string[] } | undefined;
    expect(intent?.type).toBe('chat');
    expect(intent?.lines).toHaveLength(2);
    expect(intent?.lines![0]).toBeTruthy();
    expect(intent?.lines![1]).toBeTruthy();
    expect(
      (h.traceRows.find(
        (r) =>
          (r.perception as { motive?: string; llm?: boolean }).motive === 'social' &&
          (r.perception as { llm?: boolean }).llm === false,
      )!.perception as { llm?: boolean }).llm,
    ).toBe(false);
    h.scheduler.dispose();
  });

  it('同对冷却: 点火后 30 分内静默(E2 60→30),冷却过再点;jev 冷却不受影响', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    withResponder();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1);
    h.onEvent(chatEvent(1, 'other-1')); // social.chat 回执结算 doing want(桩不发事件,手动补)
    h.clock.gameMinutes += 15;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1); // 冷却中
    h.clock.gameMinutes += 15;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(2); // 恰好 30 分:冷却过再点火
    h.scheduler.dispose();
  });

  it('每日主动上限闸已废(E6.4): 跨出对冷却即可反复点火,频率由对冷却自限', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    withResponder();
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) h.clock.gameMinutes += 60; // 跨出同对冷却
      await vi.advanceTimersByTimeAsync(2_000);
      h.onEvent(chatEvent(10 + i, 'other-1')); // 结算本轮 doing want
    }
    // 3 轮全部点火成功:无日预算拦截,聊天频率唯一受 SOCIAL_PAIR_COOLDOWN 约束
    expect(h.intents.filter((i) => i.type === 'chat')).toHaveLength(3);
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

  it('走散两段式(E6): 对方被拽远,冷却过再点火写寻人 want→move_to 寻人,不隔空聊天', async () => {
    const h = harness(480, char({}), dialogueLlm, {
      extraCharacters: [char({ id: 'other-1', name: '苏晚', x: 31, y: 30 })],
    });
    withRelation(h);
    withEmptyIntents();
    withResponder();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.intents).toHaveLength(1);
    h.onEvent(chatEvent(1, 'other-1')); // 结算首轮 doing want
    h.clock.gameMinutes += 60;
    // 对方被拽远:动机仍会再点火(E6 驱力),执行走两段式寻人而非隔空聊天
    const other = char({ id: 'other-1', name: '苏晚', x: 60, y: 60 });
    (h.scheduler as unknown as { deps: { sim: { characters: Map<string, WorldCharacter> } } }).deps.sim.characters.set(
      'other-1',
      other,
    );
    await vi.advanceTimersByTimeAsync(2_000);
    // 阿测侧:再点火不隔空聊,写寻人 move_to(苏晚动机对等也会反向寻人,各看各的)
    const mine = h.intents.filter((i) => i.characterId === CHAR_ID);
    expect(mine).toEqual([{ type: 'move_to', characterId: CHAR_ID, x: 60, y: 60 }]);
    // 全程无第二次隔空聊天:chat 意图只有首轮召唤应答那一场
    expect(h.intents.filter((i) => i.type === 'chat')).toHaveLength(1);
    h.scheduler.dispose();
  });
});

describe('AgentScheduler(E2 人指向社交 want)', () => {
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

  it('远处 target: move_to 寻人并标 doing;social.chat 结算 done', async () => {
    const npc = char({ id: 'npc-1', name: '铁牛', x: 20, y: 20 });
    const h = harness(0, char({ x: 30, y: 30 }), undefined, { extraCharacters: [npc] });
    innerState.setIntents(CHAR_ID, {
      day: 0,
      source: 'llm',
      wants: [
        { id: 'w0', activityId: 'socialize', origin: 'plan', targetCharacterId: 'npc-1', why: '找铁牛聊聊', urgency: 0.9, status: 'pending', createdAtMin: 0 },
      ],
    });
    h.onEvent(chatEvent(1)); // self 强度4→idle 管线→wantSelect 寻人
    await vi.advanceTimersByTimeAsync(0);
    expect(h.intents).toEqual([{ type: 'move_to', characterId: CHAR_ID, x: 20, y: 20 }]);
    expect(h.bubbles[0]!.text).toContain('铁牛');
    expect(innerState.get(CHAR_ID)!.intents!.wants[0]!.status).toBe('doing');
    h.onEvent(chatEvent(2)); // settleSocialChat: doing+target 匹配→done
    await vi.advanceTimersByTimeAsync(0);
    expect(innerState.get(CHAR_ID)!.intents!.wants[0]!.status).toBe('done');
    const settled = h.traceRows.find((r) => (r.perception as { with?: string }).with === 'npc-1');
    expect(settled).toBeDefined();
    expect((settled!.perception as { want?: string }).want).toBe('w0');
    expect(h.intents).toHaveLength(1); // 结算后 idle 管线不再产新意图
    h.scheduler.dispose();
  });
});

describe('AgentScheduler(E3 聚会邀约)', () => {
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

  /** study 意图桩,顺带截获 prompt 全文(验证「昨天的约定」注入) */
  const intentsLlm = (seen: string[]): Partial<MemoryLlm> => ({
    chatStructured: (_slot, messages, _tool, _task, parse) => {
      seen.push(messages.map((m) => m.content).join('\n'));
      const parsed = parse({ wants: [{ activity: 'study', urgency: 0.8, why: '想学点东西' }] });
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
  });

  it('昨天的约定: 次晨意图前置赴约 want+prompt 注入,邀约兑现一次', async () => {
    const seen: string[] = [];
    const h = harness(1440 + 480, char({}), intentsLlm(seen)); // 次日 08:00
    innerState.ensure(CHAR_ID).pendingInvitation = {
      placeId: 'park',
      note: '晒太阳',
      withId: 'npc-1',
      day: 0,
    };
    await vi.advanceTimersByTimeAsync(2_000); // 晨间意图生成
    const wants = innerState.get(CHAR_ID)!.intents!.wants;
    expect(wants[0]).toMatchObject({
      id: 'w1-inv',
      activityId: 'socialize',
      targetCharacterId: 'npc-1',
      why: '赴约:晒太阳',
      urgency: 0.9,
    });
    expect(innerState.get(CHAR_ID)!.pendingInvitation).toBeNull(); // 兑现一次
    expect(seen.some((text) => text.includes('昨天的约定'))).toBe(true);
    h.scheduler.dispose();
  });

  it('当日约定不兑现: day 未跨日不前置 want 也不消费', async () => {
    const seen: string[] = [];
    const h = harness(480, char({}), intentsLlm(seen)); // 首日 08:00
    innerState.ensure(CHAR_ID).pendingInvitation = {
      placeId: 'park',
      note: '晒太阳',
      withId: 'npc-1',
      day: 0,
    };
    await vi.advanceTimersByTimeAsync(2_000);
    expect(innerState.get(CHAR_ID)!.intents!.wants[0]!.id).toBe('w0-0');
    expect(innerState.get(CHAR_ID)!.pendingInvitation).toMatchObject({ day: 0 }); // 留待次日
    h.scheduler.dispose();
  });
});
