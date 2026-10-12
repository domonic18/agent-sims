/**
 * TileMapDefinition → 游戏贴图效果渲染(admin 域 Canvas2D 移植 game/terrain.ts)。
 * 目标:编辑器「效果视图」与 AI 截图所见即游戏实际外观——地板/墙体/池塘水岸/
 * 家具/资源/树灯花按同一套素材映射绘制。刻意不 import game/terrain.ts 与
 * manifest.ts(两者值依赖 Phaser 会把 phaser 拖进 admin chunk),仅复用其
 * 纯常量模块 assets.ts/decor.ts;映射表若有调整需与 game 侧同步。
 */
import { AssetManifestSchema } from '@sims/shared';
import type { FurnitureDefinition, PlaceDefinition, TileMapDefinition } from '@sims/shared';
import { TILE as TILE_PX, TILE_SLUG } from '../game/assets';
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
} from '../game/decor';

/** 内置图专属:池塘/广场缺省位(与 terrain.ts 一致;仅 decor 未数据化时生效) */
const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };
const PLAZA_RECT = { x: 22, y: 15, w: 12, h: 11 };

/** 场所 id → 内景地板 tile(缺省木地板) */
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

/** 场所 id → 内景墙体 tile(缺省米白) */
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

/** 开放场所 kind 前缀 → 铺装 tile(缺省公园草皮) */
const OPEN_FLOOR_OF: Record<string, string> = {
  park: TILE_SLUG.parkGrass,
  plaza: TILE_SLUG.plaza,
  beach: TILE_SLUG.path,
  camping: TILE_SLUG.parkGrass,
  graveyard: TILE_SLUG.path,
  ruins: TILE_SLUG.plaza,
};

/** 资源节点 kind → 贴图 slug(与 game/resources-view.ts 同源) */
export const NODE_SPRITES: Record<string, string> = {
  berry_bush: 'garden-bush-2965',
  junk_pile: 'city-props-small-full-trash-can-1691',
  tree: 'camping-tree-1013',
  rock: 'camping-rock-883',
  metal_pile: 'garage-sales-air-conditioner-unit-2810',
  apple_tree: 'camping-apples-668',
  wheat_patch: 'beach-small-sprout-3-vers-259',
};

const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** 池塘格 → 8 向水岸/水面 slug(纯函数,便于单测) */
export function pondFrameSlug(
  x: number,
  y: number,
  pondRect: { x: number; y: number; w: number; h: number },
): string {
  const west = x === pondRect.x;
  const east = x === pondRect.x + pondRect.w - 1;
  const north = y === pondRect.y;
  const south = y === pondRect.y + pondRect.h - 1;
  return north && west ? TILE_SLUG.shoreNW
    : north && east ? TILE_SLUG.shoreNE
    : south && west ? TILE_SLUG.shoreSW
    : south && east ? TILE_SLUG.shoreSE
    : north ? TILE_SLUG.shoreN
    : south ? TILE_SLUG.shoreS
    : west ? TILE_SLUG.shoreW
    : east ? TILE_SLUG.shoreE
    : TILE_SLUG.water;
}

/** 家具 → 贴图 slug(与 game/furniture-art.ts 兜底链同源:宽 shelf 用矮凳,缺省盆栽) */
export function furnitureSlug(f: FurnitureDefinition): string {
  const fallbackKind = f.kind === 'shelf' && f.w > f.h ? 'bench' : f.kind;
  return f.sprite ?? fallbackKind;
}

// ---- 素材装载(manifest + 按需 PNG;模块级缓存跨视图切换复用) ----

interface ManifestEntry {
  slug: string;
  url: string;
  width: number;
  height: number;
}

const imageCache = new Map<string, HTMLImageElement>();
const imageSizes = new Map<string, { width: number; height: number }>();
let entriesBySlug: Map<string, ManifestEntry> | null = null;

