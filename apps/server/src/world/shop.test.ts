import { describe, expect, it } from 'vitest';
import { SHOP_ITEMS, getShopItem } from '@sims/shared';
import { Simulation } from './simulation.js';

function simWith(id: string, coins: number): { sim: Simulation; id: string } {
  const sim = new Simulation();
  sim.spawnCharacter(id, 10, 10, id);
  sim.character(id).coins = coins;
  return { sim, id };
}

describe('商店购买(M3.2)', () => {
  it('食物即买即结算: 扣币并立即恢复数值,上限夹取', () => {
    const { sim, id } = simWith('alice', 20);
    sim.character(id).energy = 97;
    sim.character(id).happiness = 60;
    sim.requestBuyItem(id, 'bread');
    const alice = sim.character(id);
    expect(alice.coins).toBe(16); // 20 - 4
    expect(alice.energy).toBe(100); // 97 + 6 夹取上限
    expect(alice.happiness).toBe(60);
    expect(alice.items).toHaveLength(0); // 食物不入库存
  });

  it('家具入库存: 扣币并追加条目,可重复购买', () => {
    const { sim, id } = simWith('bob', 200);
    sim.requestBuyItem(id, 'lamp');
    sim.requestBuyItem(id, 'bed');
    sim.requestBuyItem(id, 'lamp');
    const bob = sim.character(id);
    expect(bob.coins).toBe(200 - 15 - 120 - 15);
    expect(bob.items).toEqual(['lamp', 'bed', 'lamp']);
  });

  it('余额不足: 拒绝且金币不变', () => {
    const { sim, id } = simWith('carl', 2);
    expect(() => sim.requestBuyItem(id, 'cake')).toThrow(/金币不足/);
    expect(() => sim.requestBuyItem(id, 'bed')).toThrow(/金币不足/);
    const carl = sim.character(id);
    expect(carl.coins).toBe(2);
    expect(carl.items).toHaveLength(0);
  });

  it('校验: 未知商品/未知角色均拒绝', () => {
    const { sim, id } = simWith('dave', 50);
    expect(() => sim.requestBuyItem(id, 'yacht')).toThrow(/未知商品/);
    expect(() => sim.requestBuyItem('ghost', 'bread')).toThrow(/角色不存在/);
  });

  it('快照携带库存与金币', () => {
    const { sim, id } = simWith('erin', 50);
    sim.requestBuyItem(id, 'chair');
    const snapshot = sim.snapshot();
    const erin = snapshot.characters.find((c) => c.id === id);
    expect(erin?.coins).toBe(25);
    expect(erin?.items).toEqual(['chair']);
  });

  it('目录完整性: 全部条目可查,家具带加成/食物带即时效果', () => {
    expect(SHOP_ITEMS).toHaveLength(7);
    for (const item of SHOP_ITEMS) {
      expect(getShopItem(item.id)).toBe(item);
      if (item.category === 'furniture') {
        expect(item.bonus).toBeDefined();
      } else {
        expect(item.effects).toBeDefined();
      }
    }
  });
});
