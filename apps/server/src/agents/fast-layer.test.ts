import { TOWN_MAP, SHOP_ITEMS } from '@sims/shared';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance.js';
import type { WorldCharacter } from '../world/character.js';
import type { DayIntents } from './cognition.js';
import {
  exploreTarget,
  jevDecide,
  wantSelect,
  ruleDecide,
  type Decision,
  type JevContext,
  type RuleWorldQueries,
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

describe('ruleDecide(快层 rule,零模型数值压力反应)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];
  const decide = (c: WorldCharacter, minuteOfDay = NOON): Decision =>
    ruleDecide(c, DAY, minuteOfDay, TOWN_MAP, noAnchors);

  it('数值健康且空闲 → continue', () => {
    expect(decide(char({}))).toEqual({ layer: 'rule', action: 'continue' });
  });

  it('忙(活动/移动)与失能(死亡/虚脱)一律 continue,不打断不越权', () => {
    expect(decide(char({ activity: { id: 'rest', startedAtGameMinutes: 0 } as never })).action).toBe('continue');
    expect(decide(char({ path: [{ x: 1, y: 1 }] })).action).toBe('continue');
    expect(decide(char({ alive: false, energy: 0 })).action).toBe('continue');
    expect(decide(char({ collapsed: true })).action).toBe('continue');
  });

  it('饥饿链:背包有食物吃食物 → 无食物去商店 → 店内买最便宜 → 没钱 continue', () => {
    const hungry = BALANCE.SURVIVAL_HUNGER_ENERGY_LINE;
    const eat = decide(char({ energy: hungry, backpack: { apple: 1, wood: 2 } }));
    expect(eat.action).toBe('react');
    expect(eat.intent).toEqual({ type: 'eat_item', characterId: 'char-1', itemId: 'apple' });
    expect(eat.bubble).toContain('苹果');

    const goShop = decide(char({ energy: hungry }));
    expect(goShop.intent).toEqual({
      type: 'move_to',
      characterId: 'char-1',
      x: SHOP_ENTRANCE.x,
      y: SHOP_ENTRANCE.y,
    });

    const shopXY = { x: SHOP_ENTRANCE.x, y: SHOP_ENTRANCE.y + 1 }; // 店内
    const cheapest = [...SHOP_ITEMS].sort((a, b) => a.price! - b.price!)[0]!;
    const buy = decide(char({ energy: hungry, x: shopXY.x, y: shopXY.y, coins: cheapest.price! }));
    expect(buy.intent).toEqual({ type: 'buy_item', characterId: 'char-1', itemId: cheapest.id });

    const broke = decide(char({ energy: hungry, coins: 0 }));
    expect(broke.action).toBe('continue');
  });

  it('房租链:租约次日到期且有钱续租;自持有房/钱不够/租期充裕均 continue', () => {
    const due = decide(
      char({ housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 } }),
    );
    expect(due.action).toBe('react');
    expect(due.intent).toEqual({ type: 'rent_property', characterId: 'char-1', propertyId: 'home-a' });
    expect(due.bubble).toContain('公寓 A');

    const owned = char({ housing: { propertyId: 'home-a', ownership: 'owned', paidThroughDay: DAY + 1 } });
    expect(decide(owned).action).toBe('continue');
    // E1 贫困阀:钱不够续租但闲着 → 先谋生(贫困阀保人设选岗),不再静默
    const broke = char({ coins: 0, housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 } });
    expect(decide(broke).action).toBe('react');
    expect(decide(broke).bubble).toContain('挣点钱');
  });

  it('饥饿优先于房租(生存压力先行)', () => {
    const both = char({
      energy: BALANCE.SURVIVAL_HUNGER_ENERGY_LINE,
      housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 },
    });
    expect(decide(both).intent?.type).toBe('move_to');
  });

  it('困倦压力(D3):夜间体力≤夜间线→回家睡;白天线更低(25);不困/无居所/无床 continue', () => {
    const beds = [{ x: 5, y: 6 }];
    const homeAnchors = (activityId: string, placeId: string | null): Array<{ x: number; y: number }> =>
      activityId === 'sleep' && placeId === 'home-a' ? beds : [];
    const decide2 = (c: WorldCharacter, minuteOfDay: number): Decision =>
      ruleDecide(c, DAY, minuteOfDay, TOWN_MAP, homeAnchors);
    const housing = { propertyId: 'home-a', ownership: 'rent' as const, paidThroughDay: DAY + 5 };

    const night = decide2(char({ energy: BALANCE.SLEEPY_NIGHT_ENERGY, housing }), NIGHT);
    expect(night.action).toBe('react');
    expect(night.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 5, y: 6 });
    expect(night.bubble).toContain('困');

    const inBed = decide2(char({ x: 5, y: 6, energy: BALANCE.SLEEPY_NIGHT_ENERGY, housing }), NIGHT);
    expect(inBed.intent).toEqual({
      type: 'start_activity',
      characterId: 'char-1',
      activityId: 'sleep',
    });

    // 白天体力在白天困线(25)之下且买不起(E4 进食线 30,饥饿阀买不起让行)才犯困
    const dayNap = decide2(char({ energy: 22, coins: 0, housing }), NOON);
    expect(dayNap.action).toBe('react');
    expect(dayNap.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 5, y: 6 });
    expect(dayNap.bubble).toContain('困');

    // 夜间精力充沛(>60)不困
    expect(decide2(char({ energy: 70, housing }), NIGHT).action).toBe('continue');
    // 无居所不强排(体力 40:够饿线之上、够夜间困线之下,排除饥饿干扰)
    expect(
      ruleDecide(char({ energy: 40, housing: null }), DAY, NIGHT, TOWN_MAP, homeAnchors).action,
    ).toBe('continue');
  });

  it('饥饿优先于困倦(生存压力先行)', () => {
    const beds = [{ x: 5, y: 6 }];
    const homeAnchors = (activityId: string, placeId: string | null): Array<{ x: number; y: number }> =>
      activityId === 'sleep' && placeId === 'home-a' ? beds : [];
    const starving = char({
      energy: BALANCE.SURVIVAL_HUNGER_ENERGY_LINE,
      housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 5 },
    });
    expect(ruleDecide(starving, DAY, NIGHT, TOWN_MAP, homeAnchors).intent?.type).toBe('move_to');
  });
});

