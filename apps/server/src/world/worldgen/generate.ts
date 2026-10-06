import {
  TOWN_MAP,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZE_GRIDS,
  type GameType,
  type PlaceDefinition,
  type ResourceNodeSeed,
  type TileMapDefinition,
  type WorldgenParams,
  type WorldgenReport,
} from '@sims/shared';
import type { ActivityId, BlockedRect } from '@sims/shared';
import { TileMap } from '../map.js';
import {
  FLOOR_TILE_POOL,
  GROWTH_QUOTA,
  PLACE_BLUEPRINTS,
  WALL_TILE_POOL,
  type FurnitureSlot,
  type PlaceKind,
  type Zone,
} from './blueprint.js';
import { Rng } from './prng.js';

/** 内置固定地图种子(design/06:固定地图=生成器特例,兼容已有存档) */
export const BUILTIN_SEED = '__builtin__';

export interface WorldgenInput {
  seed: string;
  gameType: GameType;
  params: WorldgenParams;
  /** 素材清单版本(manifest version;参与种子派生,素材变更即世界不同) */
  manifestVersion: string;
  /** kind → 可选素材 slug 池(素材库随机选材;缺省 sprite 省略=kind 同名纹理) */
  assetsByKind?: Readonly<Record<string, readonly string[]>>;
}

export interface WorldgenResult {
  map: TileMapDefinition;
  report: WorldgenReport;
}

const cellKey = (x: number, y: number): string => `${x},${y}`;

function mark0(occupied: Set<string>, rect: BlockedRect): void {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) occupied.add(cellKey(x, y));
  }
}

/**
 * 种子驱动整图生成(design/06 管线):骨架(主街/支路)→ 分区行排场所 →
 * 建筑门/入口/门前路 → 室内(地板墙色+家具布局模板) → 户外装饰 →
 * 校验(TileMap 构造即校验+锚点齐备+全局连通)。纯函数:同输入必同输出。
 */
export function generateTownMap(input: WorldgenInput): WorldgenResult {
  if (input.seed === BUILTIN_SEED) {
    return {
      map: TOWN_MAP,
      report: {
        seed: input.seed,
        gameType: input.gameType,
        params: input.params,
        manifestVersion: input.manifestVersion,
        places: TOWN_MAP.places.map((p) => ({ id: p.id, name: p.name, w: p.w, h: p.h })),
        checks: { connectivity: true, anchorsComplete: true, fallback: true },
      },
    };
  }
  if (input.gameType === 'survival') {
    // 占位:生存规则随 M-S 落地,当前按 growth 生成(design/06 §4)
  }
  // 偶发布局可能围死使用格:确定性整图重试(attempt 入种子派生,保持纯函数);
  // 连续失败才兜底回内置固定地图(世界可用性优先)
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return generate(input, attempt);
    } catch {
      // 换下一轮重试
    }
  }
  return {
    map: TOWN_MAP,
    report: {
      seed: input.seed,
      gameType: input.gameType,
      params: input.params,
      manifestVersion: input.manifestVersion,
      places: TOWN_MAP.places.map((p) => ({ id: p.id, name: p.name, w: p.w, h: p.h })),
      checks: { connectivity: true, anchorsComplete: true, fallback: true },
    },
  };
}

