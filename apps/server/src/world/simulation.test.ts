import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.js';

describe('Simulation 模拟核心', () => {
  it('advanceTicks 每 tick 推进 1 游戏分钟', () => {
    const sim = new Simulation();
    sim.advanceTicks(90);
    expect(sim.tick).toBe(90);
    expect(sim.clock.formatTime()).toBe('09:30');
    sim.advanceTicks(30);
    expect(sim.tick).toBe(120);
    expect(sim.clock.formatTime()).toBe('10:00');
  });

  it('暂停/恢复只翻转标志,状态不丢', () => {
    const sim = new Simulation();
    sim.advanceTicks(10);
    sim.setPaused(true);
    expect(sim.snapshot().paused).toBe(true);
    sim.setPaused(false);
    expect(sim.snapshot().paused).toBe(false);
    expect(sim.tick).toBe(10);
  });

  it('setTimeScale 合法档位生效,非法档位抛错', () => {
    const sim = new Simulation();
    sim.setTimeScale(4);
    expect(sim.timeScale).toBe(4);
    sim.setTimeScale(16);
    expect(sim.timeScale).toBe(16);
    expect(() => sim.setTimeScale(5)).toThrow(RangeError);
    expect(() => sim.setTimeScale(0)).toThrow(RangeError);
    expect(sim.timeScale).toBe(16); // 抛错后保持原值
  });

  it('snapshot 输出完整对外形态', () => {
    const sim = new Simulation();
    sim.advanceTicks(60);
    sim.setTimeScale(4);
    expect(sim.snapshot()).toEqual({
      tick: 60,
      paused: false,
      timeScale: 4,
      clock: { gameMinutes: 540, day: 1, time: '09:00', isNight: false },
      characters: [],
    });
  });
});
