import {
  getActivityDefinition,
  getPropertyDefinition,
  getShopItem,
  intentSchema,
  type Intent,
} from '@sims/shared';
import type { Simulation } from '../world/simulation.js';

export interface IntentResult {
  ok: boolean;
  message: string;
}

/**
 * 意图统一入口(socket 网关与 /debug/intent 共用):协议校验+执行+错误归一,
 * 调用方拿 IntentResult 自行决定 ack 或 HTTP 状态。
 */
export function runIntent(sim: Simulation, payload: unknown): IntentResult {
  const parsed = intentSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue ? `意图不合法: ${issue.message}` : '意图不合法' };
  }
  try {
    return executeIntent(sim, parsed.data);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '意图执行失败' };
  }
}

/**
 * 意图指令执行入口(arch §5):Zod 校验已在协议层完成,此处执行并
 * 归一错误信息。世界状态只能经本层变更(业务代码禁止绕过)。
 */
export function executeIntent(sim: Simulation, intent: Intent): IntentResult {
  switch (intent.type) {
    case 'move_to': {
      const character = sim.requestMoveTo(intent.characterId, intent.x, intent.y);
      return {
        ok: true,
        message: `${character.name} 前往 (${intent.x},${intent.y}),路径 ${character.path.length} 格`,
      };
    }
    case 'stop_move': {
      const character = sim.requestStopMove(intent.characterId);
      return { ok: true, message: `${character.name} 停止移动` };
    }
    case 'start_activity': {
      const character = sim.requestStartActivity(intent.characterId, intent.activityId);
      const name = getActivityDefinition(intent.activityId)?.name ?? intent.activityId;
      return { ok: true, message: `${character.name} 开始「${name}」` };
    }
    case 'stop_activity': {
      const character = sim.requestStopActivity(intent.characterId);
      return { ok: true, message: `${character.name} 停止活动` };
    }
    case 'buy_item': {
      const character = sim.requestBuyItem(intent.characterId, intent.itemId);
      const name = getShopItem(intent.itemId)?.name ?? intent.itemId;
      const stocked = character.backpack[intent.itemId] ?? 0;
      return { ok: true, message: `${character.name} 购入「${name}」放入背包(现有 ${stocked} 份)` };
    }
    case 'eat_item': {
      const character = sim.requestEatItem(intent.characterId, intent.itemId);
      const name = getShopItem(intent.itemId)?.name ?? intent.itemId;
      return { ok: true, message: `${character.name} 吃掉「${name}」(背包)` };
    }
    case 'store_item': {
      const character = sim.requestStoreItem(intent.characterId, intent.itemId, intent.count);
      const name = getShopItem(intent.itemId)?.name ?? intent.itemId;
      const stored = character.fridge[intent.itemId] ?? 0;
      return { ok: true, message: `${character.name} 存入冰箱「${name}」×${intent.count}(冰箱现有 ${stored} 份)` };
    }
    case 'take_item': {
      const character = sim.requestTakeItem(intent.characterId, intent.itemId, intent.count);
      const name = getShopItem(intent.itemId)?.name ?? intent.itemId;
      const carried = character.backpack[intent.itemId] ?? 0;
      return { ok: true, message: `${character.name} 从冰箱取出「${name}」×${intent.count}(背包现有 ${carried} 份)` };
    }
    case 'rent_property': {
      const character = sim.requestRentProperty(intent.characterId, intent.propertyId);
      const name = getPropertyDefinition(intent.propertyId)?.name ?? intent.propertyId;
      const through = character.housing?.paidThroughDay ?? 0;
      return { ok: true, message: `${character.name} 续租「${name}」,租约付至第 ${through} 日` };
    }
    case 'buy_property': {
      const character = sim.requestBuyProperty(intent.characterId, intent.propertyId);
      const name = getPropertyDefinition(intent.propertyId)?.name ?? intent.propertyId;
      return { ok: true, message: `${character.name} 买下「${name}」,从此免租金` };
    }
  }
}
