import Phaser from 'phaser';
import {
  PROP_TREES,
  TILE,
  TILESET,
  TILE_FRAME,
} from './assets';
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
import { drawFurniture } from './furniture-art';
import { FLOOR, WALL_COLORS, WALL_DEFAULT } from './palette';

const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };
/** 广场铺装(paths 内矩形默认砂路,该矩形单独用灰石) */
const PLAZA_RECT = { x: 22, y: 15, w: 12, h: 11 };

export const inRect = (
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/**
 * 城镇地形绘制(M3.6e 剖切风):Kenney tile 地图(水岸/装饰分层)
 * + 建筑剖切内景(地板/墙/家具程序化绘制)+ 场所名标注。
 */
export function drawTownMap(scene: Phaser.Scene): void {
  const map = TOWN_MAP;
  const border = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const blocked = map.blockedRects.some((r) => inRect(x, y, r));
      if (blocked && inRect(x, y, POND_RECT)) {
        // 障碍占地现仅池塘(建筑改为墙圈内景,由 drawInterior 绘制)
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
      if (border(x, y)) prop(scene, x, y, TILE_FRAME.pine);
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
    prop(scene, lx, ly, TILE_FRAME.lamp);
  }
  const flowerFrames = [TILE_FRAME.flowerPurple, TILE_FRAME.flowerYellow, TILE_FRAME.flowerOrange];
  for (const [fx, fy] of DECOR_FLOWERS) {
    overlay(scene, fx, fy, flowerFrames[(fx + fy) % flowerFrames.length]!);
  }
  for (const [tx, ty] of APARTMENT_TREES) {
    prop(scene, tx, ty, PROP_TREES[(tx * 3 + ty) % PROP_TREES.length]!);
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
 * 建筑内景(M3.6e 剖切风): 取消屋顶/立面,同一地图直接画出可行走的室内——
 * 木地板 + 四边墙体(门洞豁口)+ 家具精灵,角色经门入内。
 */
function drawInterior(scene: Phaser.Scene, place: PlaceDefinition): void {
  const g = scene.add.graphics();
  const wall = WALL_COLORS[place.id] ?? WALL_DEFAULT;
  const right = place.x + place.w - 1;
  const bottom = place.y + place.h - 1;
  const px = place.x * TILE;
  const py = place.y * TILE;
  // 室内木地板: 双色棋盘 + 细缝线
  for (let y = place.y + 1; y < bottom; y += 1) {
    for (let x = place.x + 1; x < right; x += 1) {
      g.fillStyle((x + y) % 2 === 0 ? FLOOR.a : FLOOR.b, 1);
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  g.lineStyle(1, FLOOR.line, 0.35);
  for (let x = place.x + 1; x <= right; x += 1) {
    g.lineBetween(x * TILE, (place.y + 1) * TILE, x * TILE, bottom * TILE);
  }
  for (let y = place.y + 1; y <= bottom; y += 1) {
    g.lineBetween((place.x + 1) * TILE, y * TILE, right * TILE, y * TILE);
  }
  // 墙体四边,门洞格跳过(露出门槛)
  const isDoor = (x: number, y: number): boolean =>
    place.door !== undefined && place.door.x === x && place.door.y === y;
  g.fillStyle(wall, 1);
  for (let x = place.x; x <= right; x += 1) {
    if (!isDoor(x, place.y)) g.fillRect(x * TILE, place.y * TILE, TILE, TILE);
    if (!isDoor(x, bottom)) g.fillRect(x * TILE, bottom * TILE, TILE, TILE);
  }
  for (let y = place.y + 1; y < bottom; y += 1) {
    if (!isDoor(place.x, y)) g.fillRect(place.x * TILE, y * TILE, TILE, TILE);
    if (!isDoor(right, y)) g.fillRect(right * TILE, y * TILE, TILE, TILE);
  }
  // 墙体外缘高光 + 北/西墙内侧投影,增强厚度感
  g.fillStyle(0xffffff, 0.16);
  g.fillRect(px, py, place.w * TILE, 3);
  g.fillRect(px, py, 3, place.h * TILE);
  g.fillStyle(0x000000, 0.2);
  g.fillRect((place.x + 1) * TILE, (place.y + 1) * TILE, (place.w - 2) * TILE, 2);
  g.fillRect((place.x + 1) * TILE, (place.y + 1) * TILE, 2, (place.h - 2) * TILE);
  if (place.door !== undefined) {
    g.fillStyle(FLOOR.a, 1);
    g.fillRect(place.door.x * TILE, place.door.y * TILE, TILE, TILE);
    g.fillStyle(FLOOR.doorThreshold, 1);
    g.fillRect(place.door.x * TILE + 2, place.door.y * TILE + 4, TILE - 4, TILE - 8);
  }
  const fg = scene.add.graphics();
  fg.setDepth(2);
  for (const furniture of place.furniture ?? []) {
    drawFurniture(fg, furniture);
  }
}

/** 公园:草皮 + 稀疏花丛 + 树/灌木/野餐桌/园灯 + 北缘栅栏(入口列留豁) */
function drawPark(scene: Phaser.Scene, map: TileMapDefinition, place: PlaceDefinition): void {
  fillPlace(scene, map, place, TILE_FRAME.parkGrass);
  const flowers = [TILE_FRAME.flowerPurple, TILE_FRAME.flowerYellow, TILE_FRAME.flowerOrange];
  for (let y = place.y; y < place.y + place.h; y += 1) {
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (inRect(x, y, POND_RECT)) continue;
      if ((x * 7 + y * 5) % 13 === 0) overlay(scene, x, y, flowers[(x + y) % flowers.length]!);
    }
  }
  for (const [tx, ty] of PARK_TREES) {
    prop(scene, tx, ty, PROP_TREES[(tx + ty) % PROP_TREES.length]!);
  }
  for (const [bx, by] of PARK_BUSHES) prop(scene, bx, by, TILE_FRAME.bush);
  for (const [bx, by] of PARK_BENCHES) prop(scene, bx, by, TILE_FRAME.bench);
  for (const [lx, ly] of PARK_LAMPS) prop(scene, lx, ly, TILE_FRAME.lamp);
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

/** 立面门窗/花丛等覆盖在底瓦之上的装饰 */
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
