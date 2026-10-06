/**
 * 首批导入清单(M-L.1,版本化):存量在用素材 55 件(经人工验证,status=active)
 * + 已确认 Singles 变体 5 件(draft,待 M-L.2 校验启用)。
 * 源目录由 ASSET_IMPORT_SOURCE 指定(默认 /tmp/asset-import,一次性数据准备产物);
 * 导入后文件持久落 workspace/asset-library,源可失。
 */
import type { AssetAnimConfig } from '@sims/shared';
import type { ImportItem } from './library.js';

const TERRAIN_TILES: ReadonlyArray<readonly [string, string]> = [
  ['grass', '草地'],
  ['parkGrass', '公园草'],
  ['path', '砂土路'],
  ['plaza', '广场灰砖'],
  ['water', '水面'],
  ['shoreN', '水岸·北'],
  ['shoreS', '水岸·南'],
  ['shoreW', '水岸·西'],
  ['shoreE', '水岸·东'],
  ['shoreNW', '水岸·西北'],
  ['shoreNE', '水岸·东北'],
  ['shoreSW', '水岸·西南'],
  ['shoreSE', '水岸·东南'],
  ['fence', '木栅栏'],
];
const VEGETATION: ReadonlyArray<readonly [string, string]> = [
  ['bush', '灌木'],
  ['flowerA', '花丛·紫'],
  ['flowerB', '花丛·黄'],
  ['flowerC', '花丛·橙'],
];
const FLOOR_TILES: ReadonlyArray<readonly [string, string]> = [
  ['floorWood', '木地板'],
  ['floorOval', '拼花地板'],
  ['floorTile', '瓷砖地板'],
  ['floorBrick', '红砖地板'],
  ['floorBlue', '蓝灰地板'],
  ['floorGrey', '灰石地板'],
];
const WALL_TILES: ReadonlyArray<readonly [string, string]> = [
  ['wallCream', '米白墙'],
  ['wallBrown', '棕木墙'],
  ['wallGrey', '灰石墙'],
  ['wallTeal', '青绿墙'],
  ['wallPurple', '紫墙'],
  ['wallBlue', '蓝墙'],
];
/** 家具: slug → [中文名, 占地 w, 占地 h](与 town-map FurnitureDefinition 占地一致) */
const FURNITURE: ReadonlyArray<readonly [string, string, number, number]> = [
  ['bed', '床', 2, 3],
  ['sofa', '沙发', 2, 1],
  ['workstation', '办公工位', 2, 1],
  ['treadmill', '跑步机', 1, 2],
  ['bookshelf', '书架', 2, 2],
  ['shelf', '货架', 1, 4],
  ['counter', '柜台', 2, 1],
  ['fridge', '冰箱', 1, 3],
  ['plant', '盆栽', 1, 1],
  ['tv', '电视柜', 2, 1],
  ['wardrobe', '衣柜', 2, 2],
  ['bench', '长椅', 1, 1],
  ['desk', '课桌', 2, 1],
  ['table', '餐桌', 2, 1],
];
const CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['green', '居民·绿衣'],
  ['purple', '居民·紫衣'],
  ['beige', '居民·米衣'],
  ['red', '居民·红衣'],
  ['white', '居民·白衣'],
  ['blue', '居民·蓝衣'],
  // LimeZu Legacy 命名角色(源:Modern Interiors 完整包 Single_Characters_Legacy/32x32,
  // 经 scripts/assets/crop_characters.py 裁切重排为 288×512 契约表,含 sit 组)
  ['adam', '居民·亚当'],
  ['alex', '居民·亚历克斯'],
  ['amelia', '居民·艾米莉亚'],
  ['ash', '居民·艾什'],
  ['bob', '居民·鲍勃'],
  ['bouncer', '保镖'],
  ['bruce', '居民·布鲁斯'],
  ['butcher', '屠夫'],
  ['butcher2', '屠夫·二号'],
  ['dan', '居民·丹'],
  ['edward', '居民·爱德华'],
  ['lucy', '居民·露西'],
  ['molly', '居民·莫莉'],
  ['pier', '居民·皮尔'],
  ['rob', '居民·罗布'],
  ['roki', '居民·罗基'],
  ['samuel', '居民·塞缪尔'],
  ['witch', '女巫'],
  ['zombie', '僵尸'],
];
/** 角色表帧契约(与 apps/web/src/game/assets.ts CHARACTER 一致,M-L.3 对接后单源化;M-G.3 增 sit 组) */
const CHARACTER_ANIM: AssetAnimConfig = {
  frameWidth: 32,
  frameHeight: 32,
  columns: 9,
  groups: { walk: 0, idle: 4, lie: 8, sit: 12 },
  framesPerGroup: { walk: 6, idle: 2, lie: 2, sit: 2 },
  fps: { walk: 8, idle: 3, lie: 2, sit: 2 },
};
/** 已确认 Singles 变体(design/05 风险节:首批控制校验成本,只导确认件) */
const SINGLE_VARIANTS: ReadonlyArray<readonly [string, string, string]> = [
  ['bed-blue', '床·蓝被', 'Bedroom_Singles_238'],
  ['bookshelf-b', '书架·B', 'Classroom_and_Library_Singles_44'],
  ['bookshelf-c', '书架·C', 'Classroom_and_Library_Singles_45'],
  ['sofa-b', '沙发·B', 'Living_Room_Singles_57'],
  ['fridge-b', '冰箱·B', 'Kitchen_Singles_334'],
];

