/**
 * 地图定义展开与校验(MS-1 自 server world/map.ts 上提):展开障碍矩形与
 * 结构校验为纯函数,服务端 TileMap 与后台编辑器(实时校验/布局体检)共用
 * 同一份实现,防双端判定漂移。错误文案即 server 历史契约(worldgen 重试
 * 与 map.test.ts 断言依赖),不可改动。
 */
import {
  furnitureRectsOf,
  wallRectsOf,
  type BlockedRect,
  type PlaceDefinition,
  type TileMapDefinition,
} from './town-map.js';
import type { ResourceNodeSeed } from './production.js';
import { solidDecorRect } from './worldgen.js';

const inRect = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 资源节点 → 1x1 占格 */
export function resourceRectsOf(resources: ReadonlyArray<ResourceNodeSeed>): BlockedRect[] {
  return resources.map((r) => ({ x: r.x, y: r.y, w: 1, h: 1 }));
}

/** 障碍矩形全集(不含资源节点):边界圈+定制障碍+建筑墙体+家具占地+围栏+solid 装饰 */
export function obstacleRectsOf(definition: TileMapDefinition): BlockedRect[] {
  const solidDecorRects: BlockedRect[] = (definition.decor?.props ?? [])
    .filter((p) => p.solid === true)
    .map((p) => solidDecorRect(p));
  return [
    ...definition.blockedRects,
    { x: 0, y: 0, w: definition.width, h: 1 }, // 上
    { x: 0, y: definition.height - 1, w: definition.width, h: 1 }, // 下
    { x: 0, y: 0, w: 1, h: definition.height }, // 左
    { x: definition.width - 1, y: 0, w: 1, h: definition.height }, // 右
    ...definition.places.flatMap(wallRectsOf),
    ...definition.places.flatMap(furnitureRectsOf),
    ...(definition.fences ?? []),
    ...solidDecorRects,
  ];
}

/** 可行走判定矩形全集(障碍+资源占格):TileMap._blocked 与编辑器渲染/BFS 共用 */
export function blockedRectsOf(definition: TileMapDefinition): BlockedRect[] {
  return [...obstacleRectsOf(definition), ...resourceRectsOf(definition.resources ?? [])];
}

/** 校验问题(编辑器体检面板按 code/placeId 分类定位;server 构造取首条 message 抛出) */
export interface MapIssue {
  code: 'entrance' | 'door' | 'furniture' | 'interior' | 'resource';
  message: string;
  /** 关联场所 id(场所/家具/门/入口类问题携带) */
  placeId?: string;
  /** 关联资源节点序号(resources 数组下标) */
  resourceIndex?: number;
}

/**
 * 定义结构校验(收集全部问题不短路):入口在占地外且可行走;门洞在边缘/
 * 与入口四邻相接/可行走;家具占地在室内(墙内圈)或场所矩形内、activityId
 * 与 use 成对、使用格紧邻家具且可行走;室内自门洞 BFS 连通全部使用格;
 * 资源节点互不重叠且落在既有障碍之外。顺序与 server 历史实现一致。
 */
