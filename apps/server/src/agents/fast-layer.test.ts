import { TOWN_MAP, SHOP_ITEMS } from '@sims/shared';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance.js';
import type { WorldCharacter } from '../world/character.js';
import type { DayIntents } from './cognition.js';
import {
  driveDecide,
  driveSatisfied,
  exploreTarget,
  jevDecide,
  rentDecision,
  wantSelect,
  type Decision,
  type DrivePressure,
  type JevContext,
  type RuleWorldQueries,
  type WantWorldQueries,
} from './fast-layer.js';
import type { MemoryLlm } from './memory-writer.js';

const DAY = 4;
const SHOP_ENTRANCE = TOWN_MAP.places.find((p) => p.id === 'shop')!.entrance;
const NOON = 12 * 60;
const NIGHT = 22 * 60;

function char(overrides: Partial<WorldCharacter>): WorldCharacter {
  return {
    id: 'char-1',
    name: '阿测',
    x: 30,
    y: 30, // 中央广场,空闲
    path: [],
    energy: 80,
    health: 100,
    coins: 50,
    activity: null,
    housing: {
      propertyId: 'home-a',
      ownership: 'rent',
      paidThroughDay: DAY + 5,
    },
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

function sleeping(): WorldCharacter['activity'] {
  return { activityId: 'sleep', elapsed: 0, anchorKind: 'bed', targetId: null };
}

function intents(day: number, wants: Array<Partial<DayIntents['wants'][number]> & { activityId: string }>): DayIntents {
  return {
    day,
    source: 'llm',
    wants: wants.map((w, i) => ({
      id: w.id ?? `w${day}-${i}`,
      activityId: w.activityId,
      origin: w.origin ?? 'plan',
      why: w.why ?? '想这么做',
      urgency: w.urgency ?? 0.5,
      status: w.status ?? 'pending',
      createdAtMin: w.createdAtMin ?? 480,
      ...(w.targetCharacterId !== undefined ? { targetCharacterId: w.targetCharacterId } : {}),
    })),
  };
}

function stubLlm(choice: string): MemoryLlm {
  return {
    systemOne: () =>
      Promise.resolve({
        model: 'stub',
        answers: {
          next: { type: 'choice', choice, probabilities: {}, confidence: 1 },
        },
      }) as never,
    embed: () => Promise.reject(new Error('unused')),
    chat: () => Promise.reject(new Error('unused')),
    chatStructured: () => Promise.reject(new Error('unused')),

  };
}

describe('rentDecision(房租即时结算,账单不是行为)', () => {
  const decide = (c: WorldCharacter): Decision | null => rentDecision(c, DAY);

  it('租约次日到期且有钱 → react 续租(layer=rule)', () => {
    const due = decide(
      char({ housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 } }),
    );
    expect(due).not.toBeNull();
    expect(due!.layer).toBe('rule');
    expect(due!.action).toBe('react');
    expect(due!.intent).toEqual({ type: 'rent_property', characterId: 'char-1', propertyId: 'home-a' });
    expect(due!.bubble).toContain('公寓 A');
  });

  it('自持有房/租期充裕/钱不够 → null(E6.2 谋生改由驱力 earn want 接管)', () => {
    expect(decide(char({ housing: { propertyId: 'home-a', ownership: 'owned', paidThroughDay: DAY + 1 } }))).toBeNull();
    expect(decide(char({ housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 5 } }))).toBeNull();
    expect(decide(char({ coins: 0, housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 } }))).toBeNull();
  });
});

