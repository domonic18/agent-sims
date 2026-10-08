import { TOWN_MAP, SHOP_ITEMS } from '@sims/shared';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance.js';
import type { WorldCharacter } from '../world/character.js';
import { jevDecide, ruleDecide, type Decision } from './fast-layer.js';
import type { MemoryLlm } from './memory-writer.js';

const DAY = 4;
const SHOP_ENTRANCE = TOWN_MAP.places.find((p) => p.id === 'shop')!.entrance;

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
  };
}

describe('ruleDecide(快层 rule,零模型数值压力反应)', () => {
  it('数值健康且空闲 → continue', () => {
    expect(ruleDecide(char({}), DAY, TOWN_MAP)).toEqual({ layer: 'rule', action: 'continue' });
  });

  it('忙(活动/移动)与失能(死亡/虚脱)一律 continue,不打断不越权', () => {
    expect(ruleDecide(char({ activity: { id: 'rest', startedAtGameMinutes: 0 } as never }), DAY, TOWN_MAP).action).toBe('continue');
    expect(ruleDecide(char({ path: [{ x: 1, y: 1 }] }), DAY, TOWN_MAP).action).toBe('continue');
    expect(ruleDecide(char({ alive: false, energy: 0 }), DAY, TOWN_MAP).action).toBe('continue');
    expect(ruleDecide(char({ collapsed: true }), DAY, TOWN_MAP).action).toBe('continue');
  });

  it('饥饿链:背包有食物吃食物 → 无食物去商店 → 店内买最便宜 → 没钱 continue', () => {
    const hungry = BALANCE.SURVIVAL_HUNGER_ENERGY_LINE;
    const eat = ruleDecide(char({ energy: hungry, backpack: { apple: 1, wood: 2 } }), DAY, TOWN_MAP);
    expect(eat.action).toBe('react');
    expect(eat.intent).toEqual({ type: 'eat_item', characterId: 'char-1', itemId: 'apple' });
    expect(eat.bubble).toContain('苹果');

    const goShop = ruleDecide(char({ energy: hungry }), DAY, TOWN_MAP);
    expect(goShop.intent).toEqual({
      type: 'move_to',
      characterId: 'char-1',
      x: SHOP_ENTRANCE.x,
      y: SHOP_ENTRANCE.y,
    });

    const shopXY = { x: SHOP_ENTRANCE.x, y: SHOP_ENTRANCE.y + 1 }; // 店内
    const cheapest = [...SHOP_ITEMS].sort((a, b) => a.price! - b.price!)[0]!;
    const buy = ruleDecide(char({ energy: hungry, x: shopXY.x, y: shopXY.y, coins: cheapest.price! }), DAY, TOWN_MAP);
    expect(buy.intent).toEqual({ type: 'buy_item', characterId: 'char-1', itemId: cheapest.id });

    const broke = ruleDecide(char({ energy: hungry, coins: 0 }), DAY, TOWN_MAP);
    expect(broke.action).toBe('continue');
  });

  it('房租链:租约次日到期且有钱续租;自持有房/钱不够/租期充裕均 continue', () => {
    const due = ruleDecide(
      char({ housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 } }),
      DAY,
      TOWN_MAP,
    );
    expect(due.action).toBe('react');
    expect(due.intent).toEqual({ type: 'rent_property', characterId: 'char-1', propertyId: 'home-a' });
    expect(due.bubble).toContain('公寓 A');

    const owned = char({ housing: { propertyId: 'home-a', ownership: 'owned', paidThroughDay: DAY + 1 } });
    expect(ruleDecide(owned, DAY, TOWN_MAP).action).toBe('continue');
    const broke = char({ coins: 0, housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 } });
    expect(ruleDecide(broke, DAY, TOWN_MAP).action).toBe('continue');
  });

  it('饥饿优先于房租(生存压力先行)', () => {
    const both = char({
      energy: BALANCE.SURVIVAL_HUNGER_ENERGY_LINE,
      housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 1 },
    });
    expect(ruleDecide(both, DAY, TOWN_MAP).intent?.type).toBe('move_to');
  });
});

describe('jevDecide(systemone choice 候选选一)', () => {
  it('选中候选 → 去对应场所 entrance 的 react;排除当前所在', async () => {
    const park = TOWN_MAP.places.find((p) => p.id === 'park')!;
    const decision: Decision | null = await jevDecide(stubLlm('公园'), char({}), TOWN_MAP);
    expect(decision).not.toBeNull();
    expect(decision!.layer).toBe('jev');
    expect(decision!.intent).toEqual({
      type: 'move_to',
      characterId: 'char-1',
      x: park.entrance.x,
      y: park.entrance.y,
    });
    // 角色站在商店门口时,候选不再含「商店」
    const atShop = char({ x: SHOP_ENTRANCE.x, y: SHOP_ENTRANCE.y });
    let asked: Record<string, string> | undefined;
    const llm: MemoryLlm = {
      systemOne: (_slot, _prompt, questions) => {
        asked = (questions as unknown as { next: { criteria: Record<string, string> } }).next.criteria;
        return Promise.resolve({
          model: 'stub',
          answers: { next: { type: 'choice', choice: '公园', probabilities: {}, confidence: 1 } },
        }) as never;
      },
      embed: () => Promise.reject(new Error('unused')),
      chat: () => Promise.reject(new Error('unused')),
    };
    await jevDecide(llm, atShop, TOWN_MAP);
    expect(Object.keys(asked!)).not.toContain('商店');
  });

  it('回答不在候选内/调用失败 → null(回落 continue,不阻塞泵)', async () => {
    expect(await jevDecide(stubLlm('火星'), char({}), TOWN_MAP)).toBeNull();
    const broken: MemoryLlm = {
      systemOne: () => Promise.reject(new Error('jev 槽未配置')),
      embed: () => Promise.reject(new Error('unused')),
      chat: () => Promise.reject(new Error('unused')),
    };
    expect(await jevDecide(broken, char({}), TOWN_MAP)).toBeNull();
  });

  it('失能(死亡/虚脱倒地)→ null,不给倒下角色派去处', async () => {
    expect(await jevDecide(stubLlm('公园'), char({ alive: false }), TOWN_MAP)).toBeNull();
    expect(await jevDecide(stubLlm('公园'), char({ collapsed: true }), TOWN_MAP)).toBeNull();
  });
});
