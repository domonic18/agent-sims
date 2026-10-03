import { BALANCE } from '../config/balance.js';
import { GameClock } from './clock.js';

/**
 * 世界模拟核心:固定 tick(1 tick = 1 游戏分钟),纯逻辑零 I/O。
 * 推进来源有二:实时驱动器(TickDriver,暂停时冻结)与手动推进
 * (调试端点/headless,不受暂停限制)。
 */
export class Simulation {
  readonly clock = new GameClock();
  tick = 0;
  paused = false;
  timeScale: number = BALANCE.DEFAULT_TIME_SCALE;

  advanceTicks(n: number): void {
    for (let i = 0; i < n; i += 1) {
      this.tick += 1;
      this.clock.advance(1);
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setTimeScale(scale: number): void {
    if (!(BALANCE.TIME_SCALES as readonly number[]).includes(scale)) {
      throw new RangeError(`非法时间倍率: ${scale}(可用档位: ${BALANCE.TIME_SCALES.join('/')})`);
    }
    this.timeScale = scale;
  }

  /** 状态快照:调试端点与后续同步层共用的对外形态 */
  snapshot(): SimulationSnapshot {
    return {
      tick: this.tick,
      paused: this.paused,
      timeScale: this.timeScale,
      clock: {
        gameMinutes: this.clock.gameMinutes,
        day: this.clock.day,
        time: this.clock.formatTime(),
        isNight: this.clock.isNight,
      },
    };
  }
}

export interface SimulationSnapshot {
  tick: number;
  paused: boolean;
  timeScale: number;
  clock: {
    gameMinutes: number;
    day: number;
    /** HH:mm */
    time: string;
    isNight: boolean;
  };
}
