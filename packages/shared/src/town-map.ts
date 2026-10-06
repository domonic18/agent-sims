/**
 * 城镇地图定义与布局。协议面一部分——服务端模拟与客户端渲染共用同一份
 * 定义,避免双端漂移。家具/休息档位见 furniture.ts。
 */
import type { AnyFurnitureKind, FurnitureDefinition } from './furniture.js';
import type { DecorDefinition } from './worldgen.js';

/** 场所定义:占地矩形 + 入口格(入口必须在占地外且可行走) */
export interface PlaceDefinition {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  entrance: { x: number; y: number };
  /** 门洞格(M3.6e 内景化,有墙建筑必填):占地边缘上的可行走格,须与入口四邻相接;公园等无墙场所省略 */
  door?: { x: number; y: number };
  /** 室内家具(有内景场所列出;公园/测试地图省略) */
  furniture?: FurnitureDefinition[];
  /** 内景地板/墙体 tile slug(生成地图携带;缺省由渲染层静态映射兜底) */
  floorTile?: string;
  wallTile?: string;
}

export interface BlockedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 围栏段(M-G.5):整段一条矩形(横栏 h=1/竖栏 w=1),阻塞;修理工破损目标注册表 */
export type FenceRect = BlockedRect;

/** 地图定义:网格尺寸 + 障碍占地(默认全图可行走;建筑墙体由 door 场所展开) + 铺装 + 场所 */
export interface TileMapDefinition {
  width: number;
  height: number;
  blockedRects: BlockedRect[];
  /** 铺装矩形(主街/广场/门前小路):仅视觉,可行走,客户端渲染用 */
  paths: BlockedRect[];
  places: PlaceDefinition[];
  /** 围栏段清单(M-G.5 数据化):公园北缘等;缺省=无围栏 */
  fences?: FenceRect[];
  /** 户外装饰坐标(生成地图数据化;内置地图缺省) */
  decor?: DecorDefinition;
}

/**
 * 有门洞场所的墙体展开:占地边缘一圈细矩形,门洞格留豁口(寻路即自然穿门)。
 * 服务端 TileMap 与客户端 WASD 前瞻共用同一展开,防双端可行走判定漂移(M3.6g)。
 */
export function wallRectsOf(place: PlaceDefinition): BlockedRect[] {
  const door = place.door;
  if (door === undefined) return [];
  const right = place.x + place.w - 1;
  const bottom = place.y + place.h - 1;
  const seg = (x: number, y: number, w: number, h: number): BlockedRect[] =>
    w > 0 && h > 0 ? [{ x, y, w, h }] : [];
  const rowSegs = (row: number): BlockedRect[] => {
    if (door.y === row) {
      return [
        ...seg(place.x, row, door.x - place.x, 1),
        ...seg(door.x + 1, row, right - door.x, 1),
      ];
    }
    return seg(place.x, row, place.w, 1);
  };
  return [
    ...rowSegs(place.y),
    ...rowSegs(bottom),
    ...seg(place.x, place.y + 1, 1, place.h - 2),
    ...seg(right, place.y + 1, 1, place.h - 2),
  ];
}

/** 家具占地矩形(锚点/装饰统一按格阻塞) */
export function furnitureRectsOf(place: PlaceDefinition): BlockedRect[] {
  return (place.furniture ?? []).map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }));
}

/** 点位是否紧邻家具占地(四邻相接,最小曼哈顿距离=1;对角不算) */
export function isBesideFootprint(f: FurnitureDefinition, x: number, y: number): boolean {
  const gapX = Math.max(f.x - x, 0, x - (f.x + f.w - 1));
  const gapY = Math.max(f.y - y, 0, y - (f.y + f.h - 1));
  return gapX + gapY === 1;
}

/**
 * 点位的活动锚点命中(按给定地图直查,客户端 go-and-do 判定用;内置/生成地图通用):
 * 站在声明使用格,或紧邻锚点家具占地(四邻)均算命中(M3.6i 放宽——
 * "站在跑步机旁"即可开始,不再要求精确踩中声明格);未命中返回 null。
 */