function generate(input: WorldgenInput, attempt: number): WorldgenResult {
  const { width, height } = WORLDGEN_SIZE_GRIDS[input.params.size];
  const rng = new Rng(
    `${input.seed}|${input.gameType}|${input.params.size}|${input.params.density}|${input.manifestVersion}#${attempt}`,
  );
  const densityIndex = WORLDGEN_DENSITIES.indexOf(input.params.density);
  const paths: BlockedRect[] = [];
  const blockedRects: BlockedRect[] = [];
  const places: PlaceDefinition[] = [];
  const fences: BlockedRect[] = [];

  // ① 骨架:十字主街(宽 2,居中) + 密度支路
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  paths.push({ x: 2, y: midY, w: width - 4, h: 2 });
  paths.push({ x: midX, y: 2, w: 2, h: height - 4 });
  const branchCount = densityIndex; // sparse=0 / normal=2 / dense=4
  for (let i = 0; i < branchCount; i += 1) {
    if (i % 2 === 0) {
      const bx = rng.int(8, width - 10);
      if (Math.abs(bx - midX) < 6) continue;
      paths.push({ x: bx, y: 2, w: 2, h: height - 4 });
    } else {
      const by = rng.int(6, height - 8);
      if (Math.abs(by - midY) < 5) continue;
      paths.push({ x: 2, y: by, w: width - 4, h: 2 });
    }
  }

  // ② 分区行排场所:四象限(主街分割),每分区内场所按行排布
  const zones: Record<Zone, { x: number; y: number; w: number; h: number }> = {
    nw: { x: 2, y: 2, w: midX - 4, h: midY - 4 },
    ne: { x: midX + 2, y: 2, w: width - midX - 4, h: midY - 4 },
    sw: { x: 2, y: midY + 2, w: midX - 4, h: height - midY - 4 },
    se: { x: midX + 2, y: midY + 2, w: width - midX - 4, h: height - midY - 4 },
  };
  const counters = new Map<PlaceKind, number>();
  // 分区级共享行排游标:同分区多 quota 场所依次接排,杜绝互相重叠
  const cursors = {
    nw: { x: zones.nw.x, y: zones.nw.y, rowHeight: 0 },
    ne: { x: zones.ne.x, y: zones.ne.y, rowHeight: 0 },
    sw: { x: zones.sw.x, y: zones.sw.y, rowHeight: 0 },
    se: { x: zones.se.x, y: zones.se.y, rowHeight: 0 },
  };
  let pond: BlockedRect | null = null;
  for (const quota of GROWTH_QUOTA) {
    const count = densityIndex === 0 ? quota.count[0] : rng.int(quota.count[0], quota.count[1]);
    const zone = zones[quota.zone];
    const cursor = cursors[quota.zone];
    for (let n = 0; n < count; n += 1) {
      const [w, h] = rng.pick(PLACE_BLUEPRINTS[quota.kind].size);
      if (cursor.x + w > zone.x + zone.w) {
        cursor.x = zone.x;
        cursor.y += cursor.rowHeight + 2;
        cursor.rowHeight = 0;
      }
      if (cursor.y + h > zone.y + zone.h) break;
      const seq = (counters.get(quota.kind) ?? 0) + 1;
      counters.set(quota.kind, seq);
      const id = `${quota.kind}-${String.fromCharCode(96 + seq)}`;
      if (quota.kind === 'park') pond = parkPond(rng, cursor.x, cursor.y, w, h);
      const place = buildPlace(rng, quota.kind, id, cursor.x, cursor.y, w, h, pond, input.assetsByKind);
      places.push(place);
      if (quota.kind === 'park') fences.push(...parkFences(place));
      cursor.x += w + 2;
      cursor.rowHeight = Math.max(cursor.rowHeight, h);
    }
  }
  if (pond !== null) blockedRects.push(pond);

  // ③ 门前小路:entrance 竖向连到最近道路 y
  const roadRows = paths.filter((p) => p.h <= 2).map((p) => p.y);
  for (const place of places) {
    if (place.door === undefined) continue;
    const roadY = nearestRoadRow(roadRows, place.entrance.y);
    const from = Math.min(roadY, place.entrance.y);
    const to = Math.max(roadY, place.entrance.y);
    if (to > from) paths.push({ x: place.entrance.x, y: from, w: 1, h: to - from + 1 });
  }

  // ④ 户外装饰
  const decor = buildDecor(rng, width, height, places, paths, pond);

  // ④.5 资源节点撒点(M-G.6):公园浆果丛/街道拾荒堆,占格不可行走站四邻作业
  const resources = scatterResources(rng, width, height, places, paths, fences, pond);

  const map: TileMapDefinition = { width, height, blockedRects, paths, places, decor, fences, resources };
  // ⑤ 校验:TileMap 构造即校验(入口/门洞/家具/室内连通);再验锚点与全局连通
  const tileMap = TileMap.fromDefinition(map);
  const anchorsComplete = checkAnchors(places);
  const connectivity = checkConnectivity(tileMap, midX, midY);
  if (!anchorsComplete || !connectivity) {
    throw new Error(anchorsComplete ? '入口连通性校验失败' : '活动锚点校验失败');
  }
  return {
    map,
    report: {
      seed: input.seed,
      gameType: input.gameType,
      params: input.params,
      manifestVersion: input.manifestVersion,
      places: places.map((p) => ({ id: p.id, name: p.name, w: p.w, h: p.h })),
      checks: { connectivity, anchorsComplete, fallback: false },
    },
  };
}

