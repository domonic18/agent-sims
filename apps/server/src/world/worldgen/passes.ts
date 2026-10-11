/**
 * worldgen 管线 pass 集(plan/02 R2):generate() 的顺序阶段拆为八个具名
 * pass,执行序列由 profile.worldgen.passes 声明(数组序=执行序)。字段组由
 * 各自 pass 填充、后序 pass 只读前序产物;含 rng 的 pass 内部逻辑逐行等价
 * 于拆分前(含 growth 空过路径的零 rng 消耗),R0 特征化快照钉死字节不变。
 */
import type { BlockedRect, PlaceDefinition, ResourceNodeSeed, TileMapDefinition } from '@sims/shared';
import type { WorldgenModeOptions, WorldgenPassId } from '../game-mode.js';
import { PLACE_BLUEPRINTS, type PlaceKind, type Zone } from './blueprint.js';
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
import { scatterResources, tryScatterPlace } from './scatter.js';

/** 管线共享上下文:generate() 初始化空场,pass 按声明序填充 */
export interface WorldgenCtx {
  rng: Rng;
  width: number;
  height: number;
  /** small 档(撒放覆写/野簇紧凑用) */
  small: boolean;
  densityIndex: number;
  worldgen: WorldgenModeOptions;
  assetsByKind?: Readonly<Record<string, readonly string[]>>;
  assetSizes?: Readonly<Record<string, readonly [number, number]>>;
  // —— pass 产物(roads 起依次填充;缺省值保证任意子集序列可跑)——
  paths: BlockedRect[];
  plaza: BlockedRect;
  patches: NonNullable<TileMapDefinition['patches']>;
  midX: number;
  midY: number;
  townCore: BlockedRect | null;
  fences: BlockedRect[];
  wild: { forests: BlockedRect[]; rocks: BlockedRect[] } | null;
  pond: BlockedRect | null;
  blockedRects: BlockedRect[];
  places: PlaceDefinition[];
  resources: ResourceNodeSeed[];
  decor: TileMapDefinition['decor'];
}

/** ① 蜿蜒路网+广场(只进 paths 纯视觉+撒放预留,不阻塞通行) */
const passRoads = (ctx: WorldgenCtx): void => {
  const { rects, plaza } = buildRoadNetwork(
    ctx.rng, ctx.width, ctx.height, ctx.densityIndex, ctx.worldgen.compactRoads,
  );
  ctx.paths = rects;
  ctx.plaza = plaza;
  ctx.patches.push({ ...plaza, tile: PLAZA_TILE });
  ctx.midX = plaza.x + Math.floor(plaza.w / 2);
  ctx.midY = plaza.y + Math.floor(plaza.h / 2);
};

/** ② 镇内核心分区(以广场中心为镇中心;未启用零 rng 消耗) */
const passTownCore = (ctx: WorldgenCtx): void => {
  ctx.townCore = ctx.worldgen.townCore ? buildTownCore(ctx.width, ctx.height) : null;
};

/** ③ 配额场所撒放:四象限为偏好区,核心必得、可选放不下即裁;产出池塘 */
const passPlaces = (ctx: WorldgenCtx): void => {
  const { rng, width, height, midX, midY, worldgen, places } = ctx;
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
  for (const path of ctx.paths) reserve(path);
  const counters = new Map<PlaceKind, number>();
  // 撒放顺序=配额数组序(profile 声明,mode 差异全在数据)
  for (const quota of worldgen.quota) {
    const count = ctx.densityIndex === 0 ? quota.count[0] : rng.int(quota.count[0], quota.count[1]);
    const zone = zones[quota.zone];
    for (let n = 0; n < count; n += 1) {
      const sizePool =
        worldgen.smallSizeOverrides !== null && ctx.small
          ? worldgen.smallSizeOverrides[quota.kind] ?? PLACE_BLUEPRINTS[quota.kind].size
          : PLACE_BLUEPRINTS[quota.kind].size;
      const [w, h] = rng.pick(sizePool);
      const spot = tryScatterPlace(
        rng, zone, width, height, w, h, occupied, occupiedCore, entrances, quota.essential,
        quota.area ?? null, ctx.townCore, quota.kind,
      );
      if (spot === null) break;
      const seq = (counters.get(quota.kind) ?? 0) + 1;
      counters.set(quota.kind, seq);
      const id = `${quota.kind}-${String.fromCharCode(96 + seq)}`;
      if (quota.kind === 'park') {
        ctx.pond = parkPond(rng, spot.x, spot.y, w, h);
        ctx.blockedRects.push(ctx.pond);
        reserve(ctx.pond);
      }
      const place = buildPlace(rng, quota.kind, id, spot.x, spot.y, w, h, ctx.pond, ctx.assetsByKind);
      places.push(place);
      if (quota.kind === 'park' || quota.kind === 'graveyard') {
        const fenceRects = quota.kind === 'park' ? parkFences(place) : graveyardFences(place);
        ctx.fences.push(...fenceRects);
        for (const fence of fenceRects) reserve(fence); // 后放场所不压栅栏
      }
      entrances.add(cellKey(place.entrance.x, place.entrance.y));
      reserve(place);
    }
  }
};