export function validateMapDefinition(definition: TileMapDefinition): MapIssue[] {
  const issues: MapIssue[] = [];
  const others = obstacleRectsOf(definition);
  const resourceRects = resourceRectsOf(definition.resources ?? []);
  const allBlocked = [...others, ...resourceRects];
  const isWalkable = (x: number, y: number): boolean => {
    if (x < 0 || x >= definition.width || y < 0 || y >= definition.height) return false;
    return !allBlocked.some((rect) => inRect(x, y, rect));
  };

  const validateEntrance = (place: PlaceDefinition): void => {
    const { x, y } = place.entrance;
    if (inRect(x, y, place) || !isWalkable(x, y)) {
      issues.push({
        code: 'entrance',
        placeId: place.id,
        message: `场所 ${place.id} 入口非法: (${x},${y}) 须在占地外且可行走`,
      });
    }
  };

  const validateDoor = (place: PlaceDefinition): void => {
    const door = place.door!;
    const right = place.x + place.w - 1;
    const bottom = place.y + place.h - 1;
    const onPerimeter =
      door.x >= place.x &&
      door.x <= right &&
      door.y >= place.y &&
      door.y <= bottom &&
      (door.x === place.x || door.x === right || door.y === place.y || door.y === bottom);
    if (!onPerimeter) {
      issues.push({
        code: 'door',
        placeId: place.id,
        message: `场所 ${place.id} 门洞非法: (${door.x},${door.y}) 须在占地边缘`,
      });
      return;
    }
    if (manhattan(door, place.entrance) !== 1) {
      issues.push({
        code: 'door',
        placeId: place.id,
        message: `场所 ${place.id} 门洞非法: (${door.x},${door.y}) 须与入口 (${place.entrance.x},${place.entrance.y}) 四邻相接`,
      });
    }
    if (!isWalkable(door.x, door.y)) {
      issues.push({
        code: 'door',
        placeId: place.id,
        message: `场所 ${place.id} 门洞非法: (${door.x},${door.y}) 被障碍覆盖`,
      });
    }
  };

  const validateFurniture = (place: PlaceDefinition, indoor: boolean): void => {
    const interior = (v: number, base: number, size: number): boolean =>
      v > base && v < base + size - 1;
    for (const f of place.furniture ?? []) {
      if (f.w < 1 || f.h < 1) {
        issues.push({
          code: 'furniture',
          placeId: place.id,
          message: `场所 ${place.id} 家具 ${f.kind} 占地非法: w/h 须 ≥1`,
        });
        continue;
      }
      const inside = indoor
        ? interior(f.x, place.x, place.w) &&
          interior(f.x + f.w - 1, place.x, place.w) &&
          interior(f.y, place.y, place.h) &&
          interior(f.y + f.h - 1, place.y, place.h)
        : f.x >= place.x &&
          f.y >= place.y &&
          f.x + f.w <= place.x + place.w &&
          f.y + f.h <= place.y + place.h;
      if (!inside) {
        issues.push({
          code: 'furniture',
          placeId: place.id,
          message: `场所 ${place.id} 家具 ${f.kind} 位置非法: 占地须在${indoor ? '室内(墙内圈)' : '场所矩形内'}`,
        });
      }
      if ((f.activityId === undefined) !== (f.use === undefined)) {
        issues.push({
          code: 'furniture',
          placeId: place.id,
          message: `场所 ${place.id} 家具 ${f.kind} 非法: activityId 与 use 须成对出现`,
        });
        continue;
      }
      if (f.use === undefined) continue;
      // 使用格到家具占地的最小曼哈顿距离=1(四邻相接)
      const gapX = Math.max(f.x - f.use.x, 0, f.use.x - (f.x + f.w - 1));
      const gapY = Math.max(f.y - f.use.y, 0, f.use.y - (f.y + f.h - 1));
      if (gapX + gapY !== 1) {
        issues.push({
          code: 'furniture',
          placeId: place.id,
          message: `场所 ${place.id} 家具 ${f.kind} 使用格非法: (${f.use.x},${f.use.y}) 须紧邻家具占地`,
        });
      }
      if (!isWalkable(f.use.x, f.use.y)) {
        issues.push({
          code: 'furniture',
          placeId: place.id,
          message: `场所 ${place.id} 家具 ${f.kind} 使用格非法: (${f.use.x},${f.use.y}) 被阻塞`,
        });
      }
    }
  };

  /** 门洞 BFS 可达性:门洞须连通全部锚点使用格(防家具布置把室内割裂) */
  const validateInteriorReachability = (place: PlaceDefinition): void => {
    const door = place.door!;
    const uses = (place.furniture ?? [])
      .filter((f) => f.use !== undefined)
      .map((f) => f.use!);
    if (uses.length === 0) return;
    const seen = new Set<string>([`${door.x},${door.y}`]);
    const queue: Array<{ x: number; y: number }> = [door];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !isWalkable(nx, ny)) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    for (const use of uses) {
      if (!seen.has(`${use.x},${use.y}`)) {
        issues.push({
          code: 'interior',
          placeId: place.id,
          message: `场所 ${place.id} 室内不连通: 门洞 (${door.x},${door.y}) 无法到达使用格 (${use.x},${use.y})`,
        });
      }
    }
  };

  for (const place of definition.places) {
    validateEntrance(place);
    if (place.door !== undefined) {
      validateDoor(place);
      validateFurniture(place, true);
      validateInteriorReachability(place);
    } else if ((place.furniture ?? []).length > 0) {
      // 无墙场所(公园)家具: 户外长椅等锚点,仅校验矩形内+使用格紧邻可行走(无室内圈/门/连通约束)
      validateFurniture(place, false);
    }
  }

  const seen = new Set<string>();
  (definition.resources ?? []).forEach((rect, index) => {
    const key = `${rect.x},${rect.y}`;
    if (seen.has(key)) {
      issues.push({
        code: 'resource',
        resourceIndex: index,
        message: `资源节点重叠: (${rect.x},${rect.y}) 重复种种子`,
      });
    }
    seen.add(key);
    if (others.some((other) => inRect(rect.x, rect.y, other))) {
      issues.push({
        code: 'resource',
        resourceIndex: index,
        message: `资源节点落点非法: (${rect.x},${rect.y}) 被既有障碍覆盖`,
      });
    }
  });

  return issues;
}
