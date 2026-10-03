/**
 * 素材清单:tile 条带与角色 walk 表的帧配置(素材经裁切入库,来源与授权见 public/assets/README.md)。
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

export const CHARACTER = {
  key: 'character',
  url: '/assets/character/walk.png',
  frameWidth: 32,
  frameHeight: 32,
  /** 每方向帧数(行内列数) */
  frames: 9,
  walkFps: 8,
  /** 行序沿用 LPC 通用表 rows 8-11:up/left/down/right */
  rows: { up: 0, left: 1, down: 2, right: 3 },
} as const;
