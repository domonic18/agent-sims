import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.js';

function simWith(id: string, coins: number): { sim: Simulation; id: string } {
  const sim = new Simulation();
  sim.spawnCharacter(id, 20, 13, id);
  sim.character(id).coins = coins;
  return { sim, id };
}

describe('房产租买(M3.3;M3.6e 家具购买/摆放移除,家具转为世界内置锚点)', () => {
  it('初始租房: 生成即租住公寓,预付至次日,快照携带住宿状态', () => {
    const sim = new Simulation();
    sim.spawnCharacter('alice', 20, 13);
    const alice = sim.character('alice');
    expect(alice.housing).toMatchObject({
      propertyId: 'home',
      ownership: 'rent',
      paidThroughDay: 2,
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

  it('校验: 未知房产/余额不足/未知角色均拒绝', () => {
    const { sim, id } = simWith('erin', 10);
    expect(() => sim.requestRentProperty(id, 'villa')).toThrow(/未知房产/);
    expect(() => sim.requestBuyProperty(id, 'home')).toThrow(/金币不足/);
    expect(() => sim.requestRentProperty('ghost', 'home')).toThrow(/角色不存在/);
  });

  it('核心循环串接: 打工赚币→买食物应急', () => {
    const { sim } = simWith('gina', 0);
    const desk = { x: 45, y: 6 }; // 办公楼工位使用格(M3.6e 锚点)
    sim.spawnCharacter('worker', desk.x, desk.y, 'worker');
    sim.requestStartActivity('worker', 'work');
    sim.advanceTicks(120);
    const worker = sim.character('worker');
    expect(worker.coins).toBe(60);
    sim.requestBuyItem('worker', 'bread'); // 能量见底应急
    expect(worker.coins).toBe(56);
    expect(worker.energy).toBeCloseTo(64 + 6, 5); // 100-120*0.3=64,面包+6
  });
});
