/**
 * 世界静态内容:地图定义与城镇布局。协议面一部分——服务端模拟与
 * 客户端渲染共用同一份定义,避免双端漂移。
 */
import type { ActivityId } from './activities.js';

/** 室内家具/设施类型(M3.6e 内景化):世界内置内容,不可购买 */
export const FURNITURE_KINDS = [
  'bed',
  'desk',
  'workstation',
  'treadmill',
  'table',
  'bookshelf',
  'shelf',
  'counter',
  'sofa',
  'plant',
] as const;

export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

export const FURNITURE_LABELS: Record<FurnitureKind, string> = {
  bed: '床',
  desk: '书桌',
  workstation: '办公桌',
  treadmill: '跑步机',
  table: '餐桌',
  bookshelf: '书架',
  shelf: '货架',
  counter: '柜台',
  sofa: '沙发',
  plant: '盆栽',
};

/**
 * 家具定义:占地 x..x+w-1 / y..y+h-1(格,均不可行走)。
 * 锚点家具(activityId+use):角色立于 use 格即可开始绑定活动;
 * 非锚点家具为室内装饰,仅占格。
 */
export interface FurnitureDefinition {
  kind: FurnitureKind;
  x: number;
  y: number;
  /** 占地宽高(格,≥1) */
  w: number;
  h: number;
  /** 绑定活动(锚点家具) */
  activityId?: ActivityId;
  /** 使用格(锚点必填):紧邻家具的可行走室内格 */
  use?: { x: number; y: number };
}

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
}

export interface BlockedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 地图定义:网格尺寸 + 障碍占地(默认全图可行走;建筑墙体由 door 场所展开) + 铺装 + 场所 */
export interface TileMapDefinition {
  width: number;
  height: number;
  blockedRects: BlockedRect[];
  /** 铺装矩形(主街/广场/门前小路):仅视觉,可行走,客户端渲染用 */
  paths: BlockedRect[];
  places: PlaceDefinition[];
}

/**
 * 城镇布局(M3.5b 定版;M3.6e 内景化):56x40 网格,7 场所。
 * 中央广场 + 十字主街;居住簇(公寓/公园,西南)、文教簇(图书馆/办公楼,东北)、
 * 商业簇(商店/餐厅/健身房,沿广场南缘一线排开);公园含水系收边。
 * 六建筑为有墙内景:door 门洞 + furniture 家具锚点,角色经门入内在家具上执行活动。
 * 布局为固定游戏内容,代码静态定义(非 DB 数据);
 * 调整布局后跑 `GET /debug/map` 或 map 单测核对口(TileMap 构造即校验门洞/家具/连通)。
 */
export const TOWN_MAP: TileMapDefinition = {
  width: 56,
  height: 40,
  blockedRects: [
    // 装饰障碍(建筑墙体由场所 door 展开为细墙矩形,不再整栋封死)
    { x: 4, y: 30, w: 4, h: 4 }, // 池塘(公园西缘水系)
  ],
  paths: [
    { x: 2, y: 19, w: 52, h: 2 }, // 东西主街
    { x: 27, y: 2, w: 2, h: 35 }, // 南北主街
    { x: 22, y: 15, w: 12, h: 11 }, // 中央广场
    // 门前小路:入口 → 主街/广场
    { x: 8, y: 12, w: 1, h: 7 }, // 公寓
    { x: 36, y: 12, w: 1, h: 7 }, // 图书馆
    { x: 49, y: 12, w: 1, h: 7 }, // 办公楼
    { x: 9, y: 21, w: 1, h: 5 }, // 公园
    { x: 47, y: 21, w: 1, h: 5 }, // 健身房
  ],
  places: [
    {
      id: 'home',
      name: '公寓',
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
        { kind: 'sofa', x: 4, y: 9, w: 3, h: 1 },
        { kind: 'plant', x: 13, y: 10, w: 1, h: 1 },
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
        { kind: 'desk', x: 33, y: 8, w: 2, h: 1, activityId: 'study', use: { x: 33, y: 9 } },
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
        { kind: 'counter', x: 21, y: 27, w: 2, h: 1 },
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
        { kind: 'counter', x: 31, y: 27, w: 2, h: 1 },
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
        { kind: 'sofa', x: 50, y: 29, w: 2, h: 1 },
        { kind: 'shelf', x: 43, y: 31, w: 2, h: 1 },
        { kind: 'shelf', x: 50, y: 31, w: 2, h: 1 },
      ],
    },
    // 公园=可行走场所(休闲活动区),无墙无内景(池塘除外)
    { id: 'park', name: '公园', x: 3, y: 26, w: 15, h: 10, entrance: { x: 9, y: 25 } },
  ],
};
