import {
  TOWN_MAP,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZE_GRIDS,
  type ActivityId,
  type BlockedRect,
  type GameType,
  type PlaceDefinition,
  type ResourceNodeSeed,
  type TileMapDefinition,
  type WorldgenParams,
  type WorldgenReport,
} from '@sims/shared';
import { TileMap } from '../map.js';
import {
  GROWTH_QUOTA,
  PLACE_BLUEPRINTS,
  SURVIVAL_QUOTA,
  SURVIVAL_SMALL_SIZE_OVERRIDES,
  type PlaceKind,
  type Zone,
} from './blueprint.js';
import { buildDecor } from './decor.js';
import {
  buildTownCore,
  buildWildClusters,
  graveyardFences,
  parkFences,
  parkPond,
  townFences,
} from './fences.js';
import { cellKey, mark0 } from './grid.js';
import { buildPlace } from './placement.js';
import { Rng } from './prng.js';
import { PLAZA_TILE, buildRoadNetwork, nearestRoadCell } from './roads.js';

// 家具/场所布局公共件(alignedScan/attemptCoreSlots/directionalPool/layoutFurniture)
// 对测试与其他消费方保持自 generate.js 可导入(拆分前即此处导出)
export {
  alignedScan,
  attemptCoreSlots,
  buildPlace,
  directionalPool,
  layoutFurniture,
} from './placement.js';
export type { SlotWithPool } from './placement.js';

/** 内置固定地图种子(design/06:固定地图=生成器特例,兼容已有存档) */
export const BUILTIN_SEED = '__builtin__';

/** 资源节点撒点数量档(TD-1 自 scatterResources 字面量具名,design/09 §2):
 * 浆果丛易枯竭(重生次日)、拾荒堆无限,数量太少则以物代薪无目标可接 */
const BERRY_BUSH_COUNT: readonly [number, number] = [4, 7];
const JUNK_PILE_COUNT: readonly [number, number] = [2, 4];
/** 食物链节点档(2026-10-07,numerical §5.4):苹果树/麦丛与浆果丛同落食物区,
 * 售罄即止后长期食物来源=直采(苹果)与制作原料(小麦) */
const APPLE_TREE_COUNT: readonly [number, number] = [2, 4];
const WHEAT_PATCH_COUNT: readonly [number, number] = [2, 4];
/** 末日生存档:资源采集区加密(废土拾荒+食物区) */
const SURVIVAL_BERRY_BUSH_COUNT: readonly [number, number] = [5, 9];
const SURVIVAL_JUNK_PILE_COUNT: readonly [number, number] = [5, 9];
const SURVIVAL_APPLE_TREE_COUNT: readonly [number, number] = [3, 6];
const SURVIVAL_WHEAT_PATCH_COUNT: readonly [number, number] = [3, 6];
/** 生存资源三件套档(M-S/S1,07-survival §2):树→木材/岩石→石料/废墟金属堆→金属;
 * S1.5 起树/岩迁镇外簇(森林/岩石区),数量随簇加密 */
const SURVIVAL_TREE_COUNT: readonly [number, number] = [6, 10];
const SURVIVAL_ROCK_COUNT: readonly [number, number] = [4, 7];
const SURVIVAL_METAL_PILE_COUNT: readonly [number, number] = [3, 6];

export interface WorldgenInput {
  seed: string;
  gameType: GameType;
  params: WorldgenParams;
  /** 素材清单版本(manifest version;参与种子派生,素材变更即世界不同) */
  manifestVersion: string;
  /** kind → 可选素材 slug 池(素材库随机选材;缺省 sprite 省略=kind 同名纹理) */
  assetsByKind?: Readonly<Record<string, readonly string[]>>;
  /** 装饰 slug → sprite 占地格数(solid 装饰转 blockedRect 用;缺省 1×1) */
  assetSizes?: Readonly<Record<string, readonly [number, number]>>;
}

