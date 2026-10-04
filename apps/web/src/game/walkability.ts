import { TOWN_MAP, furnitureRectsOf, wallRectsOf } from '@sims/shared';

/**
 * 可行走判定(web 侧单源):规则与 server TileMap 一致——边界内且不在
 * blockedRects/边界墙/建筑墙体展开(wallRectsOf)/家具占地(furnitureRectsOf)内。
 * WASD 前瞻续路据此预判;客户端预判只做体验优化,最终裁决在服务端。
 */

const blockedTiles = (() => {
  const tiles = new Set<string>();
  const add = (rect: { x: number; y: number; w: number; h: number }): void => {
    for (let ry = rect.y; ry < rect.y + rect.h; ry += 1) {
      for (let rx = rect.x; rx < rect.x + rect.w; rx += 1) tiles.add(`${rx},${ry}`);
    }
  };
  for (const rect of TOWN_MAP.blockedRects) add(rect);
  add({ x: 0, y: 0, w: TOWN_MAP.width, h: 1 });
  add({ x: 0, y: TOWN_MAP.height - 1, w: TOWN_MAP.width, h: 1 });
  add({ x: 0, y: 0, w: 1, h: TOWN_MAP.height });
  add({ x: TOWN_MAP.width - 1, y: 0, w: 1, h: TOWN_MAP.height });
  for (const place of TOWN_MAP.places) {
    for (const rect of [...wallRectsOf(place), ...furnitureRectsOf(place)]) add(rect);
  }
  return tiles;
})();

export function isWalkable(x: number, y: number): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    x < TOWN_MAP.width &&
    y < TOWN_MAP.height &&
    !blockedTiles.has(`${x},${y}`)
  );
}
