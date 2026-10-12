/**
 * 画布命中检测(纯函数,供 EditorCanvas 与单测):点状(资源/装饰)→
 * 小矩形(围栏/铺装/障碍)→ 屋内家具 → 场所占地。家具优先于所属场所,
 * 实现床桌等物品级点选;同格多层时后画的在上(家具倒序扫)。
 */
import type { TileMapDefinition } from '@sims/shared';
import type { DecorPointGroup, Selection } from './editorStore';

export function hitTest(doc: TileMapDefinition, tx: number, ty: number): Selection | null {
  const inR = (r: { x: number; y: number; w: number; h: number }): boolean =>
    tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
  const resIndex = (doc.resources ?? []).findIndex((r) => r.x === tx && r.y === ty);
  if (resIndex >= 0) return { kind: 'resource', index: resIndex };
  const decorGroups: DecorPointGroup[] = ['trees', 'lamps', 'flowers', 'bushes'];
  if (doc.decor !== undefined) {
    for (const group of decorGroups) {
      const pts = doc.decor[group];
      if (pts === undefined) continue;
      const idx = pts.findIndex((p) => p[0] === tx && p[1] === ty);
      if (idx >= 0) return { kind: 'decor', group, index: idx };
    }
  }
  const fenceIndex = (doc.fences ?? []).findIndex((r) => inR(r));
  if (fenceIndex >= 0) return { kind: 'fence', index: fenceIndex };
  const pathIndex = doc.paths.findIndex((r) => inR(r));
  if (pathIndex >= 0) return { kind: 'path', index: pathIndex };
  const blockedIndex = doc.blockedRects.findIndex((r) => inR(r));
  if (blockedIndex >= 0) return { kind: 'blocked', index: blockedIndex };
  const place = doc.places.find((p) => inR(p));
  if (place !== undefined) {
    const furniture = place.furniture ?? [];
    for (let i = furniture.length - 1; i >= 0; i -= 1) {
      const f = furniture[i]!;
      if (inR(f)) return { kind: 'furniture', placeId: place.id, index: i };
    }
    return { kind: 'place', id: place.id };
  }
  return null;
}
