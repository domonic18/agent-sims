import type { ActivityId, AnyFurnitureKind } from '@sims/shared';

/**
 * 生成蓝图(M-L.4;全量素材驱动重规划):场所类型配额/尺寸档/家具布局模板/tile 池——
 * 布局模板保证语义锚点(rest/study/work/meal/workout)齐备是硬约束,
 * 自由度交给具体素材选配(素材库 manifest)。
 * 建筑分两类:有墙内景(door+地板墙色)与开放场所(公园类,无门)。
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
  | 'park'
  /** 室内扩展(M-G.0 重规划):锚点驱动,零活动代码接入 */
  | 'cafe'
  | 'school'
  | 'hotel'
  | 'clinic'
  /** 户外开放场所:主题道具池布置 */
  | 'plaza'
  | 'beach'
  | 'camping';

export type Zone = 'nw' | 'ne' | 'sw' | 'se';

/** 家具摆放指令:锚定语义由布局器解释(贴北墙/贴西墙/居中/占空位) */
export interface FurnitureSlot {
  kind: AnyFurnitureKind;
  w: number;
  h: number;
  anchor: 'north' | 'west' | 'east' | 'center' | 'south';
  /** 活动锚点;装饰类省略 */
  activityId?: ActivityId;
  /** 装饰类摆放概率(0=必选) */
  chance?: number;
  /** 素材池域(缺省 indoor;户外道具池传 outdoor) */
  domain?: 'indoor' | 'outdoor';
  /**
   * 主题道具池(户外开放场所与室内主题角装饰):从该主题 active 素材按占地上限随机;
   * 声明后 kind 仅作标签,素材从 theme/{slug}@{maxTiles} 池挑选
   */
  themePick?: { theme: string; maxTiles?: number };
}

