import Phaser from 'phaser';
import { TILE, TILE_SLUG } from './assets';
import {
  APARTMENT_TREES,
  DECOR_FLOWERS,
  FENCE_LAMPS,
  PARK_BENCHES,
  PARK_BUSHES,
  PARK_LAMPS,
  PARK_TREES,
  PLAZA_LAMPS,
  STREET_LAMPS,
} from './decor';
import type { PlaceDefinition, TileMapDefinition } from '@sims/shared';
import { addFurnitureSprite } from './furniture-art';

const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };
/** 广场铺装(paths 内矩形默认砂路,该矩形单独用灰石) */
const PLAZA_RECT = { x: 22, y: 15, w: 12, h: 11 };

/** 场所 → 内景地板 tile(缺省木地板) */
const FLOOR_OF: Record<string, string> = {
  'home-a': TILE_SLUG.floorWood,
  'home-b': TILE_SLUG.floorOval,
  'home-c': TILE_SLUG.floorWood,
  'home-d': TILE_SLUG.floorBlue,
  library: TILE_SLUG.floorOval,
  office: TILE_SLUG.floorTile,
  shop: TILE_SLUG.floorBrick,
  restaurant: TILE_SLUG.floorTile,
  gym: TILE_SLUG.floorGrey,
};

/** 场所 → 内景墙体 tile(缺省米白) */
const WALL_OF: Record<string, string> = {
  'home-a': TILE_SLUG.wallCream,
  'home-b': TILE_SLUG.wallTeal,
  'home-c': TILE_SLUG.wallBrown,
  'home-d': TILE_SLUG.wallGrey,
  library: TILE_SLUG.wallPurple,
  office: TILE_SLUG.wallBlue,
  shop: TILE_SLUG.wallCream,
  restaurant: TILE_SLUG.wallBrown,
  gym: TILE_SLUG.wallGrey,
};

/** 开放场所(无门)→ 铺装 tile,按 kind 前缀取(缺省公园草皮) */
const OPEN_FLOOR_OF: Record<string, string> = {
  park: TILE_SLUG.parkGrass,
  plaza: TILE_SLUG.plaza,
  beach: TILE_SLUG.path,
  camping: TILE_SLUG.parkGrass,
};