describe('driveDecide(E6.2 驱力巡检,压力→urgency 不产动作)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];
  const decideP = (
    c: WorldCharacter,
    minuteOfDay = NOON,
    world: RuleWorldQueries = {},
    anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }> = noAnchors,
  ): DrivePressure[] => driveDecide(c, DAY, minuteOfDay, anchorsOf, world);
  const byId = (ps: DrivePressure[], id: string): DrivePressure | undefined =>
    ps.find((p) => p.activityId === id);
  const housing = { propertyId: 'home-a', ownership: 'rent' as const, paidThroughDay: DAY + 5 };
  const beds = [{ x: 5, y: 6 }];
  const homeAnchors = (activityId: string, placeId: string | null): Array<{ x: number; y: number }> =>
    activityId === 'sleep' && placeId === 'home-a' ? beds : [];

  it('数值健康 → 零压力;失能(死亡/虚脱)→ 零压力', () => {
    expect(decideP(char({}))).toEqual([]);
    expect(decideP(char({ alive: false, energy: 0 }))).toEqual([]);
    expect(decideP(char({ collapsed: true }))).toEqual([]);
  });

  it('忙碌照常巡检(写 want 不打断,闲时由评分调度)', () => {
    const busy = decideP(char({ energy: 20, activity: { id: 'work', startedAtGameMinutes: 0 } as never }));
    expect(byId(busy, 'eat')).toBeDefined();
  });

  it('饥饿逃生梯(E1):能买→eat;非饥饿贫困有岗→earn;饿极买不起有节点→forage', () => {
    // 饥饿+背包有食物 → eat(不吃库存先饿着的事不存在)
    const eat = decideP(char({ energy: BALANCE.HUNGER_EAT_ENERGY - 1, backpack: { apple: 1 } }));
    expect(byId(eat, 'eat')?.urgency).toBeGreaterThan(BALANCE.DRIVE_EAT_URGENCY_BASE);

    // 饥饿+店有货买得起 → eat
    const buyable = decideP(char({ energy: BALANCE.HUNGER_EAT_ENERGY - 1, coins: 50 }), NOON, {
      shopStock: () => 5,
    });
    expect(byId(buyable, 'eat')).toBeDefined();

    // 非饥饿+穷+有岗(知识 0 → 杂工) → earn
    const earn = decideP(char({ energy: 60, coins: 0 }));
    expect(byId(earn, 'earn')?.urgency).toBe(BALANCE.DRIVE_EARN_URGENCY);

    // 饿极(买不起)+体力在直采窗+有节点 → forage
    const forage = decideP(char({ energy: 25, coins: 0 }), NOON, {
      shopStock: () => 0,
      nearestEdibleNode: () => ({ id: 'b', x: 1, y: 1 }),
    });
    expect(byId(forage, 'forage')?.urgency).toBe(BALANCE.DRIVE_FORAGE_URGENCY);

    // 通道全无(买不起+无岗+无节点)→ 零压力(不再对着售罄货架撞墙)
    expect(decideP(char({ energy: 25, coins: 0 }), NOON, { shopStock: () => 0 })).toEqual([]);
  });

  it('贫困阀门槛:体力<阀值 或 金币≥贫困线 不产 earn', () => {
    expect(byId(decideP(char({ coins: 5, energy: 34 })), 'earn')).toBeUndefined(); // E4: 阀值 45→35
    expect(byId(decideP(char({ coins: BALANCE.POVERTY_COIN_LINE, energy: 60 })), 'earn')).toBeUndefined();
  });

  it('困倦独立评估(D3):夜间线 60→0.85;白天线 25→0.7;不困零压力', () => {
    const night = decideP(char({ energy: BALANCE.SLEEPY_NIGHT_ENERGY, housing }), NIGHT, {}, homeAnchors);
    expect(byId(night, 'sleep')?.urgency).toBe(BALANCE.DRIVE_SLEEP_NIGHT_URGENCY);

    // 白天困线之下且买不起(E4 进食线 30,饥饿让行通道检查)→ sleep 0.7
    const dayNap = decideP(char({ energy: 22, coins: 0, housing }), NOON, {}, homeAnchors);
    expect(byId(dayNap, 'sleep')?.urgency).toBe(BALANCE.DRIVE_SLEEP_DAY_URGENCY);

    expect(byId(decideP(char({ energy: 70, housing }), NIGHT, {}, homeAnchors), 'sleep')).toBeUndefined();
  });

  it('饥饿+困倦并存 → 两条压力都在(评分竞争,非互斥);rent 不产压力(即时结算)', () => {
    const both = decideP(
      char({ energy: BALANCE.HUNGER_EAT_ENERGY, housing }),
      NIGHT,
      { shopStock: () => 5 },
      homeAnchors,
    );
    expect(byId(both, 'eat')).toBeDefined();
    expect(byId(both, 'sleep')).toBeDefined();
    // 租约次日到期:pressures 里没有 rent 项(rentDecision 单独结算,账单不是行为)
    const due = char({ housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 } });
    expect(decideP(due, NIGHT, {}, homeAnchors)).toEqual([]);
  });
});

describe('driveSatisfied(驱力收口口径)', () => {
  it('eat/forage 看进食线;earn 看贫困线;sleep 看昼夜困线', () => {
    expect(driveSatisfied(char({ energy: BALANCE.HUNGER_EAT_ENERGY + 1 }), 'eat', NOON)).toBe(true);
    expect(driveSatisfied(char({ energy: BALANCE.HUNGER_EAT_ENERGY }), 'eat', NOON)).toBe(false);
    expect(driveSatisfied(char({ energy: 10 }), 'forage', NOON)).toBe(false);
    expect(driveSatisfied(char({ coins: BALANCE.POVERTY_COIN_LINE }), 'earn', NOON)).toBe(true);
    expect(driveSatisfied(char({ coins: BALANCE.POVERTY_COIN_LINE - 1 }), 'earn', NOON)).toBe(false);
    expect(driveSatisfied(char({ energy: BALANCE.SLEEPY_NIGHT_ENERGY + 1 }), 'sleep', NIGHT)).toBe(true);
    expect(driveSatisfied(char({ energy: BALANCE.SLEEPY_NIGHT_ENERGY }), 'sleep', NIGHT)).toBe(false);
  });
});

