import type {
  ActivityDefinition,
  ActivityFinishReason,
  ActivityFinishedEvent,
  ActivityStartedEvent,
} from '@sims/shared';
import {
  BASIC_ACTIVITY_IDS,
  JOB_CATEGORIES,
  furnitureLabel,
  REST_RATES_BY_KIND,
  getActivityDefinition,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import {
  clampVital,
  ensureAlive,
  type CharacterActivity,
  type WorldCharacter,
} from './character.js';
import { ensureRestAccess } from './housing.js';
import type { Simulation } from './simulation.js';

export type SettleResult = 'continue' | 'completed' | 'insufficient_coins';

/** 结束活动并发离散事件(reason: completed/stopped/interrupted/died) */
export function finishActivity(
  sim: Simulation,
  character: WorldCharacter,
  reason: ActivityFinishReason,
): void {
  if (character.activity === null) {
    return;
  }
  const event: ActivityFinishedEvent = {
    type: 'activity.finished',
    characterId: character.id,
    activityId: character.activity.activityId,
    tick: sim.tick,
    elapsedMinutes: character.activity.elapsed,
    reason,
  };
  character.activity = null;
  sim.events.emit(event);
}

/**
 * 开始活动:有锚点家具的活动须站在其声明使用格或紧邻家具占地(四邻,M3.6i 放宽;
 * M3.6e 内景化,如书桌/床/跑步机);无锚点活动(散步)沿用场所范围判定。
 * 已有进行中活动则拒绝(先显式 stop 或移动打断)。
 * M3.6f 体力区段: 体力≤阈值仅允许基础活动;rest 使用住宅床铺须本人租约有效(公园长椅放行)。
 */
export function startActivity(
  sim: Simulation,
  characterId: string,
  activityId: string,
): WorldCharacter {
  const definition = getActivityDefinition(activityId);
  if (definition === null) {
    throw new Error(`未知活动: ${activityId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  if (character.activity !== null) {
    throw new Error(`${character.name} 已在进行活动: ${character.activity.activityId}`);
  }
  if (character.path.length > 0) {
    throw new Error(`${character.name} 移动中,到达后再开始活动`);
  }
  const isBasic = (BASIC_ACTIVITY_IDS as readonly string[]).includes(activityId);
  if (character.energy <= BALANCE.LOW_ENERGY_THRESHOLD && !isBasic) {
    throw new Error(
      `${character.name} 体力过低(${Math.floor(character.energy)}≤${BALANCE.LOW_ENERGY_THRESHOLD}),只能进行基础活动(${BASIC_ACTIVITY_IDS.join('/')})`,
    );
  }
  // 岗位知识门槛(M-G.4 类别平行模型): 门槛=类别累计学习班数,拒绝并回执缺口
  if (definition.category !== undefined) {
    const required = JOB_CATEGORIES[definition.category].requiredKnowledge;
    if (character.knowledge < required) {
      throw new Error(
        `${character.name} 知识不足: ${JOB_CATEGORIES[definition.category].label}类岗位需学习 ${required} 班(当前 ${character.knowledge})`,
      );
    }
  }
  const anchors = sim.map.activityAnchors(activityId);
  let anchorKind: string | null = null;
  if (anchors.length > 0) {
    // M3.6i 放宽: 声明使用格或紧邻锚点家具占地(四邻)均可,贴着跑步机即能开始
    const anchor = sim.map.anchorAt(activityId, character.x, character.y);
    if (anchor === null) {
      const spots = anchors.map((item) => `(${item.x},${item.y})`).join('/');
      throw new Error(
        `${definition.name} 须站在${furnitureLabel(anchors[0]!.kind)}旁(使用格: ${spots})`,
      );
    }
    anchorKind = anchor.kind;
    // 床位归属仅约束 rest(睡眠);书桌/跑步机等非住宅锚点与他人同住场所放行
    if (activityId === 'rest') {
      ensureRestAccess(sim, character, anchor.placeId);
    }
  } else if (
    !definition.placeIds.some((placeId) => sim.map.contains(placeId, character.x, character.y))
  ) {
    throw new Error(`${definition.name} 须在场所 ${definition.placeIds.join('、')} 入口或范围内`);
  }
  character.activity = { activityId, elapsed: 0, anchorKind };
  const event: ActivityStartedEvent = {
    type: 'activity.started',
    characterId: character.id,
    activityId,
    tick: sim.tick,
  };
  sim.events.emit(event);
  return character;
}

export function stopActivity(sim: Simulation, characterId: string): WorldCharacter {
  const character = sim.character(characterId);
  ensureAlive(character);
  if (character.activity === null) {
    throw new Error(`${character.name} 当前没有进行中的活动`);
  }
  finishActivity(sim, character, 'stopped');
  return character;
}

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
