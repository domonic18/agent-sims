import type { SleepDebtAppliedEvent, SleepSettledEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { WorldCharacter } from './character.js';
import type { GameClock } from './clock.js';
import type { Simulation } from './simulation.js';

/** 睡眠窗口判定(M-G.2):22:00~次日 06:00(与 clock.isNight 同窗口,读可热调参数) */
export function inSleepWindow(clock: GameClock): boolean {
  const m = clock.minuteOfDay;
  return m >= BALANCE.NIGHT_START_MINUTE || m < BALANCE.NIGHT_END_MINUTE;
}

/** 缺觉系数(M-G.2):惩罚生效中(未到 sleepDebtEndGameMinutes)返回 SLEEP_DEBT_MULTIPLIER,否则 1 */
export function debtFactor(
  character: Pick<WorldCharacter, 'sleepDebtEndGameMinutes'>,
  gameMinutes: number,
): number {
  return character.sleepDebtEndGameMinutes !== null &&
    gameMinutes < character.sleepDebtEndGameMinutes
    ? BALANCE.SLEEP_DEBT_MULTIPLIER
    : 1;
}

/**
 * 睡眠结算(M-G.2,数值文档 §2.7):每日 06:00——昨夜窗口累计 < SLEEP_MIN_MINUTES
 * 且存活者挂缺觉惩罚 24 游戏时并发 sleep.debt_applied;睡饱者(M5)发 sleep.settled
 * 供梦境固化器触发当日记忆整理。两事件互斥(每角色每晨恰一条);账本无条件清零
 * (含幽灵——死亡期间漏结算,复活后从零起算)。
 */
export function settleSleep(sim: Simulation): void {
  for (const character of sim.characters.values()) {
    if (character.alive) {
      if (character.sleepWindowMinutes < BALANCE.SLEEP_MIN_MINUTES) {
        character.sleepDebtEndGameMinutes = sim.clock.gameMinutes + BALANCE.DAY_MINUTES;
        const event: SleepDebtAppliedEvent = {
          type: 'sleep.debt_applied',
          characterId: character.id,
          sleptMinutes: character.sleepWindowMinutes,
          tick: sim.tick,
        };
        sim.events.emit(event);
      } else {
        const event: SleepSettledEvent = {
          type: 'sleep.settled',
          characterId: character.id,
          sleptMinutes: character.sleepWindowMinutes,
          gameMinutes: sim.clock.gameMinutes,
          tick: sim.tick,
        };
        sim.events.emit(event);
      }
    }
    character.sleepWindowMinutes = 0;
  }
}