/** 公园水系:先定池塘(家具/花木布局避开) */
function parkPond(rng: Rng, x: number, y: number, w: number, h: number): BlockedRect {
  const pondW = rng.int(3, 4);
  const pondH = rng.int(3, 4);
  return { x: x + 1, y: rng.int(y + 2, Math.max(y + 2, y + h - pondH - 1)), w: pondW, h: pondH };
}

/** 公园北缘栅栏段(M-G.5 数据化):沿场所北缘两段,入口列留豁口(开放场所入口在上缘 x+1) */
function parkFences(place: PlaceDefinition): BlockedRect[] {
  const gap = place.entrance.x;
  const westW = gap - place.x;
  const eastW = place.x + place.w - (gap + 1);
  return [
    ...(westW > 0 ? [{ x: place.x, y: place.y, w: westW, h: 1 }] : []),
    ...(eastW > 0 ? [{ x: gap + 1, y: place.y, w: eastW, h: 1 }] : []),
  ];
}

/** 槽位素材池解析:主题道具池(theme/{slug}@{maxTiles})或域分键 kind 池({domain}/{kind}) */
function slotPool(
  slot: FurnitureSlot,
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
): readonly string[] {
  if (slot.themePick !== undefined) {
    const max = slot.themePick.maxTiles ?? 4;
    return assetsByKind?.[`theme/${slot.themePick.theme}@${max}`] ?? [];
  }
  return assetsByKind?.[`${slot.domain ?? 'indoor'}/${slot.kind}`] ?? [];
}

type SlotWithPool = FurnitureSlot & { pool: readonly string[] };

/** 槽位解析:themePick 池空的装饰槽剔除(kind 仅作标签无同名纹理,发出必渲染缺纹理) */
function resolvedSlots(
  source: readonly FurnitureSlot[],
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
): SlotWithPool[] {
  return source
    .filter((slot) => slot.themePick === undefined || slotPool(slot, assetsByKind).length > 0)
    .map((slot) => ({ ...slot, pool: slotPool(slot, assetsByKind) }));
}

/** 场所构建:门居南墙中点,入口在门外;室内地板/墙色随机;家具按模板布局。
 * 开放场所(公园类)无门无墙,入口在上缘。 */
function buildPlace(
  rng: Rng,
  kind: PlaceKind,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  pond: BlockedRect | null,
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
): PlaceDefinition {
  const blueprint = PLACE_BLUEPRINTS[kind];
  if (blueprint.open === true) {
    const slots = resolvedSlots(blueprint.furniture, assetsByKind);
    const furniture = layoutFurniture(rng, x, y, w, h, slots, true, pond);
    return {
      id,
      name: blueprint.name,
      x, y, w, h,
      entrance: { x: x + 1, y: y - 1 },
      furniture,
    };
  }
  const doorX = x + Math.floor(w / 2);
  // 单场所最多重摇 3 次:门→全部使用格 BFS 可达才收(防 use 格被围死);
  // 末轮剔除装饰类(chance 标记)只保核心锚点家具,确保必可达
  let furniture: PlaceDefinition['furniture'] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const source =
      attempt < 2
        ? blueprint.furniture
        : blueprint.furniture.filter((slot) => slot.chance === undefined);
    const slots = resolvedSlots(source, assetsByKind);
    furniture = layoutFurniture(rng, x, y, w, h, slots, false, null);
    if (interiorReachable(x, y, w, h, doorX, furniture)) break;
  }
  return {
    id,
    name: blueprint.name,
    x, y, w, h,
    entrance: { x: doorX, y: y + h },
    door: { x: doorX, y: y + h - 1 },
    furniture,
    floorTile: rng.pick(FLOOR_TILE_POOL),
    wallTile: rng.pick(WALL_TILE_POOL),
  };
}

