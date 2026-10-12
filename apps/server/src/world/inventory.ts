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
 * 购买商品(M3.6g 背包制;食物经济 2026-10-07 售罄即止):须在商店内;
 * 货架余量扣减(售罄拒绝);买入入随身背包,体积超限拒绝;
 * 经 eat_item 意图随时进食(任意地点)。
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
  const stock = sim.shopStock.get(itemId) ?? 0;
  if (stock <= 0) {
    throw new Error(
      `商店「${item.name}」已售罄(等每日小额补货,或采集/制作/等他人卖入)`,
    );
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
  sim.shopStock.set(itemId, stock - 1);
  character.backpack[itemId] = (character.backpack[itemId] ?? 0) + 1;
  return character;
}

/** 出售给商店(E1 生产经济):须在商店内;只收带定价物品(SELL_RATE×售价,
 * 零件取整);背包扣减、金币入袋、货架余量+1——采集/制作产出入店可被他人
 * 购买,镇内经济循环闭合。货架不封顶(卖多少收多少)。 */
export function sellItem(
  sim: Simulation,
  characterId: string,
  itemId: string,
  count: number,
): WorldCharacter {
  const item = getItem(itemId);
  if (item === null) {
    throw new Error(`未知商品: ${itemId}`);
  }
  if (item.price === undefined) {
    throw new Error(`「${item.name}」无定价,商店不收购`);
  }
  if (count < 1) {
    throw new Error('出售数量须为正整数');
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  ensureNotCollapsed(character);
  if (!sim.map.contains('shop', character.x, character.y)) {
    throw new Error(`${character.name} 须在商店内出售(先移动到商店)`);
  }
  if ((character.backpack[itemId] ?? 0) < count) {
    throw new Error(`${character.name} 背包里「${item.name}」不足 ${count} 个`);
  }
  const earn = Math.floor(item.price * count * BALANCE.SELL_RATE);
  character.backpack[itemId] = character.backpack[itemId]! - count;
  if (character.backpack[itemId]! <= 0) {
    delete character.backpack[itemId];
  }
  character.coins += earn;
  sim.shopStock.set(itemId, (sim.shopStock.get(itemId) ?? 0) + count);
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
  target: 'fridge' | 'storage' = 'fridge',
): WorldCharacter {
  const item = getItem(itemId);
  if (item === null) {
    throw new Error(`未知商品: ${itemId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  ensureNotCollapsed(character);
  if ((character.backpack[itemId] ?? 0) < count) {
    throw new Error(`${character.name} 背包里「${item.name}」不足 ${count} 个`);
  }
  if (target === 'storage') {
    ensureAtStorage(sim, character, '存入单仓');
    const used = inventoryVolume(sim.storage);
    if (used + item.volume * count > BALANCE.STORAGE_VOLUME_LIMIT) {
      throw new Error(
        `单仓已满(${used}/${BALANCE.STORAGE_VOLUME_LIMIT}),放不下 ${count} 个「${item.name}」(余 ${BALANCE.STORAGE_VOLUME_LIMIT - used} 体积)`,
      );
    }
    character.backpack[itemId] = character.backpack[itemId]! - count;
    if (character.backpack[itemId]! <= 0) {
      delete character.backpack[itemId];
    }
    sim.storage[itemId] = (sim.storage[itemId] ?? 0) + count;
    return character;
  }
  ensureAtOwnHome(sim, character, '存入冰箱');
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

/** 库→背包:家中冰箱→背包 须在自己住所且租约有效;镇核心单仓→背包 须站单仓旁 */
export function takeItem(
  sim: Simulation,
  characterId: string,
  itemId: string,
  count: number,
  target: 'fridge' | 'storage' = 'fridge',
): WorldCharacter {
  const item = getItem(itemId);
  if (item === null) {
    throw new Error(`未知商品: ${itemId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  ensureNotCollapsed(character);
  if (target === 'storage') {
    ensureAtStorage(sim, character, '从单仓取出');
    if ((sim.storage[itemId] ?? 0) < count) {
      throw new Error(`单仓里「${item.name}」不足 ${count} 个`);
    }
  } else {
    ensureAtOwnHome(sim, character, '从冰箱取出');
    if ((character.fridge[itemId] ?? 0) < count) {
      throw new Error(`${character.name} 冰箱里「${item.name}」不足 ${count} 个`);
    }
  }
  const used = inventoryVolume(character.backpack);
  if (used + item.volume * count > BALANCE.BACKPACK_VOLUME_LIMIT) {
    throw new Error(
      `背包已满(${used}/${BALANCE.BACKPACK_VOLUME_LIMIT}),装不下 ${count} 个「${item.name}」(余 ${BALANCE.BACKPACK_VOLUME_LIMIT - used} 体积)`,
    );
  }
  if (target === 'storage') {
    sim.storage[itemId] = sim.storage[itemId]! - count;
    if (sim.storage[itemId]! <= 0) {
      delete sim.storage[itemId];
    }
  } else {
    character.fridge[itemId] = character.fridge[itemId]! - count;
    if (character.fridge[itemId]! <= 0) {
      delete character.fridge[itemId];
    }
  }
  character.backpack[itemId] = (character.backpack[itemId] ?? 0) + count;
  return character;
}

/** 单仓位置门槛(S2批2):须站单仓实体格或四邻(曼哈顿≤1);无镇核心即禁用 */
function ensureAtStorage(sim: Simulation, character: WorldCharacter, action: string): void {
  const spot = sim.storageSpot;
  if (spot === null) {
    throw new Error('本世界无镇核心单仓');
  }
  const distance = Math.abs(character.x - spot.x) + Math.abs(character.y - spot.y);
  if (distance > 1) {
    throw new Error(`${character.name} 须站单仓旁才能${action}(单仓在 (${spot.x},${spot.y}))`);
  }
}
