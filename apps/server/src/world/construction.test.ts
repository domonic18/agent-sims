import { describe, expect, it } from 'vitest';
import { blockedRectsOf, TOWN_MAP, type BlockedRect, type TileMapDefinition } from '@sims/shared';
import { debugBuildFence, debugBuildPlace, debugRemoveBuiltPlace } from './construction.js';
import { Simulation, type SimulationArchive } from './simulation.js';

/** 隔断连通用合成底图(与 shared 矩阵底图同构):两屋对置,中轴留空 */
const matrixBase: TileMapDefinition = {
  width: 30,
  height: 20,
  blockedRects: [],
  paths: [{ x: 20, y: 10, w: 4, h: 1 }],
  places: [
    { id: 'left', name: '左屋', x: 2, y: 2, w: 4, h: 4, entrance: { x: 4, y: 6 }, door: { x: 4, y: 5 } },
    { id: 'right', name: '右屋', x: 14, y: 2, w: 4, h: 4, entrance: { x: 16, y: 6 }, door: { x: 16, y: 5 } },
  ],
  resources: [{ kind: 'berry_bush', x: 24, y: 14 }],
};

/** 在底图上扫描第一块 w×h 空地(距边≥1,不压障碍/道路/资源) */
function findFreeRect(base: TileMapDefinition, w: number, h: number): { x: number; y: number } {
  const rects = blockedRectsOf(base);
  const hits = (x: number, y: number, rect: BlockedRect): boolean =>
    x < rect.x + rect.w && rect.x < x + w && y < rect.y + rect.h && rect.y < y + h;
  for (let y = 1; y + h <= base.height - 1; y += 1) {
    for (let x = 1; x + w <= base.width - 1; x += 1) {
      if (rects.some((r) => hits(x, y, r))) continue;
      if ((base.paths ?? []).some((p) => hits(x, y, p))) continue;
      return { x, y };
    }
  }
  throw new Error('底图无空地');
}

describe('建造层接线(S2批1)', () => {
  it('debug 落建筑:基础图引用不动,合并图锚点/家具障碍生效', () => {
    const sim = new Simulation();
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    expect(debugBuildPlace(sim, 'build_home', rect.x, rect.y)).toEqual({ ok: true });
    expect(sim.baseDefinition).toBe(TOWN_MAP);
    const place = sim.map.placeById('built-1');
    expect(place).not.toBeNull();
    expect(sim.map.isWalkable(place!.entrance.x, place!.entrance.y)).toBe(true);
    const bed = place!.furniture![0]!;
    expect(sim.map.isWalkable(bed.x, bed.y)).toBe(false);
    sim.spawnCharacter('t1', place!.entrance.x, place!.entrance.y);
    expect(sim.built.places).toHaveLength(1);
    expect(sim.built.nextPlaceSeq).toBe(2);
  });

  it('debug 落建筑压既有场所被拒且零残留', () => {
    const sim = new Simulation();
    const existing = TOWN_MAP.places[0]!;
    const result = debugBuildPlace(sim, 'build_home', existing.x, existing.y);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('placement');
    expect(sim.built.places).toHaveLength(0);
    expect(sim.map.placeById('built-1')).toBeNull();
  });

  it('围栏隔断对侧入口被连通门禁拦截', () => {
    const sim = new Simulation();
    sim.setMap(matrixBase);
    const result = debugBuildFence(sim, { x: 10, y: 1, w: 1, h: 18 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('connectivity');
    expect(sim.built.fences).toHaveLength(0);
  });

  it('拆 built 建筑回滚合并图', () => {
    const sim = new Simulation();
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    debugBuildPlace(sim, 'build_home', rect.x, rect.y);
    expect(debugRemoveBuiltPlace(sim, 'built-1')).toEqual({ ok: true });
    expect(sim.map.placeById('built-1')).toBeNull();
    expect(sim.built.places).toHaveLength(0);
    expect(debugRemoveBuiltPlace(sim, 'built-1').ok).toBe(false);
  });

  it('存档 round-trip:建造层/单仓/资源枯竭现场全量回放', () => {
    const simA = new Simulation();
    simA.setMap(TOWN_MAP);
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    expect(debugBuildPlace(simA, 'build_home', rect.x, rect.y)).toEqual({ ok: true });
    const fenceRect = findFreeRect(TOWN_MAP, 1, 2);
    expect(debugBuildFence(simA, { ...fenceRect, w: 1, h: 2 })).toEqual({ ok: true });
    simA.storage['wood'] = 5;
    expect(simA.resourceNodes.size).toBeGreaterThan(0);
    const nodeId = [...simA.resourceNodes.keys()][0]!;
    simA.resourceNodes.get(nodeId)!.charges = 1;

    const archive = JSON.parse(JSON.stringify(simA.serialize())) as SimulationArchive;
    const simB = new Simulation();
    simB.setMap(TOWN_MAP);
    simB.restoreArchive(archive);
    expect(simB.baseDefinition).toBe(TOWN_MAP);
    expect(simB.built.places.map((p) => p.id)).toEqual(['built-1']);
    expect(simB.built.fences).toHaveLength(1);
    expect(simB.built.nextPlaceSeq).toBe(2);
    expect(simB.map.placeById('built-1')).not.toBeNull();
    expect(simB.storage['wood']).toBe(5);
    // applyBuilt 重建资源节点为满仓后,档案存量覆盖须保住枯竭现场(回放顺序护栏)
    expect(simB.resourceNodes.get(nodeId)!.charges).toBe(1);
    expect(simB.constructionSites.size).toBe(0);
  });

  it('旧档缺建造字段兼容回空', () => {
    const simA = new Simulation();
    const archive = JSON.parse(JSON.stringify(simA.serialize())) as Record<string, unknown>;
    delete archive.built;
    delete archive.constructionSites;
    delete archive.storage;
    const simB = new Simulation();
    simB.setMap(TOWN_MAP);
    simB.restoreArchive(archive as unknown as SimulationArchive);
    expect(simB.built.places).toHaveLength(0);
    expect(simB.built.nextPlaceSeq).toBe(1);
    expect(simB.map.places).toHaveLength(TOWN_MAP.places.length);
  });

  it('reset 清建造层且 seq 回 1', () => {
    const sim = new Simulation();
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    debugBuildPlace(sim, 'build_home', rect.x, rect.y);
    sim.storage['stone'] = 3;
    sim.reset();
    expect(sim.built.places).toHaveLength(0);
    expect(sim.built.nextPlaceSeq).toBe(1);
    expect(sim.storage).toEqual({});
    expect(sim.constructionSites.size).toBe(0);
    expect(debugBuildPlace(sim, 'build_home', rect.x, rect.y)).toEqual({ ok: true });
    expect(sim.built.places[0]!.id).toBe('built-1');
  });
});
