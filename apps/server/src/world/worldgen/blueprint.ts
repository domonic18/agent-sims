import type { ActivityId, FurnitureKind } from '@sims/shared';

/**
 * 生成蓝图(M-L.4):场所类型配额/尺寸档/家具布局模板/tile 池——
 * 布局模板保证语义锚点(rest/study/work/meal/workout)齐备是硬约束,
 * 自由度交给具体素材选配(素材库 manifest,后续迭代接入)。
 */

export interface BlueprintPlace {
  kind: PlaceKind;
  id: string;
  name: string;
  w: number;
  h: number;
  zone: Zone;
  /** 必需活动锚点(校验硬约束) */
  requiredAnchors: readonly ActivityId[];
}

export type PlaceKind =
  | 'home'
  | 'library'
  | 'office'
  | 'shop'
  | 'restaurant'
  | 'gym'
  | 'park';

export type Zone = 'nw' | 'ne' | 'sw' | 'se';

/** 家具摆放指令:锚定语义由布局器解释(贴北墙/贴西墙/居中/占空位) */
export interface FurnitureSlot {
  kind: FurnitureKind;
  w: number;
  h: number;
  anchor: 'north' | 'west' | 'east' | 'center' | 'south';
  /** 活动锚点;装饰类省略 */
  activityId?: ActivityId;
  /** 装饰类摆放概率(0=必选) */
  chance?: number;
}

export const PLACE_BLUEPRINTS: Record<PlaceKind, {
  name: string;
  size: ReadonlyArray<readonly [number, number]>;
  requiredAnchors: readonly ActivityId[];
  furniture: readonly FurnitureSlot[];
}> = {
  home: {
    name: '公寓',
    size: [[9, 8], [12, 8]],
    requiredAnchors: ['rest', 'study'],
    furniture: [
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest' },
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest' },
      { kind: 'desk', w: 2, h: 1, anchor: 'north', activityId: 'study' },
      { kind: 'bookshelf', w: 2, h: 1, anchor: 'east', chance: 1 },
      { kind: 'fridge', w: 1, h: 1, anchor: 'west', chance: 1 },
      { kind: 'wardrobe', w: 1, h: 2, anchor: 'east', chance: 0.9 },
      { kind: 'table', w: 2, h: 1, anchor: 'center', chance: 1 },
      { kind: 'sofa', w: 2, h: 1, anchor: 'south', activityId: 'rest' },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.7 },
    ],
  },
  library: {
    name: '图书馆',
    size: [[9, 8], [12, 8]],
    requiredAnchors: ['study', 'rest'],
    furniture: [
      { kind: 'bookshelf', w: 4, h: 1, anchor: 'north', chance: 1 },
      { kind: 'bookshelf', w: 3, h: 1, anchor: 'north', chance: 1 },
      { kind: 'bookshelf', w: 2, h: 1, anchor: 'east', chance: 0.9 },
      { kind: 'desk', w: 2, h: 1, anchor: 'center', activityId: 'study' },
      { kind: 'desk', w: 2, h: 1, anchor: 'center', activityId: 'study' },
      { kind: 'sofa', w: 2, h: 1, anchor: 'south', activityId: 'rest' },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
    ],
  },
  office: {
    name: '办公楼',
    size: [[12, 8]],
    requiredAnchors: ['work'],
    furniture: [
      { kind: 'workstation', w: 2, h: 1, anchor: 'north', activityId: 'work' },
      { kind: 'workstation', w: 2, h: 1, anchor: 'north', activityId: 'work' },
      { kind: 'workstation', w: 2, h: 1, anchor: 'north', activityId: 'work' },
      { kind: 'table', w: 3, h: 1, anchor: 'center', chance: 1 },
      { kind: 'counter', w: 2, h: 1, anchor: 'west', chance: 1 },
      { kind: 'fridge', w: 1, h: 1, anchor: 'west', chance: 1 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
    ],
  },
  shop: {
    name: '商店',
    size: [[9, 8]],
    requiredAnchors: [],
    furniture: [
      { kind: 'counter', w: 2, h: 1, anchor: 'north', chance: 1 },
      { kind: 'fridge', w: 1, h: 1, anchor: 'north', chance: 1 },
      { kind: 'shelf', w: 1, h: 3, anchor: 'west', chance: 1 },
      { kind: 'shelf', w: 1, h: 3, anchor: 'east', chance: 1 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.5 },
    ],
  },
  restaurant: {
    name: '餐厅',
    size: [[9, 8], [12, 8]],
    requiredAnchors: ['meal'],
    furniture: [
      { kind: 'counter', w: 2, h: 1, anchor: 'north', chance: 1 },
      { kind: 'tv', w: 2, h: 1, anchor: 'east', chance: 1 },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal' },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal' },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.5 },
    ],
  },
  gym: {
    name: '健身房',
    size: [[9, 8], [12, 8]],
    requiredAnchors: ['workout', 'rest'],
    furniture: [
      { kind: 'treadmill', w: 1, h: 2, anchor: 'north', activityId: 'workout' },
      { kind: 'treadmill', w: 1, h: 2, anchor: 'north', activityId: 'workout' },
      { kind: 'sofa', w: 2, h: 1, anchor: 'south', activityId: 'rest' },
      { kind: 'tv', w: 2, h: 1, anchor: 'east', chance: 1 },
      { kind: 'shelf', w: 2, h: 1, anchor: 'west', chance: 1 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
    ],
  },
  park: {
    name: '公园',
    size: [[14, 10], [16, 10]],
    requiredAnchors: ['rest'],
    furniture: [
      { kind: 'bench', w: 1, h: 1, anchor: 'center', activityId: 'rest' },
      { kind: 'bench', w: 1, h: 1, anchor: 'center', activityId: 'rest' },
    ],
  },
};

/** growth 配额:各分区场所清单(数量区间由密度参数在生成器内定) */
export const GROWTH_QUOTA: ReadonlyArray<{ kind: PlaceKind; zone: Zone; count: [number, number] }> = [
  { kind: 'home', zone: 'sw', count: [3, 4] },
  { kind: 'park', zone: 'se', count: [1, 1] },
  { kind: 'library', zone: 'nw', count: [1, 1] },
  { kind: 'office', zone: 'nw', count: [1, 1] },
  { kind: 'shop', zone: 'ne', count: [1, 1] },
  { kind: 'restaurant', zone: 'ne', count: [1, 1] },
  { kind: 'gym', zone: 'ne', count: [1, 1] },
];

/** 内景地板/墙体 tile 池(与素材库 tile slug 对应) */
export const FLOOR_TILE_POOL = [
  'tile-floorWood',
  'tile-floorOval',
  'tile-floorTile',
  'tile-floorBrick',
  'tile-floorBlue',
  'tile-floorGrey',
] as const;

export const WALL_TILE_POOL = [
  'tile-wallCream',
  'tile-wallBrown',
  'tile-wallGrey',
  'tile-wallTeal',
  'tile-wallPurple',
  'tile-wallBlue',
] as const;
