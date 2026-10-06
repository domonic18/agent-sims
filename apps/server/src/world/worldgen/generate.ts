import {
  TOWN_MAP,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZE_GRIDS,
  type DecorEntry,
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
  DECOR_POOLS,
  FLOOR_TILE_POOL,
  GROWTH_QUOTA,
  PLACE_BLUEPRINTS,
  SURVIVAL_QUOTA,
  WALL_TILE_POOL,
  type FurnitureSlot,
  type PlaceKind,
  type Zone,
} from './blueprint.js';
import { Rng } from './prng.js';

/** 内置固定地图种子(design/06:固定地图=生成器特例,兼容已有存档) */
export const BUILTIN_SEED = '__builtin__';

/** 资源节点撒点数量档(TD-1 自 scatterResources 字面量具名,design/09 §2):
 * 浆果丛易枯竭(重生次日)、拾荒堆无限,数量太少则以物代薪无目标可接 */
const BERRY_BUSH_COUNT: readonly [number, number] = [3, 6];
const JUNK_PILE_COUNT: readonly [number, number] = [2, 4];
/** 末日生存档:资源采集区加密(废土拾荒) */
const SURVIVAL_BERRY_BUSH_COUNT: readonly [number, number] = [4, 8];
const SURVIVAL_JUNK_PILE_COUNT: readonly [number, number] = [5, 9];

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
  // 偶发布局可能围死使用格:确定性整图重试(attempt 入种子派生,保持纯函数);
  // 连续失败才兜底回内置固定地图(世界可用性优先)
  for (let attempt = 1; attempt <= 8; attempt += 1) {
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
  const blockedRects: BlockedRect[] = [];
  const places: PlaceDefinition[] = [];
  const fences: BlockedRect[] = [];

  // ① 骨架:蜿蜒路网——中心广场随机偏移,四方向随机游走延伸(段长 3~6,30% 折弯),
  // 密度短枝路自已铺路段引出;只进 paths(纯视觉+撒放预留),不阻塞通行
  const { rects: paths, plaza } = buildRoadNetwork(rng, width, height, densityIndex);
  const patches: NonNullable<TileMapDefinition['patches']> = [{ ...plaza, tile: PLAZA_TILE }];
  const midX = plaza.x + Math.floor(plaza.w / 2);
  const midY = plaza.y + Math.floor(plaza.h / 2);

  // ② 场所随机撒放:四象限为偏好区(主街分割),核心场所必得、可选场所放不下即裁;
  // 占用网格含 ±1 缓冲(场所间不贴脸、不压路、不越界),撒放顺序即配额顺序
  const zones: Record<Zone, { x: number; y: number; w: number; h: number }> = {
    nw: { x: 2, y: 2, w: midX - 4, h: midY - 4 },
    ne: { x: midX + 2, y: 2, w: width - midX - 4, h: midY - 4 },
    sw: { x: 2, y: midY + 2, w: midX - 4, h: height - midY - 4 },
    se: { x: midX + 2, y: midY + 2, w: width - midX - 4, h: height - midY - 4 },
  };
  const occupied = new Set<string>();
  /** 核心占用(无缓冲):兜底扫描只查矩形本身不重叠 */
  const occupiedCore = new Set<string>();
  /** 已放场所入口格:双级占用均不含他人入口,后放矩形须单查不得覆盖 */
  const entrances = new Set<string>();
  /** 预留矩形外扩一圈缓冲(场所间自然留缝) */
  const reserve = (rect: BlockedRect): void => {
    mark0(occupied, { x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 });
    mark0(occupiedCore, rect);
  };
  for (const path of paths) reserve(path);
  const counters = new Map<PlaceKind, number>();
  let pond: BlockedRect | null = null;
  // survival 模式换末日配额(场所末日化重配),growth 保持原配额
  const QUOTA = input.gameType === 'survival' ? SURVIVAL_QUOTA : GROWTH_QUOTA;
  for (const quota of QUOTA) {
    const count = densityIndex === 0 ? quota.count[0] : rng.int(quota.count[0], quota.count[1]);
    const zone = zones[quota.zone];
    for (let n = 0; n < count; n += 1) {
      const [w, h] = rng.pick(PLACE_BLUEPRINTS[quota.kind].size);
      const spot = tryScatterPlace(
        rng, zone, width, height, w, h, occupied, occupiedCore, entrances, quota.essential,
      );
      if (spot === null) break;
      const seq = (counters.get(quota.kind) ?? 0) + 1;
      counters.set(quota.kind, seq);
      const id = `${quota.kind}-${String.fromCharCode(96 + seq)}`;
      if (quota.kind === 'park') {
        pond = parkPond(rng, spot.x, spot.y, w, h);
        blockedRects.push(pond);
        reserve(pond);
      }
      const place = buildPlace(rng, quota.kind, id, spot.x, spot.y, w, h, pond, input.assetsByKind);
      places.push(place);
      if (quota.kind === 'park' || quota.kind === 'graveyard') {
        const fenceRects = quota.kind === 'park' ? parkFences(place) : graveyardFences(place);
        fences.push(...fenceRects);
        for (const fence of fenceRects) reserve(fence); // 后放场所不压栅栏
      }
      entrances.add(cellKey(place.entrance.x, place.entrance.y));
      reserve(place);
    }
  }

  // ③ 门前小路:入口至最近道路格 L 形连接(两段 1 宽矩形,只进 paths;先横先竖随机)
  for (const place of places) {
    if (place.door === undefined) continue;
    const target = nearestRoadCell(paths, place.entrance);
    if (target === null) continue;
    const dy = Math.abs(target.y - place.entrance.y);
    const dx = Math.abs(target.x - place.entrance.x);
    const verticalLeg = { x: place.entrance.x, y: Math.min(place.entrance.y, target.y), w: 1, h: dy + 1 };
    const horizontalLeg = { x: Math.min(place.entrance.x, target.x), y: target.y, w: dx + 1, h: 1 };
    const verticalFirst = rng.chance(0.5);
    const legs = verticalFirst ? [verticalLeg, horizontalLeg] : [horizontalLeg, verticalLeg];
    for (const leg of legs) {
      if (Math.max(leg.w, leg.h) > 1) paths.push(leg); // 同行/同列的零长腿跳过
    }
  }

  // ④ 资源节点撒点(M-G.6):公园浆果丛/街道拾荒堆,占格不可行走站四邻作业
  const resources = scatterResources(rng, input.gameType, width, height, places, paths, fences, pond);

  // ⑤ 户外装饰(池驱动五 pass):decor 避让资源与全部既有占用
  const decor = buildDecor(
    rng, width, height, densityIndex, input.gameType,
    places, paths, plaza, pond, fences, resources, input.assetsByKind,
  );

  const map: TileMapDefinition = {
    width,
    height,
    blockedRects,
    paths,
    places,
    decor,
    fences,
    resources,
    patches,
  };
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

/**
 * 随机撒放坐标:偏好象限试 20 次 → 全图再试 60 次 → 核心场所无缓冲确定性扫描(必得);
 * 可选场所两轮皆败即裁(锦上添花型,空间不足自然消失)。随机轮查缓冲占用
 * (场所间留缝/不贴路),兜底轮只查核心占用(矩形本身不重叠)——支路把象限切成
 * 窄条时核心场所允许贴路而立,不再触发整图重试。
 */
function tryScatterPlace(
  rng: Rng,
  zone: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  w: number,
  h: number,
  occupied: Set<string>,
  occupiedCore: Set<string>,
  entrances: Set<string>,
  essential: boolean,
): { x: number; y: number } | null {
  // y 界保持 2/height-2:入口格在 y-1 或 y+h 行,须落在可行走带内(0/末行为边界墙)
  const inBounds = (x: number, y: number): boolean =>
    x >= 1 && y >= 2 && x + w <= width - 1 && y + h <= height - 2;
  /** 入口/门前格自由:有门场所入口在 (中列, y+h),开放场所入口在 (x+1, y-1) */
  const entranceFree = (x: number, y: number, grid: Set<string>): boolean =>
    !grid.has(cellKey(x + Math.floor(w / 2), y + h)) && !grid.has(cellKey(x + 1, y - 1));
  /** 新矩形不得覆盖任何已放场所入口格(先放者的入口不在占用网格里) */
  const coversEntrance = (x: number, y: number): boolean => {
    for (const key of entrances) {
      const comma = key.indexOf(',');
      const ex = Number(key.slice(0, comma));
      const ey = Number(key.slice(comma + 1));
      if (ex >= x && ex < x + w && ey >= y && ey < y + h) return true;
    }
    return false;
  };
  const fits = (x: number, y: number, grid: Set<string>): boolean => {
    if (!inBounds(x, y)) return false;
    if (coversEntrance(x, y)) return false;
    const pad = grid === occupiedCore ? 0 : 1;
    for (let yy = y - pad; yy <= y + h - 1 + pad; yy += 1) {
      for (let xx = x - pad; xx <= x + w - 1 + pad; xx += 1) {
        if (grid.has(cellKey(xx, yy))) return false;
      }
    }
    return entranceFree(x, y, grid);
  };
  const randSpot = (zx: number, zy: number, zw: number, zh: number): { x: number; y: number } | null => {
    const x0 = Math.max(zx, 1);
    const y0 = Math.max(zy, 2);
    const x1 = Math.min(zx + zw - w, width - 1 - w);
    const y1 = Math.min(zy + zh - h, height - 2 - h);
    if (x1 < x0 || y1 < y0) return null;
    return { x: rng.int(x0, x1), y: rng.int(y0, y1) };
  };
  for (let i = 0; i < 20; i += 1) {
    const spot = randSpot(zone.x, zone.y, zone.w, zone.h);
    if (spot !== null && fits(spot.x, spot.y, occupied)) return spot;
  }
  for (let i = 0; i < 60; i += 1) {
    const spot = randSpot(1, 2, width - 2, height - 4);
    if (spot !== null && fits(spot.x, spot.y, occupied)) return spot;
  }
  // 可选场所也兜底一次无缓冲扫描(紧凑贴靠优于整段缺席);扫无可选即裁,核心必得
  for (let y = 2; y + h <= height - 2; y += 1) {
    for (let x = 1; x + w <= width - 1; x += 1) {
      if (fits(x, y, occupiedCore)) return { x, y };
    }
  }
  if (!essential) return null;
  throw new Error('撒放空间不足');
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

/** 墓地四边围栏(survival):每边中央 3 格豁口,北缝盖住入口列(entrance 天然连通);
 * 竖向围栏让出四角(角格归横向边),四向开口+确定性豁口免围死,connectivity 校验兜底 */
function graveyardFences(place: PlaceDefinition): BlockedRect[] {
  const rects: BlockedRect[] = [];
  const pushH = (y: number, x0: number, x1: number): void => {
    if (x1 >= x0) rects.push({ x: x0, y, w: x1 - x0 + 1, h: 1 });
  };
  const pushV = (x: number, y0: number, y1: number): void => {
    if (y1 >= y0) rects.push({ x, y: y0, w: 1, h: y1 - y0 + 1 });
  };
  const gapX = place.entrance.x - 1; // 北缝 [gapX, gapX+2] 盖入口
  pushH(place.y, place.x, gapX - 1);
  pushH(place.y, gapX + 3, place.x + place.w - 1);
  const midX = place.x + Math.floor(place.w / 2) - 1;
  pushH(place.y + place.h - 1, place.x, midX - 1);
  pushH(place.y + place.h - 1, midX + 3, place.x + place.w - 1);
  const midY = place.y + Math.floor(place.h / 2) - 1;
  pushV(place.x, place.y + 1, midY - 1);
  pushV(place.x, midY + 3, place.y + place.h - 2);
  pushV(place.x + place.w - 1, place.y + 1, midY - 1);
  pushV(place.x + place.w - 1, midY + 3, place.y + place.h - 2);
  return rects;
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
    } else if (slot.anchor === 'scatter') {
      // 全场散撒(开放装饰场所):从全部可放位 rng 随机取一,道具自然分布不成排
      const candidates: Array<{ x: number; y: number }> = [];
      for (let yy = minY; yy + slot.h <= maxY + 1; yy += 1) {
        for (let xx = minX; xx + slot.w <= maxX + 1; xx += 1) {
          if (tryPlace(xx, yy, slot.w, slot.h)) candidates.push({ x: xx, y: yy });
        }
      }
      if (candidates.length > 0) placed = rng.pick(candidates);
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

/**
 * 户外装饰引擎(池驱动五 pass):街道街具路灯 → 宅前庭院 → 公园花木长椅 →
 * 场所间隙 → 边界树带。素材池(DECOR_POOLS)非空时出 props/flats 数据条目
 * (slug 即纹理,渲染层 propSprite/overlay),池空回退旧固定纹理字段
 * trees/lamps/flowers/bushes(stub/无素材路径行为不变)。
 * 通用避让:道路/广场/池塘/围栏/资源节点/场所占地/入口门邻域/彼此占用;
 * 密度档缩放撒点量(sparse 0.6/normal 1/dense 1.4)。
 */
function buildDecor(
  rng: Rng,
  width: number,
  height: number,
  densityIndex: number,
  gameType: GameType,
  places: PlaceDefinition[],
  paths: BlockedRect[],
  plaza: BlockedRect,
  pond: BlockedRect | null,
  fences: BlockedRect[],
  resources: ResourceNodeSeed[],
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
): TileMapDefinition['decor'] {
  const densityScale = [0.6, 1, 1.4][densityIndex] ?? 1;
  const trees: Array<[number, number]> = [];
  const lamps: Array<[number, number]> = [];
  const flowers: Array<[number, number]> = [];
  const bushes: Array<[number, number]> = [];
  const props: DecorEntry[] = [];
  const flats: DecorEntry[] = [];
  const pools = {
    tree: assetsByKind?.[DECOR_POOLS.tree] ?? [],
    bush: assetsByKind?.[DECOR_POOLS.bush] ?? [],
    bench: assetsByKind?.[DECOR_POOLS.bench] ?? [],
    street: assetsByKind?.[DECOR_POOLS.street] ?? [],
    lamp: assetsByKind?.[DECOR_POOLS.lamp] ?? [],
    flat: assetsByKind?.[DECOR_POOLS.flat] ?? [],
  };
  type StandingKind = keyof typeof DECOR_POOLS;
  /** 落一件立式装饰:池非空出数据条目,池空回退旧字段(bench/street 无旧纹理,弃放) */
  const addStanding = (x: number, y: number, kind: StandingKind): void => {
    taken.add(cellKey(x, y));
    const pool = pools[kind];
    if (pool.length > 0) {
      props.push({ slug: rng.pick(pool), x, y });
      return;
    }
    if (kind === 'tree') trees.push([x, y]);
    else if (kind === 'bush') bushes.push([x, y]);
    else if (kind === 'lamp') lamps.push([x, y]);
  };
  const addFlat = (x: number, y: number): void => {
    taken.add(cellKey(x, y));
    if (pools.flat.length > 0) flats.push({ slug: rng.pick(pools.flat), x, y });
    else flowers.push([x, y]);
  };

  const placeRects = places.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  const inAnyPlace = (x: number, y: number): boolean =>
    placeRects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  /** 全局禁放:道路/广场/池塘外扩/围栏/资源格(场所占地用 inAnyPlace 单查) */
  const noGo = new Set<string>();
  for (const r of paths) mark0(noGo, r);
  if (pond !== null) mark0(noGo, { x: pond.x - 1, y: pond.y - 1, w: pond.w + 2, h: pond.h + 2 });
  for (const f of fences) mark0(noGo, f);
  for (const res of resources) noGo.add(cellKey(res.x, res.y));
  const taken = new Set<string>();
  const free = (x: number, y: number): boolean =>
    x >= 1 && y >= 1 && x <= width - 2 && y <= height - 2 &&
    !taken.has(cellKey(x, y)) && !noGo.has(cellKey(x, y)) && !inAnyPlace(x, y);

  // pass1 街道:沿路段间隔一侧落路灯(survival 更稀疏,荒凉感;30% 换街具),广场四角灯
  const [lampGapMin, lampGapMax] = gameType === 'survival' ? [18, 27] : [12, 18];
  for (const road of paths) {
    if (road === plaza) continue;
    const horizontal = road.h <= road.w;
    const span = horizontal ? road.w : road.h;
    for (let s = 2; s < span - 1; s += rng.int(lampGapMin, lampGapMax)) {
      const side = rng.chance(0.5) ? -2 : 3;
      const x = horizontal ? road.x + s : road.x + side;
      const y = horizontal ? road.y + side : road.y + s;
      if (!free(x, y)) continue;
      addStanding(x, y, rng.chance(0.3) && pools.street.length > 0 ? 'street' : 'lamp');
    }
  }
  for (const [cx2, cy2] of [
    [plaza.x - 1, plaza.y - 1],
    [plaza.x + plaza.w, plaza.y - 1],
    [plaza.x - 1, plaza.y + plaza.h],
    [plaza.x + plaza.w, plaza.y + plaza.h],
  ] as const) {
    if (free(cx2, cy2)) addStanding(cx2, cy2, 'lamp');
  }

  // pass2 宅前庭院:有门场所门前三邻(先跑,再补入口门邻域禁放;survival 减半显荒凉)
  for (const place of places) {
    if (place.door === undefined) continue;
    const e = place.entrance;
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i += 1) {
      if (gameType === 'survival' && !rng.chance(0.5)) continue;
      const x = e.x + rng.pick([-2, -1, 1, 2]);
      const y = e.y + (rng.chance(0.3) ? rng.int(0, 1) : 0);
      if (x === e.x && y === e.y) continue;
      if (!free(x, y)) continue;
      if (rng.chance(0.5)) addStanding(x, y, 'bush');
      else addFlat(x, y);
    }
  }
  for (const place of places) {
    const e = place.entrance;
    mark0(noGo, { x: e.x - 1, y: e.y - 1, w: 3, h: 3 });
    if (place.door !== undefined) {
      mark0(noGo, { x: place.door.x - 1, y: place.door.y - 1, w: 3, h: 3 });
    }
  }

  // pass3 公园:树簇/贴地花丛(内部撒点,避池塘外扩/家具/使用格三邻)/长椅环塘缘
  const parkOccupied = new Set<string>();
  for (const place of places) {
    if (!place.id.startsWith('park')) continue;
    for (const f of place.furniture ?? []) {
      mark0(parkOccupied, { x: f.x, y: f.y, w: f.w, h: f.h });
      if (f.use !== undefined) mark0(parkOccupied, { x: f.use.x - 1, y: f.use.y - 1, w: 3, h: 3 });
    }
  }
  const parkFree = (park: PlaceDefinition, x: number, y: number): boolean =>
    x >= park.x + 1 && y >= park.y + 1 && x <= park.x + park.w - 2 && y <= park.y + park.h - 2 &&
    !parkOccupied.has(cellKey(x, y)) && !noGo.has(cellKey(x, y)) && !taken.has(cellKey(x, y));
  const pondRim = pond !== null
    ? [
        ...Array.from({ length: pond.w }, (_, i) => [{ x: pond.x + i, y: pond.y - 1 }, { x: pond.x + i, y: pond.y + pond.h }]).flat(),
        ...Array.from({ length: pond.h }, (_, i) => [{ x: pond.x - 1, y: pond.y + i }, { x: pond.x + pond.w, y: pond.y + i }]).flat(),
      ]
    : [];
  for (const place of places) {
    if (!place.id.startsWith('park')) continue;
    const clusters = Math.max(2, Math.round(rng.int(2, 4) * densityScale));
    for (let i = 0; i < clusters; i += 1) {
      const x = rng.int(place.x + 1, place.x + place.w - 2);
      const y = rng.int(place.y + 1, place.y + place.h - 2);
      if (parkFree(place, x, y)) addStanding(x, y, 'tree');
    }
    const flowerCount = Math.max(3, Math.round(rng.int(3, 6) * densityScale));
    for (let i = 0; i < flowerCount; i += 1) {
      const x = rng.int(place.x + 1, place.x + place.w - 2);
      const y = rng.int(place.y + 1, place.y + place.h - 2);
      if (parkFree(place, x, y)) addFlat(x, y);
    }
    const benches = Math.max(1, Math.round(rng.int(1, 2) * densityScale));
    for (let i = 0; i < benches * 3 && pondRim.length > 0; i += 1) {
      const rim = rng.pick(pondRim);
      if (parkFree(place, rim.x, rim.y)) addStanding(rim.x, rim.y, 'bench');
    }
  }

  // pass4 场所间隙:空草地随机点缀(乔木为主,灌木/花丛补充)
  const gapCount = Math.max(4, Math.round(10 * densityScale));
  for (let i = 0; i < gapCount; i += 1) {
    const x = rng.int(1, width - 2);
    const y = rng.int(1, height - 2);
    if (!free(x, y)) continue;
    const roll = rng.chance(0.65);
    if (roll) addStanding(x, y, 'tree');
    else if (rng.chance(0.5)) addStanding(x, y, 'bush');
    else addFlat(x, y);
  }

  // pass5 边界树带:内圈隔格交错(替代渲染层写死 cypress,生成图由数据驱动)
  const borderTree = (x: number, y: number): void => {
    if ((x + y) % 2 !== 0 || !free(x, y)) return;
    addStanding(x, y, 'tree');
  };
  for (let y = 1; y <= height - 2; y += 1) {
    borderTree(1, y);
    borderTree(width - 2, y);
  }
  for (let x = 2; x <= width - 3; x += 1) {
    borderTree(x, 1);
    borderTree(x, height - 2);
  }

  return {
    trees,
    lamps,
    flowers,
    bushes,
    ...(pond !== null ? { pond } : {}),
    ...(props.length > 0 ? { props } : {}),
    ...(flats.length > 0 ? { flats } : {}),
  };
}

/** 广场地表覆块 tile(与渲染层 TILE_SLUG.plaza 同名素材) */
const PLAZA_TILE = 'tile-plaza';

/**
 * 蜿蜒路网:中心广场(边长 4~6,随机偏移 ±2)+ 四方向随机游走延伸——段宽 2/段长 3~6,
 * 30% 折弯垂直偏移 2~4(连接段锚定刚铺段前端 2 格,路网必连通),距边 4~6 停;
 * 短枝路 sparse 1/normal 2/dense 4 自随机已铺段垂直引出(长 5~10)。
 */
function buildRoadNetwork(
  rng: Rng,
  width: number,
  height: number,
  densityIndex: number,
): { rects: BlockedRect[]; plaza: BlockedRect } {
  const rects: BlockedRect[] = [];
  const plazaSize = rng.int(4, 6);
  const plaza: BlockedRect = {
    x: Math.floor(width / 2) + rng.int(-2, 2) - Math.floor(plazaSize / 2),
    y: Math.floor(height / 2) + rng.int(-2, 2) - Math.floor(plazaSize / 2),
    w: plazaSize,
    h: plazaSize,
  };
  rects.push(plaza);
  for (const arm of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }] as const) {
    const horizontal = arm.dx !== 0;
    const s = horizontal ? arm.dx : arm.dy;
    const margin = rng.int(4, 6);
    const limit = (horizontal ? width : height) - margin;
    let x = horizontal
      ? s > 0 ? plaza.x + plaza.w : plaza.x - 1
      : plaza.x + rng.int(0, plaza.w - 2);
    let y = horizontal
      ? plaza.y + rng.int(0, plaza.h - 2)
      : s > 0 ? plaza.y + plaza.h : plaza.y - 1;
    const front = (): number => (horizontal ? x : y);
    const room = (): number => (s > 0 ? limit - front() : front() - margin);
    while (room() >= 3) {
      const len = Math.min(rng.int(3, 6), room());
      if (horizontal) {
        rects.push({ x: s > 0 ? x : x - len + 1, y, w: len, h: 2 });
        x += s * len;
      } else {
        rects.push({ x, y: s > 0 ? y : y - len + 1, w: 2, h: len });
        y += s * len;
      }
      // 折弯:垂直偏移 2~4,连接段跨新旧行带并锚定刚铺段前端
      if (!rng.chance(0.3)) continue;
      const k = rng.int(2, 4);
      if (horizontal) {
        const opts: number[] = [];
        if (y + 1 + k <= height - 2) opts.push(1);
        if (y - k >= 2) opts.push(-1);
        if (opts.length === 0) continue;
        const j = rng.pick(opts);
        const ny = y + j * k;
        rects.push({ x: s > 0 ? x - 2 : x, y: Math.min(y, ny), w: 2, h: k + 2 });
        y = ny;
      } else {
        const opts: number[] = [];
        if (x + 1 + k <= width - 2) opts.push(1);
        if (x - k >= 2) opts.push(-1);
        if (opts.length === 0) continue;
        const j = rng.pick(opts);
        const nx = x + j * k;
        rects.push({ x: Math.min(x, nx), y: s > 0 ? y - 2 : y, w: k + 2, h: 2 });
        x = nx;
      }
    }
  }
  // 短枝路:自随机已铺段(含广场)垂直引出,长 5~10,越界侧自动改向
  const branchCount = [1, 2, 4][densityIndex] ?? 2;
  for (let i = 0; i < branchCount; i += 1) {
    const base = rng.pick(rects);
    const len = rng.int(5, 10);
    if (base.h <= base.w) {
      const canUp = base.y - len >= 2;
      const canDown = base.y + base.h + len <= height - 2;
      if (!canUp && !canDown) continue;
      const up = canUp && (!canDown || rng.chance(0.5));
      rects.push({
        x: rng.int(base.x, base.x + base.w - 2),
        y: up ? base.y - len : base.y + base.h,
        w: 2,
        h: len,
      });
    } else {
      const canLeft = base.x - len >= 2;
      const canRight = base.x + base.w + len <= width - 2;
      if (!canLeft && !canRight) continue;
      const left = canLeft && (!canRight || rng.chance(0.5));
      rects.push({
        x: left ? base.x - len : base.x + base.w,
        y: rng.int(base.y, base.y + base.h - 2),
        w: len,
        h: 2,
      });
    }
  }
  return { rects, plaza };
}