describe('jevDecide(systemone choice 候选选一)', () => {
  const park = TOWN_MAP.places.find((p) => p.id === 'park')!;
  const captureLlm = (choice: string) => {
    const captured: { prompt?: string; criteria?: Record<string, string> } = {};
    const llm: MemoryLlm = {
      systemOne: (_slot, prompt, questions) => {
        captured.prompt = prompt;
        captured.criteria = (
          questions as unknown as { next: { criteria: Record<string, string> } }
        ).next.criteria;
        return Promise.resolve({
          model: 'stub',
          answers: { next: { type: 'choice', choice, probabilities: {}, confidence: 1 } },
        }) as never;
      },
      embed: () => Promise.reject(new Error('unused')),
      chat: () => Promise.reject(new Error('unused')),
      chatStructured: () => Promise.reject(new Error('unused')),
    };
    return { llm, captured };
  };
  const ctx = (overrides: Partial<JevContext> = {}) => ({
    night: false,
    valence: 0,
    hasSellable: false,
    wantWhys: [],
    ...overrides,
  });

  it('选中候选 → 冲动 want(E6 不直执);排除当前所在;选中标签落 choice', async () => {
    const { llm } = captureLlm('公园');
    const decision: Decision | null = await jevDecide(llm, char({}), TOWN_MAP);
    expect(decision).not.toBeNull();
    expect(decision!.layer).toBe('jev');
    expect(decision!.choice).toBe('公园');
    expect(decision!.intent).toBeUndefined();
    expect(decision!.impulse).toEqual({ activityId: 'stroll', why: '去公园走走散心' });
    // E6:商店候选仅在背包有货时出现(冲动=变现);无货时候选池=公园/出去转转
    const { llm: llm2, captured: captured2 } = captureLlm('公园');
    await jevDecide(llm2, char({ x: SHOP_ENTRANCE.x, y: SHOP_ENTRANCE.y }), TOWN_MAP);
    expect(Object.keys(captured2.criteria!)).toEqual(['公园', '出去转转']);
  });

  it('概率采样(E6):probabilities 分布采样命中高权候选;空分布回落 argmax choice', async () => {
    const weighted: MemoryLlm = {
      systemOne: () =>
        Promise.resolve({
          model: 'stub',
          answers: {
            next: {
              type: 'choice',
              choice: '出去转转',
              probabilities: { 公园: 0, 出去转转: 1 },
              confidence: 1,
            },
          },
        }) as never,
      embed: () => Promise.reject(new Error('unused')),
      chat: () => Promise.reject(new Error('unused')),
      chatStructured: () => Promise.reject(new Error('unused')),
    };
    for (let i = 0; i < 5; i += 1) {
      const decision = await jevDecide(weighted, char({}), TOWN_MAP);
      expect(decision!.choice).toBe('出去转转');
      expect(decision!.impulse!.activityId).toBe('explore');
    }
    // probabilities 全空:回落 argmax choice(公园)
    const { llm } = captureLlm('公园');
    const fallback = await jevDecide(llm, char({}), TOWN_MAP);
    expect(fallback!.choice).toBe('公园');
  });

  it('confidence 低于门限 → null(低置信=没产生直觉,不产出冲动)', async () => {
    const shy: MemoryLlm = {
      systemOne: () =>
        Promise.resolve({
          model: 'stub',
          answers: {
            next: { type: 'choice', choice: '公园', probabilities: { 公园: 1 }, confidence: 0.1 },
          },
        }) as never,
      embed: () => Promise.reject(new Error('unused')),
      chat: () => Promise.reject(new Error('unused')),
      chatStructured: () => Promise.reject(new Error('unused')),
    };
    expect(await jevDecide(shy, char({}), TOWN_MAP)).toBeNull();
  });

  it('有货时商店候选出现,冲动映射 sell_goods;社交候选映射 socialize(带 target)', async () => {
    const { llm: sellLlm } = captureLlm('商店');
    const sell = await jevDecide(sellLlm, char({}), TOWN_MAP, [], undefined, ctx({ hasSellable: true }));
    expect(sell!.impulse).toEqual({ activityId: 'sell_goods', why: '背包有货,拿去商店卖掉换钱' });
    const { llm: socialLlm } = captureLlm('找铁牛聊天');
    const social = await jevDecide(
      socialLlm,
      char({}),
      TOWN_MAP,
      [{ characterId: 'npc-1', name: '铁牛', affinity: 70, x: 5, y: 5 }],
    );
    expect(social!.impulse).toEqual({
      activityId: 'socialize',
      why: '去找铁牛聊聊,你们很投缘',
      targetCharacterId: 'npc-1',
    });
  });

  it('E5 状态感知: 深夜公园降权/低落散心加权/有货卖货导向/wants 注入题面', async () => {
    const { llm: nightLlm, captured: nightCaptured } = captureLlm('公园');
    await jevDecide(nightLlm, char({}), TOWN_MAP, [], undefined, ctx({ night: true }));
    expect(nightCaptured.criteria!['公园']).toContain('夜深了');

    const { llm: sadLlm, captured: sadCaptured } = captureLlm('公园');
    await jevDecide(sadLlm, char({}), TOWN_MAP, [], undefined, ctx({ valence: -0.5 }));
    expect(sadCaptured.criteria!['公园']).toContain('心情');
    expect(sadCaptured.criteria!['公园']).not.toContain('夜深了');

    const { llm: sellLlm, captured: sellCaptured } = captureLlm('商店');
    await jevDecide(sellLlm, char({}), TOWN_MAP, [], undefined, ctx({ hasSellable: true }));
    expect(sellCaptured.criteria!['商店']).toContain('卖');

    const { llm: wantLlm, captured: wantCaptured } = captureLlm('公园');
    await jevDecide(wantLlm, char({}), TOWN_MAP, [], '书虫', ctx({ wantWhys: ['想采浆果换钱'] }));
    expect(wantCaptured.prompt).toContain('惦记着');
    expect(wantCaptured.prompt).toContain('想采浆果换钱');
    expect(wantCaptured.prompt).toContain('书虫');
  });

  it('公园终点化(E5→E6):在园内选公园 → stroll 冲动 want(执行器就地开散步)', async () => {
    const decision = await jevDecide(
      stubLlm('公园'),
      char({ x: park.entrance.x, y: park.entrance.y }),
      TOWN_MAP,
    );
    expect(decision!.impulse).toEqual({ activityId: 'stroll', why: '就在公园散会儿步' });
    expect(decision!.intent).toBeUndefined();
    expect(decision!.choice).toBe('公园');
  });

  it('「出去转转」(E5→E6) → explore 冲动 want(两段式交执行器)', async () => {
    const decision = await jevDecide(stubLlm('出去转转'), char({}), TOWN_MAP);
    expect(decision).not.toBeNull();
    expect(decision!.choice).toBe('出去转转');
    expect(decision!.impulse).toEqual({ activityId: 'explore', why: '换个地方随便看看' });
  });

  it('回答不在候选内/调用失败 → null(回落 continue,不阻塞泵)', async () => {
    expect(await jevDecide(stubLlm('火星'), char({}), TOWN_MAP)).toBeNull();
    const broken: MemoryLlm = {
      systemOne: () => Promise.reject(new Error('jev 槽未配置')),
      embed: () => Promise.reject(new Error('unused')),
      chat: () => Promise.reject(new Error('unused')),
      chatStructured: () => Promise.reject(new Error('unused')),

    };
    expect(await jevDecide(broken, char({}), TOWN_MAP)).toBeNull();
  });

  it('失能(死亡/虚脱倒地)与忙碌(活动/移动)→ null,不给非空闲角色派去处', async () => {
    expect(await jevDecide(stubLlm('公园'), char({ alive: false }), TOWN_MAP)).toBeNull();
    expect(await jevDecide(stubLlm('公园'), char({ collapsed: true }), TOWN_MAP)).toBeNull();
    expect(
      await jevDecide(stubLlm('公园'), char({ activity: sleeping() }), TOWN_MAP),
    ).toBeNull();
    expect(await jevDecide(stubLlm('公园'), char({ path: [{ x: 1, y: 1 }] }), TOWN_MAP)).toBeNull();
  });
});

