import { BALANCE } from '../config/balance.js';

/**
 * 游戏日历:以累计游戏分钟为唯一内部状态的纯时钟(零 I/O)。
 * 推进由 Simulation 驱动,1 tick = 1 游戏分钟。
 */
export class GameClock {
  private _minutes: number;

  constructor(startMinutes: number = BALANCE.START_MINUTE_OF_DAY) {
    this._minutes = startMinutes;
  }

  /** 自纪元(第 1 日 00:00)起累计游戏分钟 */
  get gameMinutes(): number {
    return this._minutes;
  }

  /** 游戏日,从 1 起 */
  get day(): number {
    return BALANCE.START_DAY + Math.floor(this._minutes / BALANCE.DAY_MINUTES);
  }

  /** 当日第几分钟(0~1439) */
  get minuteOfDay(): number {
    return this._minutes % BALANCE.DAY_MINUTES;
  }

  get hour(): number {
    return Math.floor(this.minuteOfDay / 60);
  }

  get minute(): number {
    return this.minuteOfDay % 60;
  }

  /** 昼夜判定:22:00~次日 06:00 为夜 */
  get isNight(): boolean {
    const m = this.minuteOfDay;
    return m >= BALANCE.NIGHT_START_MINUTE || m < BALANCE.NIGHT_END_MINUTE;
  }

  advance(gameMinutes: number): void {
    this._minutes += gameMinutes;
  }

  /** 当日 HH:mm(24 小时制) */
  formatTime(): string {
    const hh = String(this.hour).padStart(2, '0');
    const mm = String(this.minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}
