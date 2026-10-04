import type { ActivityDefinition } from '@sims/shared';
import { clampVital, type CharacterActivity, type WorldCharacter } from './character.js';

export type SettleResult = 'continue' | 'completed' | 'insufficient_coins';

/**
 * 结算活动的一游戏分钟:效果为净增量(与调用方的自然衰减叠加),
 * 达到 durationMinutes 返回 completed;净负金币且余额不足返回
 * insufficient_coins(结算前判定,金币不透支)。
 */
export function settleActivityMinute(
  activity: CharacterActivity,
  character: WorldCharacter,
  definition: ActivityDefinition,
): SettleResult {
  const { effects } = definition;
  if (effects.coins < 0 && character.coins + effects.coins < 0) {
    return 'insufficient_coins';
  }
  character.energy = clampVital(character.energy + effects.energy);
  character.happiness = clampVital(character.happiness + effects.happiness);
  character.coins = Math.max(0, character.coins + effects.coins);
  activity.elapsed += 1;
  return activity.elapsed >= definition.durationMinutes ? 'completed' : 'continue';
}
