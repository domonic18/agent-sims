/**
 * 布局体检(批B):结构硬校验复用 shared validateMapDefinition(双端同源),
 * 叠加编辑器侧启发式——全局连通(BFS)/入口间距/资源覆盖/密度档位/配额建议。
 * 布局质量直接决定 LLM 调用密度(旁观感知≤8格、枢纽相遇率),体检分两级:
 * 硬错误=发布门禁,警告=优化建议不拦截。
 */
import {
  blockedRectsOf,
  validateMapDefinition,
  type MapIssue,
  type TileMapDefinition,
} from '@sims/shared';
import { placeKindOf } from './kinds';

export type HealthCode =
  | 'structure'
  | 'connectivity'
  | 'spacing'
  | 'resource'
  | 'density'
  | 'quota';

export interface HealthFinding {
  level: 'error' | 'warning';
  code: HealthCode;
  message: string;
  /** 关联场所 id(可点击定位到选中) */
  placeIds?: string[];
  /** 关联家具序号(该场所 furniture 数组下标,定位可直达单件家具) */
  furnitureIndex?: number;
}

export interface DensityEstimate {
  /** 场所占地占总格比(0-1) */
  areaRatio: number;
  /** 家具活动锚点总数 */
  anchorCount: number;
  /** 入口两两曼哈顿≤8 的对数(旁观感知半径内) */
  closePairs: number;
  /** 入口最小间距(场所<2 个为 null) */
  minPairDistance: number | null;
  tier: 'dense' | 'balanced' | 'sparse';
}

export interface HealthResult {
  findings: HealthFinding[];
  /** 零硬错误(发布门禁) */
  ok: boolean;
  /** shared 结构校验原始问题(含 placeId/resourceIndex 定位) */
  structure: MapIssue[];
  density: DensityEstimate;
}

/** 多源 BFS(首个可行走入口起):每入口 → true 连通 / false 不可达 / null 入口格被阻 */
function entranceReachability(definition: TileMapDefinition): (boolean | null)[] {
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
  const start = entrances.find((e) => walkable(e.x, e.y));
  if (start === undefined) return entrances.map(() => null);

  const seen = new Uint8Array(definition.width * definition.height);
  const queue = [idx(start.x, start.y)];
  seen[queue[0]!] = 1;
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
  return entrances.map((e) => (walkable(e.x, e.y) ? seen[idx(e.x, e.y)] === 1 : null));
}

/** 体检主入口(纯函数,编辑器保存/发布前与 HealthPanel 实时共用) */
export function checkLayout(definition: TileMapDefinition): HealthResult {
  const findings: HealthFinding[] = [];
  const structure = validateMapDefinition(definition);
  for (const issue of structure) {
    findings.push({
      level: 'error',
      code: 'structure',
      message: issue.message,
      placeIds: issue.placeId !== undefined ? [issue.placeId] : undefined,
      furnitureIndex: issue.furnitureIndex,
    });
  }

  // 全局连通:任一入口与主连通区隔绝 = 硬错误(角色到不了即废场所)
  const reach = entranceReachability(definition);
  definition.places.forEach((place, i) => {
    if (reach[i] === false) {
      findings.push({
        level: 'error',
        code: 'connectivity',
        message: `「${place.name}」入口不可达:与其它入口不在同一连通区域`,
        placeIds: [place.id],
      });
    } else if (reach[i] === null) {
      findings.push({
        level: 'error',
        code: 'connectivity',
        message: `「${place.name}」入口所在格被障碍压住`,
        placeIds: [place.id],
      });
    }
  });

  const entrances = definition.places.map((p) => ({
    id: p.id,
    name: p.name,
    x: p.entrance.x,
    y: p.entrance.y,
  }));

  // 入口间距:<6 警告(近邻→旁观感知≤8格事件暴涨);同时统计 ≤8 对数供密度档位
  let closePairs = 0;
  let minPairDistance: number | null = null;
  for (let i = 0; i < entrances.length; i += 1) {
    for (let j = i + 1; j < entrances.length; j += 1) {
      const a = entrances[i]!;
      const b = entrances[j]!;
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (minPairDistance === null || d < minPairDistance) minPairDistance = d;
      if (d <= 8) closePairs += 1;
      if (d < 6) {
        findings.push({
          level: 'warning',
          code: 'spacing',
          message: `「${a.name}」与「${b.name}」入口相距 ${d} 格(<6):过度密集推高旁观感知与 LLM 调用`,
          placeIds: [a.id, b.id],
        });
      }
    }
  }

  // 资源覆盖:仅当图上放了资源节点才检查(空资源图不产采集行为)
  const resources = definition.resources ?? [];
  if (resources.length > 0) {
    for (const e of entrances) {
      const nearest = Math.min(...resources.map((r) => Math.abs(e.x - r.x) + Math.abs(e.y - r.y)));
      if (nearest > 25) {
        findings.push({
          level: 'warning',
          code: 'resource',
          message: `「${e.name}」到最近资源节点 ${nearest} 格(>25):采集往返耗时,空闲窗口变多`,
          placeIds: [e.id],
        });
      }
    }
  }

  // 密度档位:近邻对数为轴的粗估(权重更大的面积/锚点仅展示不参与分档)
  const areaRatio =
    definition.places.reduce((sum, p) => sum + p.w * p.h, 0) / (definition.width * definition.height);
  const anchorCount = definition.places.reduce((sum, p) => sum + (p.furniture?.length ?? 0), 0);
  const tier = closePairs >= 8 ? 'dense' : closePairs <= 2 ? 'sparse' : 'balanced';
  if (tier === 'dense') {
    findings.push({
      level: 'warning',
      code: 'density',
      message: `入口近邻对 ${closePairs} 对(≤8格):布局偏紧凑,相遇/旁观类 LLM 调用偏高`,
    });
  } else if (tier === 'sparse') {
    findings.push({
      level: 'warning',
      code: 'density',
      message: `入口近邻对仅 ${closePairs} 对:布局宽松,角色空闲窗口多,行为决策(jev)调用占比可能升高`,
    });
  }

  // 配额建议:经验最低配置 + townCore 与世界类型的对应关系
  const kindCount = new Map<string, number>();
  for (const p of definition.places) {
    const kind = placeKindOf(p.id);
    if (kind !== null) kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1);
  }
  for (const [kind, min] of [
    ['home', 1],
    ['shop', 1],
  ] as const) {
    if ((kindCount.get(kind) ?? 0) < min) {
      findings.push({
        level: 'warning',
        code: 'quota',
        message: `建议至少 ${min} 个${kind === 'home' ? '住宅' : '商店'}:居住与补给是行为链的基本锚点`,
      });
    }
  }
  if (definition.townCore === undefined) {
    findings.push({
      level: 'warning',
      code: 'quota',
      message: '无镇核心区(townCore):仅能创建 growth 世界;survival 世界要求地图带镇核心',
    });
  }

  return {
    findings,
    ok: findings.every((f) => f.level !== 'error'),
    structure,
    density: { areaRatio, anchorCount, closePairs, minPairDistance, tier },
  };
}
