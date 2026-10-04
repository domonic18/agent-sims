import { describe, expect, it } from 'vitest';
import { SHOP_ITEMS, getShopItem } from '@sims/shared';
import { Simulation } from './simulation.js';

/** 商店内部可行走格(x21..25/y27..32 内圈,避开柜台/货架) */
const IN_SHOP = { x: 23, y: 28 };

function simWith(id: string, coins: number, at: { x: number; y: number } = IN_SHOP): { sim: Simulation; id: string } {
  const sim = new Simulation();
  sim.spawnCharacter(id, at.x, at.y, id);
  sim.character(id).coins = coins;
  return { sim, id };
}

describe('商店囤粮制(M3.2;M3.6f 店内购买+冰箱库存+eat_item 进食)', () => {
  it('店内购买入库存: 扣币不结算数值,可叠加份数', () => {
    const { sim, id } = simWith('alice', 20);
    sim.character(id).energy = 97;
    sim.character(id).happiness = 60;
    sim.requestBuyItem(id, 'bread');
    sim.requestBuyItem(id, 'bread');
    const alice = sim.character(id);
    expect(alice.coins).toBe(12); // 20 - 4*2
    expect(alice.energy).toBe(97); // 买入不入腹
    expect(alice.happiness).toBe(60);
    expect(alice.foodInventory).toEqual({ bread: 2 });
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

  it('eat_item: 回到自有住房进食结算效果并扣库存', () => {
    const { sim, id } = simWith('dave', 50); // 首个生成 → home-a
    sim.requestBuyItem(id, 'sushi'); // 寿司 +12 体力 +5 幸福
    sim.character(id).energy = 80;
    sim.character(id).happiness = 60; // 留出增益空间(上限 100 夹取)
    sim.character(id).x = 11;
    sim.character(id).y = 7; // home-a 室内空地
    const before = sim.character(id);
    const energy = before.energy;
    const happiness = before.happiness;
    sim.requestEatItem(id, 'sushi');
    const dave = sim.character(id);
    expect(dave.energy).toBeCloseTo(energy + 12, 5);
    expect(dave.happiness).toBeCloseTo(happiness + 5, 5);
    expect(dave.coins).toBe(38); // 进食不另扣费
    expect(dave.foodInventory).toEqual({});
  });

  it('eat_item 校验: 无库存/不在自家/租约过期均拒绝', () => {
    const { sim, id } = simWith('erin', 50); // 首个生成 → home-a
    expect(() => sim.requestEatItem(id, 'cake')).toThrow(/冰箱里没有/);
    sim.requestBuyItem(id, 'cake'); // 在店,买入
    sim.character(id).x = 23;
    sim.character(id).y = 28; // 回到商店,不在家
    expect(() => sim.requestEatItem(id, 'cake')).toThrow(/须回到/);
    sim.character(id).x = 11;
    sim.character(id).y = 7; // home-a 室内
    sim.character(id).housing!.paidThroughDay = 0; // 欠租跨日
    expect(() => sim.requestEatItem(id, 'cake')).toThrow(/租约已过期/);
  });

  it('校验: 未知商品/未知角色均拒绝', () => {
    const { sim, id } = simWith('frank', 50);
    expect(() => sim.requestBuyItem(id, 'yacht')).toThrow(/未知商品/);
    expect(() => sim.requestBuyItem('ghost', 'bread')).toThrow(/角色不存在/);
  });

  it('快照携带金币与冰箱库存', () => {
    const { sim, id } = simWith('gina', 50);
    sim.requestBuyItem(id, 'coffee');
    const snapshot = sim.snapshot();
    const gina = snapshot.characters.find((c) => c.id === id);
    expect(gina?.coins).toBe(44);
    expect(gina?.foodInventory).toEqual({ coffee: 1 });
    expect(gina?.alive).toBe(true);
  });

  it('目录完整性: 8 种食物,均带进食效果与梯度定价', () => {
    expect(SHOP_ITEMS).toHaveLength(8);
    const prices = SHOP_ITEMS.map((item) => item.price);
    expect(new Set(prices).size).toBe(prices.length); // 价格互异
    for (const item of SHOP_ITEMS) {
      expect(item.category).toBe('food');
      expect(getShopItem(item.id)).toBe(item);
      expect(item.effects.energy).toBeGreaterThan(0);
    }
  });
});