export const inRect = (
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/**
 * 城镇地形绘制(M-L.5 参数化):按传入地图定义绘制(内置/生成地图通用)——
 * decor 树灯花木与场所 floorTile/wallTile 优先取地图数据,缺省回退静态
 * 内置映射;tile 独立纹理(slug 即 key)+ 家具精灵底边中心锚定。
 */
export function drawTownMap(scene: Phaser.Scene, map: TileMapDefinition): void {
  const decor = map.decor;
  const pondRect = decor?.pond ?? POND_RECT;
  const border = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const blocked = map.blockedRects.some((r) => inRect(x, y, r));
      if (blocked && inRect(x, y, pondRect)) {
        // 障碍占地现仅池塘(建筑为墙圈内景,由 drawInterior 绘制)
        pondTile(scene, x, y, pondRect);
        continue;
      }
      ground(scene, x, y, TILE_SLUG.grass);
      if (inRect(x, y, PLAZA_RECT)) {
        ground(scene, x, y, TILE_SLUG.plaza);
        continue;
      }
      if (map.paths.some((r) => inRect(x, y, r))) {
        ground(scene, x, y, TILE_SLUG.path);
        continue;
      }
      // 边界柏树墙:隔格交错,树冠相连又不糊死
      if (border(x, y) && (x + y) % 2 === 0) propSprite(scene, x, y, 'cypress');
    }
  }

  for (const place of map.places) {
    if (place.id === 'park') {
      drawPark(scene, map, place);
    } else if (place.door !== undefined) {
      drawInterior(scene, place);
    } else {
      drawOpenPlace(scene, map, place);
    }
    scene.add
      .text(place.x * TILE + (place.w * TILE) / 2, place.y * TILE + 2, place.name, {
        fontSize: '11px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setDepth(20)
      .setStroke('rgba(0,0,0,0.6)', 3);
  }

  // 围栏段(M-G.5 数据化:内置/生成公园统一由地图定义驱动,入口豁口已在段划分中)
  for (const fence of map.fences ?? []) {
    for (let y = fence.y; y < fence.y + fence.h; y += 1) {
      for (let x = fence.x; x < fence.x + fence.w; x += 1) {
        prop(scene, x, y, TILE_SLUG.fence);
      }
    }
  }

  const lamps = decor?.lamps ?? [...STREET_LAMPS, ...PLAZA_LAMPS, ...PARK_LAMPS, ...FENCE_LAMPS];
  for (const [lx, ly] of lamps) {
    propSprite(scene, lx, ly, 'lamp');
  }
  const flowerFrames = [TILE_SLUG.flowerA, TILE_SLUG.flowerB, TILE_SLUG.flowerC];
  const flowers = decor?.flowers ?? DECOR_FLOWERS;
  for (const [fx, fy] of flowers) {
    overlay(scene, fx, fy, flowerFrames[(fx + fy) % flowerFrames.length]!);
  }
  const trees = decor?.trees ?? APARTMENT_TREES;
  for (const [tx, ty] of trees) {
    propSprite(scene, tx, ty, (tx * 3 + ty) % 2 === 0 ? 'tree-a' : 'tree-b');
  }
  if (decor !== undefined) {
    for (const [bx, by] of decor.bushes) prop(scene, bx, by, TILE_SLUG.bush);
  }
}

/** 池塘:按格位铺 8 向水岸 + 中心水面 */
function pondTile(scene: Phaser.Scene, x: number, y: number, pondRect: { x: number; y: number; w: number; h: number }): void {
  const f = TILE_SLUG;
  const west = x === pondRect.x;
  const east = x === pondRect.x + pondRect.w - 1;
  const north = y === pondRect.y;
  const south = y === pondRect.y + pondRect.h - 1;
  const frame = north && west ? f.shoreNW
    : north && east ? f.shoreNE
    : south && west ? f.shoreSW
    : south && east ? f.shoreSE
    : north ? f.shoreN
    : south ? f.shoreS
    : west ? f.shoreW
    : east ? f.shoreE
    : f.water;
  ground(scene, x, y, frame);
}

/**
 * 建筑内景(剖切风): 场所地板 tile + 四边墙体 tile(门洞豁口铺地板)
 * + 家具精灵,角色经门入内。
 */
function drawInterior(scene: Phaser.Scene, place: PlaceDefinition): void {
  const floor = place.floorTile ?? FLOOR_OF[place.id] ?? TILE_SLUG.floorWood;
  const wall = place.wallTile ?? WALL_OF[place.id] ?? TILE_SLUG.wallCream;
  const right = place.x + place.w - 1;
  const bottom = place.y + place.h - 1;
  const isDoor = (x: number, y: number): boolean =>
    place.door !== undefined && place.door.x === x && place.door.y === y;
  // 室内地板
  for (let y = place.y + 1; y < bottom; y += 1) {
    for (let x = place.x + 1; x < right; x += 1) {
      ground(scene, x, y, floor);
    }
  }
  // 墙体四边,门洞格铺地板露通行
  for (let x = place.x; x <= right; x += 1) {
    ground(scene, x, place.y, isDoor(x, place.y) ? floor : wall);
    ground(scene, x, bottom, isDoor(x, bottom) ? floor : wall);
  }
  for (let y = place.y + 1; y < bottom; y += 1) {
    ground(scene, place.x, y, isDoor(place.x, y) ? floor : wall);
    ground(scene, right, y, isDoor(right, y) ? floor : wall);
  }
  // 门洞下沿压一条深色门槛,暗示入口
  if (place.door !== undefined) {
    const g = scene.add.graphics().setDepth(1);
    g.fillStyle(0x000000, 0.18);
    g.fillRect(place.door.x * TILE + 1, (place.door.y + 1) * TILE - 4, TILE - 2, 3);
  }
  for (const furniture of place.furniture ?? []) {
    addFurnitureSprite(scene, furniture);
  }
}

/**
 * 开放场所(M 重规划): 海滩/广场/营地/生成公园等无门场所——
 * 整块铺装(kind 前缀选地面)+ 地图数据家具(户外道具池选材)直绘;
 * 生成公园补稀疏花丛,与内置公园观感一致。
 */
function drawOpenPlace(scene: Phaser.Scene, map: TileMapDefinition, place: PlaceDefinition): void {
  const kind = place.id.split('-')[0]!;
  fillPlace(scene, map, place, OPEN_FLOOR_OF[kind] ?? TILE_SLUG.parkGrass);
  if (kind === 'park') {
    const flowers = [TILE_SLUG.flowerA, TILE_SLUG.flowerB, TILE_SLUG.flowerC];
    for (let y = place.y; y < place.y + place.h; y += 1) {
      for (let x = place.x; x < place.x + place.w; x += 1) {
        if (inRect(x, y, map.decor?.pond ?? POND_RECT)) continue;
        if ((x * 7 + y * 5) % 13 === 0) overlay(scene, x, y, flowers[(x + y) % flowers.length]!);
      }
    }
  }
  for (const furniture of place.furniture ?? []) {
    addFurnitureSprite(scene, furniture);
  }
}

/** 公园:草皮 + 稀疏花丛 + 树/灌木/长椅/园灯 + 北缘栅栏(入口列留豁) */
function drawPark(scene: Phaser.Scene, map: TileMapDefinition, place: PlaceDefinition): void {
  const pondRect = map.decor?.pond ?? POND_RECT;
  fillPlace(scene, map, place, TILE_SLUG.parkGrass);
  const flowers = [TILE_SLUG.flowerA, TILE_SLUG.flowerB, TILE_SLUG.flowerC];
  for (let y = place.y; y < place.y + place.h; y += 1) {
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (inRect(x, y, pondRect)) continue;
      if ((x * 7 + y * 5) % 13 === 0) overlay(scene, x, y, flowers[(x + y) % flowers.length]!);
    }
  }
  for (const [tx, ty] of PARK_TREES) {
    propSprite(scene, tx, ty, (tx + ty) % 2 === 0 ? 'tree-a' : 'tree-b');
  }
  for (const [bx, by] of PARK_BUSHES) prop(scene, bx, by, TILE_SLUG.bush);
  for (const [bx, by] of PARK_BENCHES) propSprite(scene, bx, by, 'bench');
  for (const [lx, ly] of PARK_LAMPS) propSprite(scene, lx, ly, 'lamp');
}

