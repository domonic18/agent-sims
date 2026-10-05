/**
 * 素材清单:tile 条带 / props / furniture / 角色精灵表的帧配置。
 * 素材裁切自 LimeZu Modern Interiors & Exteriors(16x16),
 * 来源与授权见 public/assets/README.md;索引与裁切脚本条带顺序一一对应。
 */
import type { ActivityId } from '@sims/shared';

/** 像素格边长(tile→px 换算,渲染层通用) */
export const TILE = 16;

export const TILESET = {
  key: 'town-tiles',
  url: '/assets/tiles/tiles.png',
  frameWidth: 16,
  frameHeight: 16,
  /** 条带内 tile 间留 1px 隔断,防止 NEAREST 采样渗色 */
  spacing: 1,
} as const;

export const TILE_FRAME = {
  grass: 0,
  parkGrass: 1,
  path: 2,
  plaza: 3,
  water: 4,
  shoreN: 5,
  shoreS: 6,
  shoreW: 7,
  shoreE: 8,
  shoreNW: 9,
  shoreNE: 10,
  shoreSW: 11,
  shoreSE: 12,
  bush: 13,
  flowerA: 14,
  flowerB: 15,
  flowerC: 16,
  fence: 17,
  floorWood: 18,
  floorOval: 19,
  floorTile: 20,
  floorBrick: 21,
  floorBlue: 22,
  floorGrey: 23,
  wallCream: 24,
  wallBrown: 25,
  wallGrey: 26,
  wallTeal: 27,
  wallPurple: 28,
  wallBlue: 29,
} as const;

/** 户外大型 prop 精灵(树/灯,底边中心锚定格底) */
export const PROPS = ['tree-a', 'tree-b', 'cypress', 'lamp'] as const;
export type PropName = (typeof PROPS)[number];

/** 家具精灵(与 FurnitureKind 一一对应,底边中心锚定占地底边) */
export const FURNITURE_SPRITES = [
  'bed',
  'sofa',
  'workstation',
  'treadmill',
  'bookshelf',
  'shelf',
  'counter',
  'fridge',
  'plant',
  'tv',
  'wardrobe',
  'bench',
  'desk',
  'table',
] as const;
export type FurnitureSprite = (typeof FURNITURE_SPRITES)[number];

export const propKey = (name: PropName): string => `prop-${name}`;
export const furnitureKey = (name: FurnitureSprite): string => `furniture-${name}`;

/**
 * LimeZu premade 角色表(288x384,32px 帧,9 列 × 12 行):
 * rows 0-3 行走(6 帧)/ rows 4-7 待机(2 帧呼吸)/ rows 8-11 躺卧(2 帧,无方向)。
 * 方向序均为 up/left/down/right;配色变体按角色 id 稳定分配。
 */
export const CHARACTER = {
  keyPrefix: 'character',
  frameWidth: 32,
  frameHeight: 32,
  columns: 9,
  walkFps: 8,
  idleFps: 3,
  lieFps: 2,
  variants: ['green', 'purple', 'beige', 'red', 'white', 'blue'],
  /** 三组动画的基行(方向偏移在此基础上加 rows[dir]) */
  groups: { walk: 0, idle: 4, lie: 8 },
  rows: { up: 0, left: 1, down: 2, right: 3 },
  framesPerGroup: { walk: 6, idle: 2, lie: 2 },
} as const;

export type CharacterVariant = (typeof CHARACTER.variants)[number];

/** 活动 → 头顶气泡图标(emoji,M4 决策气泡复用此形态);键穷举 ActivityId,新增活动漏配即编译错误 */
export const ACTIVITY_EMOJI: Record<ActivityId, string> = {
  study: '📖',
  work: '🔨',
  rest: '💤',
  workout: '💪',
  stroll: '🚶',
  meal: '🍽️',
};

/** 活动 → 静止姿态:躺(lie,rest 横卧床/长椅)/原地跑(run,workout)/站立(idle) */
export const ACTIVITY_POSES: Record<ActivityId, 'idle' | 'run' | 'lie'> = {
  study: 'idle',
  work: 'idle',
  rest: 'lie',
  workout: 'run',
  stroll: 'idle',
  meal: 'idle',
};

/** 角色 id → 配色变体(稳定哈希,同一角色始终同一套衣服) */
export function characterVariant(id: string): CharacterVariant {
  let hash = 7;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % CHARACTER.variants.length;
  return CHARACTER.variants[index] as CharacterVariant;
}
