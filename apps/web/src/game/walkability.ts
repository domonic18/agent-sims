import { furnitureRectsOf, wallRectsOf, type TileMapDefinition } from '@sims/shared';

/**
 * 可行走判定(web 侧单源):规则与 server TileMap 一致——边界内且不在
 * blockedRects/边界墙/围栏段(fences)/建筑墙体展开(wallRectsOf)/家具占地(furnitureRectsOf)内。
 * WASD 前瞻续路据此预判;客户端预判只做体验优化,最终裁决在服务端。
 */
export function createIsWalkable(map: TileMapDefinition): (x: number, y: number) => boolean {
  const tiles = new Set<string>();
  const add = (rect: { x: number; y: number; w: number; h: number }): void => {
    for (let ry = rect.y; ry < rect.y + rect.h; ry += 1) {
      for (let rx = rect.x; rx < rect.x + rect.w; rx += 1) tiles.add(`${rx},${ry}`);
    }
  };
  for (const rect of map.blockedRects) add(rect);
  for (const rect of map.fences ?? []) add(rect);
  add({ x: 0, y: 0, w: map.width, h: 1 });
  add({ x: 0, y: map.height - 1, w: map.width, h: 1 });
  add({ x: 0, y: 0, w: 1, h: map.height });
  add({ x: map.width - 1, y: 0, w: 1, h: map.height });
  for (const place of map.places) {
    for (const rect of [...wallRectsOf(place), ...furnitureRectsOf(place)]) add(rect);
  }
  return (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < map.width && y < map.height && !tiles.has(`${x},${y}`);
}
