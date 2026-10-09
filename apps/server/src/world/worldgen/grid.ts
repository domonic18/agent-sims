import type { BlockedRect } from '@sims/shared';

/** 占用网格坐标键与矩形占格(worldgen 各阶段共用) */
export const cellKey = (x: number, y: number): string => `${x},${y}`;

export function mark0(occupied: Set<string>, rect: BlockedRect): void {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) occupied.add(cellKey(x, y));
  }
}
