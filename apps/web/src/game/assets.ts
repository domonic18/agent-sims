/**
 * 素材清单(M-L.3 起消费素材库 manifest):tile/家具/角色纹理 key 一律 = 素材 slug,
 * 由 manifest.ts 的 registry 提供 url/anim/anchor;此处只保留渲染层约定与静态映射。
 * 来源与授权见 public/assets/README.md;素材增改走后台素材管理(M-L.2)。
 */
import type { ActivityId } from '@sims/shared';

/** 像素格边长(tile→px 换算,渲染层通用) */
export const TILE = 16;

/** tile 素材 slug 静态映射(与素材库导入清单一一对应;调整需同步库内 slug) */
export const TILE_SLUG = {
  grass: 'tile-grass',
  parkGrass: 'tile-parkGrass',
  path: 'tile-path',
  plaza: 'tile-plaza',
  water: 'tile-water',
  shoreN: 'tile-shoreN',
  shoreS: 'tile-shoreS',
  shoreW: 'tile-shoreW',
  shoreE: 'tile-shoreE',
  shoreNW: 'tile-shoreNW',
  shoreNE: 'tile-shoreNE',
  shoreSW: 'tile-shoreSW',
  shoreSE: 'tile-shoreSE',
  bush: 'tile-bush',
  flowerA: 'tile-flowerA',
  flowerB: 'tile-flowerB',
  flowerC: 'tile-flowerC',
  fence: 'tile-fence',
  floorWood: 'tile-floorWood',
  floorOval: 'tile-floorOval',
  floorTile: 'tile-floorTile',
  floorBrick: 'tile-floorBrick',
  floorBlue: 'tile-floorBlue',
  floorGrey: 'tile-floorGrey',
  wallCream: 'tile-wallCream',
  wallBrown: 'tile-wallBrown',
  wallGrey: 'tile-wallGrey',
  wallTeal: 'tile-wallTeal',
  wallPurple: 'tile-wallPurple',
  wallBlue: 'tile-wallBlue',
} as const;

/** 角色表方向行偏移(渲染层约定,素材 anim 的 groups 基行 + 此偏移) */
export const CHARACTER_ROW_OFFSETS = { up: 0, left: 1, down: 2, right: 3 } as const;

/** 活动 → 头顶气泡图标(emoji,M4 决策气泡复用此形态);键穷举 ActivityId,新增活动漏配即编译错误 */
export const ACTIVITY_EMOJI: Record<ActivityId, string> = {
  study: '📖',
  work: '🔨',
  rest: '💤',
  sleep: '😴',
  workout: '💪',
  stroll: '🚶',
  meal: '🍽️',
  waiter: '🧾',
  vendor: '🛒',
  librarian: '📚',
  clean: '🧹',
  repair: '🔧',
  rescue: '🚑',
  gather_berry: '🧺',
  scavenge: '♻️',
  chop_tree: '🪓',
  mine_rock: '⛏️',
  salvage_metal: '🔩',
  pick_apple: '🍎',
  harvest_wheat: '🌾',
  craft_berry_pie: '🥧',
  craft_repair_kit: '🔨',
  craft_bread: '🍞',
  craft_sandwich: '🥪',
};

/** 活动 → 静止姿态:躺(lie,rest 横卧床/长椅)/原地跑(run,workout)/坐(sit,桌台/柜台类)/站立(idle) */
export const ACTIVITY_POSES: Record<ActivityId, 'idle' | 'run' | 'lie' | 'sit'> = {
  study: 'sit',
  work: 'sit',
  rest: 'lie',
  sleep: 'lie',
  workout: 'run',
  stroll: 'idle',
  meal: 'sit',
  waiter: 'sit',
  vendor: 'sit',
  librarian: 'sit',
  clean: 'idle',
  repair: 'idle',
  rescue: 'idle',
  gather_berry: 'idle',
  scavenge: 'idle',
  chop_tree: 'idle',
  mine_rock: 'idle',
  salvage_metal: 'idle',
  pick_apple: 'idle',
  harvest_wheat: 'idle',
  craft_berry_pie: 'idle',
  craft_repair_kit: 'idle',
  craft_bread: 'idle',
  craft_sandwich: 'idle',
};

/** 角色 id → 配色变体 slug(稳定哈希,同一角色始终同一套衣服;变体列表来自 manifest) */
export function characterVariant(id: string, variants: readonly string[]): string {
  let hash = 7;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return variants[Math.abs(hash) % variants.length]!;
}
