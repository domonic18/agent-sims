import { getItem } from '@sims/shared';
import { startActivity } from './activity.js';
import type { WorldCharacter } from './character.js';
import type { Simulation } from './simulation.js';

/**
 * 配方制作(M-G.6,design/09 §3):查每世界配方表(禁用拒绝)→验料(不扣)→
 * 站点锚点活动开始(复用锚点/互斥/体力/知识门槛判定)→扣料挂单。完成产出入包
 * 与中断退料分别由 simulation._completeCraft 与 finishActivity 凭开始时快照结算。
 */
export function requestCraft(
  sim: Simulation,
  characterId: string,
  recipeId: string,
): WorldCharacter {
  const recipe = sim.recipe(recipeId);
  if (recipe === null) {
    throw new Error(`未知配方: ${recipeId}`);
  }
  if (recipe.enabled === false) {
    throw new Error(`配方已停用: ${recipe.name}`);
  }
  const character = sim.character(characterId);
  const missing = recipe.inputs.filter(
    (input) => (character.backpack[input.itemId] ?? 0) < input.count,
  );
  if (missing.length > 0) {
    const detail = missing
      .map((input) => `${getItem(input.itemId)?.name ?? input.itemId}×${input.count}`)
      .join('、');
    throw new Error(`${character.name} 材料不足,需 ${detail}`);
  }
  startActivity(sim, characterId, recipe.id, { recipeId: recipe.id });
  for (const input of recipe.inputs) {
    const left = (character.backpack[input.itemId] ?? 0) - input.count;
    if (left > 0) {
      character.backpack[input.itemId] = left;
    } else {
      delete character.backpack[input.itemId];
    }
  }
  return character;
}