export const PLACE_BLUEPRINTS: Record<PlaceKind, {
  name: string;
  size: ReadonlyArray<readonly [number, number]>;
  requiredAnchors: readonly ActivityId[];
  furniture: readonly FurnitureSlot[];
  /** 开放场所(公园类):无门无墙,入口在上缘;池走户外道具 */
  open?: boolean;
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
      { kind: 'tv', w: 2, h: 1, anchor: 'south', chance: 0.6 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.7 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.5 },
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
      { kind: 'desk', w: 2, h: 1, anchor: 'center', activityId: 'librarian' },
      { kind: 'sofa', w: 2, h: 1, anchor: 'south', activityId: 'rest' },
      { kind: 'museum-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'museum', maxTiles: 2 }, chance: 0.5 },
      { kind: 'museum-prop', w: 1, h: 1, anchor: 'east', themePick: { theme: 'museum', maxTiles: 1 }, chance: 0.4 },
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
      { kind: 'workbench', w: 2, h: 1, anchor: 'east', activityId: 'craft_repair_kit' },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.4 },
    ],
  },
  shop: {
    name: '商店',
    size: [[9, 8]],
    requiredAnchors: [],
    furniture: [
      { kind: 'counter', w: 2, h: 1, anchor: 'north', chance: 1, activityId: 'vendor' },
      { kind: 'fridge', w: 1, h: 1, anchor: 'north', chance: 1 },
      { kind: 'shelf', w: 1, h: 3, anchor: 'west', chance: 1 },
      { kind: 'shelf', w: 1, h: 3, anchor: 'east', chance: 1 },
      { kind: 'grocery-prop', w: 1, h: 1, anchor: 'west', themePick: { theme: 'grocery-store', maxTiles: 2 }, chance: 0.8 },
      { kind: 'grocery-prop', w: 1, h: 1, anchor: 'east', themePick: { theme: 'grocery-store', maxTiles: 1 }, chance: 0.6 },
      { kind: 'clothing-prop', w: 1, h: 1, anchor: 'east', themePick: { theme: 'clothing-store', maxTiles: 2 }, chance: 0.6 },
      { kind: 'grocery-prop', w: 1, h: 1, anchor: 'north', themePick: { theme: 'grocery-store', maxTiles: 2 }, chance: 0.5 },
      { kind: 'clothing-prop', w: 1, h: 1, anchor: 'east', themePick: { theme: 'clothing-store', maxTiles: 1 }, chance: 0.5 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.5 },
    ],
  },
  restaurant: {
    name: '餐厅',
    size: [[9, 8], [12, 8]],
    requiredAnchors: ['meal'],
    furniture: [
      { kind: 'counter', w: 2, h: 1, anchor: 'north', chance: 1, activityId: 'waiter' },
      { kind: 'tv', w: 2, h: 1, anchor: 'east', chance: 1 },
      { kind: 'stove', w: 1, h: 2, anchor: 'east', activityId: 'craft_berry_pie' },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal' },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal' },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal', chance: 0.6 },
      { kind: 'kitchen-prop', w: 1, h: 1, anchor: 'west', themePick: { theme: 'kitchen', maxTiles: 2 }, chance: 0.8 },
      { kind: 'kitchen-prop', w: 1, h: 1, anchor: 'west', themePick: { theme: 'kitchen', maxTiles: 1 }, chance: 0.6 },
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
      { kind: 'treadmill', w: 1, h: 2, anchor: 'north', activityId: 'workout', chance: 0.7 },
      { kind: 'sofa', w: 2, h: 1, anchor: 'south', activityId: 'rest' },
      { kind: 'tv', w: 2, h: 1, anchor: 'east', chance: 1 },
      { kind: 'shelf', w: 2, h: 1, anchor: 'west', chance: 1 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.4 },
    ],
  },
  park: {
    name: '公园',
    size: [[14, 10], [16, 10]],
    requiredAnchors: ['rest'],
    open: true,
    furniture: [
      { kind: 'bench', w: 2, h: 1, anchor: 'center', activityId: 'rest' },
      { kind: 'bench', w: 2, h: 1, anchor: 'center', activityId: 'rest' },
    ],
  },
  cafe: {
    name: '咖啡馆',
    size: [[9, 8], [12, 8]],
    requiredAnchors: ['meal'],
    furniture: [
      { kind: 'counter', w: 2, h: 1, anchor: 'north' },
      { kind: 'fridge', w: 1, h: 1, anchor: 'west', chance: 0.8 },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal' },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal' },
      { kind: 'table', w: 2, h: 1, anchor: 'center', activityId: 'meal', chance: 0.6 },
      { kind: 'sofa', w: 2, h: 1, anchor: 'south', activityId: 'rest', chance: 0.8 },
      { kind: 'tv', w: 2, h: 1, anchor: 'east', chance: 0.7 },
      { kind: 'kitchen-prop', w: 1, h: 1, anchor: 'west', themePick: { theme: 'kitchen', maxTiles: 2 }, chance: 0.6 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
    ],
  },
  school: {
    name: '学校',
    size: [[12, 8]],
    requiredAnchors: ['study'],
    furniture: [
      { kind: 'desk', w: 2, h: 1, anchor: 'north', activityId: 'study' },
      { kind: 'desk', w: 2, h: 1, anchor: 'north', activityId: 'study' },
      { kind: 'desk', w: 2, h: 1, anchor: 'center', activityId: 'study' },
      { kind: 'desk', w: 2, h: 1, anchor: 'center', activityId: 'study' },
      { kind: 'bookshelf', w: 3, h: 1, anchor: 'north', chance: 0.7 },
      { kind: 'bookshelf', w: 2, h: 1, anchor: 'east', chance: 0.9 },
      { kind: 'counter', w: 2, h: 1, anchor: 'west', chance: 0.6 },
      { kind: 'museum-prop', w: 1, h: 1, anchor: 'east', themePick: { theme: 'museum', maxTiles: 2 }, chance: 0.5 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
    ],
  },
  hotel: {
    name: '旅馆',
    size: [[12, 8], [14, 8]],
    requiredAnchors: ['rest'],
    furniture: [
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest' },
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest' },
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest' },
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest', chance: 0.5 },
      { kind: 'wardrobe', w: 1, h: 2, anchor: 'east', chance: 0.8 },
      { kind: 'counter', w: 2, h: 1, anchor: 'west', chance: 0.8 },
      { kind: 'sofa', w: 2, h: 1, anchor: 'south', activityId: 'rest', chance: 0.8 },
      { kind: 'table', w: 2, h: 1, anchor: 'center', chance: 0.7 },
      { kind: 'japanese-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'japanese-interiors', maxTiles: 2 }, chance: 0.6 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.7 },
    ],
  },
  clinic: {
    name: '诊所',
    size: [[9, 8]],
    requiredAnchors: ['rest'],
    furniture: [
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest' },
      { kind: 'bed', w: 2, h: 3, anchor: 'north', activityId: 'rest' },
      { kind: 'desk', w: 2, h: 1, anchor: 'north' },
      { kind: 'bookshelf', w: 2, h: 1, anchor: 'east', chance: 0.8 },
      { kind: 'counter', w: 2, h: 1, anchor: 'west', chance: 0.8 },
      { kind: 'tv', w: 2, h: 1, anchor: 'east', chance: 0.6 },
      { kind: 'wardrobe', w: 1, h: 2, anchor: 'east', chance: 0.5 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.6 },
    ],
  },
  plaza: {
    name: '市集广场',
    size: [[12, 9], [14, 10]],
    requiredAnchors: ['rest'],
    open: true,
    furniture: [
      { kind: 'bench', w: 1, h: 1, anchor: 'center', activityId: 'rest', domain: 'outdoor' },
      { kind: 'bench', w: 1, h: 1, anchor: 'center', activityId: 'rest', domain: 'outdoor' },
      { kind: 'table', w: 1, h: 1, anchor: 'center', domain: 'outdoor', chance: 0.8 },
      { kind: 'chair', w: 1, h: 1, anchor: 'center', domain: 'outdoor', chance: 0.7 },
      { kind: 'barrel', w: 1, h: 1, anchor: 'center', domain: 'outdoor', chance: 0.7 },
      { kind: 'sign', w: 1, h: 1, anchor: 'center', domain: 'outdoor', chance: 0.5 },
      { kind: 'lantern', w: 1, h: 1, anchor: 'center', domain: 'outdoor', chance: 0.5 },
    ],
  },
  beach: {
    name: '海滩',
    size: [[14, 10]],
    requiredAnchors: ['rest'],
    open: true,
    furniture: [
      { kind: 'bench', w: 1, h: 1, anchor: 'center', activityId: 'rest', domain: 'outdoor' },
      { kind: 'beach-towel', w: 2, h: 2, anchor: 'center', themePick: { theme: 'beach', maxTiles: 4 }, chance: 0.9 },
      { kind: 'beach-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'beach', maxTiles: 1 }, chance: 0.8 },
      { kind: 'beach-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'beach', maxTiles: 1 }, chance: 0.6 },
      { kind: 'beach-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'beach', maxTiles: 1 }, chance: 0.4 },
    ],
  },
  camping: {
    name: '露营地',
    size: [[12, 9], [14, 10]],
    requiredAnchors: ['rest'],
    open: true,
    furniture: [
      { kind: 'bench', w: 1, h: 1, anchor: 'center', activityId: 'rest', domain: 'outdoor' },
      { kind: 'tent', w: 1, h: 1, anchor: 'center', domain: 'outdoor', chance: 0.9 },
      { kind: 'camping-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'camping', maxTiles: 1 }, chance: 0.8 },
      { kind: 'camping-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'camping', maxTiles: 1 }, chance: 0.6 },
      { kind: 'camping-prop', w: 1, h: 1, anchor: 'center', themePick: { theme: 'camping', maxTiles: 1 }, chance: 0.4 },
    ],
  },
};

/** growth 配额:各分区场所清单(数量区间由密度参数在生成器内定;
 * [0,n] 区间为锦上添花型新场所——空间不足自然裁掉,不挤占核心八类;
 * essential=核心活动场所,随机撒放空间不足时确定性兜底必须放得下) */
export const GROWTH_QUOTA: ReadonlyArray<{
  kind: PlaceKind;
  zone: Zone;
  count: [number, number];
  essential: boolean;
}> = [
  { kind: 'home', zone: 'sw', count: [3, 4], essential: true },
  { kind: 'park', zone: 'se', count: [1, 1], essential: true },
  { kind: 'library', zone: 'nw', count: [1, 1], essential: true },
  { kind: 'office', zone: 'nw', count: [1, 1], essential: true },
  { kind: 'hotel', zone: 'nw', count: [0, 1], essential: false },
  { kind: 'school', zone: 'nw', count: [0, 1], essential: false },
  { kind: 'shop', zone: 'ne', count: [1, 1], essential: true },
  { kind: 'restaurant', zone: 'ne', count: [1, 1], essential: true },
  { kind: 'gym', zone: 'ne', count: [1, 1], essential: true },
  { kind: 'clinic', zone: 'ne', count: [1, 1], essential: true },
  { kind: 'cafe', zone: 'ne', count: [0, 1], essential: false },
  { kind: 'beach', zone: 'se', count: [0, 1], essential: false },
  { kind: 'plaza', zone: 'se', count: [0, 1], essential: false },
  { kind: 'camping', zone: 'sw', count: [0, 1], essential: false },
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

/** 户外装饰素材池键(worlds.ts loadAssetsByKind 产出同名池,成员限宽保证底边锚定观感;
 * 池空回退 decor 旧固定纹理字段 trees/lamps/flowers/bushes) */
export const DECOR_POOLS = {
  /** 立式乔木/枯木(庭院/间隙/边界/公园树簇) */
  tree: 'decor/tree',
  /** 立式灌木(庭院/间隙) */
  bush: 'decor/bush',
  /** 公园长椅(环池塘缘) */
  bench: 'decor/bench',
  /** 街具(消火栓/告示牌/邮箱/垃圾桶/木桶) */
  street: 'decor/street',
  /** 路灯(沿路间隔/广场四角) */
  lamp: 'decor/lamp',
  /** 贴地花丛草石(庭院/公园/间隙 overlay) */
  flat: 'decor/flat',
} as const;
