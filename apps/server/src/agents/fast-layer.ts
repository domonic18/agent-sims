import {
  findPlaceAt,
  findPlaceByRef,
  getItem,
  getPropertyDefinition,
  ITEMS,
  type Intent,
  type PlaceDefinition,
  type TileMapDefinition,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { WorldCharacter } from '../world/character.js';
import type { MemoryLlm } from './memory-writer.js';

/** 快层判定输出(agent-design §4.3):continue=当前行为仍有效零模型;react=产出一个意图交执行 */
export interface Decision {
  layer: 'rule' | 'jev';
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

/** jev 微决策(agent-design §4.3):空闲角色在事件触发时用 systemone choice
 * 题「现在去哪」候选选一,产出去某处的 move_to。调用失败返回 null(回落 continue)。 */
export async function jevDecide(
  llm: MemoryLlm,
  char: WorldCharacter,
  map: TileMapDefinition,
): Promise<Decision | null> {
  if (!char.alive || char.collapsed) return null; // 失能不越权(与 ruleDecide 同门槛)
  const here = findPlaceAt(map, char.x, char.y)?.id ?? null;
  const candidates = [
    { ref: 'shop', label: '商店', desc: '去商店看看,补充食物' },
    { ref: 'park', label: '公园', desc: '去公园走走散心' },
    ...(['home-a', 'home-b', 'home-c', 'home-d'] as const)
      .map((ref) => {
        const property = getPropertyDefinition(ref);
        return { ref, label: property?.name ?? ref, desc: '回家休息' };
      })
      .filter((c) => c.ref !== housingRef(char)),
  ].filter((c) => c.ref !== here);
  if (candidates.length === 0) return null;
  try {
    const result = await llm.systemOne(
      'jev',
      `${char.name}现在空闲,凭直觉选一个此刻最想去的去处`,
      {
        next: {
          type: 'choice',
          instructions: '选出此刻最想去的去处',
          criteria: Object.fromEntries(candidates.map((c) => [c.label, c.desc])),
        },
      },
      { taskType: 'agent.jev_micro', characterId: char.id },
    );
    const answer = result.answers.next;
    const choice = answer?.type === 'choice' ? answer.choice : null;
    const picked = choice !== null ? candidates.find((c) => c.label === choice) : undefined;
    if (picked === undefined) return null;
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

/** lab 观测辅助:地点列表(气泡文案/测试用) */
export function placeLabel(places: PlaceDefinition[], ref: string): string | null {
  return places.find((p) => p.id === ref)?.name ?? null;
}
