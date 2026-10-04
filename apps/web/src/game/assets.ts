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
  water: 3,
  pine: 4,
  tree: 5,
  roofHome: 6,
  roofOffice: 7,
  roofLibrary: 8,
  roofShop: 9,
  roofRestaurant: 10,
  roofGym: 11,
  wall: 12,
} as const;

/** 场所 → 屋顶 tile(id 与 shared TOWN_MAP places 一致) */
export const ROOF_FRAME: Record<string, number> = {
  home: TILE_FRAME.roofHome,
  office: TILE_FRAME.roofOffice,
  library: TILE_FRAME.roofLibrary,
  shop: TILE_FRAME.roofShop,
  restaurant: TILE_FRAME.roofRestaurant,
  gym: TILE_FRAME.roofGym,
};

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