/** 门 → 全部使用格 局部 BFS(use 格被四面围死即 false) */
function interiorReachable(
  px: number,
  py: number,
  pw: number,
  ph: number,
  doorX: number,
  furniture: PlaceDefinition['furniture'],
): boolean {
  const blocked = new Set<string>();
  for (const f of furniture ?? []) mark0(blocked, { x: f.x, y: f.y, w: f.w, h: f.h });
  const uses = (furniture ?? []).filter((f) => f.use !== undefined).map((f) => f.use!);
  if (uses.length === 0) return true;
  const entry = { x: doorX, y: py + ph - 2 }; // 门内第一格
  if (blocked.has(cellKey(entry.x, entry.y))) return false;
  const seen = new Set<string>([cellKey(entry.x, entry.y)]);
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = cellKey(nx, ny);
      if (nx <= px || nx >= px + pw - 1 || ny <= py || ny >= py + ph - 1) continue;
      if (seen.has(key) || blocked.has(key)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return uses.every((use) => seen.has(cellKey(use.x, use.y)));
}

/** 家具布局器:按锚定语义(北墙/西墙/东墙/居中/南缘)行主序找空位,冲突跳过;
 * 槽位带池时落位即随机选材(sprite) */
function layoutFurniture(
  rng: Rng,
  px: number,
  py: number,
  pw: number,
  ph: number,
  slots: readonly SlotWithPool[],
  outdoor: boolean,
  pond: BlockedRect | null,
): NonNullable<PlaceDefinition['furniture']> {
  // 占用网格:有墙场所=室内圈(px+1..px+pw-2);公园=整个场所(留边界)
  const minX = outdoor ? px + 1 : px + 1;
  const maxX = outdoor ? px + pw - 2 : px + pw - 2;
  const minY = outdoor ? py + 1 : py + 1;
  const maxY = outdoor ? py + ph - 2 : py + ph - 2;
  const occupied = new Set<string>();
  if (pond !== null) mark0(occupied, pond);
  const mark = (x: number, y: number, w: number, h: number): void => {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) occupied.add(cellKey(xx, yy));
    }
  };
  const free = (x: number, y: number, w: number, h: number): boolean => {
    if (x < minX || y < minY || x + w > maxX + 1 || y + h > maxY + 1) return false;
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        if (occupied.has(cellKey(xx, yy))) return false;
      }
    }
    return true;
  };
  const furniture: NonNullable<PlaceDefinition['furniture']> = [];
  /** 已定 use 格(守卫:任何新家具不得使其四邻全堵) */
  const uses: Array<{ x: number; y: number }> = [];
  /** 门内格(南锚家具不得覆盖,保门畅通) */
  const doorCell = outdoor ? null : { x: px + Math.floor(pw / 2), y: py + ph - 2 };
  /** 模拟放置后仍满足:每个 use 至少留一个空邻(放置后口径) + 门内格不被占 */
  const guardOk = (x: number, y: number, w: number, h: number): boolean => {
    if (doorCell !== null && x <= doorCell.x && doorCell.x < x + w && y <= doorCell.y && doorCell.y < y + h) {
      return false;
    }
    const touched = new Set<string>();
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) touched.add(cellKey(xx, yy));
    }
    return uses.every((use) => !neighborsBlockedBy(use, touched));
  };
  const neighborsBlockedBy = (use: { x: number; y: number }, newlyBlocked: Set<string>): boolean => {
    let still = 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const k = cellKey(use.x + dx, use.y + dy);
      if (!occupied.has(k) && !newlyBlocked.has(k)) still += 1;
    }
    return still === 0;
  };
  const tryPlace = (x: number, y: number, w: number, h: number): boolean =>
    free(x, y, w, h) && guardOk(x, y, w, h);

  for (const slot of slots) {
    if (slot.chance !== undefined && !rng.chance(slot.chance)) continue;
    let placed: { x: number; y: number } | null = null;
    if (slot.anchor === 'north') {
      for (let xx = minX; xx + slot.w <= maxX + 1 && placed === null; xx += 1) {
        if (tryPlace(xx, minY, slot.w, slot.h)) placed = { x: xx, y: minY };
      }
    } else if (slot.anchor === 'south') {
      const sy = maxY - slot.h + 1;
      for (let xx = minX; xx + slot.w <= maxX + 1 && placed === null; xx += 1) {
        if (tryPlace(xx, sy, slot.w, slot.h)) placed = { x: xx, y: sy };
      }
    } else if (slot.anchor === 'west') {
      for (let yy = minY; yy + slot.h <= maxY + 1 && placed === null; yy += 1) {
        if (tryPlace(minX, yy, slot.w, slot.h)) placed = { x: minX, y: yy };
      }
    } else if (slot.anchor === 'east') {
      const ex = maxX - slot.w + 1;
      for (let yy = minY; yy + slot.h <= maxY + 1 && placed === null; yy += 1) {
        if (tryPlace(ex, yy, slot.w, slot.h)) placed = { x: ex, y: yy };
      }
    } else {
      for (let yy = minY; yy + slot.h <= maxY + 1 && placed === null; yy += 1) {
        for (let xx = minX; xx + slot.w <= maxX + 1 && placed === null; xx += 1) {
          if (tryPlace(xx, yy, slot.w, slot.h)) placed = { x: xx, y: yy };
        }
      }
    }
    if (placed === null) continue;
    mark(placed.x, placed.y, slot.w, slot.h);
    // 素材库随机选材:池非空即挑具体 sprite(缺省回退 kind 同名纹理)
    const sprite = slot.pool.length > 0 ? rng.pick([...slot.pool]) : undefined;
    if (slot.activityId !== undefined) {
      const use = deriveUse(placed.x, placed.y, slot.w, slot.h, minX, maxX, minY, maxY, occupied);
      if (use === null) continue; // 无合法使用格(过度拥挤),放弃该件
      occupied.add(cellKey(use.x, use.y)); // use 格反占,防后续家具覆盖
      uses.push(use);
      furniture.push({
        kind: slot.kind,
        x: placed.x,
        y: placed.y,
        w: slot.w,
        h: slot.h,
        activityId: slot.activityId,
        use,
        ...(sprite !== undefined ? { sprite } : {}),
      });
    } else {
      furniture.push({
        kind: slot.kind,
        x: placed.x,
        y: placed.y,
        w: slot.w,
        h: slot.h,
        ...(sprite !== undefined ? { sprite } : {}),
      });
    }
  }
  return furniture;
}

