import { getPropertyDefinition, PROPERTY_IDS } from '@sims/shared';
import { ensureAlive, type WorldCharacter } from './character.js';
import type { Simulation } from './simulation.js';

/** rest 锚点在住宅时:须为本人住房且租约有效(owned 或未过期);公园等场所放行 */
export function ensureRestAccess(
  sim: Simulation,
  character: WorldCharacter,
  anchorPlaceId: string,
): void {
  if (!(PROPERTY_IDS as readonly string[]).includes(anchorPlaceId)) {
    return;
  }
  const housing = character.housing;
  const placeName = sim.map.placeById(anchorPlaceId)?.name ?? anchorPlaceId;
  if (housing === null || housing.propertyId !== anchorPlaceId) {
    throw new Error(`${placeName} 的床不是你的床位(须租住或拥有该公寓)`);
  }
  ensureHousingLease(sim, character, '使用床铺');
}

/** 租约有效性:自有产权放行;租赁须 paidThroughDay ≥ 今日 */
export function ensureHousingLease(sim: Simulation, character: WorldCharacter, action: string): void {
  const housing = character.housing;
  if (housing === null || housing.ownership === 'owned') {
    return;
  }
  if (housing.paidThroughDay < sim.clock.day) {
    throw new Error(
      `${character.name} 租约已过期(付至第 ${housing.paidThroughDay} 日,今日第 ${sim.clock.day} 日),无法${action}(先续租或买断)`,
    );
  }
}

/** 存取冰箱位置校验:须位于本人住房场所内且租约有效 */
export function ensureAtOwnHome(sim: Simulation, character: WorldCharacter, action: string): void {
  const housing = character.housing;
  if (housing === null || !sim.map.contains(housing.propertyId, character.x, character.y)) {
    const placeName = housing
      ? (sim.map.placeById(housing.propertyId)?.name ?? housing.propertyId)
      : '住所';
    throw new Error(`${character.name} 须回到${placeName}才能${action}`);
  }
  ensureHousingLease(sim, character, action);
}

/** 续租: 扣一日期租金,租约顺延一天(已过期则从今日起算) */
export function rentProperty(
  sim: Simulation,
  characterId: string,
  propertyId: string,
): WorldCharacter {
  const property = getPropertyDefinition(propertyId);
  if (property === null) {
    throw new Error(`未知房产: ${propertyId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  if (character.housing?.ownership === 'owned') {
    throw new Error(`${character.name} 已拥有 ${property.name},无需续租`);
  }
  if (character.coins < property.rentPrice) {
    throw new Error(
      `${character.name} 金币不足: 租金需 ${property.rentPrice},现有 ${Math.floor(character.coins)}`,
    );
  }
  character.coins -= property.rentPrice;
  character.housing = {
    propertyId: property.id,
    ownership: 'rent',
    paidThroughDay: Math.max(character.housing?.paidThroughDay ?? sim.clock.day, sim.clock.day) + 1,
  };
  return character;
}

/** 买断房产: 一次性扣全款,此后免租金 */
export function buyProperty(
  sim: Simulation,
  characterId: string,
  propertyId: string,
): WorldCharacter {
  const property = getPropertyDefinition(propertyId);
  if (property === null) {
    throw new Error(`未知房产: ${propertyId}`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  if (character.housing?.ownership === 'owned') {
    throw new Error(`${character.name} 已拥有 ${property.name}`);
  }
  if (character.coins < property.buyPrice) {
    throw new Error(
      `${character.name} 金币不足: ${property.name}售价 ${property.buyPrice},现有 ${Math.floor(character.coins)}`,
    );
  }
  character.coins -= property.buyPrice;
  character.housing = {
    propertyId: property.id,
    ownership: 'owned',
    paidThroughDay: character.housing?.paidThroughDay ?? sim.clock.day,
  };
  return character;
}