/** 从文档收集本图需要的全部 slug(tile 全集+动态 tile 字段+道具/资源/家具/装饰) */
function neededSlugs(map: TileMapDefinition): Set<string> {
  const needed = new Set<string>([
    ...Object.values(TILE_SLUG),
    'cypress',
    'tree-a',
    'tree-b',
    'lamp',
    'bench',
    'plant',
    ...Object.values(NODE_SPRITES),
  ]);
  for (const p of map.paths) if (p.tile !== undefined) needed.add(p.tile);
  for (const patch of map.patches ?? []) needed.add(patch.tile);
  for (const place of map.places) {
    if (place.floorTile !== undefined) needed.add(place.floorTile);
    if (place.wallTile !== undefined) needed.add(place.wallTile);
    for (const f of place.furniture ?? []) {
      needed.add(furnitureSlug(f));
      needed.add('plant');
    }
  }
  for (const r of map.resources ?? []) needed.add(NODE_SPRITES[r.kind] ?? 'plant');
  for (const entry of map.decor?.props ?? []) needed.add(entry.slug);
  for (const entry of map.decor?.flats ?? []) needed.add(entry.slug);
  return needed;
}

async function fetchManifestEntries(): Promise<Map<string, ManifestEntry>> {
  const res = await fetch('/assets/manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`素材清单加载失败(HTTP ${res.status})`);
  const parsed = AssetManifestSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('素材清单协议不合法');
  return new Map(
    parsed.data.assets.map((a) => [a.slug, { slug: a.slug, url: a.url, width: a.width, height: a.height }]),
  );
}

function loadImage(entry: ManifestEntry): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(entry.slug, img);
      imageSizes.set(entry.slug, { width: img.naturalWidth, height: img.naturalHeight });
      resolve();
    };
    img.onerror = () => resolve();
    img.src = `/assets/${entry.url}`;
  });
}

/**
 * 确保渲染该图所需素材已进缓存,返回本次是否新装了图(供调用方决定重绘)。
 * 清单失败/单图 404 均静默降级为色块/跳画,不阻塞效果视图——素材库未发布时
 * 仍能看到布局。
 */
export async function ensureTownRenderAssets(map: TileMapDefinition): Promise<boolean> {
  if (entriesBySlug === null) {
    try {
      entriesBySlug = await fetchManifestEntries();
    } catch {
      entriesBySlug = new Map();
    }
  }
  const pending: Promise<void>[] = [];
  for (const slug of neededSlugs(map)) {
    if (imageCache.has(slug)) continue;
    const entry = entriesBySlug.get(slug);
    if (entry !== undefined) pending.push(loadImage(entry));
  }
  if (pending.length === 0) return false;
  await Promise.all(pending);
  return true;
}

// ---- 绘制原语(与 terrain.ts 四原语一一对应;tile=16 基准等比缩放) ----

type Ctx = CanvasRenderingContext2D;

function drawGroundTile(ctx: Ctx, x: number, y: number, slug: string, tile: number): void {
  const img = imageCache.get(slug);
  if (img !== undefined) {
    ctx.drawImage(img, x * tile, y * tile, tile, tile);
    return;
  }
  ctx.fillStyle = '#333c57';
  ctx.fillRect(x * tile, y * tile, tile, tile);
}

function drawFlat(ctx: Ctx, x: number, y: number, slug: string, tile: number): void {
  const img = imageCache.get(slug);
  if (img !== undefined) ctx.drawImage(img, x * tile, y * tile, tile, tile);
}

/** 大型立式 prop(树/灯/长椅/家具): 底边中心锚定格底,竖高向上延伸 */
function drawPropSprite(ctx: Ctx, x: number, y: number, slug: string, tile: number): void {
  const img = imageCache.get(slug);
  if (img === undefined) return;
  const px = tile / TILE_PX;
  const { width, height } = imageSizes.get(slug) ?? { width: img.naturalWidth, height: img.naturalHeight };
  ctx.drawImage(img, x * tile + tile / 2 - (width * px) / 2, (y + 1) * tile - height * px, width * px, height * px);
}

/** 家具:占地格底边中心锚定(缺省 slug 回退盆栽,盆栽也缺则跳过) */
function drawFurniture(ctx: Ctx, f: FurnitureDefinition, tile: number): void {
  const key = furnitureSlug(f);
  const slug = imageCache.has(key) ? key : imageCache.has('plant') ? 'plant' : null;
  if (slug === null) return;
  drawPropSprite(ctx, f.x + (f.w - 1) / 2, f.y + f.h - 1, slug, tile);
}

/**
 * 效果渲染主入口(同步;先 await ensureTownRenderAssets)。层序与
 * game/terrain.ts drawTownMap 一致:地面→场所(内景/开放/公园)→围栏→
 * 装饰→资源,末尾可选网格与场所名。
 */
