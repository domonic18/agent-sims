import { describe, expect, it } from 'vitest';
import type { ActivityFinishedEvent, WorldEvent } from '@sims/shared';
import { TOWN_MAP } from '@sims/shared';
import { Simulation } from './simulation.js';

/** 场所内指定活动的首个锚点使用格(M3.6e 内景) */
const anchorUse = (placeId: string, activityId: string): { x: number; y: number } => {
  const furniture = TOWN_MAP.places
    .find((p) => p.id === placeId)
    ?.furniture?.find((f) => f.activityId === activityId && f.use !== undefined);
  if (furniture?.use === undefined) throw new Error(`无锚点: ${placeId}/${activityId}`);
  return furniture.use;
};

function simWith(id: string, x: number, y: number): { sim: Simulation; events: WorldEvent[] } {
  const sim = new Simulation();
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  sim.spawnCharacter(id, x, y, id);
  return { sim, events };
}

describe('活动执行(M3.1;M3.6e 锚点语义)', () => {
  it('学习完整 60 分钟(图书馆书桌): 体力/幸福按衰减+效果结算,自动完成', () => {
    const desk = anchorUse('library', 'study');
    const { sim, events } = simWith('alice', desk.x, desk.y);
    sim.requestStartActivity('alice', 'study');
    sim.advanceTicks(60);
    const alice = sim.character('alice');
    expect(alice.activity).toBeNull();
    expect(alice.energy).toBeCloseTo(100 - 60 * 0.05 - 60 * 0.15, 5);
    expect(alice.happiness).toBeCloseTo(100 - 60 * 0.03 - 60 * 0.05, 5);
    const finished = events.find((e) => e.type === 'activity.finished');
    expect(finished).toMatchObject({
      type: 'activity.finished',
      characterId: 'alice',
      activityId: 'study',
      elapsedMinutes: 60,
      reason: 'completed',
    });
  });

  it('学习支持家中书桌: home 锚点同效(placeIds 多场所)', () => {
    const desk = anchorUse('home', 'study');
    const { sim } = simWith('bob', desk.x, desk.y);
    sim.requestStartActivity('bob', 'study');
    expect(sim.character('bob').activity).toMatchObject({ activityId: 'study' });
  });

  it('打工 120 分钟(办公楼工位): 赚 60 金币,数值净消耗', () => {
    const desk = anchorUse('office', 'work');
    const { sim } = simWith('carl', desk.x, desk.y);
    sim.requestStartActivity('carl', 'work');
    sim.advanceTicks(120);
    const carl = sim.character('carl');
    expect(carl.coins).toBe(60);
    expect(carl.energy).toBeCloseTo(100 - 120 * 0.05 - 120 * 0.25, 5);
    expect(carl.happiness).toBeCloseTo(100 - 120 * 0.03 - 120 * 0.1, 5);
  });

  it('就餐余额不足(餐厅餐桌): 结算前判定,不透支,提前中断', () => {
    const table = anchorUse('restaurant', 'meal');
    const { sim, events } = simWith('dave', table.x, table.y);
    sim.character('dave').coins = 5;
    sim.requestStartActivity('dave', 'meal');
    sim.advanceTicks(30);
    const dave = sim.character('dave');
    expect(dave.activity).toBeNull();
    // 5 币够 12 分钟(5-0.4*12=0.2),第 13 分钟结算前判定不足;事件 elapsed=已结算分钟
    expect(dave.coins).toBeCloseTo(0.2, 5);
    const finished = events.find((e) => e.type === 'activity.finished');
    expect(finished).toMatchObject({
      type: 'activity.finished',
      activityId: 'meal',
      elapsedMinutes: 12,
      reason: 'insufficient_coins',
    });
  });

  it('散步无锚点: 场所范围判定照旧(公园)', () => {
    const { sim, events } = simWith('erin', 9, 25); // 公园入口
    sim.requestStartActivity('erin', 'stroll');
    sim.advanceTicks(5);
    sim.requestMoveTo('erin', 10, 28); // 公园内部目标
    const erin = sim.character('erin');
    expect(erin.activity).toBeNull();
    expect(erin.path.length).toBeGreaterThan(0); // 路径已重新规划
    const finished = events.at(-1);
    expect(finished).toMatchObject({
      type: 'activity.finished',
      activityId: 'stroll',
      elapsedMinutes: 5,
      reason: 'interrupted',
    });
  });

  it('手动 stop(家中床铺休息): 即时结束并结算已进行部分', () => {
    const bed = anchorUse('home', 'rest');
    const { sim, events } = simWith('frank', bed.x, bed.y);
    sim.character('frank').energy = 40;
    sim.requestStartActivity('frank', 'rest');
    sim.advanceTicks(10);
    sim.requestStopActivity('frank');
    const frank = sim.character('frank');
    expect(frank.activity).toBeNull();
    expect(frank.energy).toBeCloseTo(40 - 10 * 0.05 + 10 * 0.5, 5);
    const finished = events.find((e) => e.type === 'activity.finished') as ActivityFinishedEvent;
    expect(finished).toMatchObject({ reason: 'stopped', elapsedMinutes: 10 });
  });

  it('校验: 不在锚点/不在场所/移动中/重复开始/未知活动/无活动停止均拒绝', () => {
    const { sim } = simWith('gina', 8, 12); // 公寓入口(非书桌/床使用格)
    expect(() => sim.requestStartActivity('gina', 'study')).toThrow(/使用格/);
    expect(() => sim.requestStartActivity('gina', 'rest')).toThrow(/使用格/);
    sim.spawnCharacter('henry', 20, 13, 'henry'); // 广场,不在公园
    expect(() => sim.requestStartActivity('henry', 'stroll')).toThrow(/场所/);
    sim.requestMoveTo('henry', 21, 13);
    expect(() => sim.requestStartActivity('henry', 'stroll')).toThrow(/移动中/);
    const bed = anchorUse('home', 'rest');
    sim.spawnCharacter('iris', bed.x, bed.y, 'iris');
    sim.requestStartActivity('iris', 'rest');
    expect(() => sim.requestStartActivity('iris', 'rest')).toThrow(/已在进行/);
    expect(() => sim.requestStartActivity('iris', 'unknown')).toThrow(/未知活动/);
    sim.requestStopActivity('iris');
    expect(() => sim.requestStopActivity('iris')).toThrow(/没有进行中的活动/);
  });
});
