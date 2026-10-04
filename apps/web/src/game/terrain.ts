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
import type { FurnitureDefinition, PlaceDefinition, TileMapDefinition } from '@sims/shared';
import { TOWN_MAP } from '@sims/shared';

const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };
/** 广场铺装(paths 内矩形默认砂路,该矩形单独用灰石) */
const PLAZA_RECT = { x: 22, y: 15, w: 12, h: 11 };

export const inRect = (
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/** 内景配色(M3.6e 剖切风): 墙体按场所着色区分建筑,室内铺木地板双色棋盘 */
const WALL_COLORS: Record<string, number> = {
  'home-a': 0x9c7b5f,
  'home-b': 0xa8825f,
  'home-c': 0x8f7a9c,
  'home-d': 0x7f9c6f,
  library: 0x7a6f9e,
  office: 0x6f8496,
  shop: 0xa8894f,
  restaurant: 0xa26353,
  gym: 0x5f8472,
};
const WALL_DEFAULT = 0x7d7d85;
const FLOOR_A = 0xd9b98a;
const FLOOR_B = 0xcfae7e;
const FLOOR_LINE = 0xb1925f;

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
      g.fillStyle((x + y) % 2 === 0 ? FLOOR_A : FLOOR_B, 1);
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  g.lineStyle(1, FLOOR_LINE, 0.35);
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
    g.fillStyle(FLOOR_A, 1);
    g.fillRect(place.door.x * TILE, place.door.y * TILE, TILE, TILE);
    g.fillStyle(0x8a5a3a, 1);
    g.fillRect(place.door.x * TILE + 2, place.door.y * TILE + 4, TILE - 4, TILE - 8);
  }
  const fg = scene.add.graphics();
  fg.setDepth(2);
  for (const furniture of place.furniture ?? []) {
    drawFurniture(fg, furniture);
  }
}

/** 家具程序化像素画:每格 16px,锚点家具(床/桌/跑步机等)即活动使用位 */
function drawFurniture(g: Phaser.GameObjects.Graphics, f: FurnitureDefinition): void {
  const px = f.x * TILE;
  const py = f.y * TILE;
  const w = f.w * TILE;
  const h = f.h * TILE;
  const r = (x: number, y: number, ww: number, hh: number, color: number): void => {
    g.fillStyle(color, 1);
    g.fillRect(px + x, py + y, ww, hh);
  };
  switch (f.kind) {
    case 'bed': {
      r(0, 0, w, h, 0x8a6d4a); // 床架
      r(2, 2, w - 4, h - 4, 0xf2ead8); // 床垫
      r(3, 3, w - 6, 6, 0xffffff); // 枕头(床头在上)
      r(2, 11, w - 4, h - 15, 0x7f9fd9); // 被子
      r(2, 11, w - 4, 2, 0x6f8fc9); // 被沿
      break;
    }
    case 'desk': {
      r(0, 2, w, h - 5, 0x9a6b45); // 桌面
      r(0, 2, w, 2, 0xb98a5f); // 桌沿高光
      r(2, h - 3, 3, 3, 0x6f4a2f); // 桌腿
      r(w - 5, h - 3, 3, 3, 0x6f4a2f);
      r(w - 12, 5, 8, 5, 0xd9534f); // 桌上的书
      r(w - 12, 5, 8, 2, 0xe2776f);
      break;
    }
    case 'workstation': {
      r(0, 9, w, h - 11, 0x7f8fa0); // 桌面(下半)
      r(0, 9, w, 2, 0x9aabb8);
      r(w / 2 - 8, 0, 16, 8, 0x333a44); // 显示器
      r(w / 2 - 6, 1, 12, 5, 0x6fd3e8); // 屏
      break;
    }
    case 'treadmill': {
      r(2, 3, w - 4, h - 5, 0x4a525c); // 机身
      r(4, h / 2, w - 8, h / 2 - 4, 0x22262c); // 跑带
      r(4, h / 2, w - 8, 2, 0x3a4048);
      r(1, 0, w - 2, 6, 0x8a99a8); // 仪表台
      r(3, 1, 4, 3, 0x6fd3e8); // 仪表屏
      break;
    }
    case 'table': {
      r(1, 2, w - 2, h - 6, 0xa87748); // 桌面
      r(1, 2, w - 2, 2, 0xc09060);
      r(3, h - 4, 3, 3, 0x7a5230); // 桌腿
      r(w - 6, h - 4, 3, 3, 0x7a5230);
      r(w / 2 - 3, 5, 6, 4, 0xe8e0d0); // 餐盘
      break;
    }
    case 'bookshelf': {
      r(0, 0, w, h, 0x7a5230); // 柜体
      const books = [0xd9534f, 0x4f8fd9, 0xe8b84f, 0x6fae5f, 0xb08fd9];
      for (let i = 1; i < w - 2; i += 3) {
        r(i, 2, 2, 5, books[i % books.length]!);
        r(i, 9, 2, 5, books[(i + 2) % books.length]!);
      }
      g.lineStyle(1, 0x8f6540, 1);
      g.lineBetween(px + 1, py + 7.5, px + w - 1, py + 7.5); // 中层隔板
      break;
    }
    case 'shelf': {
      r(0, 0, w, h, 0x8f979f); // 货架框架
      g.lineStyle(1, 0x767e86, 1);
      for (let i = 1; i < 4; i += 1) {
        g.lineBetween(px + 1, py + (h / 4) * i, px + w - 1, py + (h / 4) * i);
      }
      r(2, 3, w - 4, 4, 0xc9a06a); // 货箱
      r(2, h / 2 + 1, w - 4, 4, 0x8fb0d9);
      r(2, h - 5, w - 4, 4, 0x9fd98f);
      break;
    }
    case 'counter': {
      r(0, 0, w, h, 0x8d6e4f); // 柜体
      r(0, 0, w, 4, 0xb08f6a); // 台面
      r(0, h - 2, w, 2, 0x6f5238); // 底沿
      break;
    }
    case 'sofa': {
      r(0, 0, w, h, 0x5f7f5a); // 靠背
      r(0, h / 2, w, h / 2, 0x6f8f6a); // 座
      r(0, h / 2, w, 2, 0x7f9f7a);
      r(0, 0, 3, h, 0x4f6f4a); // 扶手
      r(w - 3, 0, 3, h, 0x4f6f4a);
      break;
    }
    case 'plant': {
      r(4, h - 7, w - 8, 6, 0xb0603f); // 花盆
      r(4, h - 7, w - 8, 2, 0x8f4f33);
      g.fillStyle(0x4f8f4a, 1);
      g.fillCircle(px + w / 2, py + 6, 5); // 叶冠
      g.fillStyle(0x63a85c, 1);
      g.fillCircle(px + w / 2 - 2, py + 5, 3);
      break;
    }
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
