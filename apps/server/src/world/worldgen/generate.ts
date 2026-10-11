import {
  TOWN_MAP,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZE_GRIDS,
  type ActivityId,
  type GameType,
  type PlaceDefinition,
  type TileMapDefinition,
  type WorldgenParams,
  type WorldgenReport,
} from '@sims/shared';
import { TileMap } from '../map.js';
import { getGameModeProfile } from '../game-mode.js';
import { PLACE_BLUEPRINTS, type PlaceKind } from './blueprint.js';
import { cellKey } from './grid.js';
import { runWorldgenPasses, type WorldgenCtx } from './passes.js';
import { Rng } from './prng.js';

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
 * 种子驱动整图生成(design/06 管线,plan/02 R2 管线化):pass 序列由 profile
 * 声明(passes.ts,roads→places→…→decor),模式差异全在 GameModeProfile 数据里。
 * 末段校验:TileMap 构造即校验(入口/门洞/家具/室内连通)+锚点齐备+全局连通。
 * 纯函数:同输入必同输出。
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
  const ctx: WorldgenCtx = {
    rng,
    width,
    height,
    small: input.params.size === 'small',
    densityIndex: WORLDGEN_DENSITIES.indexOf(input.params.density),
    worldgen: getGameModeProfile(input.gameType).worldgen,
    assetsByKind: input.assetsByKind,
    assetSizes: input.assetSizes,
    paths: [],
    plaza: { x: 0, y: 0, w: 0, h: 0 },
    patches: [],
    midX: Math.floor(width / 2),
    midY: Math.floor(height / 2),
    townCore: null,
    fences: [],
    wild: null,
    pond: null,
    blockedRects: [],
    places: [],
    resources: [],
    decor: { trees: [], lamps: [], flowers: [], bushes: [] },
  };
  // pass 序列=profile 声明(growth/survival 今日同序,模式差异在 pass 内开关;
  // 含 rng 的 pass 换序即同种子图变——特征化快照拦)
  runWorldgenPasses(ctx);

  const map: TileMapDefinition = {
    width,
    height,
    blockedRects: ctx.blockedRects,
    paths: ctx.paths,
    places: ctx.places,
    decor: ctx.decor,
    fences: ctx.fences,
    resources: ctx.resources,
    patches: ctx.patches,
    ...(ctx.townCore !== null ? { townCore: ctx.townCore } : {}),
  };
  // 末段校验:TileMap 构造即校验(入口/门洞/家具/室内连通);再验锚点与全局连通
  const tileMap = TileMap.fromDefinition(map);
  const anchorsComplete = checkAnchors(ctx.places);
  const connectivity = checkConnectivity(tileMap, ctx.midX, ctx.midY);
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
      places: ctx.places.map((p) => ({ id: p.id, name: p.name, w: p.w, h: p.h })),
      checks: { connectivity, anchorsComplete, fallback: false },
    },
  };
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