describe('wantSelect(意图执行,慢层产 want 快层评分择条两段式)', () => {
  const studyAnchors = [{ x: 11, y: 12 }];
  const anchorsOf = (activityId: string): Array<{ x: number; y: number }> =>
    activityId === 'study' ? studyAnchors : [];

  it('无意图/异日意图 → null(意图不越日生效)', () => {
    expect(wantSelect(char({}), undefined, 1, TOWN_MAP, anchorsOf)).toBeNull();
    expect(wantSelect(char({}), intents(2, [{ activityId: 'study' }]), 1, TOWN_MAP, anchorsOf)).toBeNull();
    expect(wantSelect(char({}), intents(1, []), 1, TOWN_MAP, anchorsOf)).toBeNull();
  });

  it('高分 want 优先:两段式先 move_to 锚点(气泡带第一人称 why)', () => {
    const day = intents(1, [
      { activityId: 'stroll', urgency: 0.3, why: '透透气' },
      { activityId: 'study', urgency: 0.9, why: '想学新东西' },
    ]);
    const far = wantSelect(char({}), day, 1, TOWN_MAP, anchorsOf);
    expect(far).not.toBeNull();
    expect(far!.layer).toBe('plan');
    expect(far!.wantId).toBe('w1-1');
    expect(far!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 11, y: 12 });
    expect(far!.bubble).toContain('想学新东西');
  });

  it('到位→start_activity;bias 加成可翻盘低 urgency want', () => {
    const day = intents(1, [
      { activityId: 'stroll', urgency: 0.4 },
      { activityId: 'study', urgency: 0.9, why: '想学新东西' },
    ]);
    const near = wantSelect(char({ x: 11, y: 12 }), day, 1, TOWN_MAP, anchorsOf);
    expect(near!.intent).toEqual({
      type: 'start_activity',
      characterId: 'char-1',
      activityId: 'study',
    });
    expect(near!.bubble).toContain('学习');

    // bias: study=-1(被方针排斥)×0 → 落选;stroll 胜出
    const flipped = wantSelect(char({}), day, 1, TOWN_MAP, anchorsOf, { study: -1, stroll: 1 });
    expect(flipped!.wantId).toBe('w1-0');
    expect(flipped!.intent?.type).toBe('move_to');
  });

  it('doing 粘性:进行中的 want 仍是候选(被打断后可续)', () => {
    const day = intents(1, [{ activityId: 'study', urgency: 0.8, status: 'doing' }]);
    const decision = wantSelect(char({}), day, 1, TOWN_MAP, anchorsOf);
    expect(decision!.wantId).toBe('w1-0');
  });

  it('不可执行 want 当场废弃:无居所 rest→abandonedWantIds;体力闸拦下非基础块→pending 保留', () => {
    const restDay = intents(1, [{ activityId: 'rest', urgency: 0.9 }]);
    const none = wantSelect(char({ housing: null }), restDay, 1, TOWN_MAP, anchorsOf);
    expect(none).toEqual({
      layer: 'plan',
      action: 'continue',
      abandonedWantIds: ['w1-0'],
    });

    const workDay = intents(1, [
      { activityId: 'rest', urgency: 0.9 },
      { activityId: 'work', urgency: 0.8 },
    ]);
    const mixed = wantSelect(char({ housing: null, energy: 10 }), workDay, 1, TOWN_MAP, anchorsOf);
    // rest 废弃 + work 被体力闸拦下(≤20 非基础块)→ continue 携废弃列表
    expect(mixed).toEqual({ layer: 'plan', action: 'continue', abandonedWantIds: ['w1-0'] });

    // 基础块(stroll)体力闸放行
    const strollDay = intents(1, [{ activityId: 'stroll', urgency: 0.9 }]);
    const stroll = wantSelect(char({ energy: 10 }), strollDay, 1, TOWN_MAP, anchorsOf);
    expect(stroll!.action).toBe('react');
  });

  it('数值需求增益:缺钱时 work 压过同 urgency 的 stroll', () => {
    const day = intents(1, [
      { activityId: 'stroll', urgency: 0.9 },
      { activityId: 'work', urgency: 0.8 },
    ]);
    const broke = wantSelect(char({ coins: 5 }), day, 1, TOWN_MAP, anchorsOf);
    // work: 0.8×1.5=1.2 > stroll: 0.9(±5% 抖动不改序)
    expect(broke!.wantId).toBe('w1-1');
    const rich = wantSelect(char({ coins: 500 }), day, 1, TOWN_MAP, anchorsOf);
    // work: 0.8×0.6=0.48 < stroll: 0.9
    expect(rich!.wantId).toBe('w1-0');
  });

  it('忙(活动/移动)与失能 → null,意图不越权打断进行中行为', () => {
    const day = intents(1, [{ activityId: 'study', urgency: 0.9 }]);
    expect(wantSelect(char({ activity: sleeping() }), day, 1, TOWN_MAP, anchorsOf)).toBeNull();
    expect(wantSelect(char({ path: [{ x: 1, y: 1 }] }), day, 1, TOWN_MAP, anchorsOf)).toBeNull();
    expect(wantSelect(char({ alive: false }), day, 1, TOWN_MAP, anchorsOf)).toBeNull();
    expect(wantSelect(char({ collapsed: true }), day, 1, TOWN_MAP, anchorsOf)).toBeNull();
  });
});

