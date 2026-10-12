/**
 * 建造系统协议面(S2,plan/03):蓝图注册表 + 声明式建造层。
 * 基础图 TileMapDefinition 永不改——建造产物存于 BuiltState(places/fences),
 * 运行时经 definitionWithBuilt 合并展开,校验/锚点/寻路与编辑器、AI 改图
 * 同源(validateMapDefinition + 入口连通 BFS 三入口同一门禁)。
 * 蓝图家具模板为相对坐标(占地左上为原点),盖章时平移;门洞取底边中点、
 * 入口在其下。模板经 stampBuiltPlace 产出后必须通过 validateMapDefinition。
 */
import type { GameType } from './worldgen.js';
import type { FurnitureDefinition } from './furniture.js';
import type {
  BlockedRect,
  FenceRect,
  PlaceDefinition,
  PlaceKind,
  TileMapDefinition,
} from './town-map.js';
import { blockedRectsOf, validateMapDefinition } from './map-validate.js';

/** 建造蓝图 id(v1 子集;塔防等新类型随 S3 扩枚举) */
export type BuildBlueprintId = 'build_home' | 'build_cafe' | 'build_shop' | 'build_fence';

/** 建造蓝图(v1 子集四条,全 survival 门控;引擎零 gameType 分支) */
export interface BuildBlueprint {
  id: BuildBlueprintId;
  kind: 'place' | 'fence';
  label: string;
  gameTypes: readonly GameType[];
  /** 建筑分级预留(v1 全 1):不同级别不同知识门槛 */
  level: number;
  /** 建造类知识门槛基线(JOB_CATEGORIES.build=6);世界参数可全局开关 */
  requiredKnowledge: number;
  /** 材料消耗(fence 按格数乘 materialsPerCell 语义,见 fenceWork) */
  materials: Record<string, number>;
  /** place 类:工时(游戏分)与按单入账工资 */
  durationMinutes: number;
  wage: number;
  /** fence 类:工时/工资按格数推导 */
  fenceWork?: { baseMinutes: number; minutesPerCell: number; wagePerCell: number };
  placeKind?: PlaceKind;
  size?: { w: number; h: number };
  /** place 类家具模板(相对坐标) */
  template?: readonly FurnitureDefinition[];
}

/** v1 蓝图子集(2026-10-12 用户定稿:先开 home/cafe/shop/fence 再扩全量) */
export const BUILD_BLUEPRINTS: readonly BuildBlueprint[] = [
  {
    id: 'build_home',
    kind: 'place',
    label: '住宅',
    gameTypes: ['survival'],
    level: 1,
    requiredKnowledge: 6,
    materials: { wood: 12, stone: 8, metal: 4 },
    durationMinutes: 480,
    wage: 60,
    placeKind: 'home',
    size: { w: 7, h: 5 },
    template: [
      { kind: 'bed', x: 1, y: 1, w: 2, h: 2, activityId: 'rest', use: { x: 3, y: 1 } },
      { kind: 'desk', x: 5, y: 1, w: 1, h: 1, activityId: 'study', use: { x: 5, y: 2 } },
      { kind: 'fridge', x: 5, y: 3, w: 1, h: 1 },
    ],
  },
  {
    id: 'build_cafe',
    kind: 'place',
    label: '咖啡馆',
    gameTypes: ['survival'],
    level: 1,
    requiredKnowledge: 6,
    materials: { wood: 10, stone: 6 },
    durationMinutes: 360,
    wage: 48,
    placeKind: 'cafe',
    size: { w: 6, h: 4 },
    template: [
      { kind: 'counter', x: 1, y: 1, w: 2, h: 1, activityId: 'vendor', use: { x: 1, y: 2 } },
      { kind: 'table', x: 4, y: 1, w: 1, h: 1, activityId: 'meal', use: { x: 4, y: 2 } },
    ],
  },
  {
    id: 'build_shop',
    kind: 'place',
    label: '商店',
    gameTypes: ['survival'],
    level: 1,
    requiredKnowledge: 6,
    materials: { wood: 8, stone: 8, metal: 2 },
    durationMinutes: 360,
    wage: 48,
    placeKind: 'shop',
    size: { w: 6, h: 5 },
    template: [
      { kind: 'counter', x: 1, y: 1, w: 2, h: 1, activityId: 'vendor', use: { x: 1, y: 2 } },
      { kind: 'shelf', x: 4, y: 1, w: 1, h: 2 },
      { kind: 'fridge', x: 4, y: 3, w: 1, h: 1 },
    ],
  },
  {
    id: 'build_fence',
    kind: 'fence',
    label: '围栏',
    gameTypes: ['survival'],
    level: 1,
    requiredKnowledge: 6,
    materials: { wood: 1 },
    durationMinutes: 0,
    wage: 0,
    fenceWork: { baseMinutes: 15, minutesPerCell: 6, wagePerCell: 2 },
  },
];

