import type { Point } from './pathfinding.js';

/** 世界运行时角色(权威状态在服务端内存;持久化衔接后置) */
export interface WorldCharacter {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 待走路径(相邻格序列,不含当前格);空=原地 */
  path: Point[];
}

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
