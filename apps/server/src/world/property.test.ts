import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.js';

function simWith(id: string, coins: number): { sim: Simulation; id: string } {
  const sim = new Simulation();
  sim.spawnCharacter(id, 10, 10, id);
  sim.character(id).coins = coins;
  return { sim, id };
}

describe('房产与家具摆放(M3.3)', () => {
  it('初始租房: 生成即租住公寓,预付至次日,快照携带住宿状态', () => {
    const sim = new Simulation();
    sim.spawnCharacter('alice', 10, 10);
    const alice = sim.character('alice');
    expect(alice.housing).toMatchObject({
      propertyId: 'home',
      ownership: 'rent',
      paidThroughDay: 2,
      placedItems: [],
    });
    const snapshot = sim.snapshot();
    expect(snapshot.characters[0]?.housing).toMatchObject({ propertyId: 'home', ownership: 'rent' });
  });

  it('续租: 扣一日期租金租约顺延;过期后续租从今日起算', () => {
    const { sim, id } = simWith('bob', 20);
    sim.requestRentProperty(id, 'home');
    expect(sim.character(id).coins).toBe(12);
    expect(sim.character(id).housing?.paidThroughDay).toBe(3);
    sim.character(id).housing!.paidThroughDay = 0; // 模拟欠租跨日
    sim.requestRentProperty(id, 'home');
    expect(sim.character(id).housing?.paidThroughDay).toBe(2); // max(0, 今日1)+1
  });

  it('买断: 一次扣全款转自有,此后租/买均拒绝', () => {
    const { sim, id } = simWith('carl', 600);
    sim.requestBuyProperty(id, 'home');
    const carl = sim.character(id);
    expect(carl.coins).toBe(100);
    expect(carl.housing).toMatchObject({ propertyId: 'home', ownership: 'owned' });
    expect(() => sim.requestRentProperty(id, 'home')).toThrow(/已拥有/);
    expect(() => sim.requestBuyProperty(id, 'home')).toThrow(/已拥有/);
  });

  it('摆放: 家具从库存移入住宅;重复购买各摆一件', () => {
    const { sim, id } = simWith('dave', 50);
    sim.requestBuyItem(id, 'lamp');
    sim.requestBuyItem(id, 'lamp');
    sim.requestPlaceFurniture(id, 'lamp');
    const dave = sim.character(id);
    expect(dave.items).toEqual(['lamp']);
    expect(dave.housing?.placedItems).toEqual(['lamp']);
    sim.requestPlaceFurniture(id, 'lamp');
    expect(dave.items).toEqual([]);
    expect(dave.housing?.placedItems).toEqual(['lamp', 'lamp']);
  });

  it('摆放校验: 未知商品/食物/无货/未知房产/余额不足均拒绝', () => {
    const { sim, id } = simWith('erin', 10);
    expect(() => sim.requestPlaceFurniture(id, 'yacht')).toThrow(/未知商品/);
    expect(() => sim.requestPlaceFurniture(id, 'bread')).toThrow(/食物/);
    expect(() => sim.requestPlaceFurniture(id, 'bed')).toThrow(/库存中没有/);
    expect(() => sim.requestRentProperty(id, 'villa')).toThrow(/未知房产/);
    expect(() => sim.requestBuyProperty(id, 'home')).toThrow(/金币不足/);
    expect(() => sim.requestRentProperty('ghost', 'home')).toThrow(/角色不存在/);
  });

  it('加成生效: 已摆家具每分钟被动加成;欠租即停发,续租恢复', () => {
    const { sim } = simWith('frank', 100);
    const id = 'frank';
    sim.requestBuyItem(id, 'chair');
    sim.requestPlaceFurniture(id, 'chair');
    sim.advanceTicks(25);
    const frank = sim.character(id);
    // 能量: 衰减 0.05 - 加成 0.01 = 净 -0.04/分;幸福不受椅加成影响
    expect(frank.energy).toBeCloseTo(100 - 25 * 0.04, 5);
    expect(frank.happiness).toBeCloseTo(100 - 25 * 0.03, 5);
    frank.housing!.paidThroughDay = 0; // 欠租
    sim.advanceTicks(10);
    expect(frank.energy).toBeCloseTo(100 - 25 * 0.04 - 10 * 0.05, 5);
    frank.coins = 20;
    sim.requestRentProperty(id, 'home');
    sim.advanceTicks(10);
    expect(frank.energy).toBeCloseTo(100 - 25 * 0.04 - 10 * 0.05 - 10 * 0.04, 5);
  });

  it('核心循环串接: 打工赚币→买家具→摆放生效→买食物应急', () => {
    const { sim } = simWith('gina', 0);
    const office = { x: 15, y: 8 };
    sim.spawnCharacter('worker', office.x, office.y, 'worker');
    sim.requestStartActivity('worker', 'work');
    sim.advanceTicks(120);
    const worker = sim.character('worker');
    expect(worker.coins).toBe(60);
    sim.requestBuyItem('worker', 'lamp');
    sim.requestBuyItem('worker', 'chair');
    sim.requestPlaceFurniture('worker', 'lamp');
    sim.requestPlaceFurniture('worker', 'chair');
    sim.requestBuyItem('worker', 'bread'); // 能量见底应急
    expect(worker.coins).toBe(16);
    expect(worker.energy).toBeCloseTo(64 + 6, 5); // 100-120*0.3=64,面包+6
    expect(worker.housing?.placedItems).toEqual(['lamp', 'chair']);
    sim.advanceTicks(10);
    expect(worker.energy).toBeCloseTo(70 - 10 * 0.05 + 10 * 0.01, 5);
    expect(worker.happiness).toBeCloseTo(84.4 - 10 * 0.03 + 10 * 0.01, 5);
  });
});