/** ④ 门前小路:入口至最近道路格 L 形连接(两段 1 宽矩形;先横先竖随机) */
const passDoorPaths = (ctx: WorldgenCtx): void => {
  for (const place of ctx.places) {
    if (place.door === undefined) continue;
    const target = nearestRoadCell(ctx.paths, place.entrance);
    if (target === null) continue;
    const dy = Math.abs(target.y - place.entrance.y);
    const dx = Math.abs(target.x - place.entrance.x);
    const verticalLeg = { x: place.entrance.x, y: Math.min(place.entrance.y, target.y), w: 1, h: dy + 1 };
    const horizontalLeg = { x: Math.min(place.entrance.x, target.x), y: target.y, w: dx + 1, h: 1 };
    const verticalFirst = ctx.rng.chance(0.5);
    const legs = verticalFirst ? [verticalLeg, horizontalLeg] : [horizontalLeg, verticalLeg];
    for (const leg of legs) {
      if (Math.max(leg.w, leg.h) > 1) ctx.paths.push(leg); // 同行/同列的零长腿跳过
    }
  }
};

/** ⑤ 镇界围栏:沿核心边线连续段成栏,落路格=镇出口(先路后栏) */
const passTownFences = (ctx: WorldgenCtx): void => {
  if (ctx.townCore !== null) ctx.fences.push(...townFences(ctx.townCore, ctx.paths));
};

/** ⑥ 镇外簇:森林/岩石区矩形——资源三件套落点与密植装饰区(无核心=空簇) */
const passWildClusters = (ctx: WorldgenCtx): void => {
  ctx.wild = ctx.townCore === null
    ? { forests: [], rocks: [] }
    : buildWildClusters(ctx.rng, ctx.width, ctx.height, ctx.townCore, ctx.paths, ctx.places, ctx.small);
};

/** ⑦ 资源节点撒点(resourcePlacement 组驱动) */
const passResources = (ctx: WorldgenCtx): void => {
  ctx.resources = scatterResources(
    ctx.rng, ctx.worldgen, ctx.width, ctx.height, ctx.places, ctx.paths, ctx.fences, ctx.pond, ctx.wild,
  );
};

/** ⑧ 户外装饰(池驱动五 pass):decor 避让资源与全部既有占用 */
const passDecor = (ctx: WorldgenCtx): void => {
  ctx.decor = buildDecor(
    ctx.rng, ctx.width, ctx.height, ctx.densityIndex, ctx.worldgen,
    ctx.places, ctx.paths, ctx.plaza, ctx.pond, ctx.fences, ctx.resources, ctx.assetsByKind,
    ctx.wild, ctx.townCore, ctx.assetSizes,
  );
};

const PASSES: Record<WorldgenPassId, (ctx: WorldgenCtx) => void> = {
  roads: passRoads,
  townCore: passTownCore,
  places: passPlaces,
  doorPaths: passDoorPaths,
  townFences: passTownFences,
  wildClusters: passWildClusters,
  resources: passResources,
  decor: passDecor,
};

/** 按 profile 声明序执行 pass(rng 消耗序=pass 序+pass 内逻辑,未注册 id 即抛) */
export function runWorldgenPasses(ctx: WorldgenCtx): void {
  for (const id of ctx.worldgen.passes) {
    const pass = PASSES[id];
    if (pass === undefined) throw new Error(`未注册的 worldgen pass: ${id}`);
    pass(ctx);
  }
}
