import { getItem, inventoryVolume } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import {
  clampVital,
  clearCollapseIfRecovered,
  ensureAlive,
  ensureNotCollapsed,
  type WorldCharacter,
} from './character.js';
import { ensureAtOwnHome } from './housing.js';
import type { Simulation } from './simulation.js';

/**
 * 购买商品(M3.6g 背包制):须在商店内;买入入随身背包,
 * 体积超限拒绝;经 eat_item 意图随时进食(任意地点)。
 */
export function buyItem(sim: Simulation, characterId: string, itemId: string): WorldCharacter {
  const item = getItem(itemId);
  if (item === null) {
    throw new Error(`未知商品: ${itemId}`);
  }
  if (item.price === undefined) {
    throw new Error(`「${item.name}」非商店货架物品,不可购买`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  ensureNotCollapsed(character);
  if (!sim.map.contains('shop', character.x, character.y)) {
    throw new Error(`${character.name} 须在商店内购买(先移动到商店)`);
  }
  const used = inventoryVolume(character.backpack);
  if (used + item.volume > BALANCE.BACKPACK_VOLUME_LIMIT) {
    throw new Error(
      `背包已满(${used}/${BALANCE.BACKPACK_VOLUME_LIMIT}),装不下「${item.name}」(体积 ${item.volume});先吃点或回家存冰箱`,
    );
  }
  if (character.coins < item.price) {
    throw new Error(
      `${character.name} 金币不足: 「${item.name}」需 ${item.price},现有 ${Math.floor(character.coins)}`,
    );
  }
  character.coins -= item.price;
  character.backpack[itemId] = (character.backpack[itemId] ?? 0) + 1;
  return character;
}

/** 吃背包食物(M3.6g):任意地点可吃(虚脱倒地可被喂食,体力回升即爬起);
 * 扣背包并结算一次性效果;material 不可食用 */
export function eatItem(sim: Simulation, characterId: string, itemId: string): WorldCharacter {
  const item = getItem(itemId);
  if (item === null) {
    throw new Error(`未知商品: ${itemId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  const effects = item.effects;
  if (effects === undefined) {
    throw new Error(`「${item.name}」不可食用`);
  }
  if ((character.backpack[itemId] ?? 0) <= 0) {
    throw new Error(`${character.name} 背包里没有「${item.name}」(先到商店购买)`);
  }
  character.backpack[itemId] = (character.backpack[itemId] ?? 0) - 1;
  if (character.backpack[itemId]! <= 0) {
    delete character.backpack[itemId];
  }
  character.energy = clampVital(character.energy + effects.energy);
  character.score += effects.score;
  clearCollapseIfRecovered(character);
  return character;
}

/** 背包→家中冰箱:须在自己住所且租约有效,目标容积足够 */
export function storeItem(
  sim: Simulation,
  characterId: string,
  itemId: string,
  count: number,
): WorldCharacter {
  const item = getItem(itemId);
  if (item === null) {
    throw new Error(`未知商品: ${itemId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  ensureNotCollapsed(character);
  ensureAtOwnHome(sim, character, '存入冰箱');
  if ((character.backpack[itemId] ?? 0) < count) {
    throw new Error(`${character.name} 背包里「${item.name}」不足 ${count} 个`);
  }
  const used = inventoryVolume(character.fridge);
  if (used + item.volume * count > BALANCE.FRIDGE_VOLUME_LIMIT) {
    throw new Error(
      `冰箱已满(${used}/${BALANCE.FRIDGE_VOLUME_LIMIT}),放不下 ${count} 个「${item.name}」(余 ${BALANCE.FRIDGE_VOLUME_LIMIT - used} 体积)`,
    );
  }
  character.backpack[itemId] = character.backpack[itemId]! - count;
  if (character.backpack[itemId]! <= 0) {
    delete character.backpack[itemId];
  }
  character.fridge[itemId] = (character.fridge[itemId] ?? 0) + count;
  return character;
}

/** 家中冰箱→背包:须在自己住所且租约有效,背包容积足够 */
export function takeItem(
  sim: Simulation,
  characterId: string,
  itemId: string,
  count: number,
): WorldCharacter {
  const item = getItem(itemId);
  if (item === null) {
    throw new Error(`未知商品: ${itemId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  ensureNotCollapsed(character);
  ensureAtOwnHome(sim, character, '从冰箱取出');
  if ((character.fridge[itemId] ?? 0) < count) {
    throw new Error(`${character.name} 冰箱里「${item.name}」不足 ${count} 个`);
  }
  const used = inventoryVolume(character.backpack);
  if (used + item.volume * count > BALANCE.BACKPACK_VOLUME_LIMIT) {
    throw new Error(
      `背包已满(${used}/${BALANCE.BACKPACK_VOLUME_LIMIT}),装不下 ${count} 个「${item.name}」(余 ${BALANCE.BACKPACK_VOLUME_LIMIT - used} 体积)`,
    );
  }
  character.fridge[itemId] = character.fridge[itemId]! - count;
  if (character.fridge[itemId]! <= 0) {
    delete character.fridge[itemId];
  }
  character.backpack[itemId] = (character.backpack[itemId] ?? 0) + count;
  return character;
}