describe('wantSelect explore want(散列目标,want 内粘性)', () => {
  const anchorsOf = (): Array<{ x: number; y: number }> => [];
  const exploreDay = intents(3, [{ activityId: 'explore', urgency: 0.9, id: 'w3-0' }]);
  const targetOf = (key: string) =>
    exploreTarget(key, ['park', 'shop', 'restaurant', 'gym', 'library', 'office'], TOWN_MAP);

  it('同键散列确定性:重复取目标命中同一场所', () => {
    expect(targetOf('char-1|w3-0')!.id).toBe(targetOf('char-1|w3-0')!.id);
    expect(targetOf('苏晚|w3-0')!.id).toBe(targetOf('苏晚|w3-0')!.id);
  });

  it('异地→move_to 散列目标入口(气泡带场所名);换 want/换人可换目标', () => {
    const first = wantSelect(char({}), exploreDay, 3, TOWN_MAP, anchorsOf);
    expect(first).not.toBeNull();
    expect(first!.layer).toBe('plan');
    expect(first!.wantId).toBe('w3-0');
    const target = targetOf('char-1|w3-0')!;
    expect(first!.intent).toEqual({
      type: 'move_to',
      characterId: 'char-1',
      x: target.entrance.x,
      y: target.entrance.y,
    });
    expect(first!.bubble).toContain(target.name);
    // 不同(角色,want)键进池分布:六个键至少命中两种场所(纯粘性退化=全部同地)
    const keys = ['char-1|w3-0', 'char-1|w3-1', 'char-1|w3-2', 'char-2|w3-0', 'char-2|w3-1', 'char-2|w3-2'];
    expect(new Set(keys.map((k) => targetOf(k)!.id)).size).toBeGreaterThan(1);
  });

  it('已在目标场所→就地 start_activity explore', () => {
    const target = targetOf('char-1|w3-0')!;
    const started = wantSelect(
      char({ x: target.entrance.x, y: target.entrance.y }),
      exploreDay,
      3,
      TOWN_MAP,
      anchorsOf,
    );
    expect(started!.intent).toEqual({
      type: 'start_activity',
      characterId: 'char-1',
      activityId: 'explore',
    });
    expect(started!.bubble).toContain('探索');
  });
});

describe('wantSelect E1 三通路(采集直发/制作验料/知识门槛)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];

  it('采集 want(E4 两段式):远处 move_to 邻位/贴身 work_task;无节点本轮跳过;知识 0 放行', () => {
    const day = intents(1, [{ activityId: 'gather_berry', urgency: 0.9, why: '采点浆果' }]);
    // 远节点((30,30)→(12,8)):先 move_to 邻位
    const far = wantSelect(char({ knowledge: 0 }), day, 1, TOWN_MAP, noAnchors, {}, {
      nearestNode: () => ({ id: 'berry_bush:12:8', x: 12, y: 8 }),
    });
    expect(far!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 12, y: 8 });
    expect(far!.bubble).toContain('浆果丛');

    // 贴身节点:直发 work_task(E4 起采集零门槛,知识 0 可接)
    const near = wantSelect(char({ knowledge: 0 }), day, 1, TOWN_MAP, noAnchors, {}, {
      nearestNode: () => ({ id: 'berry_bush:31:30', x: 31, y: 30 }),
    });
    expect(near!.intent).toEqual({
      type: 'work_task',
      characterId: 'char-1',
      targetId: 'berry_bush:31:30',
    });

    expect(wantSelect(char({ knowledge: 5 }), day, 1, TOWN_MAP, noAnchors)).toBeNull();
  });

  it('制作 want:验料就绪+到站→craft;缺料跳过;不在站点先前往', () => {
    const day = intents(1, [{ activityId: 'craft_berry_pie', urgency: 0.9, why: '烤个派' }]);
    const stove = [{ x: 20, y: 21 }];
    const stoveAnchors = (activityId: string): Array<{ x: number; y: number }> =>
      activityId === 'craft_berry_pie' ? stove : [];
    const ready = { recipeReady: () => true };

    const atStation = wantSelect(
      char({ x: 20, y: 21, knowledge: 5 }),
      day,
      1,
      TOWN_MAP,
      stoveAnchors,
      {},
      ready,
    );
    expect(atStation!.intent).toEqual({
      type: 'craft',
      characterId: 'char-1',
      recipeId: 'craft_berry_pie',
    });

    const far = wantSelect(char({ knowledge: 5 }), day, 1, TOWN_MAP, stoveAnchors, {}, ready);
    expect(far!.intent?.type).toBe('move_to');

    expect(
      wantSelect(char({ knowledge: 5 }), day, 1, TOWN_MAP, stoveAnchors, {}, {
        recipeReady: () => false,
      }),
    ).toBeNull();
  });

  it('知识门槛预检:不够则跳过(pending 保留),学成后照常执行', () => {
    const day = intents(1, [{ activityId: 'waiter', urgency: 0.9 }]);
    expect(wantSelect(char({}), day, 1, TOWN_MAP, noAnchors)).toBeNull();
    // 广场(30,30)在餐厅矩形内:上岗位就地开始
    const go = wantSelect(char({ x: 8, y: 12, knowledge: 5 }), day, 1, TOWN_MAP, noAnchors);
    expect(go!.intent?.type).toBe('move_to'); // 前往餐馆上岗
  });
});