export interface WorldgenResult {
  map: TileMapDefinition;
  report: WorldgenReport;
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
  const { rects: paths, plaza } = buildRoadNetwork(
    rng, width, height, densityIndex, input.gameType === 'survival',
  );
  const patches: NonNullable<TileMapDefinition['patches']> = [{ ...plaza, tile: PLAZA_TILE }];
  const midX = plaza.x + Math.floor(plaza.w / 2);
  const midY = plaza.y + Math.floor(plaza.h / 2);
  // 镇内核心(survival 分区): 以广场中心为镇中心,growth 不分区(rng 流零消耗)
  const townCore = input.gameType === 'survival' ? buildTownCore(width, height) : null;

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
      const sizePool =
        input.gameType === 'survival' && input.params.size === 'small'
          ? SURVIVAL_SMALL_SIZE_OVERRIDES[quota.kind] ?? PLACE_BLUEPRINTS[quota.kind].size
          : PLACE_BLUEPRINTS[quota.kind].size;
      const [w, h] = rng.pick(sizePool);
      const spot = tryScatterPlace(
        rng, zone, width, height, w, h, occupied, occupiedCore, entrances, quota.essential,
        quota.area ?? null, townCore, quota.kind,
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

  // ③.5 镇界围栏(survival):沿核心边线连续段成栏,落在路格上的围栏位跳过=镇出口
  // (先路后栏;随 fences 数组下发,资源/装饰既有避让自动生效)
  if (townCore !== null) fences.push(...townFences(townCore, paths));
  // ③.6 镇外簇(survival):森林/岩石区矩形——资源三件套的伐木/采矿落点与密植装饰区
  const wildClusters =
    townCore === null
      ? { forests: [], rocks: [] }
      : buildWildClusters(rng, width, height, townCore, paths, places, input.params.size === 'small');

  // ④ 资源节点撒点(M-G.6):公园浆果丛/街道拾荒堆,占格不可行走站四邻作业
  const resources = scatterResources(
    rng, input.gameType, width, height, places, paths, fences, pond,
    townCore === null ? null : wildClusters,
  );

  // ⑤ 户外装饰(池驱动五 pass):decor 避让资源与全部既有占用
  const decor = buildDecor(
    rng, width, height, densityIndex, input.gameType,
    places, paths, plaza, pond, fences, resources, input.assetsByKind,
    townCore === null ? null : wildClusters, townCore, input.assetSizes,
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
    ...(townCore !== null ? { townCore } : {}),
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
 * 镇内外分区(survival,M-S/S1.5):town 矩形含于核心内圈(入口行不越围栏),
 * wild 矩形与核心外扩一圈不相交(围栏外留走环);两轮随机与兜底扫描全带约束。
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
  area: 'town' | 'wild' | null,
  townCore: BlockedRect | null,
  label: string,
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
  const areaOk = (x: number, y: number): boolean => {
    if (area === null || townCore === null) return true;
    if (area === 'town') {
      // 核心内圈(围栏线内缩 1):有门场所入口行 y+h 与开放场所入口行 y-1 均不出栏
      return (
        x >= townCore.x + 1 &&
        y >= townCore.y + 2 &&
        x + w <= townCore.x + townCore.w - 2 &&
        y + h <= townCore.y + townCore.h - 2
      );
    }
    // 与核心外扩一圈不相交(镇界围栏外留一圈走环)
    return (
      x + w <= townCore.x - 1 ||
      x >= townCore.x + townCore.w + 1 ||
      y + h <= townCore.y - 1 ||
      y >= townCore.y + townCore.h + 1
    );
  };
  const fits = (x: number, y: number, grid: Set<string>): boolean => {
    if (!inBounds(x, y)) return false;
    if (!areaOk(x, y)) return false;
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
  throw new Error(`撒放空间不足:${label}`);
}

/**
 * 资源节点撒点(M-G.6+2026-10-07 食物链):食物节点(浆果丛/苹果树/麦丛)落公园空地
 * (survival 加落幸存者营地),拾荒堆落街道空地(避池塘/家具/使用格三邻域、场所缓冲带/道路/围栏);
 * 占格不可行走,重摇尽力放置。survival 模式数量加密(资源采集区)。
 * S1.5 起三件套迁镇外:树→森林簇/岩石→岩石区/金属堆→废墟(食物节点近家不变)。
 * 食物链新增撒点循环改变 rng 消耗序列:growth 同种子地图与旧版有意不同(非回归)。
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
  wild: { forests: BlockedRect[]; rocks: BlockedRect[] } | null,
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
  if (gameType === 'survival') {
    for (const fence of fences) mark0(streetBlocked, fence); // 镇界围栏格不落堆(S1.5;growth 零变化)
  }
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
  // 食物链两节点(2026-10-07,numerical §5.4):复制浆果丛落位(食物区=公园,survival 加营地)
  const appleCount = rng.int(...(gameType === 'survival' ? SURVIVAL_APPLE_TREE_COUNT : APPLE_TREE_COUNT));
  const wheatCount = rng.int(...(gameType === 'survival' ? SURVIVAL_WHEAT_PATCH_COUNT : WHEAT_PATCH_COUNT));
  const scatterFoodNode = (kind: ResourceNodeSeed['kind'], count: number): void => {
    for (let n = 0; n < count && parks.length > 0; n += 1) {
      const park = rng.pick(parks);
      for (let tries = 0; tries < 20; tries += 1) {
        const x = rng.int(park.x + 1, park.x + park.w - 2);
        const y = rng.int(park.y + 1, park.y + park.h - 2);
        const key = cellKey(x, y);
        if (parkBlocked.has(key) || taken.has(key)) continue;
        taken.add(key);
        seeds.push({ kind, x, y });
        break;
      }
    }
  };
  scatterFoodNode('apple_tree', appleCount);
  scatterFoodNode('wheat_patch', wheatCount);
  // 生存资源三件套(M-S/S1,07-survival §2;S1.5 镇外迁移):树→森林簇、岩石→岩石区、
  // 金属堆→废墟——growth 不进此分支,rng 消耗流零变化
  if (gameType === 'survival' && wild !== null) {
    const clusterBlocked = new Set<string>();
    for (const path of paths) mark0(clusterBlocked, path);
    const ruins = places.filter((p) => p.id.startsWith('ruins'));
    const ruinsBlocked = new Set<string>(parkBlocked);
    for (const ruin of ruins) {
      for (const f of ruin.furniture ?? []) {
        mark0(ruinsBlocked, { x: f.x, y: f.y, w: f.w, h: f.h });
        if (f.use !== undefined) {
          mark0(ruinsBlocked, { x: f.use.x - 1, y: f.use.y - 1, w: 3, h: 3 }); // 使用格保持四邻可站
        }
      }
      mark0(ruinsBlocked, { x: ruin.entrance.x - 1, y: ruin.entrance.y - 1, w: 3, h: 2 });
    }
    const scatterInto = (
      kind: ResourceNodeSeed['kind'],
      count: number,
      areas: readonly BlockedRect[],
      blocked: Set<string>,
    ): void => {
      for (let n = 0; n < count && areas.length > 0; n += 1) {
        const area = rng.pick(areas);
        for (let tries = 0; tries < 20; tries += 1) {
          const x = rng.int(area.x + 1, area.x + area.w - 2);
          const y = rng.int(area.y + 1, area.y + area.h - 2);
          const key = cellKey(x, y);
          if (blocked.has(key) || taken.has(key)) continue;
          taken.add(key);
          seeds.push({ kind, x, y });
          break;
        }
      }
    };
    scatterInto('tree', rng.int(...SURVIVAL_TREE_COUNT), wild.forests, clusterBlocked);
    scatterInto('rock', rng.int(...SURVIVAL_ROCK_COUNT), wild.rocks, clusterBlocked);
    scatterInto('metal_pile', rng.int(...SURVIVAL_METAL_PILE_COUNT), ruins, ruinsBlocked);
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
