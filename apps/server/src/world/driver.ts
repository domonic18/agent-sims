import { BALANCE } from '../config/balance.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from './simulation.js';

export interface TickDriverOptions {
  /** 注入时钟(默认 Date.now),测试可复现 */
  now?: () => number;
  /** 单次泵最大补跑 tick 数,默认取 BALANCE.MAX_CATCHUP_TICKS */
  maxCatchupTicks?: number;
  /** 每 tick 推进后回调(同步层广播增量用) */
  onTick?: (tick: number) => void;
}

/**
 * 实时驱动器:accumulator 模式(Fix Your Timestep)。
 * 泵间隔由宿主定时器决定(建议 BALANCE.DRIVER_SLICE_MS),
 * 累计真实流逝时间并按 TICK_MS/timeScale 换算为 tick 逐一推进。
 */
export class TickDriver {
  private _acc = 0;
  private _last: number;
  private readonly _sim: Simulation;
  private readonly _now: () => number;
  private readonly _maxCatchupTicks: number;
  private readonly _onTick: ((tick: number) => void) | undefined;

  constructor(sim: Simulation, options: TickDriverOptions = {}) {
    this._sim = sim;
    this._now = options.now ?? Date.now;
    this._maxCatchupTicks = options.maxCatchupTicks ?? BALANCE.MAX_CATCHUP_TICKS;
    this._onTick = options.onTick;
    this._last = this._now();
  }

  /** 由宿主定时器周期调用,返回本次推进的 tick 数 */
  pump(): number {
    const now = this._now();
    this._acc += now - this._last;
    this._last = now;
    if (this._sim.paused) {
      this._acc = 0;
      return 0;
    }
    const stepMs = BALANCE.TICK_MS / this._sim.timeScale;
    let steps = 0;
    // 慢切片埋点用真实墙钟计时:注入时钟是逻辑时间,多读会污染累加器
    const wallStartedAt = Date.now();
    while (this._acc >= stepMs && steps < this._maxCatchupTicks) {
      this._sim.advanceTicks(1);
      this._acc -= stepMs;
      steps += 1;
      this._onTick?.(this._sim.tick);
    }
    if (steps >= this._maxCatchupTicks) {
      this._acc = 0;
    }
    // 慢切片埋点(M-G.1②):单次泵耗时超过泵间隔,说明追帧吃满节拍
    const sliceMs = Date.now() - wallStartedAt;
    if (sliceMs > BALANCE.DRIVER_SLICE_MS) {
      logTech('warn', 'tick', '慢tick切片', { ms: sliceMs, steps, timeScale: this._sim.timeScale });
    }
    return steps;
  }
}
