import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.js';

function simWith(id: string, coins: number): { sim: Simulation; id: string } {
  const sim = new Simulation();
  sim.spawnCharacter(id, 20, 13, id);
  sim.character(id).coins = coins;
  return { sim, id };
}

describe('房产租买(M3.3;M3.6f 四公寓轮询分房)', () => {
  it('初始租房: 生成即按序轮询分房,预付至次日,快照携带住宿状态', () => {
    const sim = new Simulation();
    sim.spawnCharacter('alice', 20, 13);
    expect(sim.character('alice').housing).toMatchObject({
      propertyId: 'home-a',
      ownership: 'rent',
      paidThroughDay: 2,
    });
    sim.spawnCharacter('bob', 21, 13);
    sim.spawnCharacter('carl', 23, 13);
    sim.spawnCharacter('dora', 58, 11); // home-c 入口
    expect(sim.character('bob').housing).toMatchObject({ propertyId: 'home-b' });
    expect(sim.character('carl').housing).toMatchObject({ propertyId: 'home-c' });
    expect(sim.character('dora').housing).toMatchObject({ propertyId: 'home-d' });
    sim.spawnCharacter('evan', 13, 13);
    expect(sim.character('evan').housing).toMatchObject({ propertyId: 'home-a' }); // 回绕
    const snapshot = sim.snapshot();
    expect(snapshot.characters[0]?.housing).toMatchObject({ propertyId: 'home-a', ownership: 'rent' });
  });

  it('续租: 扣一日期租金租约顺延;过期后续租从今日起算', () => {
    const { sim, id } = simWith('bob', 20); // 首个生成 → home-a(租金 8)
    sim.requestRentProperty(id, 'home-a');
    expect(sim.character(id).coins).toBe(12);
    expect(sim.character(id).housing?.paidThroughDay).toBe(3);
    sim.character(id).housing!.paidThroughDay = 0; // 模拟欠租跨日
    sim.requestRentProperty(id, 'home-a');
    expect(sim.character(id).housing?.paidThroughDay).toBe(2); // max(0, 今日1)+1
  });

  it('买断: 一次扣全款转自有,此后租/买均拒绝', () => {
    const { sim, id } = simWith('carl', 600);
    sim.requestBuyProperty(id, 'home-a');
    const carl = sim.character(id);
    expect(carl.coins).toBe(100);
    expect(carl.housing).toMatchObject({ propertyId: 'home-a', ownership: 'owned' });
    expect(() => sim.requestRentProperty(id, 'home-a')).toThrow(/已拥有/);
    expect(() => sim.requestBuyProperty(id, 'home-a')).toThrow(/已拥有/);
  });

  it('校验: 未知房产/余额不足/未知角色均拒绝', () => {
    const { sim, id } = simWith('erin', 10);
    expect(() => sim.requestRentProperty(id, 'villa')).toThrow(/未知房产/);
    expect(() => sim.requestBuyProperty(id, 'home-a')).toThrow(/金币不足/);
    expect(() => sim.requestRentProperty('ghost', 'home-a')).toThrow(/角色不存在/);
  });

  it('核心循环串接: 打工赚币→到店囤面包→回家吃', () => {
    const { sim } = simWith('gina', 0); // gina → home-a
    const desk = { x: 45, y: 6 }; // 办公楼工位使用格(M3.6e 锚点)
    sim.spawnCharacter('worker', desk.x, desk.y, 'worker'); // 第二个生成 → home-b
    sim.requestStartActivity('worker', 'work');
    sim.advanceTicks(120);
    const worker = sim.character('worker');
    expect(worker.coins).toBeCloseTo(96, 5); // 杂工 0.8 币/分 × 120(M-G.4 调价)
    sim.requestMoveTo('worker', 23, 25); // 商店入口
    sim.advanceTicks(sim.character('worker').path.length);
    sim.requestBuyItem('worker', 'bread'); // 背包制: 入背包,数值不结算
    const afterBuy = sim.character('worker');
    expect(afterBuy.coins).toBeCloseTo(92, 5);
    expect(afterBuy.backpack).toEqual({ bread: 1 });
    sim.requestMoveTo('worker', 17, 8); // 自家(home-b)床使用格
    sim.advanceTicks(sim.character('worker').path.length);
    const before = sim.character('worker').energy;
    sim.requestEatItem('worker', 'bread'); // 从背包进食结算
    const afterEat = sim.character('worker');
    expect(afterEat.energy).toBeCloseTo(before + 6, 5);
    expect(afterEat.backpack).toEqual({});
  });
});
