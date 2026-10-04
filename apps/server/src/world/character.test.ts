import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { applyVitalDecay, stepMovement, type WorldCharacter } from './character.js';
import { EventBus } from './event-bus.js';
import { Simulation } from './simulation.js';

function walker(path: Array<{ x: number; y: number }>): WorldCharacter {
  return {
    id: 't',
    name: '测试',
    x: 0,
    y: 0,
    path,
    energy: 100,
    happiness: 100,
    coins: 0,
    activity: null,
    items: [],
  };
}

describe('stepMovement 逐 tick 移动', () => {
  it('速度 1:每 tick 走 1 格,走完返回 true(到达)', () => {
    const character = walker([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(stepMovement(character, 1)).toBe(false);
    expect(character.x).toBe(1);
    expect(stepMovement(character, 1)).toBe(false);
    expect(stepMovement(character, 1)).toBe(true); // 恰好到达
    expect(character.x).toBe(2);
    expect(character.y).toBe(1);
    expect(character.path).toHaveLength(0);
  });

  it('到达后再推进为无操作,不再触发到达', () => {
    const character = walker([{ x: 1, y: 0 }]);
    expect(stepMovement(character, 1)).toBe(true);
    expect(stepMovement(character, 1)).toBe(false); // 原地,不重复触发
    expect(character.x).toBe(1);
  });

  it('速度 2:一步跨 2 格,不越过终点', () => {
    const character = walker([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(stepMovement(character, 2)).toBe(false); // 走 2 格还剩 1
    expect(character.x).toBe(2);
    expect(stepMovement(character, 2)).toBe(true); // 第 3 格到达
    expect(character.y).toBe(1);
  });
});

describe('applyVitalDecay 数值衰减', () => {
  it('按游戏分钟衰减体力与幸福', () => {
    const character = walker([]);
    applyVitalDecay(character, 60); // 1 游戏小时
    expect(character.energy).toBeCloseTo(97, 5); // 100 - 0.05*60
    expect(character.happiness).toBeCloseTo(98.2, 5); // 100 - 0.03*60
  });

  it('下界夹取 0,不出现负数', () => {
    const character = walker([]);
    character.energy = 0.01;
    character.happiness = 0.01;
    applyVitalDecay(character, 10);
    expect(character.energy).toBe(0);
    expect(character.happiness).toBe(0);
  });

  it('上限夹取 100(活动增益场景)', () => {
    const character = walker([]);
    character.energy = 99.99;
    character.happiness = 50;
    applyVitalDecay(character, -1); // 负衰减=增益,夹上界
    expect(character.energy).toBe(100);
  });
});

describe('EventBus', () => {
  it('subscribe 后收发,退订后不再收', () => {
    const bus = new EventBus<string>();
    const got: string[] = [];
    const off = bus.subscribe((event) => got.push(event));
    bus.emit('a');
    off();
    bus.emit('b');
    expect(got).toEqual(['a']);
  });
});

describe('Simulation 移动集成', () => {
  it('advanceTicks 驱动移动,到达触发 character.arrived 事件', () => {
    const sim = new Simulation();
    const events: WorldEvent[] = [];
    sim.events.subscribe((event) => events.push(event));
    sim.spawnCharacter('jev', 5, 7, '杰夫'); // home 入口
    sim.requestMoveTo('jev', 8, 7);
    expect(sim.character('jev').path.length).toBe(3);
    sim.advanceTicks(3);
    expect(sim.character('jev').x).toBe(8);
    expect(sim.character('jev').path).toHaveLength(0);
    expect(events).toEqual([
      { type: 'character.arrived', characterId: 'jev', tick: 3, x: 8, y: 7 },
    ]);
  });

  it('requestMoveTo 拒绝不可行走目标/未知角色', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 5, 7);
    expect(() => sim.requestMoveTo('a', 3, 3)).toThrow(/不可行走/); // 公寓屋顶
    expect(() => sim.requestMoveTo('ghost', 5, 8)).toThrow(/角色不存在/);
  });

  it('spawnCharacter 拒绝重复 id 与不可行走出生点', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 5, 7);
    expect(() => sim.spawnCharacter('a', 6, 7)).toThrow(/已存在/);
    expect(() => sim.spawnCharacter('b', 0, 0)).toThrow(/不可行走/); // 边界墙
  });

  it('移动中改目标:重置路径从当前位置出发', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 5, 7);
    sim.requestMoveTo('a', 10, 7);
    sim.advanceTicks(2);
    expect(sim.character('a').x).toBe(7);
    sim.requestMoveTo('a', 9, 10); // 商店占地 x2..7,选 x=9 避开
    const path = sim.character('a').path;
    const first = path[0]!;
    expect(Math.abs(first.x - 7) + Math.abs(first.y - 7)).toBe(1); // 首步从当前位置相邻格起算
    sim.advanceTicks(path.length);
    const final = sim.character('a');
    expect(final.x).toBe(9);
    expect(final.y).toBe(10);
  });
});
