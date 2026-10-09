import type { CharacterDiedEvent } from '@sims/shared';
import { REVIVE_WINDOW_MINUTES } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { finishActivity } from './activity.js';
import { clearCollapseIfRecovered, reviveCharacter, type WorldCharacter } from './character.js';
import type { Simulation } from './simulation.js';

/**
 * 健康归零→幽灵态(numerical §2.3 唯一死亡闸门):仅 survival 重伤休整触发,
 * 清路径/打断活动,得分扣减**挂起**——窗口内救治/debug 免扣,超时 growth 按现值生效
 * (survival 免扣、数值回恢复线,见 reviveCharacter 分支)。
 */
export function checkDeath(sim: Simulation, character: WorldCharacter): void {
  // 世界规则关闭死亡(M5):健康卡 1 不入重伤(survival);
  if (!sim.rules.allowDeath) {
    if (sim.gameType === 'survival' && character.health <= 0) {
      character.health = 1;
    }
    return;
  }
  const injured = sim.gameType === 'survival' && character.health <= 0;
  if (!character.alive || !injured) {
    return;
  }
  character.alive = false;
  character.collapsed = false; // 重伤优先于虚脱(复活统一清标)
  character.path = [];
  character.diedAtGameMinutes = sim.clock.gameMinutes;
  finishActivity(sim, character, 'died');
  const event: CharacterDiedEvent = {
    type: 'character.died',
    characterId: character.id,
    tick: sim.tick,
    revivable: true,
  };
  sim.events.emit(event);
}

/**
 * 体力虚脱判定(numerical §2.3):体力归零不再死亡——
 * growth(allowDeath=true)累倒送医:复用幽灵态骨架挂救治窗口,救治满状态回归、
 * 超时苏醒回恢复线并按比例扣分;survival 与 allowDeath=false 原地虚脱倒地,
 * 意图门禁只放行休息/睡觉/进食,体力回升即爬起。健康照跑饥饿线,可滑向重伤休整。
 */
export function checkCollapse(sim: Simulation, character: WorldCharacter): void {
  clearCollapseIfRecovered(character);
  if (!character.alive || character.energy > 0) {
    return;
  }
  if (sim.gameType === 'growth' && sim.rules.allowDeath) {
    character.alive = false;
    character.path = [];
    character.diedAtGameMinutes = sim.clock.gameMinutes;
    finishActivity(sim, character, 'died');
    const event: CharacterDiedEvent = {
      type: 'character.died',
      characterId: character.id,
      tick: sim.tick,
      revivable: true,
    };
    sim.events.emit(event);
    return;
  }
  character.collapsed = true;
  character.path = [];
  if (character.activity !== null) {
    finishActivity(sim, character, 'collapsed');
  }
}

/** 救治窗口超时结算(M-G.5):挂起扣减按超时时刻现值 ×(1-比例) 生效,自动复活;
 * survival 重伤休整(M-S/S1)软惩罚原则——超时苏醒不扣得分,数值回恢复线 */
export function checkReviveWindow(sim: Simulation, character: WorldCharacter): void {
  if (character.alive || character.diedAtGameMinutes === null) {
    return;
  }
  if (sim.clock.gameMinutes - character.diedAtGameMinutes < REVIVE_WINDOW_MINUTES) {
    return;
  }
  // 累倒苏醒扣分(numerical §2.3/§2.5): 比例扣,仅 growth 送医窗口;survival 不扣
  if (sim.gameType !== 'survival') {
    character.score *= 1 - BALANCE.SCORE_WAKE_DEDUCTION;
  }
  reviveCharacter(sim, character, 'timeout');
}
