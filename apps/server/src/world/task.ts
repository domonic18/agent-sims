import {
  JOB_CATEGORIES,
  LOW_ENERGY_THRESHOLD,
  MAINTENANCE_TASKS,
  REVIVE_WINDOW_MINUTES,
  type WorkTaskAcceptedEvent,
  type WorkTaskId,
} from '@sims/shared';
import { ensureAlive, type CharacterActivity, type WorldCharacter } from './character.js';
import type { Point } from './pathfinding.js';
import { findPath } from './pathfinding.js';
import type { Simulation } from './simulation.js';

/**
 * 维护工单(M-G.5,design/08 §4):单意图内含寻路→到位作业计时→按单结算。
 * 校验序:目标解析→存活→互斥(无活动/非移动中)→体力线→类别知识门槛→可达。
 * 目标解析:litter/fence_damage 维护点→clean/repair;幽灵态角色(窗口内)→rescue。
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
  const required = JOB_CATEGORIES[MAINTENANCE_TASKS[task].category].requiredKnowledge;
  if (character.knowledge < required) {
    throw new Error(
      `${character.name} 知识不足: ${JOB_CATEGORIES[MAINTENANCE_TASKS[task].category].label}类岗位需学习 ${required} 班(当前 ${character.knowledge})`,
    );
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

/** 工单目标→岗位:维护点按 kind 分派;幽灵角色进救治单(窗口外报错) */
function resolveTask(sim: Simulation, targetId: string): WorkTaskId {
  const spot = sim.maintenanceSpots.get(targetId);
  if (spot !== undefined) {
    return spot.kind === 'litter' ? 'clean' : 'repair';
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

/** 作业站位:杂物站维护点格(不阻塞通行);围栏/幽灵站目标四邻可行走格 */
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
  const center =
    task === 'repair'
      ? sim.maintenanceSpots.get(targetId)!
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
