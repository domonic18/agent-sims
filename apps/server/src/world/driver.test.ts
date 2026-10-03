import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance.js';
import { TickDriver } from './driver.js';
import { Simulation } from './simulation.js';

/** 可手动拨动的假时钟 */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    elapse: (ms: number) => {
      now += ms;
    },
  };
}

describe('TickDriver 实时驱动器(accumulator)', () => {
  it('1x 下每 1000ms 推进 1 tick,余量结转', () => {
    const time = fakeClock();
    const sim = new Simulation();
    const driver = new TickDriver(sim, { now: time.now });
    time.elapse(BALANCE.TICK_MS);
    expect(driver.pump()).toBe(1);
    expect(sim.tick).toBe(1);
    time.elapse(BALANCE.DRIVER_SLICE_MS); // 不足 1 tick,结转到下次
    expect(driver.pump()).toBe(0);
    time.elapse(BALANCE.TICK_MS - BALANCE.DRIVER_SLICE_MS);
    expect(driver.pump()).toBe(1);
    expect(sim.tick).toBe(2);
  });

  it('倍率换算:4x 每 1000ms 推进 4 tick,16x 推进 16 tick', () => {
    const time = fakeClock();
    const sim4 = new Simulation();
    sim4.setTimeScale(4);
    const driver4 = new TickDriver(sim4, { now: time.now });
    time.elapse(BALANCE.TICK_MS);
    expect(driver4.pump()).toBe(4);
    expect(sim4.tick).toBe(4);

    const sim16 = new Simulation();
    sim16.setTimeScale(16);
    const driver16 = new TickDriver(sim16, { now: time.now });
    time.elapse(BALANCE.TICK_MS);
    expect(driver16.pump()).toBe(16);
    expect(sim16.tick).toBe(16);
    expect(sim16.clock.formatTime()).toBe('08:16');
  });

  it('暂停冻结:暂停期间不推进,恢复后继续且状态不丢', () => {
    const time = fakeClock();
    const sim = new Simulation();
    const driver = new TickDriver(sim, { now: time.now });
    time.elapse(BALANCE.TICK_MS);
    driver.pump();
    sim.setPaused(true);
    time.elapse(BALANCE.TICK_MS * 10);
    expect(driver.pump()).toBe(0);
    expect(sim.tick).toBe(1); // 暂停期时间不累计
    sim.setPaused(false);
    time.elapse(BALANCE.TICK_MS);
    expect(driver.pump()).toBe(1);
    expect(sim.tick).toBe(2);
  });

  it('补跑上限:长时间挂起后只补跑 maxCatchupTicks 个 tick', () => {
    const time = fakeClock();
    const sim = new Simulation();
    const driver = new TickDriver(sim, { now: time.now, maxCatchupTicks: 5 });
    time.elapse(100_000); // 足够 100 tick
    expect(driver.pump()).toBe(5);
    expect(sim.tick).toBe(5);
    time.elapse(0); // 溢出累积已被丢弃,不二次猛追
    expect(driver.pump()).toBe(0);
  });

  it('高倍率小步累加:16x 下 100ms 粒度也精确推进', () => {
    const time = fakeClock();
    const sim = new Simulation();
    sim.setTimeScale(16);
    const driver = new TickDriver(sim, { now: time.now });
    // 步长 62.5ms,两次 100ms = 200ms → 3 tick
    time.elapse(100);
    driver.pump();
    time.elapse(100);
    driver.pump();
    expect(sim.tick).toBe(3);
  });
});