export function findActivityAnchorAt(
  map: TileMapDefinition,
  activityId: string,
  x: number,
  y: number,
): { placeId: string; kind: AnyFurnitureKind } | null {
  for (const place of map.places) {
    for (const f of place.furniture ?? []) {
      if (f.activityId !== activityId || f.use === undefined) continue;
      if ((x === f.use.x && y === f.use.y) || isBesideFootprint(f, x, y)) {
        return { placeId: place.id, kind: f.kind };
      }
    }
  }
  return null;
}

/**
 * placeId 语义匹配: 精确 id 或 kind 前缀(park → park-a)。
 * 活动 placeIds/店内购等声明在内置图语境(裸 kind),生成地图场所为 kind-N 命名,
 * 按前缀回落匹配,内置与生成地图共用同一判定语义。
 */
export function placeIdMatches(placeId: string, id: string): boolean {
  return id === placeId || id.startsWith(`${placeId}-`);
}

/**
 * 城镇布局(M3.5b 定版;M3.6e 内景化;M3.6f 扩容 64x48 四公寓+喷泉):
 * 中央广场(含喷泉)+ 十字主街;居住簇(四公寓 A/B/C/D+公园,环绕西侧与南部)、
 * 文教簇(图书馆/办公楼,东北)、商业簇(商店/餐厅/健身房,沿广场南缘一线排开);公园含水系收边。
 * 有墙建筑为内景:door 门洞 + furniture 家具锚点,角色经门入内在家具上执行活动;
 * 公园无墙,长椅为户外 rest 锚点(doorless 家具)。
 * 布局为固定游戏内容,代码静态定义(非 DB 数据);
 * 调整布局后跑 `GET /debug/map` 或 map 单测核对口(TileMap 构造即校验门洞/家具/连通)。
 */
