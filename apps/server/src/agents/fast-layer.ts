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
import type { DayIntents } from './cognition.js';
import type { WorldCharacter } from '../world/character.js';
import type { MemoryLlm } from './memory-writer.js';

/** 快层判定输出(agent-design §4.3):continue=当前行为仍有效零模型;react=产出一个意图交执行。
 * D3:plan 层改执行弹性意图(wantSelect),wantId 标记本条决策对应的 want,
 * abandonedWantIds 收录当场判不可执行须废弃的 want(调度泵落库) */
export interface Decision {
  layer: 'rule' | 'plan' | 'jev' | 'triage';
  action: 'continue' | 'react';
  intent?: Intent;
  /** react 时的决策气泡文案(意图+理由模板) */
  bubble?: string;
  /** plan 层:本条决策对应的 want(调度泵标 doing 并落库) */
  wantId?: string;
  /** plan 层:当场判不可执行须标 abandoned 的 want 列表(调度泵落库) */
  abandonedWantIds?: string[];
}

/** 阈值巡检的 rule 判定(agent-design §4.3 rule 层,零模型):数值压力反应,
 * 规则先行、命中即止。优先级 饥饿→房租→困倦。只对空闲角色反应——
 * 移动/活动进行中不打断(等下轮巡检)。D3 起睡眠由困倦压力接管(替代夜间强制)。 */