describe('wantSelect 卖货 want(E4 变现通路)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];
  const day = intents(1, [{ activityId: 'sell_goods', urgency: 0.9, why: '卖点货换钱' }]);
  const shopXY = { x: SHOP_ENTRANCE.x, y: SHOP_ENTRANCE.y + 1 }; // 店内

  it('店内:总价最高的带价物整叠 sell_item(berry 4×2=8 胜 scrap 3×1=3)', () => {
    const decision = wantSelect(char({ x: shopXY.x, y: shopXY.y, backpack: { berry: 4, scrap: 3 } }), day, 1, TOWN_MAP, noAnchors);
    expect(decision!.intent).toEqual({
      type: 'sell_item',
      characterId: 'char-1',
      itemId: 'berry',
      count: 4,
    });
    expect(decision!.bubble).toContain('卖点货换钱');
    expect(decision!.bubble).toContain('浆果');
  });

  it('店外:先 move_to 商店入口', () => {
    const decision = wantSelect(char({ backpack: { scrap: 2 } }), day, 1, TOWN_MAP, noAnchors);
    expect(decision!.intent).toEqual({
      type: 'move_to',
      characterId: 'char-1',
      x: SHOP_ENTRANCE.x,
      y: SHOP_ENTRANCE.y,
    });
  });

  it('空背包(无可变现物):本轮 continue,want 留 pending 非 abandoned', () => {
    const decision = wantSelect(char({}), day, 1, TOWN_MAP, noAnchors);
    expect(decision!.action).toBe('continue');
    expect(decision!.wantId).toBe('w1-0');
    expect(decision!.intent).toBeUndefined();
  });
});

describe('wantSelect 人指向社交(E2 寻人/让位)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];

  it('远处熟人: move_to 对方当前位置寻人,wantId 带出', () => {
    const day = intents(1, [
      { activityId: 'socialize', urgency: 0.9, why: '想找铁牛聊聊', targetCharacterId: 'npc-9' },
    ]);
    const decision = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, {
      positionOf: (id) => (id === 'npc-9' ? { x: 30, y: 30, name: '铁牛' } : null),
    });
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe('react');
    expect(decision!.wantId).toBe('w1-0');
    expect(decision!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 30, y: 30 });
    expect(decision!.bubble).toContain('铁牛');
  });

  it('已贴身(≤SOCIAL_CHAT_DISTANCE): chatWith 交还社交管线生成对话,不产裸意图', () => {
    const day = intents(1, [
      { activityId: 'socialize', urgency: 0.9, targetCharacterId: 'npc-9' },
    ]);
    const decision = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, {
      positionOf: (id) => (id === 'npc-9' ? { x: 9, y: 12, name: '铁牛' } : null),
      nowMin: 500,
    });
    expect(decision!.action).toBe('react');
    expect(decision!.wantId).toBe('w1-0');
    expect(decision!.chatWith).toBe('npc-9');
    expect(decision!.intent).toBeUndefined(); // 聊天归 executeChatWant,不走 runIntent
  });

  it('贴身但簿记未出短冷却(生成在途/走散降级): continue 不重入聊天,want 保留', () => {
    const day = intents(1, [
      { activityId: 'socialize', urgency: 0.9, targetCharacterId: 'npc-9' },
    ]);
    const world = {
      positionOf: (id: string) => (id === 'npc-9' ? { x: 9, y: 12, name: '铁牛' } : null),
      nowMin: 500,
      pairLastChatAt: (_a: string, _b: string) => 495, // 5 分钟前刚簿记(在途/短窗)
    };
    const busy = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, world);
    expect(busy!.action).toBe('continue');
    expect(busy!.wantId).toBe('w1-0');
    expect(busy!.chatWith).toBeUndefined();
    expect(busy!.intent).toBeUndefined();
    // 短窗已过(≥SOCIAL_RETRY_COOLDOWN):恢复 chatWith
    const ready = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, {
      ...world,
      pairLastChatAt: () => 500 - 10,
    });
    expect(ready!.action).toBe('react');
    expect(ready!.chatWith).toBe('npc-9');
  });

  it('对方在途(走路中)也点火(E6.2): onPath 门控退役,首触=召唤零模型', () => {
    const day = intents(1, [
      { activityId: 'socialize', urgency: 0.9, targetCharacterId: 'npc-9' },
    ]);
    const decision = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, {
      positionOf: (id) => (id === 'npc-9' ? { x: 9, y: 12, name: '铁牛', onPath: true } : null),
    });
    expect(decision!.action).toBe('react');
    expect(decision!.chatWith).toBe('npc-9'); // 走完当前步后可应答,不再等静置
  });

  it('贴身但该对生成在途(E6.2 会合协议): continue 原地静候 social.chat 结算', () => {
    const day = intents(1, [
      { activityId: 'socialize', urgency: 0.9, targetCharacterId: 'npc-9' },
    ]);
    const decision = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, {
      positionOf: (id) => (id === 'npc-9' ? { x: 9, y: 12, name: '铁牛' } : null),
      chatGeneratingWith: (a, b) => a === 'char-1' && b === 'npc-9',
    });
    expect(decision!.action).toBe('continue');
    expect(decision!.wantId).toBe('w1-0');
    expect(decision!.chatWith).toBeUndefined();
  });

  it('贴身但我召唤的对方未应答(E6.2 会合协议): continue 不重复点火不代答', () => {
    const day = intents(1, [
      { activityId: 'socialize', urgency: 0.9, targetCharacterId: 'npc-9' },
    ]);
    const decision = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, {
      positionOf: (id) => (id === 'npc-9' ? { x: 9, y: 12, name: '铁牛' } : null),
      summonAwaiting: (targetId) => targetId === 'npc-9',
    });
    expect(decision!.action).toBe('continue');
    expect(decision!.wantId).toBe('w1-0');
    expect(decision!.chatWith).toBeUndefined();
  });

  it('对方不在(下线/亡故): continue 跳过且 want 废弃', () => {
    const day = intents(1, [
      { activityId: 'socialize', urgency: 0.9, targetCharacterId: 'ghost' },
    ]);
    const decision = wantSelect(char({}), day, 1, TOWN_MAP, noAnchors, {}, {
      positionOf: () => null,
    });
    expect(decision!.action).toBe('continue');
    expect(decision!.wantId).toBe('w1-0');
    expect(decision!.abandonedWantIds).toContain('w1-0');
    expect(decision!.intent).toBeUndefined();
  });
});