export const TOWN_MAP: TileMapDefinition = {
  width: 64,
  height: 48,
  blockedRects: [
    // 装饰障碍(建筑墙体由场所 door 展开为细墙矩形,不再整栋封死)
    { x: 4, y: 30, w: 4, h: 4 }, // 池塘(公园西缘水系)
    { x: 30, y: 18, w: 3, h: 3 }, // 广场喷泉(石砌水池,不可行走)
  ],
  paths: [
    { x: 2, y: 19, w: 60, h: 2 }, // 东西主街
    { x: 27, y: 2, w: 2, h: 42 }, // 南北主街
    { x: 22, y: 15, w: 12, h: 11 }, // 中央广场
    // 门前小路:入口 → 主街/广场
    { x: 8, y: 12, w: 1, h: 7 }, // 公寓 A
    { x: 20, y: 12, w: 1, h: 7 }, // 公寓 B
    { x: 58, y: 12, w: 1, h: 7 }, // 公寓 C
    { x: 36, y: 12, w: 1, h: 7 }, // 图书馆
    { x: 49, y: 12, w: 1, h: 7 }, // 办公楼
    { x: 9, y: 21, w: 1, h: 5 }, // 公园
    { x: 47, y: 21, w: 1, h: 5 }, // 健身房
    { x: 28, y: 44, w: 8, h: 1 }, // 公寓 D(门前横路 → 南北主街)
  ],
  places: [
    {
      id: 'home-a',
      name: '公寓 A',
      x: 3,
      y: 4,
      w: 12,
      h: 8,
      entrance: { x: 8, y: 12 },
      door: { x: 8, y: 11 },
      furniture: [
        { kind: 'bed', x: 4, y: 5, w: 2, h: 3, activityId: 'rest', use: { x: 5, y: 8 } },
        { kind: 'bookshelf', x: 7, y: 5, w: 2, h: 1 },
        { kind: 'desk', x: 11, y: 5, w: 2, h: 1, activityId: 'study', use: { x: 11, y: 6 } },
        { kind: 'table', x: 8, y: 7, w: 2, h: 1 },
        { kind: 'fridge', x: 7, y: 8, w: 1, h: 1 },
        { kind: 'sofa', x: 4, y: 9, w: 3, h: 1, activityId: 'rest', use: { x: 5, y: 10 } },
        { kind: 'wardrobe', x: 10, y: 9, w: 1, h: 2 },
        { kind: 'bed', x: 12, y: 8, w: 2, h: 3, activityId: 'rest', use: { x: 11, y: 8 } },
      ],
    },
    {
      id: 'home-b',
      name: '公寓 B',
      x: 16,
      y: 4,
      w: 9,
      h: 8,
      entrance: { x: 20, y: 12 },
      door: { x: 20, y: 11 },
      furniture: [
        { kind: 'bed', x: 17, y: 5, w: 2, h: 3, activityId: 'rest', use: { x: 17, y: 8 } },
        { kind: 'fridge', x: 19, y: 5, w: 1, h: 1 },
        { kind: 'bed', x: 21, y: 5, w: 2, h: 3, activityId: 'rest', use: { x: 21, y: 8 } },
        { kind: 'tv', x: 17, y: 9, w: 2, h: 1 },
        { kind: 'plant', x: 23, y: 9, w: 1, h: 1 },
      ],
    },
    {
      id: 'home-c',
      name: '公寓 C',
      x: 55,
      y: 4,
      w: 8,
      h: 7,
      entrance: { x: 58, y: 11 },
      door: { x: 58, y: 10 },
      furniture: [
        { kind: 'bed', x: 56, y: 5, w: 2, h: 3, activityId: 'rest', use: { x: 56, y: 8 } },
        { kind: 'fridge', x: 60, y: 5, w: 1, h: 1 },
        { kind: 'wardrobe', x: 56, y: 9, w: 2, h: 1 },
        { kind: 'table', x: 59, y: 9, w: 2, h: 1 },
      ],
    },
    {
      id: 'library',
      name: '图书馆',
      x: 31,
      y: 4,
      w: 11,
      h: 8,
      entrance: { x: 36, y: 12 },
      door: { x: 36, y: 11 },
      furniture: [
        { kind: 'bookshelf', x: 32, y: 5, w: 4, h: 1 },
        { kind: 'bookshelf', x: 38, y: 5, w: 3, h: 1 },
        { kind: 'sofa', x: 32, y: 7, w: 2, h: 1, activityId: 'rest', use: { x: 32, y: 8 } },
        { kind: 'desk', x: 33, y: 8, w: 2, h: 1, activityId: 'study', use: { x: 33, y: 9 } },
        { kind: 'desk', x: 35, y: 8, w: 2, h: 1, activityId: 'librarian', use: { x: 35, y: 9 } },
        { kind: 'desk', x: 37, y: 8, w: 2, h: 1, activityId: 'study', use: { x: 37, y: 9 } },
        { kind: 'plant', x: 32, y: 10, w: 1, h: 1 },
      ],
    },
    {
      id: 'office',
      name: '办公楼',
      x: 44,
      y: 4,
      w: 10,
      h: 8,
      entrance: { x: 49, y: 12 },
      door: { x: 49, y: 11 },
      furniture: [
        { kind: 'workstation', x: 45, y: 5, w: 2, h: 1, activityId: 'work', use: { x: 45, y: 6 } },
        { kind: 'workstation', x: 48, y: 5, w: 2, h: 1, activityId: 'work', use: { x: 48, y: 6 } },
        { kind: 'workstation', x: 51, y: 5, w: 2, h: 1, activityId: 'work', use: { x: 51, y: 6 } },
        { kind: 'table', x: 47, y: 8, w: 3, h: 1 },
        { kind: 'counter', x: 45, y: 10, w: 2, h: 1 },
        { kind: 'fridge', x: 48, y: 10, w: 1, h: 1 },
        { kind: 'plant', x: 52, y: 10, w: 1, h: 1 },
      ],
    },
    {
      id: 'shop',
      name: '商店',
      x: 20,
      y: 26,
      w: 7,
      h: 8,
      entrance: { x: 23, y: 25 },
      door: { x: 23, y: 26 },
      furniture: [
        { kind: 'counter', x: 21, y: 27, w: 2, h: 1, activityId: 'vendor', use: { x: 21, y: 28 } },
        { kind: 'fridge', x: 24, y: 27, w: 1, h: 1 },
        { kind: 'shelf', x: 21, y: 29, w: 1, h: 3 },
        { kind: 'shelf', x: 25, y: 29, w: 1, h: 3 },
        { kind: 'plant', x: 21, y: 32, w: 1, h: 1 },
      ],
    },
    {
      id: 'restaurant',
      name: '餐厅',
      x: 30,
      y: 26,
      w: 9,
      h: 8,
      entrance: { x: 33, y: 25 },
      door: { x: 33, y: 26 },
      furniture: [
        { kind: 'counter', x: 31, y: 27, w: 2, h: 1, activityId: 'waiter', use: { x: 31, y: 28 } },
        { kind: 'tv', x: 35, y: 27, w: 2, h: 1 },
        { kind: 'table', x: 32, y: 30, w: 2, h: 1, activityId: 'meal', use: { x: 32, y: 31 } },
        { kind: 'table', x: 35, y: 30, w: 2, h: 1, activityId: 'meal', use: { x: 36, y: 31 } },
        { kind: 'plant', x: 37, y: 32, w: 1, h: 1 },
      ],
    },
    {
      id: 'gym',
      name: '健身房',
      x: 42,
      y: 26,
      w: 11,
      h: 8,
      entrance: { x: 47, y: 25 },
      door: { x: 47, y: 26 },
      furniture: [
        { kind: 'plant', x: 43, y: 27, w: 1, h: 1 },
        { kind: 'treadmill', x: 44, y: 27, w: 1, h: 2, activityId: 'workout', use: { x: 45, y: 27 } },
        { kind: 'treadmill', x: 48, y: 27, w: 1, h: 2, activityId: 'workout', use: { x: 47, y: 27 } },
        { kind: 'sofa', x: 50, y: 29, w: 2, h: 1, activityId: 'rest', use: { x: 50, y: 30 } },
        { kind: 'tv', x: 45, y: 31, w: 2, h: 1 },
        { kind: 'shelf', x: 43, y: 31, w: 2, h: 1 },
        { kind: 'shelf', x: 50, y: 31, w: 2, h: 1 },
      ],
    },
    {
      id: 'home-d',
      name: '公寓 D',
      x: 32,
      y: 36,
      w: 9,
      h: 8,
      entrance: { x: 36, y: 44 },
      door: { x: 36, y: 43 },
      furniture: [
        { kind: 'bed', x: 33, y: 37, w: 2, h: 3, activityId: 'rest', use: { x: 33, y: 40 } },
        { kind: 'fridge', x: 35, y: 37, w: 1, h: 1 },
        { kind: 'bed', x: 37, y: 37, w: 2, h: 3, activityId: 'rest', use: { x: 37, y: 40 } },
        { kind: 'tv', x: 33, y: 41, w: 2, h: 1 },
        { kind: 'bookshelf', x: 38, y: 40, w: 1, h: 2 },
      ],
    },
    // 公园=可行走场所(休闲活动区),无墙;长椅为户外 rest 锚点(doorless 家具)
    {
      id: 'park',
      name: '公园',
      x: 3,
      y: 26,
      w: 15,
      h: 10,
      entrance: { x: 9, y: 25 },
      furniture: [
        { kind: 'bench', x: 8, y: 31, w: 1, h: 1, activityId: 'rest', use: { x: 9, y: 31 } },
        { kind: 'bench', x: 8, y: 32, w: 1, h: 1, activityId: 'rest', use: { x: 9, y: 32 } },
      ],
    },
  ],
  // 公园北缘栅栏(M-G.5 数据化,原为客户端硬编码装饰):入口列 x=9 留豁口
  fences: [
    { x: 3, y: 26, w: 6, h: 1 },
    { x: 10, y: 26, w: 5, h: 1 },
  ],
};