/** 最近道路格:入口到任一路段矩形内格的最小曼哈顿距离点(路段间经锚定彼此连通) */
function nearestRoadCell(
  rects: readonly BlockedRect[],
  p: { x: number; y: number },
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const r of rects) {
    const cx = Math.min(Math.max(p.x, r.x), r.x + r.w - 1);
    const cy = Math.min(Math.max(p.y, r.y), r.y + r.h - 1);
    const d = Math.abs(cx - p.x) + Math.abs(cy - p.y);
    if (d < bestD) {
      bestD = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

/**
 * 资源节点撒点(M-G.6):浆果丛落公园空地(survival 加落幸存者营地),拾荒堆落街道空地
 * (避池塘/家具/使用格三邻域、场所缓冲带/道路/围栏);占格不可行走,重摇尽力放置。
 * survival 模式数量加密(资源采集区),growth 保持原档。
 */
function scatterResources(
  rng: Rng,
  gameType: GameType,
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
  const parks = places.filter(
    (p) => p.id.startsWith('park') || (gameType === 'survival' && p.id.startsWith('camping')),
  );
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
  const berryCount = rng.int(...(gameType === 'survival' ? SURVIVAL_BERRY_BUSH_COUNT : BERRY_BUSH_COUNT));
  const junkCount = rng.int(...(gameType === 'survival' ? SURVIVAL_JUNK_PILE_COUNT : JUNK_PILE_COUNT));
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