/** use 格推导:家具四邻(下/右/左/上)首个界内且未被家具占用格 */
function deriveUse(
  x: number,
  y: number,
  w: number,
  h: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  occupied: Set<string>,
): { x: number; y: number } | null {
  const candidates = [
    { x: x + Math.floor(w / 2), y: y + h },
    { x: x + w, y: y + Math.floor(h / 2) },
    { x: x - 1, y: y + Math.floor(h / 2) },
    { x: x + Math.floor(w / 2), y: y - 1 },
  ];
  for (const c of candidates) {
    if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY && !occupied.has(cellKey(c.x, c.y))) {
      return c;
    }
  }
  return null;
}

/** 户外装饰:树沿主街/支路,灯在门前路口,公园花木+池塘 */
function buildDecor(
  rng: Rng,
  width: number,
  height: number,
  places: PlaceDefinition[],
  paths: BlockedRect[],
  pond: BlockedRect | null,
): TileMapDefinition['decor'] {
  const trees: Array<[number, number]> = [];
  const lamps: Array<[number, number]> = [];
  const flowers: Array<[number, number]> = [];
  const bushes: Array<[number, number]> = [];
  const placeRects = places.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  const inAnyPlace = (x: number, y: number): boolean =>
    placeRects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

  // 树:道路两侧稀疏撒点
  for (const road of paths) {
    if (road.w > road.h) continue; // 竖向路才植树
    for (let y = 4; y < height - 3; y += rng.int(5, 8)) {
      for (const side of [road.x - 2, road.x + road.w + 1]) {
        if (side > 1 && side < width - 2 && !inAnyPlace(side, y) && rng.chance(0.5)) {
          trees.push([side, y]);
        }
      }
    }
  }
  // 灯:每个有门场所门前
  for (const place of places) {
    if (place.door === undefined) continue;
    const lx = place.entrance.x + 1;
    if (!inAnyPlace(lx, place.entrance.y)) lamps.push([lx, place.entrance.y]);
  }
  // 公园花木撒点(避开池塘)
  for (const place of places) {
    if (!place.id.startsWith('park')) continue;
    for (let n = 0; n < 12; n += 1) {
      const fx = rng.int(place.x + 1, place.x + place.w - 2);
      const fy = rng.int(place.y + 1, place.y + place.h - 2);
      if (pond !== null && fx >= pond.x - 1 && fx < pond.x + pond.w + 1 && fy >= pond.y - 1 && fy < pond.y + pond.h + 1) continue;
      (rng.chance(0.6) ? flowers : bushes).push([fx, fy]);
    }
  }
  return { trees, lamps, flowers, bushes, ...(pond !== null ? { pond } : {}) };
}

function nearestRoadRow(roadRows: number[], y: number): number {
  return roadRows.reduce((best, row) => (Math.abs(row - y) < Math.abs(best - y) ? row : best), roadRows[0] ?? 0);
}

