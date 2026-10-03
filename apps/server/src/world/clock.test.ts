import { describe, expect, it } from 'vitest';
import { BALANCE } from '../config/balance.js';
import { GameClock } from './clock.js';

describe('GameClock 游戏日历', () => {
  it('纪元为第 1 日 08:00', () => {
    const clock = new GameClock();
    expect(clock.day).toBe(1);
    expect(clock.formatTime()).toBe('08:00');
    expect(clock.gameMinutes).toBe(BALANCE.START_MINUTE_OF_DAY);
    expect(clock.isNight).toBe(false);
  });

  it('advance 按游戏分钟推进', () => {
    const clock = new GameClock();
    clock.advance(1);
    expect(clock.formatTime()).toBe('08:01');
    clock.advance(59);
    expect(clock.formatTime()).toBe('09:00');
    expect(clock.day).toBe(1);
  });

  it('跨日翻转:1440 分钟后进入第 2 日 00:00', () => {
    const clock = new GameClock();
    clock.advance(BALANCE.DAY_MINUTES - BALANCE.START_MINUTE_OF_DAY);
    expect(clock.formatTime()).toBe('00:00');
    expect(clock.day).toBe(2);
  });

  it('昼夜边界:06:00 转昼,22:00 转夜', () => {
    // 纪元偏移:第 1 日 00:00 = 0
    const at = (minuteOfDay: number) => new GameClock(minuteOfDay);
    expect(at(5 * 60 + 59).isNight).toBe(true); // 05:59
    expect(at(6 * 60).isNight).toBe(false); // 06:00
    expect(at(21 * 60 + 59).isNight).toBe(false); // 21:59
    expect(at(22 * 60).isNight).toBe(true); // 22:00
    expect(at(23 * 60 + 59).isNight).toBe(true); // 23:59
    expect(at(0).isNight).toBe(true); // 00:00
  });

  it('formatTime 补零', () => {
    const clock = new GameClock(0);
    expect(clock.formatTime()).toBe('00:00');
    clock.advance(9 * 60 + 5);
    expect(clock.formatTime()).toBe('09:05');
  });
});