export function buildImportPlan(source: string): ImportItem[] {
  const items: ImportItem[] = [];
  const tile = (slug: string, name: string, theme: string): void => {
    items.push({
      slug: `tile-${slug}`,
      name,
      domain: theme === 'floor' || theme === 'wall' ? 'indoor' : 'outdoor',
      theme,
      sourcePath: `${source}/tiles/${slug}.png`,
      source: 'public-migration',
      anchor: 'top-left',
      status: 'active',
    });
  };
  for (const [slug, name] of TERRAIN_TILES) tile(slug, name, 'terrain');
  for (const [slug, name] of VEGETATION) tile(slug, name, 'vegetation');
  for (const [slug, name] of FLOOR_TILES) tile(slug, name, 'floor');
  for (const [slug, name] of WALL_TILES) tile(slug, name, 'wall');

  for (const [slug, name] of [
    ['tree-a', '圆树'],
    ['tree-b', '高圆树'],
    ['cypress', '柏树'],
    ['lamp', '路灯'],
  ] as const) {
    items.push({
      slug,
      name,
      domain: 'outdoor',
      theme: 'props',
      sourcePath: `${source}/props/${slug}.png`,
      source: 'public-migration',
      status: 'active',
    });
  }

  for (const [slug, name, gridW, gridH] of FURNITURE) {
    items.push({
      slug,
      name,
      domain: 'indoor',
      theme: 'furniture',
      kind: slug,
      sourcePath: `${source}/furniture/${slug}.png`,
      source: 'limezu-singles(verified)',
      gridW,
      gridH,
      status: 'active',
    });
  }

  for (const [color, name] of CHARACTERS) {
    items.push({
      slug: `char-${color}`,
      name,
      domain: 'character',
      theme: 'premade',
      sourcePath: `${source}/character/char-${color}.png`,
      source: 'public-migration',
      anchor: 'char-082',
      anim: CHARACTER_ANIM,
      status: 'active',
    });
  }

  for (const [slug, name, singleFile] of SINGLE_VARIANTS) {
    const kind = slug.split('-')[0]!;
    items.push({
      slug,
      name,
      domain: 'indoor',
      theme: 'furniture',
      kind: kind === 'bed' || kind === 'fridge' || kind === 'sofa' ? kind : 'bookshelf',
      sourcePath: `${source}/singles/${slug}.png`,
      source: `limezu-singles(${singleFile})`,
      status: 'draft',
    });
  }
  return items;
}
