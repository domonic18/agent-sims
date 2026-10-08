import {
  BASIC_ACTIVITY_IDS,
  findPlaceAt,
  findPlaceByRef,
  getActivityDefinition,
  getItem,
  getPropertyDefinition,
  ITEMS,
  type Intent,
  type PlaceDefinition,
  type TileMapDefinition,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { WorldCharacter } from '../world/character.js';
import { planBlockAt, type DayPlan } from './slow-layer.js';
import type { MemoryLlm } from './memory-writer.js';

/** 快层判定输出(agent-design §4.3):continue=当前行为仍有效零模型;react=产出一个意图交执行 */
export interface Decision {
  layer: 'rule' | 'plan' | 'jev' | 'triage';
  action: 'continue' | 'react';
  intent?: Intent;
  /** react 时的决策气泡文案(意图+理由模板) */
  bubble?: string;
}

/** 阈值巡检的 rule 判定(agent-design §4.3 rule 层,零模型):数值压力反应,
 * 规则先行、命中即止。只对空闲角色反应——移动/活动进行中不打断(等下轮巡检)。 */
export function ruleDecide(
  char: WorldCharacter,
  day: number,
  map: TileMapDefinition,
): Decision {
  if (!char.alive || char.collapsed) return { layer: 'rule', action: 'continue' };
  if (char.activity !== null || char.path.length > 0) {
    return { layer: 'rule', action: 'continue' };
  }
  const hunger = ruleHunger(char, map);
  if (hunger !== null) return hunger;
  const rent = ruleRent(char, day);
  if (rent !== null) return rent;
  return { layer: 'rule', action: 'continue' };
}

/** 饥饿反应:体力≤饥饿线时 吃背包食物 → 店内买最便宜食物 → 前往商店 */
function ruleHunger(char: WorldCharacter, map: TileMapDefinition): Decision | null {
  if (char.energy > BALANCE.SURVIVAL_HUNGER_ENERGY_LINE) return null;
  const foodId = Object.keys(char.backpack).find((id) => getItem(id)?.category === 'food');
  if (foodId !== undefined) {
    const food = getItem(foodId);
    return {
      layer: 'rule',
      action: 'react',
      intent: { type: 'eat_item', characterId: char.id, itemId: foodId },
      bubble: `体力低了,吃个${food?.name ?? foodId}`,
    };
  }
  const shop = findPlaceByRef(map, 'shop');
  if (shop === null) return null;
  const inShop = findPlaceAt(map, char.x, char.y)?.id === shop.id;
  const cheapest = cheapestFood();
  if (inShop) {
    if (cheapest !== null && char.coins >= cheapest.price) {
      return {
        layer: 'rule',
        action: 'react',
        intent: { type: 'buy_item', characterId: char.id, itemId: cheapest.id },
        bubble: `就在商店,买份${cheapest.name}垫垫肚子`,
      };
    }
    return { layer: 'rule', action: 'continue' }; // 没钱,压力留给玩家
  }
  if (cheapest !== null && char.coins >= cheapest.price) {
    return {
      layer: 'rule',
      action: 'react',
      intent: { type: 'move_to', characterId: char.id, x: shop.entrance.x, y: shop.entrance.y },
      bubble: '肚子饿了,去商店买点吃的',
    };
  }
  return { layer: 'rule', action: 'continue' };
}

/** 房租反应:租约次日到期且有支付能力 → 续租 */
function ruleRent(char: WorldCharacter, day: number): Decision | null {
  const housing = char.housing;
  if (housing === null || housing.ownership !== 'rent') return null;
  if (housing.paidThroughDay - day > 1) return null;
  const property = getPropertyDefinition(housing.propertyId);
  if (property === null || char.coins < property.rentPrice) return null;
  return {
    layer: 'rule',
    action: 'react',
    intent: { type: 'rent_property', characterId: char.id, propertyId: housing.propertyId },
    bubble: `房租快到期了,续租${property.name}`,
  };
}

function cheapestFood(): { id: string; name: string; price: number } | null {
  let best: { id: string; name: string; price: number } | null = null;
  for (const item of ITEMS) {
    if (item.category !== 'food' || item.price === undefined) continue;
    if (best === null || item.price < best.price) {
      best = { id: item.id, name: item.name, price: item.price };
    }
  }
  return best;
}

/** jev 社交候选(10-cognition §7.2):动机引擎产出、调度泵拼好位置的异地熟人 */
export interface JevSocialCandidate {
  characterId: string;
  name: string;
  affinity: number;
  x: number;
  y: number;
}

/** jev 微决策(agent-design §4.3):空闲角色在事件触发时用 systemone choice
 * 题「现在去哪」候选选一,产出去某处的 move_to。C4 起社交候选与地点同池竞争
 * (好感≥65 文案加权);选中熟人即走向 TA,到位后由动机引擎直执聊天。
 * 调用失败返回 null(回落 continue)。 */
export async function jevDecide(
  llm: MemoryLlm,
  char: WorldCharacter,
  map: TileMapDefinition,
  socialCandidates: readonly JevSocialCandidate[] = [],
): Promise<Decision | null> {
  if (!char.alive || char.collapsed) return null; // 失能不越权(与 ruleDecide 同门槛)
  if (char.activity !== null || char.path.length > 0) return null; // jev 只服务空闲角色,忙角色不白烧 LLM
  const here = findPlaceAt(map, char.x, char.y)?.id ?? null;
  const placeCandidates = [
    { ref: 'shop', label: '商店', desc: '去商店看看,补充食物' },
    { ref: 'park', label: '公园', desc: '去公园走走散心' },
    ...(['home-a', 'home-b', 'home-c', 'home-d'] as const)
      .map((ref) => {
        const property = getPropertyDefinition(ref);
        return { ref, label: property?.name ?? ref, desc: '回家休息' };
      })
      .filter((c) => c.ref !== housingRef(char)),
  ]
    .filter((c) => c.ref !== here)
    .map((c) => ({ kind: 'place' as const, ...c }));
  const social = socialCandidates.map((c) => ({
    kind: 'social' as const,
    characterId: c.characterId,
    label: `找${c.name}聊天`,
    desc: c.affinity >= 65 ? `去找${c.name}聊聊,你们很投缘` : `去找${c.name}聊聊天`,
  }));
  const candidates = [...placeCandidates, ...social];
  if (candidates.length === 0) return null;
  try {
    const result = await llm.systemOne(
      'jev',
      `${char.name}现在空闲,凭直觉选一个此刻最想做的事`,
      {
        next: {
          type: 'choice',
          instructions: '选出此刻最想做的选择',
          criteria: Object.fromEntries(candidates.map((c) => [c.label, c.desc])),
        },
      },
      { taskType: 'agent.jev_micro', characterId: char.id },
    );
    const answer = result.answers.next;
    const choice = answer?.type === 'choice' ? answer.choice : null;
    const picked = choice !== null ? candidates.find((c) => c.label === choice) : undefined;
    if (picked === undefined) return null;
    if (picked.kind === 'social') {
      const target = socialCandidates.find((c) => c.characterId === picked.characterId);
      if (target === undefined) return null;
      return {
        layer: 'jev',
        action: 'react',
        intent: { type: 'move_to', characterId: char.id, x: target.x, y: target.y },
        bubble: `去找${target.name}聊聊`,
      };
    }
    const place = findPlaceByRef(map, picked.ref);
    if (place === null) return null;
    return {
      layer: 'jev',
      action: 'react',
      intent: { type: 'move_to', characterId: char.id, x: place.entrance.x, y: place.entrance.y },
      bubble: `${picked.desc}(${picked.label})`,
    };
  } catch {
    return null; // jev 槽不可用:快层回落 rule/continue,绝不阻塞泵
  }
}

function housingRef(char: WorldCharacter): string | null {
  return char.housing === null
    ? null
    : getPropertyDefinition(char.housing.propertyId)?.placeId ?? null;
}

/** 活动目标格:锚点活动(书桌/床/跑步机)取使用格,无锚点取首个场所入口 */
function activitySpot(
  map: TileMapDefinition,
  activityId: string,
  placeIds: readonly string[],
  anchors: Array<{ x: number; y: number }>,
): { x: number; y: number; placeName: string } | null {
  if (anchors.length > 0) {
    return { x: anchors[0]!.x, y: anchors[0]!.y, placeName: '' };
  }
  const place = placeIds.map((id) => findPlaceByRef(map, id)).find((p) => p !== null);
  if (place === undefined || place === null) return null;
  return { x: place.entrance.x, y: place.entrance.y, placeName: place.name };
}

function onSpot(char: WorldCharacter, spots: Array<{ x: number; y: number }>): boolean {
  return spots.some((s) => s.x === char.x && s.y === char.y);
}

/**
 * 日程执行(agent-design §3.3 慢思考产块、快层执行):空闲角色按当日计划块
 * 两段式行动——不在目标格先 move_to,到位后 start_activity。夜间(22:00~6:00)
 * 空闲强制回家睡(有住房才安排);体力过低只放行基础活动块。无计划/空档/无锚点
 * 返回 null,交还 jev/continue,日程压力绝不阻塞快层。
 */
export function planDecide(
  char: WorldCharacter,
  plan: DayPlan | undefined,
  day: number,
  minuteOfDay: number,
  map: TileMapDefinition,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
): Decision | null {
  if (!char.alive || char.collapsed) return null;
  if (char.activity !== null || char.path.length > 0) return null; // 忙碌不越权打断(rule/jev 同门槛)
  if (plan === undefined || plan.day !== day) return null;
  const night = minuteOfDay >= BALANCE.NIGHT_START_MINUTE || minuteOfDay < BALANCE.NIGHT_END_MINUTE;
  if (night) return planNight(char, map, anchorsOf);
  const block = planBlockAt(plan, minuteOfDay);
  if (block === null) return null;
  if (block.activityId === 'rest' && char.housing === null) {
    return null; // rest 锚点=住宅床(须本人租约),无居所角色走过去必被拒,直接跳过
  }
  if (
    char.energy <= BALANCE.LOW_ENERGY_THRESHOLD &&
    !(BASIC_ACTIVITY_IDS as readonly string[]).includes(block.activityId)
  ) {
    return null; // 体力见底:日程让位生存压力(rule 链),非基础块不硬排
  }
  const definition = getActivityDefinition(block.activityId);
  if (definition === null) return null;
  const anchors = anchorsOf(block.activityId, null);
  const atTarget = anchors.length > 0 ? onSpot(char, anchors) : inAnyPlace(map, char, definition.placeIds);
  if (atTarget) {
    return {
      layer: 'plan',
      action: 'react',
      intent: { type: 'start_activity', characterId: char.id, activityId: block.activityId },
      bubble: `到地方了,按日程开始${definition.name}`,
    };
  }
  const spot = activitySpot(map, block.activityId, definition.placeIds, anchors);
  if (spot === null) return null;
  return {
    layer: 'plan',
    action: 'react',
    intent: { type: 'move_to', characterId: char.id, x: spot.x, y: spot.y },
    bubble: spot.placeName === '' ? `按日程去${definition.name}` : `按日程去${spot.placeName}${definition.name}`,
  };
}

/** 夜间空闲:有住房且家里有床锚点→就位睡觉;否则交还(无居所不强排) */
function planNight(
  char: WorldCharacter,
  map: TileMapDefinition,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
): Decision | null {
  if (char.housing === null) return null;
  const homePlaceId = getPropertyDefinition(char.housing.propertyId)?.placeId;
  if (homePlaceId === undefined) return null;
  const beds = anchorsOf('sleep', homePlaceId);
  if (beds.length === 0) return null;
  if (onSpot(char, beds)) {
    return {
      layer: 'plan',
      action: 'react',
      intent: { type: 'start_activity', characterId: char.id, activityId: 'sleep' },
      bubble: '夜深了,按日程上床睡觉',
    };
  }
  const home = findPlaceByRef(map, homePlaceId);
  if (home === null) return null;
  return {
    layer: 'plan',
    action: 'react',
    intent: { type: 'move_to', characterId: char.id, x: beds[0]!.x, y: beds[0]!.y },
    bubble: `夜深了,按日程回${home.name}睡觉`,
  };
}

function inAnyPlace(map: TileMapDefinition, char: WorldCharacter, placeIds: readonly string[]): boolean {
  return placeIds.some((id) => findPlaceAt(map, char.x, char.y)?.id === id);
}

/** lab 观测辅助:地点列表(气泡文案/测试用) */
export function placeLabel(places: PlaceDefinition[], ref: string): string | null {
  return places.find((p) => p.id === ref)?.name ?? null;
}
