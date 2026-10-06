import {
  FENCE_MAX_SPOTS,
  FENCE_PERIOD_MINUTES,
  LITTER_MAX_SPOTS,
  LITTER_PERIOD_MINUTES,
  type MaintenanceSpot,
} from '@sims/shared';
import type { Simulation } from './simulation.js';

export type RandomFn = () => number;

/**
 * 世界损耗生成器(M-G.5,design/08 §3):按游戏分钟取模 roll,损耗纯氛围
 * 无数值后果——杂物每 60 分钟 1 个(户外可行走、不压场所占地/入口格/现有
 * spot,上限 12),围栏破损每 240 分钟 1 个(fenceTiles 随机格,上限 4)。
 */
export function stepMaintenance(sim: Simulation, rng: RandomFn): void {
  const minute = sim.clock.gameMinutes;
  if (minute % LITTER_PERIOD_MINUTES === 0) spawnLitter(sim, rng);
  if (minute % FENCE_PERIOD_MINUTES === 0) spawnFenceDamage(sim, rng);
}

function spawnLitter(sim: Simulation, rng: RandomFn): void {
  const existing = new Set(
    [...sim.maintenanceSpots.values()].filter((s) => s.kind === 'litter').map((s) => `${s.x},${s.y}`),
  );
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < sim.map.height - 1; y += 1) {
    for (let x = 1; x < sim.map.width - 1; x += 1) {
      if (!sim.map.isWalkable(x, y)) continue;
      if (sim.map.placeAt(x, y) !== null) continue;
      if (occupiedEntrance(sim, x, y)) continue;
      if (existing.has(`${x},${y}`)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return;
  const spot = pick(candidates, rng, 'litter');
  register(sim, spot);
}

function spawnFenceDamage(sim: Simulation, rng: RandomFn): void {
  const existing = new Set(
    [...sim.maintenanceSpots.values()]
      .filter((s) => s.kind === 'fence_damage')
      .map((s) => `${s.x},${s.y}`),
  );
  const candidates = sim.map.fenceTiles().filter((t) => !existing.has(`${t.x},${t.y}`));
  if (candidates.length === 0) return;
  const spot = pick(candidates, rng, 'fence_damage');
  register(sim, spot);
}

/** 入口格(门外通路)不可落杂物——会堵死寻路 */
function occupiedEntrance(sim: Simulation, x: number, y: number): boolean {
  return sim.map.places.some((p) => p.entrance.x === x && p.entrance.y === y);
}

function pick(
  candidates: Array<{ x: number; y: number }>,
  rng: RandomFn,
  kind: MaintenanceSpot['kind'],
): MaintenanceSpot {
  const tile = candidates[Math.floor(rng() * candidates.length)]!;
  return {
    id: `${kind}:${tile.x}:${tile.y}`,
    kind,
    x: tile.x,
    y: tile.y,
    variant: Math.floor(rng() * 4),
  };
}

/** 上限封顶 + 登记事件;id=坐标形态天然去重 */
function register(sim: Simulation, spot: MaintenanceSpot): void {
  const limit = spot.kind === 'litter' ? LITTER_MAX_SPOTS : FENCE_MAX_SPOTS;
  const count = [...sim.maintenanceSpots.values()].filter((s) => s.kind === spot.kind).length;
  if (count >= limit) return;
  sim.maintenanceSpots.set(spot.id, spot);
  sim.events.emit({ type: 'maintenance.spawned', spot, tick: sim.tick });
}
