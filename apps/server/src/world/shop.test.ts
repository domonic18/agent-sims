import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance.js';
import { ITEMS, SHOP_ITEM_IDS, SHOP_ITEMS, getItem, getShopItem } from '@sims/shared';
import { Simulation } from './simulation.js';

/** 商店内部可行走格(x21..25/y27..32 内圈,避开柜台/货架) */
const IN_SHOP = { x: 23, y: 28 };

/** home-a 室内空地(首个生成角色的家) */
const IN_HOME_A = { x: 11, y: 7 };

function simWith(id: string, coins: number, at: { x: number; y: number } = IN_SHOP): { sim: Simulation; id: string } {
  const sim = new Simulation();
  sim.spawnCharacter(id, at.x, at.y, id);
  sim.character(id).coins = coins;
  return { sim, id };
}

describe('商店背包制(M3.2 店内购买;M3.6g 背包/冰箱两级库存+体积容量)', () => {
  it('店内购买入背包: 扣币不结算数值,可叠加份数', () => {
    const { sim, id } = simWith('alice', 20);
    sim.character(id).energy = 97;
    sim.requestBuyItem(id, 'bread');
    sim.requestBuyItem(id, 'bread');
    const alice = sim.character(id);
    expect(alice.coins).toBe(12); // 20 - 4*2
    expect(alice.energy).toBe(97); // 买入不入腹
    expect(alice.score).toBe(0); // 买入非事件,得分不动(04 §2.5)
    expect(alice.backpack).toEqual({ bread: 2 });
    expect(alice.fridge).toEqual({});
  });

  it('背包容积校验: 超出上限拒绝且不扣币', () => {
    const { sim, id } = simWith('hank', 100);
    sim.requestBuyItem(id, 'cake'); // 体积 3
    sim.requestBuyItem(id, 'cake');
    expect(sim.character(id).backpack).toEqual({ cake: 2 }); // 已占 6/8
    expect(() => sim.requestBuyItem(id, 'cake')).toThrow(/背包已满\(6\/8\)/); // 6+3 > 8
    expect(sim.character(id).coins).toBe(80); // 拒绝不扣币
    sim.requestBuyItem(id, 'bread'); // 体积 1,6+1 ≤ 8 放行
    expect(sim.character(id).backpack).toEqual({ bread: 1, cake: 2 });
  });

  it('店外购买拒绝: 须先移动到商店', () => {
    const { sim, id } = simWith('bob', 50, { x: 8, y: 12 }); // 公寓入口
    expect(() => sim.requestBuyItem(id, 'bread')).toThrow(/须在商店内/);
    expect(sim.character(id).coins).toBe(50);
  });

  it('余额不足: 拒绝且金币不变', () => {
    const { sim, id } = simWith('carl', 2);
    expect(() => sim.requestBuyItem(id, 'cake')).toThrow(/金币不足/);
    expect(sim.character(id).coins).toBe(2);
  });

  it('eat_item 任意地点: 店内买完原地即吃,结算效果并扣背包', () => {
    const { sim, id } = simWith('dave', 50);
    sim.requestBuyItem(id, 'sushi'); // 寿司 +12 体力 +5 得分
    sim.character(id).energy = 80;
    sim.requestEatItem(id, 'sushi');
    const dave = sim.character(id);
    expect(dave.energy).toBeCloseTo(80 + 12, 5);
    expect(dave.score).toBeCloseTo(5, 5); // 进食事件直加(04 §2.5)
    expect(dave.coins).toBe(38); // 进食不另扣费
    expect(dave.backpack).toEqual({});
  });

  it('eat_item 校验: 背包无此物拒绝', () => {
    const { sim, id } = simWith('erin', 50);
    expect(() => sim.requestEatItem(id, 'cake')).toThrow(/背包里没有/);
  });

  it('store_item 全校验链: 不在家拒绝→租约过期拒绝→存入冰箱扣背包', () => {
    const { sim, id } = simWith('gina', 50); // 首个生成 → home-a
    sim.requestBuyItem(id, 'bread');
    expect(() => sim.requestStoreItem(id, 'bread', 1)).toThrow(/须回到/); // 还在商店
    sim.character(id).x = IN_HOME_A.x;
    sim.character(id).y = IN_HOME_A.y;
    sim.character(id).housing!.paidThroughDay = 0; // 欠租跨日
    expect(() => sim.requestStoreItem(id, 'bread', 1)).toThrow(/租约已过期/);
    sim.character(id).housing!.paidThroughDay = 2;
    sim.requestStoreItem(id, 'bread', 1);
    expect(sim.character(id).backpack).toEqual({});
    expect(sim.character(id).fridge).toEqual({ bread: 1 });
  });

  it('take_item: 取出到背包;超库存/背包容积不足拒绝', () => {
    const { sim, id } = simWith('iris', 50); // 首个生成 → home-a
    sim.character(id).x = IN_HOME_A.x;
    sim.character(id).y = IN_HOME_A.y;
    sim.character(id).fridge = { cake: 4 }; // 直接布景: 12 体积
    expect(() => sim.requestTakeItem(id, 'cake', 5)).toThrow(/不足 5 个/); // 冰箱只有 4
    expect(() => sim.requestTakeItem(id, 'cake', 3)).toThrow(/背包已满\(0\/8\)/); // 3*3=9 > 8
    sim.requestTakeItem(id, 'cake', 2); // 6 ≤ 8 放行
    expect(sim.character(id).fridge).toEqual({ cake: 2 });
    expect(sim.character(id).backpack).toEqual({ cake: 2 });
  });

  it('冰箱容积校验: 超出上限拒绝', () => {
    const { sim, id } = simWith('jack', 50); // 首个生成 → home-a
    sim.character(id).x = IN_HOME_A.x;
    sim.character(id).y = IN_HOME_A.y;
    sim.character(id).fridge = { cake: 10 }; // 30/30 满仓(直接布景)
    sim.character(id).backpack = { bread: 1 };
    expect(() => sim.requestStoreItem(id, 'bread', 1)).toThrow(/冰箱已满\(30\/30\)/);
    expect(sim.character(id).backpack).toEqual({ bread: 1 }); // 拒绝不动源库存
  });

  it('校验: 未知商品/未知角色均拒绝', () => {
    const { sim, id } = simWith('frank', 50);
    expect(() => sim.requestBuyItem(id, 'yacht')).toThrow(/未知商品/);
    expect(() => sim.requestBuyItem('ghost', 'bread')).toThrow(/角色不存在/);
    expect(() => sim.requestStoreItem(id, 'yacht', 1)).toThrow(/未知商品/);
    expect(() => sim.requestTakeItem(id, 'yacht', 1)).toThrow(/未知商品/);
  });

  it('快照携带金币与背包/冰箱库存', () => {
    const { sim, id } = simWith('gina', 50);
    sim.requestBuyItem(id, 'coffee');
    sim.character(id).fridge = { apple: 3 };
    const snapshot = sim.snapshot();
    const gina = snapshot.characters.find((c) => c.id === id);
    expect(gina?.coins).toBe(44);
    expect(gina?.backpack).toEqual({ coffee: 1 });
    expect(gina?.fridge).toEqual({ apple: 3 });
    expect(gina?.alive).toBe(true);
  });

  it('目录完整性: 10 货架物品(8 底货食物+浆果/浆果派),均带进食效果/正体积,底货价格梯度互异', () => {
    expect(SHOP_ITEMS).toHaveLength(10);
    const basePrices = SHOP_ITEM_IDS.map((id) => getShopItem(id)!.price);
    expect(new Set(basePrices).size).toBe(basePrices.length); // 底货价格互异
    for (const item of SHOP_ITEMS) {
      expect(item.category).toBe('food');
      expect(getShopItem(item.id)).toBe(item);
      expect(item.effects.energy).toBeGreaterThan(0);
      expect(item.volume).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(item.volume)).toBe(true);
    }
    // 背包至少装得下任意单件商品(体积上限 > 最大单件体积)
    const maxVolume = Math.max(...SHOP_ITEMS.map((item) => item.volume));
    expect(BALANCE.BACKPACK_VOLUME_LIMIT).toBeGreaterThan(maxVolume);
  });
});