export function getBuildBlueprint(id: string): BuildBlueprint | null {
  return BUILD_BLUEPRINTS.find((b) => b.id === id) ?? null;
}

/** 模式门控后的可建蓝图(gameTypes 含该模式才开放) */
export function constructionBlueprints(gameType: GameType): BuildBlueprint[] {
  return BUILD_BLUEPRINTS.filter((b) => b.gameTypes.includes(gameType));
}

/** 建造产物声明层:与 TileMapDefinition 同构的增量(基础图之外的 places/fences) */
export interface BuiltState {
  places: PlaceDefinition[];
  fences: FenceRect[];
  /** built 场所 id 序号源(built-N) */
  nextPlaceSeq: number;
}

/**
 * 在建工单(批2 意图流转):materials/durationMinutes/pay 为下单时快照
 * (蓝图热改不追溯在制单,结算凭快照);builderId=接单施工者,中断退料销单。
 */
export interface ConstructionSite {
  id: string;
  blueprintId: BuildBlueprintId;
  x: number;
  y: number;
  w: number;
  h: number;
  createdAtGameMinute: number;
  builderId: string;
  materials: Record<string, number>;
  durationMinutes: number;
  pay: number;
}

/** 蓝图盖章:相对模板平移到 (x,y),门洞底边中点、入口其下,id 按 seq 命名 */
export function stampBuiltPlace(blueprint: BuildBlueprint, x: number, y: number, seq: number): PlaceDefinition {
  const size = blueprint.size!;
  const doorX = x + Math.floor(size.w / 2);
  const doorY = y + size.h - 1;
  return {
    id: `built-${seq}`,
    name: `${blueprint.label} ${seq}`,
    x,
    y,
    w: size.w,
    h: size.h,
    entrance: { x: doorX, y: doorY + 1 },
    door: { x: doorX, y: doorY },
    furniture: (blueprint.template ?? []).map((f) => ({
      ...f,
      x: f.x + x,
      y: f.y + y,
      use: f.use === undefined ? undefined : { x: f.use.x + x, y: f.use.y + y },
    })),
  };
}

/** 纯合并:基础图不动,places/fences 拼接(不深拷贝入参,消费方只读) */
export function definitionWithBuilt(base: TileMapDefinition, built: BuiltState): TileMapDefinition {
  return {
    ...base,
    places: [...base.places, ...built.places],
    fences: [...(base.fences ?? []), ...built.fences],
  };
}

/** 建造选位问题(与 MapIssue 分轨:placement 选区/structure 结构/connectivity 连通) */
export interface BuildIssue {
  code: 'placement' | 'structure' | 'connectivity';
  message: string;
}