/**
 * 资源节点撒点(M-G.6):浆果丛 3~6 落公园空地(避池塘/家具/使用格三邻域),
 * 拾荒堆 2~4 落街道空地(避场所缓冲带/道路/围栏);占格不可行走,重摇尽力放置。
 */
function scatterResources(
  rng: Rng,
  width: number,
  height: number,
  places: PlaceDefinition[],
  paths: BlockedRect[],
  fences: BlockedRect[],
  pond: BlockedRect | null,
): ResourceNodeSeed[] {
  const parkBlocked = new Set<string>();
  for (const path of paths) mark0(parkBlocked, path); // 浆果丛不落路面
  for (const fence of fences) mark0(parkBlocked, fence); // 公园北缘围栏段
  if (pond !== null) {
    mark0(parkBlocked, { x: pond.x - 1, y: pond.y - 1, w: pond.w + 2, h: pond.h + 2 });
  }
  const streetBlocked = new Set<string>();
  for (const path of paths) mark0(streetBlocked, path); // 拾荒堆不上路面
  if (pond !== null) mark0(streetBlocked, pond);
  const parks = places.filter((p) => p.id.startsWith('park'));
  for (const park of parks) {
    for (const fence of fences) mark0(parkBlocked, fence);
    for (const f of park.furniture ?? []) {
      mark0(parkBlocked, { x: f.x, y: f.y, w: f.w, h: f.h });
      if (f.use !== undefined) {
        mark0(parkBlocked, { x: f.use.x - 1, y: f.use.y - 1, w: 3, h: 3 }); // 使用格保持四邻可站
      }
    }
    mark0(parkBlocked, { x: park.entrance.x - 1, y: park.entrance.y - 1, w: 3, h: 2 });
    // 街道侧:场所占格 ±1 缓冲,拾荒堆不贴墙堵门口
    mark0(streetBlocked, { x: park.x - 1, y: park.y - 1, w: park.w + 2, h: park.h + 2 });
  }
  for (const place of places) {
    if (place.id.startsWith('park')) continue;
    mark0(streetBlocked, { x: place.x - 1, y: place.y - 1, w: place.w + 2, h: place.h + 2 });
  }
  const taken = new Set<string>();
  const seeds: ResourceNodeSeed[] = [];
  const berryCount = rng.int(3, 6);
  for (let n = 0; n < berryCount && parks.length > 0; n += 1) {
    const park = rng.pick(parks);
    for (let tries = 0; tries < 20; tries += 1) {
      const x = rng.int(park.x + 1, park.x + park.w - 2);
      const y = rng.int(park.y + 1, park.y + park.h - 2);
      const key = cellKey(x, y);
      if (parkBlocked.has(key) || taken.has(key)) continue;
      taken.add(key);
      seeds.push({ kind: 'berry_bush', x, y });
      break;
    }
  }
  const junkCount = rng.int(2, 4);
  for (let n = 0; n < junkCount; n += 1) {
    for (let tries = 0; tries < 30; tries += 1) {
      const x = rng.int(2, width - 3);
      const y = rng.int(2, height - 3);
      const key = cellKey(x, y);
      if (streetBlocked.has(key) || taken.has(key)) continue;
      taken.add(key);
      seeds.push({ kind: 'junk_pile', x, y });
      break;
    }
  }
  return seeds;
}

/** 各场所必需活动锚点齐备校验 */
function checkAnchors(places: PlaceDefinition[]): boolean {
  for (const place of places) {
    const kind = place.id.split('-')[0] as PlaceKind;
    const required = PLACE_BLUEPRINTS[kind]?.requiredAnchors ?? [];
    const provided = new Set<ActivityId>((place.furniture ?? []).filter((f) => f.activityId !== undefined).map((f) => f.activityId as ActivityId));
    if (!required.every((a) => provided.has(a))) return false;
  }
  return true;
}

/** 全局连通:所有入口自主干道中心 BFS 可达 */
function checkConnectivity(tileMap: TileMap, midX: number, midY: number): boolean {
  const start = { x: midX, y: midY };
  if (!tileMap.isWalkable(start.x, start.y)) return false;
  const seen = new Set<string>([cellKey(start.x, start.y)]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = cellKey(nx, ny);
      if (seen.has(key) || !tileMap.isWalkable(nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return tileMap.places.every((place) => seen.has(cellKey(place.entrance.x, place.entrance.y)));
}