describe('ruleDecide E1 生存阀(贫困变现/直采逃生/饥饿让行/长椅兜底)', () => {
  const noAnchors = (): Array<{ x: number; y: number }> => [];
  const shopXY = { x: SHOP_ENTRANCE.x, y: SHOP_ENTRANCE.y + 1 }; // 店内
  const decideW = (c: WorldCharacter, world: RuleWorldQueries = {}, minuteOfDay = NOON): Decision =>
    ruleDecide(c, DAY, minuteOfDay, TOWN_MAP, noAnchors, world);

  it('贫困阀:背包有货在店内→整叠 sell_item;店外→先去商店', () => {
    const inShop = decideW(
      char({ coins: 5, energy: 60, x: shopXY.x, y: shopXY.y, backpack: { berry: 4 } }),
    );
    expect(inShop.intent).toEqual({
      type: 'sell_item',
      characterId: 'char-1',
      itemId: 'berry',
      count: 4,
    });
    expect(inShop.bubble).toContain('浆果');

    const outside = decideW(char({ coins: 5, energy: 60, backpack: { berry: 4 } }));
    expect(outside.intent).toEqual({
      type: 'move_to',
      characterId: 'char-1',
      x: SHOP_ENTRANCE.x,
      y: SHOP_ENTRANCE.y,
    });
  });

  it('贫困阀选岗保人设:知识不够只剩杂工;知识够时倾向分高者胜出', () => {
    const green = decideW(char({ coins: 5, energy: 60 }));
    expect(green.intent?.type).toBe('move_to'); // 杂工,前往作业点

    const waiter = decideW(char({ coins: 5, energy: 60, knowledge: 5 }), { bias: { waiter: 1 } });
    expect(waiter.bubble).toContain('服务员');
  });

  it('贫困阀门槛:体力<阀值 或 金币≥贫困线 不触发', () => {
    expect(decideW(char({ coins: 5, energy: 34 })).action).toBe('continue'); // E4: 阀值 45→35
    expect(decideW(char({ coins: BALANCE.POVERTY_COIN_LINE, energy: 60 })).action).toBe('continue');
  });

  it('直采逃生门(E4 两段式):体力(6,30] 无食买不起——远处 move_to 邻位/贴身 work_task;≤下界/无节点不动', () => {
    // 远节点((30,30)→(12,8) 距 30):先 move_to 邻位,到达经 arrived 重入再接单
    const far = decideW(char({ energy: 25, coins: 0 }), {
      nearestEdibleNode: () => ({ id: 'berry_bush:12:8', x: 12, y: 8 }),
    });
    expect(far.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 12, y: 8 });
    expect(far.bubble).toContain('采点吃的');

    // 贴身节点(距 1):直发 work_task
    const near = decideW(char({ energy: 25, coins: 0 }), {
      nearestEdibleNode: () => ({ id: 'berry_bush:31:30', x: 31, y: 30 }),
    });
    expect(near.intent).toEqual({
      type: 'work_task',
      characterId: 'char-1',
      targetId: 'berry_bush:31:30',
    });

    // 低体力自救(E4 下界 6):15 不再沉默,先走过去
    expect(
      decideW(char({ energy: 15, coins: 0 }), { nearestEdibleNode: () => ({ id: 'b', x: 1, y: 1 }) })
        .intent?.type,
    ).toBe('move_to');
    // ≤直采下界(虚脱边缘)不动
    expect(
      decideW(char({ energy: BALANCE.FORAGE_MIN_ENERGY, coins: 0 }), {
        nearestEdibleNode: () => ({ id: 'b', x: 1, y: 1 }),
      }).action,
    ).toBe('continue');
    expect(decideW(char({ energy: 25, coins: 0 })).action).toBe('continue'); // 无节点
  });

  it('进食线提前+选食策略(E4):体力 25 吃背包(旧码 20 才吃);能量降序,同能量价低优先', () => {
    // 25 落在 (20,30]:吃背包(旧码沉默)
    const eat = decideW(char({ energy: 25, coins: 50, backpack: { berry: 3 } }), {
      shopStock: () => 0,
    });
    expect(eat.intent).toEqual({ type: 'eat_item', characterId: 'char-1', itemId: 'berry' });

    // {apple(+4), berry(+2)} 选 apple:先脱离饥饿区
    const dense = decideW(char({ energy: 25, coins: 50, backpack: { berry: 3, apple: 1 } }), {
      shopStock: () => 0,
    });
    expect(dense.intent).toMatchObject({ type: 'eat_item', itemId: 'apple' });

    // 同能量(+6)选价低: bread(4 币) 压过 milk(5 币)
    const cheap = decideW(char({ energy: 25, coins: 50, backpack: { milk: 1, bread: 1 } }), {
      shopStock: () => 0,
    });
    expect(cheap.intent).toMatchObject({ type: 'eat_item', itemId: 'bread' });
  });

  it('饥饿让行:店空/买不起 → continue(不再对着售罄货架撞墙)', () => {
    const empty = decideW(char({ energy: BALANCE.SURVIVAL_HUNGER_ENERGY_LINE, coins: 50 }), {
      shopStock: () => 0,
    });
    expect(empty.action).toBe('continue');

    const broke = decideW(char({ energy: BALANCE.SURVIVAL_HUNGER_ENERGY_LINE, coins: 0 }), {
      shopStock: (id) => (id === 'berry' ? 5 : 0),
    });
    expect(broke.action).toBe('continue');
  });

  it('租约失效困倦 → 公园长椅兜底(两段式 rest,不再撞床)', () => {
    const expired = { propertyId: 'home-a', ownership: 'rent' as const, paidThroughDay: DAY - 1 };
    const parkBench = (activityId: string, placeId: string | null): Array<{ x: number; y: number }> =>
      activityId === 'rest' && placeId === 'park' ? [{ x: 7, y: 8 }] : [];
    const go = ruleDecide(char({ energy: 30, coins: 0, housing: expired }), DAY, NIGHT, TOWN_MAP, parkBench);
    expect(go.intent).toEqual({ type: 'move_to', characterId: 'char-1', x: 7, y: 8 });
    expect(go.bubble).toContain('长椅');

    const sit = ruleDecide(
      char({ x: 7, y: 8, energy: 30, coins: 0, housing: expired }),
      DAY,
      NIGHT,
      TOWN_MAP,
      parkBench,
    );
    expect(sit.intent).toEqual({ type: 'start_activity', characterId: 'char-1', activityId: 'rest' });
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
    });
    expect(decision!.action).toBe('react');
    expect(decision!.wantId).toBe('w1-0');
    expect(decision!.chatWith).toBe('npc-9');
    expect(decision!.intent).toBeUndefined(); // 聊天归 executeChatWant,不走 runIntent
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