const intersects = (a: BlockedRect, b: BlockedRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * 入口连通(多源 BFS):任一入口不可行走或与主连通区隔绝即 false;
 * 无场所 vacuous true。编辑器体检与建造门禁共用(自 web health.ts 上提同源)。
 */
export function entrancesConnected(definition: TileMapDefinition): boolean {
  const blocked = new Uint8Array(definition.width * definition.height);
  for (const rect of blockedRectsOf(definition)) {
    const x0 = Math.max(0, rect.x);
    const x1 = Math.min(definition.width, rect.x + rect.w);
    const y0 = Math.max(0, rect.y);
    const y1 = Math.min(definition.height, rect.y + rect.h);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) blocked[y * definition.width + x] = 1;
    }
  }
  const idx = (x: number, y: number): number => y * definition.width + x;
  const walkable = (x: number, y: number): boolean =>
    x >= 0 && x < definition.width && y >= 0 && y < definition.height && blocked[idx(x, y)] === 0;
  const entrances = definition.places.map((p) => p.entrance);
  if (entrances.length === 0) return true;
  if (entrances.some((e) => !walkable(e.x, e.y))) return false;
  const seen = new Uint8Array(definition.width * definition.height);
  const start = idx(entrances[0]!.x, entrances[0]!.y);
  seen[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head]!;
    const cx = cur % definition.width;
    const cy = Math.floor(cur / definition.width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (seen[ni] === 1) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return entrances.every((e) => seen[idx(e.x, e.y)] === 1);
}

/**
 * 建造选位完整评估(纯函数,debug 端点/批2 意图共用):
 * 选区合法性(越界/压既有场所/铺装/障碍)→ 盖章合并 → 结构校验
 * (validateMapDefinition 同源)→ 入口连通(围栏封门在此拦截)。
 * 全部通过时返回 merged 供 applyBuilt 直接换图。
 */
export function evaluateBuildPlacement(
  base: TileMapDefinition,
  built: BuiltState,
  blueprint: BuildBlueprint,
  rect: BlockedRect,
): { merged: TileMapDefinition; issues: BuildIssue[] } {
  const issues: BuildIssue[] = [];
  const current = definitionWithBuilt(base, built);

  if (blueprint.kind === 'place') {
    const size = blueprint.size!;
    if (rect.w !== size.w || rect.h !== size.h) {
      issues.push({
        code: 'placement',
        message: `${blueprint.label}占地须为 ${size.w}×${size.h}(收到 ${rect.w}×${rect.h})`,
      });
    }
  } else if (rect.w !== 1 && rect.h !== 1) {
    issues.push({ code: 'placement', message: '围栏段须为横条(h=1)或竖条(w=1)' });
  }

  const margin = 1; // 距边一圈留白:入口/门洞须落在可行走区内
  if (
    rect.x < margin ||
    rect.y < margin ||
    rect.x + rect.w > base.width - margin ||
    rect.y + rect.h > base.height - margin
  ) {
    issues.push({ code: 'placement', message: `选区越界:须距地图边缘至少 ${margin} 格` });
  }

  const blockedRects = blockedRectsOf(current);
  if (blockedRects.some((b) => intersects(rect, b))) {
    issues.push({ code: 'placement', message: '选区与既有障碍/建筑/围栏/资源重叠' });
  }
  if (current.paths.some((p) => intersects(rect, p))) {
    issues.push({ code: 'placement', message: '选区压住道路:道路不可占建' });
  }

  if (issues.length > 0) return { merged: current, issues };

  const stamp =
    blueprint.kind === 'place'
      ? [stampBuiltPlace(blueprint, rect.x, rect.y, built.nextPlaceSeq)]
      : [];
  const fences = blueprint.kind === 'fence' ? [{ ...rect }] : [];
  const merged = definitionWithBuilt(base, {
    places: [...built.places, ...stamp],
    fences: [...built.fences, ...fences],
    nextPlaceSeq: built.nextPlaceSeq + stamp.length,
  });

  for (const issue of validateMapDefinition(merged)) {
    issues.push({ code: 'structure', message: issue.message });
  }
  if (!entrancesConnected(merged)) {
    issues.push({ code: 'connectivity', message: '该 placement 会切断某入口的对外连通(围栏封门/圈死)' });
  }
  return { merged, issues };
}
