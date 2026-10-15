import {
  CONSTRUCTION_MATERIALS,
  GATHER_TASKS,
  getItem,
  inventoryVolume,
  JOB_CATEGORIES,
  LOW_ENERGY_THRESHOLD,
  MAINTENANCE_TASKS,
  REVIVE_WINDOW_MINUTES,
  WORK_TARGETS,
  isGatherTask,
  type GatherTaskDef,
  type GatherTaskId,
  type JobCategoryId,
  type WorkTaskAcceptedEvent,
  type WorkTaskId,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import {
  ensureAlive,
  ensureNotCollapsed,
  reviveCharacter,
  type CharacterActivity,
  type WorldCharacter,
} from './character.js';
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
  ensureNotCollapsed(character);
  if (character.activity !== null) {
    throw new Error(`${character.name} 已在进行活动: ${character.activity.activityId}`);
  }
  if (character.path.length > 0) {
    throw new Error(`${character.name} 移动中,到达后再接单`);
  }
  // 体力线(E4 采食豁免):饿死边缘去采食物(背包无食)降到 FORAGE_EXEMPT_ENERGY——
  // 自救通路不该被接单闸拦死;其余工单维持体力下限
  const energyLine =
    isGatherTask(task) &&
    GATHER_TASKS[task].yields.some((y) => getItem(y.itemId)?.category === 'food') &&
    !Object.keys(character.backpack).some((id) => getItem(id)?.category === 'food')
      ? BALANCE.FORAGE_EXEMPT_ENERGY
      : LOW_ENERGY_THRESHOLD;
  if (character.energy <= energyLine) {
    throw new Error(
      `${character.name} 体力过低(${Math.floor(character.energy)}≤${energyLine}),先休息再接单`,
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

/** 采集岗背包容量预检(纯判定,wantSelect 候选期过滤与 work_task 接单预检同源):
 * 最坏产出总体积(附带概率产出按必得计;建造建材除外——S2-C N1 直入单仓不经
 * 背包)是否装得下——缺此判定,满包采集 want 高 urgency 每块赢每块被拒,3 连拒
 * 清整日意图,存仓出口永无调度窗口 */
export function hasBackpackRoomForGather(
  character: Pick<WorldCharacter, 'backpack'>,
  activityId: string,
): boolean {
  const task = (GATHER_TASKS as Record<string, GatherTaskDef | undefined>)[activityId];
  if (task === undefined) return false;
  const worst = backpackYieldVolume(task);
  return inventoryVolume(character.backpack) + worst <= BALANCE.BACKPACK_VOLUME_LIMIT;
}

/** 背包侧最坏产出体积:建造建材(CONSTRUCTION_MATERIALS)直入单仓不占背包 */
function backpackYieldVolume(task: GatherTaskDef): number {
  return task.yields.reduce(
    (sum, y) =>
      CONSTRUCTION_MATERIALS.has(y.itemId) ? sum : sum + y.count * (getItem(y.itemId)?.volume ?? 0),
    0,
  );
}

/** 采集接单背包预检:按最坏产出总体积校验(附带概率产出按必得计) */
function ensureBackpackRoomForYields(character: WorldCharacter, task: GatherTaskId): void {
  const worst = backpackYieldVolume(GATHER_TASKS[task]);
  const used = inventoryVolume(character.backpack);
  if (used + worst > BALANCE.BACKPACK_VOLUME_LIMIT) {
    throw new Error(
      `${character.name} 背包放不下产出(需 ${worst} 格,余 ${BALANCE.BACKPACK_VOLUME_LIMIT - used}),先吃点或回家存冰箱`,
    );
  }
}

/** 目标四邻中离 from 最近的可行走格(E4 从 standTileFor 抽出,作业站位与 agent
 * 两段式节点寻址共用):canReach 附加可达性过滤(默认只查可行走);全不可行返回 null */
export function nearestWalkableAdjacent(
  map: { isWalkable(x: number, y: number): boolean },
  center: { x: number; y: number },
  from: { x: number; y: number },
  canReach?: (tile: Point) => boolean,
): Point | null {
  const neighbors: Point[] = [
    { x: center.x - 1, y: center.y },
    { x: center.x + 1, y: center.y },
    { x: center.x, y: center.y - 1 },
    { x: center.x, y: center.y + 1 },
  ];
  return (
    neighbors
      .filter((t) => map.isWalkable(t.x, t.y) && (canReach === undefined || canReach(t)))
      .sort(
        (a, b) =>
          Math.abs(a.x - from.x) + Math.abs(a.y - from.y) -
          (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)),
      )[0] ?? null
  );
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
  return (
    nearestWalkableAdjacent(sim.map, center, character, (tile) =>
      findPath(sim.map, { x: character.x, y: character.y }, tile) !== null,
    ) ??
    // 全部四邻不可达:抛中心让 findPath 在外层给出「不可达」报错
    { x: center.x, y: center.y }
  );
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
  chop_tree: completeGather,
  mine_rock: completeGather,
  salvage_metal: completeGather,
  pick_apple: completeGather,
  harvest_wheat: completeGather,
};

export function completeWorkTask(ctx: WorkTaskCompletionContext): 'ok' | 'cancelled' {
  return WORK_TASK_COMPLETIONS[ctx.task](ctx);
}

/** 采集完成(design/09 §2):产出逐项 roll,节点扣存量,枯竭按热调
 * NODE_RESPAWN_DAYS 记重生日(次日 00:00 计,1=次日回满)。
 * 建造建材直入单仓不经背包(S2-C N1,集合自蓝图材料表派生)——「存入单仓」
 * 原只挂在 construction want 执行分支,LLM 见镇情差料理性不排建造→单仓恒空的
 * 鸡生蛋断点在此打通(与施工「材料不经背包」同哲学);仓满容积闸溢出留背包。
 * wheat/scrap 等 material 类制作原料照旧入背包(灶台/木工台经背包消费,入仓
 * 即断供)。缺觉日(M-G.2)产出 floor(count×系数) 但保底 1 件(2026-10-15 死亡
 * 悠悠球:归零式没收曾让零睡眠采集者收入恒 0,复活也无法自救);
 * 以物代薪 pay=0 */
function completeGather({ sim, character, task, targetId, debtFactor }: WorkTaskCompletionContext): 'ok' {
  const node = sim.resourceNodes.get(targetId)!;
  for (const yieldDef of GATHER_TASKS[task as GatherTaskId].yields) {
    if (yieldDef.chance !== undefined && sim.rng() >= yieldDef.chance) {
      continue;
    }
    // 缺觉折扣保底 1 件(2026-10-15 死亡悠悠球):floor(count×系数) 对单件产出
    // (苹果 1)恒为 0,叠加零睡眠即采集收入死锁——产出可打折,不可整单没收
    const count = Math.max(1, Math.floor(yieldDef.count * debtFactor));
    if (CONSTRUCTION_MATERIALS.has(yieldDef.itemId)) {
      const freeByVolume = BALANCE.STORAGE_VOLUME_LIMIT - inventoryVolume(sim.storage);
      const stored = Math.min(count, Math.max(freeByVolume, 0));
      if (stored > 0) {
        sim.storage[yieldDef.itemId] = (sim.storage[yieldDef.itemId] ?? 0) + stored;
      }
      if (stored < count) {
        character.backpack[yieldDef.itemId] =
          (character.backpack[yieldDef.itemId] ?? 0) + (count - stored);
      }
    } else {
      character.backpack[yieldDef.itemId] = (character.backpack[yieldDef.itemId] ?? 0) + count;
    }
  }
  if (node.charges !== null) {
    node.charges -= 1;
    if (node.charges <= 0) {
      node.respawnAtDay = sim.clock.day + BALANCE.NODE_RESPAWN_DAYS;
    }
  }
  return 'ok';
}