export function renderTownMapReal(
  ctx: Ctx,
  map: TileMapDefinition,
  opts: { tile: number; grid?: boolean; labels?: boolean },
): void {
  const { tile } = opts;
  const decor = map.decor;
  const pondRect = decor?.pond ?? POND_RECT;
  const builtinStatic = decor?.props === undefined;
  const border = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;

  ctx.clearRect(0, 0, map.width * tile, map.height * tile);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const blocked = map.blockedRects.some((r) => inRect(x, y, r));
      if (blocked && inRect(x, y, pondRect)) {
        drawGroundTile(ctx, x, y, pondFrameSlug(x, y, pondRect), tile);
        continue;
      }
      drawGroundTile(ctx, x, y, TILE_SLUG.grass, tile);
      const path = map.paths.find((r) => inRect(x, y, r));
      if (path !== undefined) drawGroundTile(ctx, x, y, path.tile ?? TILE_SLUG.path, tile);
      if (builtinStatic && inRect(x, y, PLAZA_RECT)) drawGroundTile(ctx, x, y, TILE_SLUG.plaza, tile);
      const patch = map.patches?.find((r) => inRect(x, y, r));
      if (patch !== undefined) drawGroundTile(ctx, x, y, patch.tile, tile);
      if (builtinStatic && border(x, y) && (x + y) % 2 === 0) drawPropSprite(ctx, x, y, 'cypress', tile);
    }
  }

  for (const place of map.places) {
    if (place.id === 'park') {
      drawPark(ctx, map, place, tile);
    } else if (place.door !== undefined) {
      drawInterior(ctx, place, tile);
    } else {
      drawOpenPlace(ctx, map, place, tile);
    }
  }

  for (const fence of map.fences ?? []) {
    for (let y = fence.y; y < fence.y + fence.h; y += 1) {
      for (let x = fence.x; x < fence.x + fence.w; x += 1) {
        drawGroundTile(ctx, x, y, TILE_SLUG.fence, tile);
      }
    }
  }

  for (const entry of decor?.props ?? []) drawPropSprite(ctx, entry.x, entry.y, entry.slug, tile);
  for (const entry of decor?.flats ?? []) drawFlat(ctx, entry.x, entry.y, entry.slug, tile);

  const lamps = decor?.lamps ?? [...STREET_LAMPS, ...PLAZA_LAMPS, ...PARK_LAMPS, ...FENCE_LAMPS];
  for (const [lx, ly] of lamps) drawPropSprite(ctx, lx, ly, 'lamp', tile);
  const flowerFrames = [TILE_SLUG.flowerA, TILE_SLUG.flowerB, TILE_SLUG.flowerC];
  const flowers = decor?.flowers ?? DECOR_FLOWERS;
  for (const [fx, fy] of flowers) drawFlat(ctx, fx, fy, flowerFrames[(fx + fy) % flowerFrames.length]!, tile);
  const trees = decor?.trees ?? APARTMENT_TREES;
  for (const [tx, ty] of trees) drawPropSprite(ctx, tx, ty, (tx * 3 + ty) % 2 === 0 ? 'tree-a' : 'tree-b', tile);
  if (decor !== undefined) {
    for (const [bx, by] of decor.bushes ?? []) drawGroundTile(ctx, bx, by, TILE_SLUG.bush, tile);
  }

  for (const res of map.resources ?? []) {
    const slug = NODE_SPRITES[res.kind];
    if (slug !== undefined) drawPropSprite(ctx, res.x, res.y, slug, tile);
  }

  if (opts.grid === true && tile >= 6) {
    ctx.strokeStyle = '#ffffff0d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x += 1) {
      ctx.moveTo(x * tile + 0.5, 0);
      ctx.lineTo(x * tile + 0.5, map.height * tile);
    }
    for (let y = 0; y <= map.height; y += 1) {
      ctx.moveTo(0, y * tile + 0.5);
      ctx.lineTo(map.width * tile, y * tile + 0.5);
    }
    ctx.stroke();
  }

  if (opts.labels !== false && tile >= 8) {
    ctx.font = `${Math.max(9, Math.min(12, tile))}px "SF Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#ffffff';
    for (const place of map.places) {
      if (place.w * tile < place.name.length * 9) continue;
      const cx = (place.x + place.w / 2) * tile;
      const cy = place.y * tile + 2;
      ctx.strokeText(place.name, cx, cy);
      ctx.fillText(place.name, cx, cy);
    }
  }
}

/** 建筑内景(剖切风):地板+四边墙体(门洞豁口)+门槛+家具 */
function drawInterior(ctx: Ctx, place: PlaceDefinition, tile: number): void {
  const floor = place.floorTile ?? FLOOR_OF[place.id] ?? TILE_SLUG.floorWood;
  const wall = place.wallTile ?? WALL_OF[place.id] ?? TILE_SLUG.wallCream;
  const right = place.x + place.w - 1;
  const bottom = place.y + place.h - 1;
  const isDoor = (x: number, y: number): boolean =>
    place.door !== undefined && place.door.x === x && place.door.y === y;
  for (let y = place.y + 1; y < bottom; y += 1) {
    for (let x = place.x + 1; x < right; x += 1) {
      drawGroundTile(ctx, x, y, floor, tile);
    }
  }
  for (let x = place.x; x <= right; x += 1) {
    drawGroundTile(ctx, x, place.y, isDoor(x, place.y) ? floor : wall, tile);
    drawGroundTile(ctx, x, bottom, isDoor(x, bottom) ? floor : wall, tile);
  }
  for (let y = place.y + 1; y < bottom; y += 1) {
    drawGroundTile(ctx, place.x, y, isDoor(place.x, y) ? floor : wall, tile);
    drawGroundTile(ctx, right, y, isDoor(right, y) ? floor : wall, tile);
  }
  if (place.door !== undefined) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(place.door.x * tile + 1, (place.door.y + 1) * tile - tile * 0.25, tile - 2, tile * 0.19);
  }
  for (const f of place.furniture ?? []) drawFurniture(ctx, f, tile);
}

/** 开放场所(无门):整块铺装+公园类稀疏花丛+家具 */
function drawOpenPlace(ctx: Ctx, map: TileMapDefinition, place: PlaceDefinition, tile: number): void {
  const kind = place.id.split('-')[0]!;
  fillPlace(ctx, map, place, OPEN_FLOOR_OF[kind] ?? TILE_SLUG.parkGrass, tile);
  if (kind === 'park') {
    const flowers = [TILE_SLUG.flowerA, TILE_SLUG.flowerB, TILE_SLUG.flowerC];
    for (let y = place.y; y < place.y + place.h; y += 1) {
      for (let x = place.x; x < place.x + place.w; x += 1) {
        if (inRect(x, y, map.decor?.pond ?? POND_RECT)) continue;
        if ((x * 7 + y * 5) % 13 === 0) drawFlat(ctx, x, y, flowers[(x + y) % flowers.length]!, tile);
      }
    }
  }
  for (const f of place.furniture ?? []) drawFurniture(ctx, f, tile);
}

/** 内置公园:草皮+花丛+树/灌木/长椅/园灯(固定坐标,与 terrain.ts 同源) */
function drawPark(ctx: Ctx, map: TileMapDefinition, place: PlaceDefinition, tile: number): void {
  const pondRect = map.decor?.pond ?? POND_RECT;
  fillPlace(ctx, map, place, TILE_SLUG.parkGrass, tile);
  const flowers = [TILE_SLUG.flowerA, TILE_SLUG.flowerB, TILE_SLUG.flowerC];
  for (let y = place.y; y < place.y + place.h; y += 1) {
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (inRect(x, y, pondRect)) continue;
      if ((x * 7 + y * 5) % 13 === 0) drawFlat(ctx, x, y, flowers[(x + y) % flowers.length]!, tile);
    }
  }
  for (const [tx, ty] of PARK_TREES) drawPropSprite(ctx, tx, ty, (tx + ty) % 2 === 0 ? 'tree-a' : 'tree-b', tile);
  for (const [bx, by] of PARK_BUSHES) drawGroundTile(ctx, bx, by, TILE_SLUG.bush, tile);
  for (const [bx, by] of PARK_BENCHES) drawPropSprite(ctx, bx, by, 'bench', tile);
  for (const [lx, ly] of PARK_LAMPS) drawPropSprite(ctx, lx, ly, 'lamp', tile);
}

/** 可行走场所整块铺装;障碍格(池塘)跳过保留水岸 */
function fillPlace(
  ctx: Ctx,
  map: TileMapDefinition,
  place: PlaceDefinition,
  slug: string,
  tile: number,
): void {
  for (let y = place.y; y < place.y + place.h; y += 1) {
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (map.blockedRects.some((r) => inRect(x, y, r))) continue;
      drawGroundTile(ctx, x, y, slug, tile);
    }
  }
}

