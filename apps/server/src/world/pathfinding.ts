import type { TileMap } from './map.js';

export interface Point {
  x: number;
  y: number;
}

const MANHATTAN = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const DIRECTIONS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

interface OpenNode {
  point: Point;
  g: number;
  f: number;
}

/**
 * A* 寻路(4 向,曼哈顿启发):返回不含起点、含终点的路径;
 * 起点=终点返回空路径(原地);不可达返回 null。
 * 网格 ≤ 百级规模,数组扫描 open list 足够(KISS)。
 */
export function findPath(map: TileMap, from: Point, to: Point): Point[] | null {
  if (!map.isWalkable(to.x, to.y) || !map.isWalkable(from.x, from.y)) {
    return null;
  }
  if (from.x === to.x && from.y === to.y) {
    return [];
  }
  const key = (p: Point): string => `${p.x},${p.y}`;
  const open: OpenNode[] = [{ point: from, g: 0, f: MANHATTAN(from, to) }];
  const gScore = new Map<string, number>([[key(from), 0]]);
  const cameFrom = new Map<string, string>();

  while (open.length > 0) {
    // 取 f 最小;并列取先入(确定性)
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (open[i]!.f < open[bestIndex]!.f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0]!;
    const currentKey = key(current.point);
    if (current.point.x === to.x && current.point.y === to.y) {
      return reconstruct(cameFrom, currentKey);
    }
    for (const dir of DIRECTIONS) {
      const next: Point = { x: current.point.x + dir.x, y: current.point.y + dir.y };
      if (!map.isWalkable(next.x, next.y)) continue;
      const nextKey = key(next);
      const tentativeG = current.g + 1;
      if (tentativeG < (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        gScore.set(nextKey, tentativeG);
        cameFrom.set(nextKey, currentKey);
        open.push({ point: next, g: tentativeG, f: tentativeG + MANHATTAN(next, to) });
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<string, string>, endKey: string): Point[] {
  const path: Point[] = [];
  let cursor: string | undefined = endKey;
  while (cursor !== undefined) {
    const [x, y] = cursor.split(',').map(Number);
    if (x === undefined || y === undefined) break;
    path.push({ x, y });
    cursor = cameFrom.get(cursor);
  }
  path.reverse();
  path.shift(); // 去掉起点
  return path;
}
