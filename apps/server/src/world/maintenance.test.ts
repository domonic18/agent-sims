import { describe, expect, it } from 'vitest';
import {
  FENCE_MAX_SPOTS,
  LITTER_MAX_SPOTS,
  LITTER_PERIOD_MINUTES,
  type MaintenanceSpot,
} from '@sims/shared';
import { Simulation } from './simulation.js';

/** mulberry32 确定性随机源(同种子同序列,损耗生成可复现) */
function rngOf(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byKind = (spots: Map<string, MaintenanceSpot>, kind: MaintenanceSpot['kind']): MaintenanceSpot[] =>
  [...spots.values()].filter((s) => s.kind === kind);

describe('损耗生成器(M-G.5)', () => {
  it('周期对齐: 60 分钟 roll 杂物,240 分钟 roll 围栏破损', () => {
    const sim = new Simulation(rngOf(7));
    sim.advanceTicks(LITTER_PERIOD_MINUTES - 1);
    expect(sim.maintenanceSpots.size).toBe(0); // 未到首个周期界
    sim.advanceTicks(1);
    expect(byKind(sim.maintenanceSpots, 'litter')).toHaveLength(1);
    sim.advanceTicks(239 - 60);
    expect(byKind(sim.maintenanceSpots, 'fence_damage')).toHaveLength(0);
    sim.advanceTicks(1); // tick 240 → gameMinutes=720,240 的倍数
    expect(byKind(sim.maintenanceSpots, 'fence_damage')).toHaveLength(1);
  });

  it('落点合法: 可行走、不压场所占地与入口格、不与现有 spot 重格', () => {
    const sim = new Simulation(rngOf(42));
    sim.advanceTicks(60 * 6);
    const litter = byKind(sim.maintenanceSpots, 'litter');
    expect(litter.length).toBeGreaterThanOrEqual(2);
    const seen = new Set<string>();
    for (const spot of litter) {
      expect(sim.map.isWalkable(spot.x, spot.y), spot.id).toBe(true);
      expect(sim.map.placeAt(spot.x, spot.y), spot.id).toBeNull();
      expect(sim.map.places.some((p) => p.entrance.x === spot.x && p.entrance.y === spot.y)).toBe(false);
      expect(seen.has(`${spot.x},${spot.y}`)).toBe(false);
      seen.add(`${spot.x},${spot.y}`);
    }
  });

  it('破损必在 fenceTiles() 内(TOWN_MAP 公园北缘)', () => {
    const sim = new Simulation(rngOf(9));
    sim.advanceTicks(240 * 2);
    const tiles = sim.map.fenceTiles();
    for (const spot of byKind(sim.maintenanceSpots, 'fence_damage')) {
      expect(tiles).toContainEqual({ x: spot.x, y: spot.y });
    }
  });

  it('上限封顶: 杂物 12 / 破损 4,届满不再增', () => {
    const sim = new Simulation(rngOf(3));
    sim.advanceTicks(60 * (LITTER_MAX_SPOTS + 2));
    expect(byKind(sim.maintenanceSpots, 'litter')).toHaveLength(LITTER_MAX_SPOTS);
    sim.advanceTicks(240 * (FENCE_MAX_SPOTS + 2));
    expect(byKind(sim.maintenanceSpots, 'fence_damage')).toHaveLength(FENCE_MAX_SPOTS);
  });

  it('reset 清空维护点;快照透传全量', () => {
    const sim = new Simulation(rngOf(11));
    sim.advanceTicks(120);
    expect(sim.maintenanceSpots.size).toBeGreaterThanOrEqual(1);
    expect(sim.snapshot().maintenance).toEqual([...sim.maintenanceSpots.values()]);
    sim.reset();
    expect(sim.maintenanceSpots.size).toBe(0);
    expect(sim.snapshot().maintenance).toEqual([]);
  });

  it('同种子两次推进损耗序列完全一致(确定性)', () => {
    const a = new Simulation(rngOf(2026));
    const b = new Simulation(rngOf(2026));
    a.advanceTicks(600);
    b.advanceTicks(600);
    expect([...a.maintenanceSpots.values()]).toEqual([...b.maintenanceSpots.values()]);
  });
});