describe('商店供给(E1 生产经济: 居民卖入主渠道+每日兜底补货)', () => {
  it('构造即铺货: 8 货架食物各 SHOP_INITIAL_FOOD_STOCK 份,快照透传余量', () => {
    const sim = new Simulation();
    expect(sim.shopStock.size).toBe(8);
    expect(sim.shopStock.get('bread')).toBe(BALANCE.SHOP_INITIAL_FOOD_STOCK);
    expect(sim.snapshot().shopStock).toEqual(Object.fromEntries(sim.shopStock));
  });

  it('售罄拒绝: 第 4 次购买拒绝且不扣币,他品独立计数;跨日兜底补货封顶初始存量', () => {
    const { sim, id } = simWith('pete', 100);
    sim.requestBuyItem(id, 'bread');
    sim.requestBuyItem(id, 'bread');
    sim.requestBuyItem(id, 'bread'); // 3→0
    expect(sim.shopStock.get('bread')).toBe(0);
    sim.character(id).coins = 100; // 余额充足仍拒
    expect(() => sim.requestBuyItem(id, 'bread')).toThrow(/已售罄.*采集/);
    expect(sim.character(id).backpack).toEqual({ bread: 3 }); // 拒绝不入包
    sim.requestBuyItem(id, 'apple'); // 他品库存独立
    expect(sim.shopStock.get('apple')).toBe(BALANCE.SHOP_INITIAL_FOOD_STOCK - 1);
    sim.advanceTicks(1440); // 跨日: SHOP_RESTOCK_DAILY=1 只防死锁
    expect(sim.shopStock.get('bread')).toBe(1);
    sim.advanceTicks(1440);
    expect(sim.shopStock.get('bread')).toBe(2);
    expect(sim.shopStock.get('apple')).toBe(BALANCE.SHOP_INITIAL_FOOD_STOCK); // 补货封顶初始存量
  });

  it('reset 重铺货: 售罄世界重置后货架回满(与 resourceNodes 恢复语义同构)', () => {
    const { sim, id } = simWith('quinn', 100);
    sim.requestBuyItem(id, 'cake');
    expect(sim.shopStock.get('cake')).toBe(BALANCE.SHOP_INITIAL_FOOD_STOCK - 1);
    sim.reset();
    expect(sim.shopStock.get('cake')).toBe(BALANCE.SHOP_INITIAL_FOOD_STOCK);
  });

  it('SHOP_INITIAL_FOOD_STOCK=0 边界: 开局即售罄,购买拒绝并指引采集/制作', () => {
    const original = BALANCE.SHOP_INITIAL_FOOD_STOCK;
    BALANCE.SHOP_INITIAL_FOOD_STOCK = 0;
    try {
      const sim = new Simulation();
      expect(sim.shopStock.get('bread')).toBe(0);
      sim.spawnCharacter('zero', IN_SHOP.x, IN_SHOP.y, '零');
      sim.character('zero').coins = 50;
      expect(() => sim.requestBuyItem('zero', 'bread')).toThrow(/已售罄.*采集/);
      expect(sim.character('zero').coins).toBe(50);
    } finally {
      BALANCE.SHOP_INITIAL_FOOD_STOCK = original;
    }
  });
});

