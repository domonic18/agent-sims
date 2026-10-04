import type { ActivityDefinition } from '@sims/shared';
import { REST_RATES_BY_KIND } from '@sims/shared';
import { clampVital, type CharacterActivity, type WorldCharacter } from './character.js';

export type SettleResult = 'continue' | 'completed' | 'insufficient_coins';

/**
 * 结算活动的一游戏分钟:效果为每分钟净速率(M3.6g,已含活动期间代谢,
 * 调用方待机才走基础代谢衰减),达到 durationMinutes 返回 completed;
 * 净负金币且余额不足返回 insufficient_coins(结算前判定,金币不透支)。
 * rest 按锚点家具档位(REST_RATES_BY_KIND: 床/沙发/长椅)取速率。
 */
export function settleActivityMinute(
  activity: CharacterActivity,
  character: WorldCharacter,
  definition: ActivityDefinition,
): SettleResult {
  const rates =
    definition.id === 'rest' && activity.anchorKind !== null
      ? (REST_RATES_BY_KIND[activity.anchorKind as keyof typeof REST_RATES_BY_KIND] ?? null)
      : null;
  const effects =
    rates !== null
      ? { energy: rates.energy, happiness: rates.happiness, coins: 0 }
      : definition.effects;
  if (effects.coins < 0 && character.coins + effects.coins < 0) {
    return 'insufficient_coins';
  }
  character.energy = clampVital(character.energy + effects.energy);
  character.happiness = clampVital(character.happiness + effects.happiness);
  character.coins = Math.max(0, character.coins + effects.coins);
  activity.elapsed += 1;
  return activity.elapsed >= definition.durationMinutes ? 'completed' : 'continue';
}
