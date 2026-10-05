import Phaser from 'phaser';
import { TILE, TILESET, TILE_FRAME, furnitureKey, propKey } from './assets';
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
import { TOWN_MAP } from '@sims/shared';
import { addFurnitureSprite } from './furniture-art';

const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };
/** 广场铺装(paths 内矩形默认砂路,该矩形单独用灰石) */
const PLAZA_RECT = { x: 22, y: 15, w: 12, h: 11 };

/** 场所 → 内景地板 tile(缺省木地板) */
const FLOOR_OF: Record<string, number> = {
  'home-a': TILE_FRAME.floorWood,
  'home-b': TILE_FRAME.floorOval,
  'home-c': TILE_FRAME.floorWood,
  'home-d': TILE_FRAME.floorBlue,
  library: TILE_FRAME.floorOval,
  office: TILE_FRAME.floorTile,
  shop: TILE_FRAME.floorBrick,
  restaurant: TILE_FRAME.floorTile,
  gym: TILE_FRAME.floorGrey,
};

/** 场所 → 内景墙体 tile(缺省米白) */
const WALL_OF: Record<string, number> = {
  'home-a': TILE_FRAME.wallCream,
  'home-b': TILE_FRAME.wallTeal,
  'home-c': TILE_FRAME.wallBrown,
  'home-d': TILE_FRAME.wallGrey,
  library: TILE_FRAME.wallPurple,
  office: TILE_FRAME.wallBlue,
  shop: TILE_FRAME.wallCream,
  restaurant: TILE_FRAME.wallBrown,
  gym: TILE_FRAME.wallGrey,
};

export const inRect = (
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/**
 * 城镇地形绘制(LimeZu 素材版):tile 条带地图(水岸/花丛/地板/墙)
 * + 大型 prop 与家具精灵(树/灯/床桌等,底边中心锚定)+ 场所名标注。
 */
export function drawTownMap(scene: Phaser.Scene): void {
  const map = TOWN_MAP;
  const border = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const blocked = map.blockedRects.some((r) => inRect(x, y, r));
      if (blocked && inRect(x, y, POND_RECT)) {
        // 障碍占地现仅池塘(建筑为墙圈内景,由 drawInterior 绘制)
        pondTile(scene, x, y);
        continue;
      }
      ground(scene, x, y, TILE_FRAME.grass);
      if (inRect(x, y, PLAZA_RECT)) {
        ground(scene, x, y, TILE_FRAME.plaza);
        continue;
      }
      if (map.paths.some((r) => inRect(x, y, r))) {
        ground(scene, x, y, TILE_FRAME.path);
        continue;
      }
      // 边界柏树墙:隔格交错,树冠相连又不糊死
      if (border(x, y) && (x + y) % 2 === 0) propSprite(scene, x, y, propKey('cypress'));
    }
  }

  for (const place of map.places) {
    if (place.id === 'park') {
      drawPark(scene, map, place);
    } else if (place.door !== undefined) {
      drawInterior(scene, place);
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

  for (const [lx, ly] of [...STREET_LAMPS, ...PLAZA_LAMPS, ...PARK_LAMPS, ...FENCE_LAMPS]) {
    propSprite(scene, lx, ly, propKey('lamp'));
  }
  const flowerFrames = [TILE_FRAME.flowerA, TILE_FRAME.flowerB, TILE_FRAME.flowerC];
  for (const [fx, fy] of DECOR_FLOWERS) {
    overlay(scene, fx, fy, flowerFrames[(fx + fy) % flowerFrames.length]!);
  }
  for (const [tx, ty] of APARTMENT_TREES) {
    propSprite(scene, tx, ty, propKey((tx * 3 + ty) % 2 === 0 ? 'tree-a' : 'tree-b'));
  }
}

/** 池塘:按格位铺 8 向水岸 + 中心水面 */
function pondTile(scene: Phaser.Scene, x: number, y: number): void {
  const f = TILE_FRAME;
  const west = x === POND_RECT.x;
  const east = x === POND_RECT.x + POND_RECT.w - 1;
  const north = y === POND_RECT.y;
  const south = y === POND_RECT.y + POND_RECT.h - 1;
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
  const floor = FLOOR_OF[place.id] ?? TILE_FRAME.floorWood;
  const wall = WALL_OF[place.id] ?? TILE_FRAME.wallCream;
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

/** 公园:草皮 + 稀疏花丛 + 树/灌木/长椅/园灯 + 北缘栅栏(入口列留豁) */
function drawPark(scene: Phaser.Scene, map: TileMapDefinition, place: PlaceDefinition): void {
  fillPlace(scene, map, place, TILE_FRAME.parkGrass);
  const flowers = [TILE_FRAME.flowerA, TILE_FRAME.flowerB, TILE_FRAME.flowerC];
  for (let y = place.y; y < place.y + place.h; y += 1) {
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (inRect(x, y, POND_RECT)) continue;
      if ((x * 7 + y * 5) % 13 === 0) overlay(scene, x, y, flowers[(x + y) % flowers.length]!);
    }
  }
  for (const [tx, ty] of PARK_TREES) {
    propSprite(scene, tx, ty, propKey((tx + ty) % 2 === 0 ? 'tree-a' : 'tree-b'));
  }
  for (const [bx, by] of PARK_BUSHES) prop(scene, bx, by, TILE_FRAME.bush);
  for (const [bx, by] of PARK_BENCHES) propSprite(scene, bx, by, furnitureKey('bench'));
  for (const [lx, ly] of PARK_LAMPS) propSprite(scene, lx, ly, propKey('lamp'));
  for (let x = place.x; x < place.x + place.w; x += 1) {
    if (x === place.entrance.x) continue;
    prop(scene, x, place.y, TILE_FRAME.fence);
  }
}

function ground(scene: Phaser.Scene, x: number, y: number, frame: number): void {
  scene.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0);
}

function prop(scene: Phaser.Scene, x: number, y: number, frame: number): void {
  scene.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0).setDepth(5);
}

/** 大型 prop(树/灯/长椅): 底边中心锚定格底,竖高精灵向上延伸 */
function propSprite(scene: Phaser.Scene, x: number, y: number, key: string): void {
  scene.add.image(x * TILE + TILE / 2, (y + 1) * TILE, key).setOrigin(0.5, 1).setDepth(5);
}

/** 花丛等覆盖在底瓦之上的装饰 */
function overlay(scene: Phaser.Scene, x: number, y: number, frame: number): void {
  scene.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0).setDepth(6);
}

/** 可行走场所整块铺装;障碍格(如公园内的池塘)跳过,保留水岸 */
function fillPlace(
  scene: Phaser.Scene,
  map: TileMapDefinition,
  place: PlaceDefinition,
  frame: number,
): void {
  for (let y = place.y; y < place.y + place.h; y += 1) {
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (map.blockedRects.some((r) => inRect(x, y, r))) continue;
      ground(scene, x, y, frame);
    }
  }
}