describe('wantSelect 驱力分支(E6.2 rule→驱力,伪活动 id 专属执行)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];
  const beds = [{ x: 5, y: 6 }];
  const homeAnchors = (activityId: string, placeId: string | null): Array<{ x: number; y: number }> =>
    activityId === 'sleep' && placeId === 'home-a' ? beds : [];
  const shopXY = { x: SHOP_ENTRANCE.x, y: SHOP_ENTRANCE.y + 1 }; // 店内

  it('eat want:吃背包→eat_item;压力已过→doneWantIds 收口', () => {
    const day = intents(1, [
      { activityId: 'eat', urgency: 0.9, origin: 'drive', why: '体力低了,得吃点东西' },
    ]);
    const eat = wantSelect(char({ energy: 20, backpack: { apple: 1 } }), day, 1, TOWN_MAP, noAnchors);
    expect(eat!.action).toBe('react');
    expect(eat!.wantId).toBe('w1-0');
    expect(eat!.intent).toEqual({ type: 'eat_item', characterId: 'char-1', itemId: 'apple' });

    const done = wantSelect(char({ energy: 80 }), day, 1, TOWN_MAP, noAnchors);
    expect(done!.action).toBe('continue');
    expect(done!.doneWantIds).toEqual(['w1-0']);
    expect(done!.intent).toBeUndefined();
  });

  it('eat want:无食物去商店 move_to;店内买最便宜;没钱/店空 stuck→abandoned', () => {
    const day = intents(1, [{ activityId: 'eat', urgency: 0.9, origin: 'drive' }]);
    const go = wantSelect(char({ energy: 20 }), day, 1, TOWN_MAP, noAnchors, {}, {
      shopStock: () => 5,
    });
    expect(go!.intent).toEqual({
      type: 'move_to',
      characterId: 'char-1',
      x: SHOP_ENTRANCE.x,
      y: SHOP_ENTRANCE.y,
    });

    const cheapest = [...SHOP_ITEMS].sort((a, b) => a.price! - b.price!)[0]!;
    const buy = wantSelect(char({ energy: 20, x: shopXY.x, y: shopXY.y, coins: cheapest.price! }), day, 1, TOWN_MAP, noAnchors, {}, {
      shopStock: () => 5,
    });
    expect(buy!.intent).toEqual({ type: 'buy_item', characterId: 'char-1', itemId: cheapest.id });

    const stuck = wantSelect(char({ energy: 20, x: shopXY.x, y: shopXY.y, coins: 0 }), day, 1, TOWN_MAP, noAnchors, {}, {
      shopStock: () => 0,
    });
    expect(stuck!.action).toBe('continue');
    expect(stuck!.abandonedWantIds).toEqual(['w1-0']);
  });

  it('earn want:店内整叠 sell_item;coins 回贫困线→done', () => {
    const day = intents(1, [{ activityId: 'earn', urgency: 0.7, origin: 'drive', why: '口袋见底' }]);
    const sell = wantSelect(char({ coins: 5, x: shopXY.x, y: shopXY.y, backpack: { berry: 4 } }), day, 1, TOWN_MAP, noAnchors);
    expect(sell!.intent).toEqual({ type: 'sell_item', characterId: 'char-1', itemId: 'berry', count: 4 });

    const done = wantSelect(char({ coins: BALANCE.POVERTY_COIN_LINE }), day, 1, TOWN_MAP, noAnchors);
    expect(done!.doneWantIds).toEqual(['w1-0']);
  });

  it('sleep want:远处回床 move_to;床上 start_activity sleep;体力过困线→done', () => {
    const day = intents(1, [{ activityId: 'sleep', urgency: 0.85, origin: 'drive', why: '夜深了' }]);
    const go = wantSelect(char({ energy: 40 }), day, 1, TOWN_MAP, homeAnchors, {}, { night: true });
    expect(go!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 5, y: 6 });

    const inBed = wantSelect(char({ x: 5, y: 6, energy: 40 }), day, 1, TOWN_MAP, homeAnchors, {}, { night: true });
    expect(inBed!.intent).toEqual({ type: 'start_activity', characterId: 'char-1', activityId: 'sleep' });

    const done = wantSelect(
      char({ energy: BALANCE.SLEEPY_NIGHT_ENERGY + 1 }),
      day,
      1,
      TOWN_MAP,
      homeAnchors,
      {},
      { night: true },
    );
    expect(done!.doneWantIds).toEqual(['w1-0']);
  });

  it('sleep want 租约失效 → 公园长椅兜底(两段式 rest,不再撞床)', () => {
    const expired = { propertyId: 'home-a', ownership: 'rent' as const, paidThroughDay: DAY - 1 };
    const parkBench = (activityId: string, placeId: string | null): Array<{ x: number; y: number }> =>
      activityId === 'rest' && placeId === 'park' ? [{ x: 7, y: 8 }] : [];
    const day = intents(1, [{ activityId: 'sleep', urgency: 0.85, origin: 'drive', why: '困了' }]);
    const go = wantSelect(char({ energy: 40, housing: expired }), day, 1, TOWN_MAP, parkBench, {}, { night: true });
    expect(go!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 7, y: 8 });

    const sit = wantSelect(char({ x: 7, y: 8, energy: 40, housing: expired }), day, 1, TOWN_MAP, parkBench, {}, { night: true });
    expect(sit!.intent).toEqual({ type: 'start_activity', characterId: 'char-1', activityId: 'rest' });
  });

  it('forage want:远节点 move_to 邻位;无节点 stuck→abandoned(写侧重评改道)', () => {
    const day = intents(1, [{ activityId: 'forage', urgency: 0.8, origin: 'drive', why: '采点吃的' }]);
    const far = wantSelect(char({ energy: 25, coins: 0 }), day, 1, TOWN_MAP, noAnchors, {}, {
      nearestEdibleNode: () => ({ id: 'berry_bush:12:8', x: 12, y: 8 }),
    });
    expect(far!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 12, y: 8 });

    const stuck = wantSelect(char({ energy: 25, coins: 0 }), day, 1, TOWN_MAP, noAnchors);
    expect(stuck!.action).toBe('continue');
    expect(stuck!.abandonedWantIds).toEqual(['w1-0']);
  });

  it('驱力豁免体力闸与非驱力 id 拦截:体力 10 的 sleep want 照常执行;词汇表外 drive want 废弃', () => {
    const parkBench = (activityId: string, placeId: string | null): Array<{ x: number; y: number }> =>
      activityId === 'rest' && placeId === 'park' ? [{ x: 7, y: 8 }] : [];
    const day = intents(1, [{ activityId: 'sleep', urgency: 0.7, origin: 'drive', why: '困了' }]);
    const decision = wantSelect(char({ energy: 10 }), day, 1, TOWN_MAP, parkBench, {}, { night: false });
    expect(decision!.action).toBe('react');
    expect(decision!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 7, y: 8 });

    const alien = intents(1, [{ activityId: 'meditate', urgency: 0.9, origin: 'drive' }]);
    const odd = wantSelect(char({ energy: 80 }), alien, 1, TOWN_MAP, noAnchors);
    expect(odd!.action).toBe('continue');
    expect(odd!.abandonedWantIds).toEqual(['w1-0']);
  });
});

