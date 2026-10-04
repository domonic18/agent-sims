import { describe, expect, it } from 'vitest';
import type { ActivityFinishedEvent, PlaceDefinition, WorldEvent } from '@sims/shared';
import { TOWN_MAP } from '@sims/shared';
import { Simulation } from './simulation.js';

const place = (id: string): PlaceDefinition => {
  const found = TOWN_MAP.places.find((p) => p.id === id);
  if (!found) throw new Error(`场所不存在: ${id}`);
  return found;
};

function simWith(id: string, placeId: string): { sim: Simulation; events: WorldEvent[] } {
  const sim = new Simulation();
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  const entrance = place(placeId).entrance;
  sim.spawnCharacter(id, entrance.x, entrance.y, id);
  return { sim, events };
}

describe('活动执行(M3.1)', () => {
  it('学习完整 60 分钟: 体力/幸福按衰减+效果结算,自动完成', () => {
    const { sim, events } = simWith('alice', 'library');
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

  it('打工 120 分钟: 赚 60 金币,数值净消耗', () => {
    const { sim } = simWith('bob', 'office');
    sim.requestStartActivity('bob', 'work');
    sim.advanceTicks(120);
    const bob = sim.character('bob');
    expect(bob.coins).toBe(60);
    expect(bob.energy).toBeCloseTo(100 - 120 * 0.05 - 120 * 0.25, 5);
    expect(bob.happiness).toBeCloseTo(100 - 120 * 0.03 - 120 * 0.1, 5);
  });

  it('就餐余额不足: 结算前判定,不透支,提前中断', () => {
    const { sim, events } = simWith('carl', 'restaurant');
    sim.character('carl').coins = 5;
    sim.requestStartActivity('carl', 'meal');
    sim.advanceTicks(30);
    const carl = sim.character('carl');
    expect(carl.activity).toBeNull();
    // 5 币够 12 分钟(5-0.4*12=0.2),第 13 分钟结算前判定不足;事件 elapsed=已结算分钟
    expect(carl.coins).toBeCloseTo(0.2, 5);
    const finished = events.find((e) => e.type === 'activity.finished');
    expect(finished).toMatchObject({
      type: 'activity.finished',
      activityId: 'meal',
      elapsedMinutes: 12,
      reason: 'insufficient_coins',
    });
  });

  it('move_to 打断进行中活动并记录 interrupted', () => {
    const { sim, events } = simWith('dave', 'park');
    sim.requestStartActivity('dave', 'stroll');
    sim.advanceTicks(5);
    sim.requestMoveTo('dave', 8, 19);
    const dave = sim.character('dave');
    expect(dave.activity).toBeNull();
    expect(dave.path.length).toBeGreaterThan(0); // 路径已重新规划
    const finished = events.at(-1);
    expect(finished).toMatchObject({
      type: 'activity.finished',
      activityId: 'stroll',
      elapsedMinutes: 5,
      reason: 'interrupted',
    });
  });

  it('手动 stop: 即时结束并结算已进行部分', () => {
    const { sim, events } = simWith('erin', 'home');
    sim.character('erin').energy = 40;
    sim.requestStartActivity('erin', 'rest');
    sim.advanceTicks(10);
    sim.requestStopActivity('erin');
    const erin = sim.character('erin');
    expect(erin.activity).toBeNull();
    expect(erin.energy).toBeCloseTo(40 - 10 * 0.05 + 10 * 0.5, 5);
    const finished = events.find((e) => e.type === 'activity.finished') as ActivityFinishedEvent;
    expect(finished).toMatchObject({ reason: 'stopped', elapsedMinutes: 10 });
  });

  it('校验: 非场所/移动中/重复开始/未知活动/无活动停止均拒绝', () => {
    const { sim } = simWith('frank', 'home');
    expect(() => sim.requestStartActivity('frank', 'study')).toThrow(/场所/);
    sim.spawnCharacter('gina', 10, 10, 'gina');
    sim.requestMoveTo('gina', 11, 10);
    expect(() => sim.requestStartActivity('gina', 'stroll')).toThrow(/移动中/);
    sim.requestStartActivity('frank', 'rest');
    expect(() => sim.requestStartActivity('frank', 'rest')).toThrow(/已在进行/);
    expect(() => sim.requestStartActivity('frank', 'unknown')).toThrow(/未知活动/);
    sim.requestStopActivity('frank');
    expect(() => sim.requestStopActivity('frank')).toThrow(/没有进行中的活动/);
  });
});
