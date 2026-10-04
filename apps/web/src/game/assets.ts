/**
 * 素材清单:tile 条带与角色精灵表的帧配置(素材经裁切入库,来源与授权见 public/assets/README.md)。
 * 索引与裁切脚本中的条带顺序一一对应,调整时需同步重新裁切。
 */

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
  meadowOrange: 13,
  meadowWhite: 14,
  meadowBlue: 15,
  roofHome: 16,
  roofOffice: 17,
  roofLibrary: 18,
  roofShop: 19,
  roofRestaurant: 20,
  roofGym: 21,
  wall: 22,
  pine: 23,
  tree: 24,
  autumn: 25,
  bush: 26,
  flowerPurple: 27,
  flowerYellow: 28,
  flowerOrange: 29,
  fence: 30,
  lamp: 31,
  bench: 32,
  door: 33,
  windowBrown: 34,
  windowWhite: 35,
  awningOrange: 36,
  awningGreen: 37,
} as const;

/** 公园点缀树(圆树/松树/秋树/果树混植) */
export const PROP_TREES = [TILE_FRAME.tree, TILE_FRAME.pine, TILE_FRAME.autumn] as const;

/**
 * LPC 穿衣角色表(288x384,32px 帧,9 列 × 12 行):
 * rows 0-3 行走(9 帧)/ rows 4-7 待机(取前 2 帧呼吸循环)/ rows 8-11 坐姿(2 帧)。
 * 方向序均为 up/left/down/right;配色变体按角色 id 稳定分配。
 */
export const CHARACTER = {
  keyPrefix: 'character',
  frameWidth: 32,
  frameHeight: 32,
  columns: 9,
  walkFps: 8,
  idleFps: 3,
  sitFps: 2,
  variants: ['blue', 'forest', 'maroon', 'slate', 'teal', 'walnut'],
  /** 三组动画的基行(方向偏移在此基础上加 rows[dir]) */
  groups: { walk: 0, idle: 4, sit: 8 },
  rows: { up: 0, left: 1, down: 2, right: 3 },
  framesPerGroup: { walk: 9, idle: 2, sit: 2 },
} as const;

export type CharacterVariant = (typeof CHARACTER.variants)[number];

/** 角色 id → 配色变体(稳定哈希,同一角色始终同一套衣服) */
export function characterVariant(id: string): CharacterVariant {
  let hash = 7;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % CHARACTER.variants.length;
  return CHARACTER.variants[index] as CharacterVariant;
}