export function ruleDecide(
  char: WorldCharacter,
  day: number,
  minuteOfDay: number,
  map: TileMapDefinition,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
): Decision {
  if (!char.alive || char.collapsed) return { layer: 'rule', action: 'continue' };
  if (char.activity !== null || char.path.length > 0) {
    return { layer: 'rule', action: 'continue' };
  }
  const hunger = ruleHunger(char, map);
  if (hunger !== null) return hunger;
  const rent = ruleRent(char, day);
  if (rent !== null) return rent;
  const sleepy = ruleSleepy(char, minuteOfDay, map, anchorsOf);
  if (sleepy !== null) return sleepy;
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

/** 困倦压力(D3,纯数值替代夜间强制):夜间/白天各有体力犯困线,越线即回家睡;
 * 无居所/家里无床不强排(压力留着,角色自己扛)。睡多久交给活动时长与自然醒,
 * 缺觉结算仍在 06:00(settlement)。 */
function ruleSleepy(
  char: WorldCharacter,
  minuteOfDay: number,
  map: TileMapDefinition,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
): Decision | null {
  const night = minuteOfDay >= BALANCE.NIGHT_START_MINUTE || minuteOfDay < BALANCE.NIGHT_END_MINUTE;
  const line = night ? BALANCE.SLEEPY_NIGHT_ENERGY : BALANCE.SLEEPY_DAY_ENERGY;
  if (char.energy > line) return null;
  if (char.housing === null) return null;
  const homePlaceId = getPropertyDefinition(char.housing.propertyId)?.placeId;
  if (homePlaceId === undefined) return null;
  const beds = anchorsOf('sleep', homePlaceId);
  if (beds.length === 0) return null;
  if (onSpot(char, beds)) {
    return {
      layer: 'rule',
      action: 'react',
      intent: { type: 'start_activity', characterId: char.id, activityId: 'sleep' },
      bubble: night ? '夜深了,困得睁不开眼,上床睡觉' : '困意上头,回去补一觉',
    };
  }
  const home = findPlaceByRef(map, homePlaceId);
  if (home === null) return null;
  return {
    layer: 'rule',
    action: 'react',
    intent: { type: 'move_to', characterId: char.id, x: beds[0]!.x, y: beds[0]!.y },
    bubble: `困了,回${home.name}睡觉`,
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
  // 合法集合内随机选点:同类活动逐次换工位/入园口,行动不再天天钉死同一格
  if (anchors.length > 0) {
    const a = anchors[Math.floor(Math.random() * anchors.length)]!;
    return { x: a.x, y: a.y, placeName: '' };
  }
  const places = placeIds.map((id) => findPlaceByRef(map, id)).filter((p) => p !== null);
  const place = places[Math.floor(Math.random() * places.length)];
  if (place === undefined || place === null) return null;
  return { x: place.entrance.x, y: place.entrance.y, placeName: place.name };
}

/** 探索目标:FNV-1a 按(角色,want)散列在场所集合内确定性选点——同一 want 重复决策
 * 命中同一目标(粘性,到位即开始),跨 want 自然换地方,不引入额外随机状态 */
export function exploreTarget(
  key: string,
  placeIds: readonly string[],
  map: TileMapDefinition,
): PlaceDefinition | null {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const places = placeIds.map((ref) => findPlaceByRef(map, ref)).filter((p) => p !== null);
  if (places.length === 0) return null;
  return places[Math.abs(hash) % places.length]!;
}

/** 探索 want 执行:目标场所内即就地开始;不在则走向目标入口 */
function exploreDecision(
  char: WorldCharacter,
  map: TileMapDefinition,
  wantKey: string,
  placeIds: readonly string[],
): { bubble: string; intent: Intent } | null {
  const target = exploreTarget(`${char.id}|${wantKey}`, placeIds, map);
  if (target === null) return null;
  const here = findPlaceAt(map, char.x, char.y);
  if (here?.id === target.id) {
    return {
      intent: { type: 'start_activity', characterId: char.id, activityId: 'explore' },
      bubble: `就在${target.name}逛逛,探索一下`,
    };
  }
  return {
    intent: { type: 'move_to', characterId: char.id, x: target.entrance.x, y: target.entrance.y },
    bubble: `去${target.name}一带探索`,
  };
}

function onSpot(char: WorldCharacter, spots: Array<{ x: number; y: number }>): boolean {
  return spots.some((s) => s.x === char.x && s.y === char.y);
}

function inAnyPlace(map: TileMapDefinition, char: WorldCharacter, placeIds: readonly string[]): boolean {
  return placeIds.some((id) => findPlaceAt(map, char.x, char.y)?.id === id);
}

function hasAnyPlace(map: TileMapDefinition, placeIds: readonly string[]): boolean {
  return placeIds.some((id) => findPlaceByRef(map, id) !== null);
}

/** 数值需求增益(D3 弹性意图择行):缺钱工作欲↑钱多↓,疲惫休息就餐↑,没学识想学 */
function needBoost(char: WorldCharacter, activityId: string): number {
  if (activityId === 'work') {
    if (char.coins < BALANCE.WANT_WORK_COIN_PRESSURE) return 1.5;
    if (char.coins >= BALANCE.WANT_WORK_COIN_SATIETY) return 0.6;
  }
  if ((activityId === 'rest' || activityId === 'meal') && char.energy <= BALANCE.WANT_TIRED_ENERGY) {
    return 1.4;
  }
  if (activityId === 'study' && char.knowledge <= BALANCE.WANT_KNOWLEDGE_LOW) return 1.3;
  return 1;
}

/**
 * 意图执行(D3,agent-design §3.3 慢思考产 want、快层择条执行):空闲角色从当日
 * wants 中按 评分=urgency×(1+倾向分 bias)×数值需求 needBoost 择一条两段式行动——
 * 不在目标格先 move_to,到位后 start_activity(气泡带第一人称 why)。
 * 不可执行的 want 当场废弃(rest 无居所/活动无锚点无场所);体力见底时非基础块
 * 让位生存压力(pending 保留,下轮再评)。无意图/意图耗尽返回 null,交还 jev/continue。
 */
export function wantSelect(
  char: WorldCharacter,
  intents: DayIntents | null | undefined,
  day: number,
  map: TileMapDefinition,
  anchorsOf: (activityId: string, placeId: string | null) => Array<{ x: number; y: number }>,
  bias: Readonly<Record<string, number>> = {},
): Decision | null {
  if (!char.alive || char.collapsed) return null;
  if (char.activity !== null || char.path.length > 0) return null; // 忙碌不越权打断(rule/jev 同门槛)
  if (intents === undefined || intents === null || intents.day !== day) return null;
  const abandoned: string[] = [];
  const candidates = intents.wants.filter((w) => {
    if (w.status !== 'pending' && w.status !== 'doing') return false;
    const definition = getActivityDefinition(w.activityId);
    if (definition === null) {
      abandoned.push(w.id);
      return false;
    }
    if (w.activityId === 'rest' && char.housing === null) {
      abandoned.push(w.id); // rest 锚点=住宅床(须本人租约),无居所角色走过去必被拒
      return false;
    }
    if (w.activityId !== 'explore' && anchorsOf(w.activityId, null).length === 0 && !hasAnyPlace(map, definition.placeIds)) {
      abandoned.push(w.id); // 既无锚点又无可达场所,这条 want 永远无法执行
      return false;
    }
    return true;
  });
  const eligible = candidates.filter(
    (w) =>
      char.energy > BALANCE.LOW_ENERGY_THRESHOLD ||
      (BASIC_ACTIVITY_IDS as readonly string[]).includes(w.activityId),
  );
  if (eligible.length === 0) {
    // 全被体力闸拦下:wants 保留(pending 不动),rule 层生存/困倦压力先行
    return abandoned.length > 0 ? { layer: 'plan', action: 'continue', abandonedWantIds: abandoned } : null;
  }
  const scored = eligible
    .map((w) => ({
      want: w,
      score:
        w.urgency *
        (1 + (bias[w.activityId] ?? 0)) *
        needBoost(char, w.activityId) *
        (0.95 + Math.random() * 0.1),
    }))
    .sort((a, b) => b.score - a.score);
  const picked = scored[0]!.want;
  const definition = getActivityDefinition(picked.activityId)!;
  const extra: Pick<Decision, 'abandonedWantIds'> = {};
  if (abandoned.length > 0) extra.abandonedWantIds = abandoned;
  if (picked.activityId === 'explore') {
    const decision = exploreDecision(char, map, picked.id, definition.placeIds);
    if (decision === null) {
      return { layer: 'plan', action: 'continue', abandonedWantIds: [...abandoned, picked.id], wantId: picked.id };
    }
    return { layer: 'plan', action: 'react', wantId: picked.id, ...extra, ...decision };
  }
  const anchors = anchorsOf(picked.activityId, null);
  const atTarget = anchors.length > 0 ? onSpot(char, anchors) : inAnyPlace(map, char, definition.placeIds);
  if (atTarget) {
    return {
      layer: 'plan',
      action: 'react',
      wantId: picked.id,
      ...extra,
      intent: { type: 'start_activity', characterId: char.id, activityId: picked.activityId },
      bubble: `开始${definition.name}:${picked.why}`,
    };
  }
  const spot = activitySpot(map, picked.activityId, definition.placeIds, anchors);
  if (spot === null) {
    return { layer: 'plan', action: 'continue', abandonedWantIds: [...abandoned, picked.id], wantId: picked.id };
  }
  const placePart = spot.placeName === '' ? definition.name : `${spot.placeName}${definition.name}`;
  return {
    layer: 'plan',
    action: 'react',
    wantId: picked.id,
    ...extra,
    intent: { type: 'move_to', characterId: char.id, x: spot.x, y: spot.y },
    bubble: `${picked.why},去${placePart}`,
  };
}

/** lab 观测辅助:地点列表(气泡文案/测试用) */
export function placeLabel(places: PlaceDefinition[], ref: string): string | null {
  return places.find((p) => p.id === ref)?.name ?? null;
}