function ground(scene: Phaser.Scene, x: number, y: number, slug: string): void {
  scene.add.image(x * TILE, y * TILE, slug).setOrigin(0, 0);
}

function prop(scene: Phaser.Scene, x: number, y: number, slug: string): void {
  scene.add.image(x * TILE, y * TILE, slug).setOrigin(0, 0).setDepth(5);
}

/** 大型 prop(树/灯/长椅): 底边中心锚定格底,竖高精灵向上延伸 */
function propSprite(scene: Phaser.Scene, x: number, y: number, key: string): void {
  scene.add.image(x * TILE + TILE / 2, (y + 1) * TILE, key).setOrigin(0.5, 1).setDepth(5);
}

/** 花丛等覆盖在底瓦之上的装饰 */
function overlay(scene: Phaser.Scene, x: number, y: number, slug: string): void {
  scene.add.image(x * TILE, y * TILE, slug).setOrigin(0, 0).setDepth(6);
}

/** 可行走场所整块铺装;障碍格(如公园内的池塘)跳过,保留水岸 */
function fillPlace(
  scene: Phaser.Scene,
  map: TileMapDefinition,
  place: PlaceDefinition,
  slug: string,
): void {
  for (let y = place.y; y < place.y + place.h; y += 1) {
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (map.blockedRects.some((r) => inRect(x, y, r))) continue;
      ground(scene, x, y, slug);
    }
  }
}