describe('物品注册表(M-G.6 单源: 货架派生+采集/制作物品;E1 材料带价可卖)', () => {
  it('目录完整性: 17 项,food 必带 effects,material 不可食用,货架为带价食物子集', () => {
    expect(ITEMS).toHaveLength(17);
    expect(SHOP_ITEMS).toHaveLength(10); // 8 底货食物+浆果/浆果派(引用一致)
    for (const item of ITEMS) {
      expect(getItem(item.id)).toBe(item);
      expect(item.volume).toBeGreaterThanOrEqual(1);
      if (item.category === 'food') {
        expect(item.effects).toBeDefined();
      } else {
        expect(item.effects).toBeUndefined();
      }
    }
  });

  it('浆果派(制作食物): 任意地点可食 +8 体力/+4 得分', () => {
    const { sim, id } = simWith('liam', 50);
    sim.character(id).backpack = { berry_pie: 1 };
    sim.character(id).energy = 50;
    sim.requestEatItem(id, 'berry_pie');
    expect(sim.character(id).energy).toBe(58);
    expect(sim.character(id).score).toBe(4);
  });

  it('无定价物品不可购买;material 不可食用', () => {
    const { sim, id } = simWith('mia', 50);
    expect(() => sim.requestBuyItem(id, 'repair_kit')).toThrow(/非商店货架/);
    sim.character(id).backpack = { scrap: 1 };
    expect(() => sim.requestEatItem(id, 'scrap')).toThrow(/不可食用/);
    expect(sim.character(id).backpack).toEqual({ scrap: 1 }); // 拒绝不动库存
  });

  it('sell_item 收购(E1): 店内按 SELL_RATE×售价 结算,扣包入币上架;店外/无价/超量拒绝', () => {
    const { sim, id } = simWith('olive', 0, { x: 8, y: 12 }); // 公寓入口,店外
    const olive = sim.character(id);
    olive.backpack = { berry: 5 };
    expect(() => sim.requestSellItem(id, 'berry', 5)).toThrow(/须在商店内/); // 门外不收
    expect(() => sim.requestSellItem(id, 'repair_kit', 1)).toThrow(/商店不收购/); // 无定价
    olive.x = IN_SHOP.x;
    olive.y = IN_SHOP.y;
    expect(() => sim.requestSellItem(id, 'berry', 6)).toThrow(/不足 6 个/);

    // 5×2×0.6=6 金币;整叠卖出后背包清空、货架上架
    sim.requestSellItem(id, 'berry', 5);
    expect(olive.coins).toBe(Math.floor(5 * 2 * BALANCE.SELL_RATE));
    expect(olive.backpack).toEqual({});
    expect(sim.shopStock.get('berry')).toBe(5);
  });

  it('镇内经济循环(E1): 居民卖入上架 → 他人可购买(含非底货品类)', () => {
    const { sim } = simWith('paul', 0, { x: 8, y: 12 }); // paul 在店外
    const buyer = 'quinn2';
    sim.spawnCharacter(buyer, IN_SHOP.x, IN_SHOP.y, '昆');
    sim.character(buyer).coins = 20;
    sim.character(buyer).x = IN_SHOP.x;
    sim.character(buyer).y = IN_SHOP.y;
    sim.character('paul').backpack = { berry_pie: 1 };
    sim.character('paul').x = IN_SHOP.x;
    sim.character('paul').y = IN_SHOP.y;
    sim.requestSellItem('paul', 'berry_pie', 1); // 上架,底货原本无此品
    expect(sim.shopStock.get('berry_pie')).toBe(1);

    sim.requestBuyItem(buyer, 'berry_pie');
    expect(sim.character(buyer).backpack).toEqual({ berry_pie: 1 });
    expect(sim.character(buyer).coins).toBe(20 - 8);
    expect(sim.shopStock.get('berry_pie')).toBe(0);
  });

  it('新材料计入背包容积: 采集品/耗材按注册表体积占格', () => {
    const { sim, id } = simWith('noah', 50);
    const noah = sim.character(id);
    noah.backpack = { berry: 6 }; // 6/8
    noah.fridge = { scrap: 3 };
    noah.x = IN_HOME_A.x;
    noah.y = IN_HOME_A.y;
    noah.housing!.paidThroughDay = 2;
    sim.requestTakeItem(id, 'scrap', 2); // 6+2=8 ≤ 8 放行
    expect(noah.backpack).toEqual({ berry: 6, scrap: 2 });
    expect(() => sim.requestTakeItem(id, 'scrap', 1)).toThrow(/背包已满\(8\/8\)/);
  });
});
