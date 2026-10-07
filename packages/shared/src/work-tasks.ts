/**
 * 工单注册表(TD-1 表驱动):五岗(clean/repair/rescue/gather_berry/scavenge)
 * 的目标源元数据与目标查询助手,server 接单解析/web 面板计数/Lab 表单共用,
 * 根治「kind 字符串分支在四端各抄一份」的漂移。
 * 岗位参数(时长/工资/产出)仍在 maintenance.ts/production.ts 两张参数表。
 */
import type { WorkTaskId } from './events.js';
import type { MaintenanceSpot } from './maintenance.js';
import type { GatherTaskId, ResourceNode } from './production.js';

const GATHER_TASK_IDS: readonly GatherTaskId[] = [
  'gather_berry',
  'scavenge',
  'chop_tree',
  'mine_rock',
  'salvage_metal',
  'pick_apple',
  'harvest_wheat',
];

/** 类型守卫:采集岗(M-G.6 两岗+M-S/S1 生存三岗)——联合查表与结算分流共用 */
export function isGatherTask(task: WorkTaskId): task is GatherTaskId {
  return (GATHER_TASK_IDS as readonly string[]).includes(task);
}

/** 工单目标实体族(快照顶层三源) */
export type WorkTargetSource = 'maintenance' | 'resources' | 'characters';

export interface WorkTargetMeta {
  source: WorkTargetSource;
  /** 同族内按 kind 过滤(characters 族无 kind) */
  kind: string | null;
  /** 节点须有存量才可接(浆果丛 charges>0;拾荒堆 charges=null 恒可) */
  requireCharges: boolean;
  /** 面板计数文案: `待救 3 人`/`浆果丛 2 处` */
  noun: string;
  measure: string;
}

export const WORK_TARGETS: Record<WorkTaskId, WorkTargetMeta> = {
  clean: { source: 'maintenance', kind: 'litter', requireCharges: false, noun: '杂物', measure: '处' },
  repair: { source: 'maintenance', kind: 'fence_damage', requireCharges: false, noun: '破损', measure: '处' },
  rescue: { source: 'characters', kind: null, requireCharges: false, noun: '待救', measure: '人' },
  gather_berry: { source: 'resources', kind: 'berry_bush', requireCharges: true, noun: '浆果丛', measure: '处' },
  scavenge: { source: 'resources', kind: 'junk_pile', requireCharges: false, noun: '拾荒堆', measure: '处' },
  chop_tree: { source: 'resources', kind: 'tree', requireCharges: true, noun: '树木', measure: '棵' },
  mine_rock: { source: 'resources', kind: 'rock', requireCharges: true, noun: '岩石', measure: '处' },
  salvage_metal: { source: 'resources', kind: 'metal_pile', requireCharges: true, noun: '金属堆', measure: '处' },
  pick_apple: { source: 'resources', kind: 'apple_tree', requireCharges: true, noun: '苹果树', measure: '棵' },
  harvest_wheat: { source: 'resources', kind: 'wheat_patch', requireCharges: true, noun: '麦丛', measure: '处' },
};

/** 资源节点 kind→中文标签(可采节点族反查;Lab 表单/画布提示用) */
export function resourceNodeLabel(kind: string): string {
  return Object.values(WORK_TARGETS).find((m) => m.source === 'resources' && m.kind === kind)?.noun ?? kind;
}

/** 工单查询入参(协议结构子集,快照超集自然兼容) */
export interface WorkTargetSnapshotView {
  characters: ReadonlyArray<{ id: string; x: number; y: number; alive: boolean; diedAtGameMinutes: number | null }>;
  resources: ReadonlyArray<ResourceNode>;
  maintenance: ReadonlyArray<MaintenanceSpot>;
}

/** 工单候选目标坐标流(按注册表过滤:族+kind+存量要求;rescue 只收救治窗口内幽灵) */
function* workTargetCandidates(task: WorkTaskId, snapshot: WorkTargetSnapshotView): Generator<{ targetId: string; x: number; y: number }> {
  const meta = WORK_TARGETS[task];
  if (meta.source === 'characters') {
    for (const c of snapshot.characters) {
      if (!c.alive && c.diedAtGameMinutes !== null) yield { targetId: c.id, x: c.x, y: c.y };
    }
    return;
  }
  if (meta.source === 'resources') {
    for (const node of snapshot.resources) {
      if (node.kind === meta.kind && (!meta.requireCharges || (node.charges ?? 0) > 0)) {
        yield { targetId: node.id, x: node.x, y: node.y };
      }
    }
    return;
  }
  for (const spot of snapshot.maintenance) {
    if (spot.kind === meta.kind) yield { targetId: spot.id, x: spot.x, y: spot.y };
  }
}

/** 同岗在册目标计数(工单行「浆果丛 N 处」文案与接单按钮置灰共用) */
export function countWorkTargets(task: WorkTaskId, snapshot: WorkTargetSnapshotView): number {
  let count = 0;
  for (const _ of workTargetCandidates(task, snapshot)) count += 1;
  return count;
}

/** 最近同岗目标(曼哈顿距离;自动接单与手点接单共用,无候选返回 null) */
export function nearestWorkTarget(
  task: WorkTaskId,
  from: { x: number; y: number },
  snapshot: WorkTargetSnapshotView,
): { targetId: string; distance: number } | null {
  let best: { targetId: string; distance: number } | null = null;
  for (const candidate of workTargetCandidates(task, snapshot)) {
    const distance = Math.abs(candidate.x - from.x) + Math.abs(candidate.y - from.y);
    if (best === null || distance < best.distance) {
      best = { targetId: candidate.targetId, distance };
    }
  }
  return best;
}