describe('wantSelect 救援 want(E6.2 triage respond→冲动)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];

  it('目标倒地:move_to 过去看;到场/已起/人没了→doneWantIds 收口', () => {
    const day = intents(1, [
      { activityId: 'rescue', urgency: 0.85, origin: 'event', why: '过去看看苏晚', targetCharacterId: 'npc-9' },
    ]);
    const world = (pos: { x: number; y: number; name: string; alive: boolean } | null): WantWorldQueries => ({
      posOfAny: (id) => (id === 'npc-9' ? pos : null),
    });
    const go = wantSelect(char({ x: 8, y: 12 }), day, 1, TOWN_MAP, noAnchors, {}, world({ x: 20, y: 20, name: '苏晚', alive: false }));
    expect(go!.action).toBe('react');
    expect(go!.wantId).toBe('w1-0');
    expect(go!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 20, y: 20 });

    const arrived = wantSelect(char({ x: 20, y: 20 }), day, 1, TOWN_MAP, noAnchors, {}, world({ x: 20, y: 20, name: '苏晚', alive: false }));
    expect(arrived!.doneWantIds).toEqual(['w1-0']);

    const revived = wantSelect(char({}), day, 1, TOWN_MAP, noAnchors, {}, world({ x: 20, y: 20, name: '苏晚', alive: true }));
    expect(revived!.doneWantIds).toEqual(['w1-0']);

    const gone = wantSelect(char({}), day, 1, TOWN_MAP, noAnchors, {}, world(null));
    expect(gone!.doneWantIds).toEqual(['w1-0']);
  });

  it('rescue want 无 target/体力闸:残片废弃不悬挂;低体力照常放行(豁免体力闸)', () => {
    const fragment = intents(1, [{ activityId: 'rescue', urgency: 0.85, origin: 'event', why: '过去看看' }]);
    const dropped = wantSelect(char({ energy: 10 }), fragment, 1, TOWN_MAP, noAnchors);
    expect(dropped!.action).toBe('continue');
    expect(dropped!.abandonedWantIds).toEqual(['w1-0']);

    const day = intents(1, [
      { activityId: 'rescue', urgency: 0.85, origin: 'event', why: '过去看看苏晚', targetCharacterId: 'npc-9' },
    ]);
    const low = wantSelect(char({ energy: 10 }), day, 1, TOWN_MAP, noAnchors, {}, {
      posOfAny: () => ({ x: 20, y: 20, name: '苏晚', alive: false }),
    });
    expect(low!.action).toBe('react');
    expect(low!.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 20, y: 20 });
  });
});
