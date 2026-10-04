import { BALANCE } from '../config/balance.js';
import type { Point } from './pathfinding.js';

/** 角色进行中活动(elapsed 为已进行游戏分钟) */
export interface CharacterActivity {
  activityId: string;
  elapsed: number;
}

/** 世界运行时角色(权威状态在服务端内存;持久化衔接后置) */
export interface WorldCharacter {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 待走路径(相邻格序列,不含当前格);空=原地 */
  path: Point[];
  /** 数值系统 0~100;金币经活动增减(M3.1) */
  energy: number;
  happiness: number;
  coins: number;
  /** 进行中活动(null=空闲) */
  activity: CharacterActivity | null;
  /** 家具库存(已购未摆放;食物即买即耗不入此列) */
  items: string[];
}

export const clampVital = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * 按速度沿路径推进 n 格(1 tick 调 1 次,tiles=速度 格/游戏分钟)。
 * 返回本步是否恰好到达终点(离散事件触发点)。
 */
export function stepMovement(character: WorldCharacter, tiles: number): boolean {
  let moved = 0;
  while (moved < tiles && character.path.length > 0) {
    const next = character.path[0];
    if (!next) break;
    character.x = next.x;
    character.y = next.y;
    character.path.shift();
    moved += 1;
  }
  return moved > 0 && character.path.length === 0;
}

/** 数值自然衰减(每游戏分钟;上限 100 供活动增益夹取) */
export function applyVitalDecay(character: WorldCharacter, gameMinutes: number): void {
  character.energy = clampVital(character.energy - BALANCE.ENERGY_DECAY_PER_MINUTE * gameMinutes);
  character.happiness = clampVital(
    character.happiness - BALANCE.HAPPINESS_DECAY_PER_MINUTE * gameMinutes,
  );
}
