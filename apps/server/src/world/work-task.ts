import {
  GATHER_TASKS,
  getItem,
  inventoryVolume,
  JOB_CATEGORIES,
  LOW_ENERGY_THRESHOLD,
  MAINTENANCE_TASKS,
  REVIVE_WINDOW_MINUTES,
  WORK_TARGETS,
  isGatherTask,
  type GatherTaskId,
  type JobCategoryId,
  type WorkTaskAcceptedEvent,
  type WorkTaskId,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { ensureAlive, reviveCharacter, type CharacterActivity, type WorldCharacter } from './character.js';
import type { Point } from './pathfinding.js';
import { findPath } from './pathfinding.js';
import type { Simulation } from './simulation.js';

/**
 * 工单(M-G.5 维护三岗+M-G.6 采集两岗,design/08 §4+09 §2):
 * 单意图内含寻路→到位作业计时→按单结算。
 * 校验序:目标解析→存活→互斥(无活动/非移动中)→体力线→类别知识门槛→
 * 采集背包产出空间→可达。
 * 目标解析与站位均按 shared WORK_TARGETS 注册表(TD-1)的 source/kind 表驱动,
 * 新增工单只扩注册表,此处不改分支。
 */
export function requestWorkTask(
  sim: Simulation,
  characterId: string,
  targetId: string,
): WorldCharacter {
  const task = resolveTask(sim, targetId);
  const character = sim.character(characterId);
  ensureAlive(character);
  if (character.activity !== null) {
    throw new Error(`${character.name} 已在进行活动: ${character.activity.activityId}`);
  }
  if (character.path.length > 0) {
    throw new Error(`${character.name} 移动中,到达后再接单`);
  }
  if (character.energy <= LOW_ENERGY_THRESHOLD) {
    throw new Error(
      `${character.name} 体力过低(${Math.floor(character.energy)}≤${LOW_ENERGY_THRESHOLD}),先休息再接单`,
    );
  }
  const required = JOB_CATEGORIES[taskCategory(task)].requiredKnowledge;
  if (character.knowledge < required) {
    throw new Error(
      `${character.name} 知识不足: ${JOB_CATEGORIES[taskCategory(task)].label}类岗位需学习 ${required} 班(当前 ${character.knowledge})`,
    );
  }
  // 修补钉闭环(M-G.6):修理岗消耗品,接单须持钉(无则提示去木工台制作)
  if (task === 'repair' && (character.backpack.repair_kit ?? 0) < 1) {
    throw new Error(`${character.name} 没有修补钉,先去木工台用废料制作再来修`);
  }
  if (isGatherTask(task)) {
    ensureBackpackRoomForYields(character, task);
  }
  const standTile = standTileFor(sim, character, task, targetId);
  const path = findPath(sim.map, { x: character.x, y: character.y }, standTile);
  if (path === null) {
    throw new Error(`不可达: (${character.x},${character.y}) → (${standTile.x},${standTile.y})`);
  }
  const activity: CharacterActivity = {
    activityId: task,
    elapsed: 0,
    anchorKind: null,
    targetId,
  };
  character.activity = activity;
  character.path = path;
  const event: WorkTaskAcceptedEvent = {
    type: 'work_task.accepted',
    characterId: character.id,
    targetId,
    task,
    tick: sim.tick,
  };
  sim.events.emit(event);
  return character;
}

/** 按 source/kind 反查注册任务 id(TD-1):新 kind 注册进 WORK_TARGETS 即自动分派 */
function resolveTask(sim: Simulation, targetId: string): WorkTaskId {
  const spot = sim.maintenanceSpots.get(targetId);
  if (spot !== undefined) {
    const task = findTaskBy('maintenance', spot.kind);
    if (task === null) {
      throw new Error(`未注册的维护点类型: ${spot.kind}`);
    }
    return task;
  }
  const node = sim.resourceNodes.get(targetId);
  if (node !== undefined) {
    const task = findTaskBy('resources', node.kind);
    if (task === null) {
      throw new Error(`未注册的资源节点类型: ${node.kind}`);
    }
    if (WORK_TARGETS[task].requireCharges && node.charges === 0) {
      throw new Error('该节点已采完,等待重生后再来');
    }
    return task;
  }
  const target = sim.characters.get(targetId);
  if (target !== undefined) {
    if (target.alive) {
      throw new Error(`${target.name} 尚存活,无需救治`);
    }
    if (target.diedAtGameMinutes === null || sim.clock.gameMinutes - target.diedAtGameMinutes >= REVIVE_WINDOW_MINUTES) {
      throw new Error(`${target.name} 已错过救治窗口`);
    }
    return 'rescue';
  }
  throw new Error(`工单目标不存在: ${targetId}`);
}

function findTaskBy(source: 'maintenance' | 'resources', kind: string): WorkTaskId | null {
  const entry = Object.entries(WORK_TARGETS).find(
    ([, meta]) => meta.source === source && meta.kind === kind,
  );
  return entry === undefined ? null : (entry[0] as WorkTaskId);
}

/** 工单类别查表:采集两岗走 GATHER_TASKS,维护三岗走 MAINTENANCE_TASKS */
function taskCategory(task: WorkTaskId): JobCategoryId {
  return isGatherTask(task)
    ? GATHER_TASKS[task].category
    : MAINTENANCE_TASKS[task].category;
}

/** 采集接单背包预检:按最坏产出总体积校验(附带概率产出按必得计) */
function ensureBackpackRoomForYields(character: WorldCharacter, task: GatherTaskId): void {
  const worst = GATHER_TASKS[task].yields.reduce(
    (sum, y) => sum + y.count * (getItem(y.itemId)?.volume ?? 0),
    0,
  );
  const used = inventoryVolume(character.backpack);
  if (used + worst > BALANCE.BACKPACK_VOLUME_LIMIT) {
    throw new Error(
      `${character.name} 背包放不下产出(需 ${worst} 格,余 ${BALANCE.BACKPACK_VOLUME_LIMIT - used}),先吃点或回家存冰箱`,
    );
  }
}

/** 作业站位:杂物站维护点格(不阻塞通行);其余按 meta.source 取目标中心后站四邻最近可行走格 */
function standTileFor(
  sim: Simulation,
  character: WorldCharacter,
  task: WorkTaskId,
  targetId: string,
): Point {
  if (task === 'clean') {
    const spot = sim.maintenanceSpots.get(targetId)!;
    return { x: spot.x, y: spot.y };
  }
  const source = WORK_TARGETS[task].source;
  const center =
    source === 'maintenance'
      ? sim.maintenanceSpots.get(targetId)!
      : source === 'resources'
        ? sim.resourceNodes.get(targetId)!
        : sim.characters.get(targetId)!;
  const neighbors: Point[] = [
    { x: center.x - 1, y: center.y },
    { x: center.x + 1, y: center.y },
    { x: center.x, y: center.y - 1 },
    { x: center.x, y: center.y + 1 },
  ];
  const reachable = neighbors
    .filter((t) => sim.map.isWalkable(t.x, t.y))
    .sort(
      (a, b) =>
        Math.abs(a.x - character.x) + Math.abs(a.y - character.y) -
        (Math.abs(b.x - character.x) + Math.abs(b.y - character.y)),
    );
  for (const tile of reachable) {
    if (findPath(sim.map, { x: character.x, y: character.y }, tile) !== null) {
      return tile;
    }
  }
  // 全部四邻不可达:抛最近格让 findPath 在外层给出「不可达」报错
  return reachable[0] ?? { x: center.x, y: center.y };
}

/** 工单完成钩子上下文:debtFactor=缺觉系数(M-G.2,调用方按结算时刻计算传入) */
export interface WorkTaskCompletionContext {
  sim: Simulation;
  character: WorldCharacter;
  task: WorkTaskId;
  targetId: string;
  debtFactor: number;
}

/**
 * 完成钩子注册表(TD-1):只做世界侧变更(消目标/耗钉/复活/产出),
 * 返回 'ok' 走通用结算尾段(金币+completed 事件),'cancelled' 由调用方
 * 发 work_task.cancelled 并按 interrupted 收尾——repair 完成时刻钉被转移即此路。
 */
type WorkTaskCompletion = (ctx: WorkTaskCompletionContext) => 'ok' | 'cancelled';

const WORK_TASK_COMPLETIONS: Record<WorkTaskId, WorkTaskCompletion> = {
  clean: ({ sim, targetId }) => {
    sim.maintenanceSpots.delete(targetId);
    return 'ok';
  },
  repair: ({ sim, character, targetId }) => {
    // 修补钉闭环(M-G.6):完成时刻再验(作业期间存入冰箱等转移→无薪中断)
    const kit = character.backpack.repair_kit ?? 0;
    if (kit < 1) {
      return 'cancelled';
    }
    if (kit > 1) {
      character.backpack.repair_kit = kit - 1;
    } else {
      delete character.backpack.repair_kit;
    }
    sim.maintenanceSpots.delete(targetId);
    return 'ok';
  },
  rescue: ({ sim, targetId }) => {
    reviveCharacter(sim, sim.characters.get(targetId)!, 'rescue'); // 免扣复活
    return 'ok';
  },
  gather_berry: completeGather,
  scavenge: completeGather,
};

export function completeWorkTask(ctx: WorkTaskCompletionContext): 'ok' | 'cancelled' {
  return WORK_TASK_COMPLETIONS[ctx.task](ctx);
}

/** 采集完成(design/09 §2):产出逐项 roll 入背包,节点扣存量,枯竭记次日重生。
 * 缺觉日(M-G.2)产出 floor(count×系数)——单件产出可能为 0(有意);以物代薪 pay=0 */
function completeGather({ sim, character, task, targetId, debtFactor }: WorkTaskCompletionContext): 'ok' {
  const node = sim.resourceNodes.get(targetId)!;
  for (const yieldDef of GATHER_TASKS[task as GatherTaskId].yields) {
    if (yieldDef.chance !== undefined && sim.rng() >= yieldDef.chance) {
      continue;
    }
    character.backpack[yieldDef.itemId] =
      (character.backpack[yieldDef.itemId] ?? 0) + Math.floor(yieldDef.count * debtFactor);
  }
  if (node.charges !== null) {
    node.charges -= 1;
    if (node.charges <= 0) {
      node.respawnAtDay = sim.clock.day + 1;
    }
  }
  return 'ok';
}
