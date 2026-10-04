import { getActivityDefinition, type Intent } from '@sims/shared';
import type { Simulation } from '../world/simulation.js';

export interface IntentResult {
  ok: boolean;
  message: string;
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
    case 'start_activity': {
      const character = sim.requestStartActivity(intent.characterId, intent.activityId);
      const name = getActivityDefinition(intent.activityId)?.name ?? intent.activityId;
      return { ok: true, message: `${character.name} 开始「${name}」` };
    }
    case 'stop_activity': {
      const character = sim.requestStopActivity(intent.characterId);
      return { ok: true, message: `${character.name} 停止活动` };
    }
  }
}
