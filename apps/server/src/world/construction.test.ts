import { afterEach, describe, expect, it } from 'vitest';
import {
  blockedRectsOf,
  TOWN_MAP,
  type BlockedRect,
  type TileMapDefinition,
  type WorldEvent,
} from '@sims/shared';
import {
  debugBuildFence,
  debugBuildPlace,
  debugRemoveBuiltPlace,
  requestBuild,
} from './construction.js';
import { applyWorldParams } from '../config/balance.js';
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

/** 建造流程(S2批2)夹具:survival 模式+知识达标角色 */
function survivalSim(): Simulation {
  const sim = new Simulation();
  sim.setMap(TOWN_MAP);
  sim.setGameMode('survival');
  return sim;
}

function spawnBuilder(sim: Simulation, id: string, knowledge = 6): void {
  sim.spawnCharacter(id, 8, 12);
  sim.character(id).knowledge = knowledge;
}

function seedStorage(sim: Simulation, materials: Record<string, number>): void {
  for (const [itemId, count] of Object.entries(materials)) {
    sim.storage[itemId] = (sim.storage[itemId] ?? 0) + count;
  }
}

function collectEvents(sim: Simulation): WorldEvent[] {
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  return events;
}

describe('建造流程(S2批2)', () => {
  it('build 全链:单仓扣料+建单寻路+placed 事件+快照字段', () => {
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    seedStorage(sim, { wood: 12, stone: 8, metal: 4 });
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    const events = collectEvents(sim);
    requestBuild(sim, 'b1', 'build_home', rect.x, rect.y);
    expect(sim.storage).toEqual({});
    const site = sim.constructionSites.get('site-1')!;
    expect(site).toMatchObject({
      blueprintId: 'build_home',
      builderId: 'b1',
      durationMinutes: 480,
      pay: 60,
      materials: { wood: 12, stone: 8, metal: 4 },
    });
    expect(sim.nextSiteSeq).toBe(2);
    const character = sim.character('b1');
    expect(character.activity).toMatchObject({ activityId: 'construction', targetId: 'site-1' });
    expect(events.map((e) => e.type)).toContain('construction.placed');
    const snapshot = sim.snapshot();
    expect(snapshot.constructionSites.map((s) => s.id)).toEqual(['site-1']);
    expect(snapshot.storage).toEqual({});
    expect(snapshot.storageSpot).toBeNull(); // TOWN_MAP 无 townCore
  });

  it('单仓材料不足拒绝且零残留', () => {
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    expect(() => requestBuild(sim, 'b1', 'build_home', rect.x, rect.y)).toThrow(/单仓材料不足/);
    expect(sim.constructionSites.size).toBe(0);
    expect(sim.character('b1').activity).toBeNull();
  });

  it('growth 模式与知识门槛拒绝', () => {
    const growth = new Simulation();
    growth.setMap(TOWN_MAP);
    growth.spawnCharacter('g1', 8, 12);
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    expect(() => requestBuild(growth, 'g1', 'build_home', rect.x, rect.y)).toThrow(/未在当前模式开放/);
    const sim = survivalSim();
    spawnBuilder(sim, 'b1', 5);
    seedStorage(sim, { wood: 12, stone: 8, metal: 4 });
    expect(() => requestBuild(sim, 'b1', 'build_home', rect.x, rect.y)).toThrow(/知识不足/);
    expect(sim.storage['wood']).toBe(12);
  });

  it('与在建工单重叠拒绝', () => {
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    sim.spawnCharacter('b2', 9, 12);
    sim.character('b2').knowledge = 6;
    seedStorage(sim, { wood: 24, stone: 16, metal: 8 });
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    requestBuild(sim, 'b1', 'build_home', rect.x, rect.y);
    expect(() => requestBuild(sim, 'b2', 'build_home', rect.x, rect.y)).toThrow(/在建工单 site-1 重叠/);
  });

  it('施工完成:建筑落地+按单入账+销单', () => {
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    seedStorage(sim, { wood: 12, stone: 8, metal: 4 });
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    requestBuild(sim, 'b1', 'build_home', rect.x, rect.y);
    const events = collectEvents(sim);
    sim.advanceTicks(700); // 寻路 + 480 工时
    expect(sim.constructionSites.size).toBe(0);
    expect(sim.built.places).toHaveLength(1);
    expect(sim.map.placeById('built-1')).not.toBeNull();
    expect(sim.character('b1').activity).toBeNull();
    expect(sim.character('b1').coins).toBe(60);
    const completed = events.find((e) => e.type === 'construction.completed');
    expect(completed).toMatchObject({ siteId: 'site-1', placeId: 'built-1', pay: 60 });
    expect(events.map((e) => e.type)).toContain('world.map_changed');
  });

  it('中断退料销单:单仓回满+cancelled 事件', () => {
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    seedStorage(sim, { wood: 12, stone: 8, metal: 4 });
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    requestBuild(sim, 'b1', 'build_home', rect.x, rect.y);
    const events = collectEvents(sim);
    sim.requestStopActivity('b1');
    expect(sim.storage).toEqual({ wood: 12, stone: 8, metal: 4 });
    expect(sim.constructionSites.size).toBe(0);
    expect(sim.built.places).toHaveLength(0);
    expect(sim.character('b1').activity).toBeNull();
    expect(events.map((e) => e.type)).toContain('construction.cancelled');
  });

  it('围栏订单按格数扣料,落地入 built', () => {
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    seedStorage(sim, { wood: 5 });
    const rect = findFreeRect(TOWN_MAP, 1, 3);
    requestBuild(sim, 'b1', 'build_fence', rect.x, rect.y, 1, 3);
    expect(sim.storage['wood']).toBe(2);
    expect(sim.constructionSites.get('site-1')).toMatchObject({
      durationMinutes: 33, // 15 + 6×3
      pay: 6,
    });
    sim.advanceTicks(120);
    expect(sim.constructionSites.size).toBe(0);
    expect(sim.built.fences).toEqual([{ x: rect.x, y: rect.y, w: 1, h: 3 }]);
    expect(sim.character('b1').coins).toBe(6);
  });

  it('applyBuilt 保留资源枯竭现场且广播 map_changed', () => {
    const sim = new Simulation();
    sim.setMap(TOWN_MAP);
    const events = collectEvents(sim);
    const nodeId = [...sim.resourceNodes.keys()][0]!;
    sim.resourceNodes.get(nodeId)!.charges = 1;
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    expect(debugBuildPlace(sim, 'build_home', rect.x, rect.y)).toEqual({ ok: true });
    expect(sim.resourceNodes.get(nodeId)!.charges).toBe(1);
    expect(events.map((e) => e.type)).toContain('world.map_changed');
  });

  it('存档 round-trip 保在制工单,恢复后续建到完工', () => {
    const simA = survivalSim();
    spawnBuilder(simA, 'b1');
    seedStorage(simA, { wood: 12, stone: 8, metal: 4 });
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    requestBuild(simA, 'b1', 'build_home', rect.x, rect.y);
    const archive = JSON.parse(JSON.stringify(simA.serialize())) as SimulationArchive;
    const simB = survivalSim();
    simB.restoreArchive(archive);
    expect(simB.constructionSites.get('site-1')).toMatchObject({ builderId: 'b1', pay: 60 });
    expect(simB.nextSiteSeq).toBe(2);
    expect(simB.character('b1').activity).toMatchObject({ activityId: 'construction', targetId: 'site-1' });
    simB.advanceTicks(700);
    expect(simB.constructionSites.size).toBe(0);
    expect(simB.map.placeById('built-1')).not.toBeNull();
    expect(simB.character('b1').coins).toBe(60);
  });
});

describe('镇核心单仓(S2批2)', () => {
  /** 合成单仓底图:townCore 4×4 → storageSpot=(12,9) */
  function storageSim(): { sim: Simulation; spot: { x: number; y: number } } {
    const sim = new Simulation();
    sim.setMap({
      width: 20,
      height: 16,
      blockedRects: [],
      paths: [],
      places: [
        { id: 'a', name: 'A', x: 2, y: 2, w: 3, h: 3, entrance: { x: 3, y: 5 }, door: { x: 3, y: 4 } },
      ],
      townCore: { x: 10, y: 6, w: 4, h: 4 },
    });
    return { sim, spot: sim.storageSpot! };
  }

  it('storageSpot 由 townCore 底边中点派生,无 townCore 为 null', () => {
    const { spot } = storageSim();
    expect(spot).toEqual({ x: 12, y: 9 });
    const plain = new Simulation();
    plain.setMap(TOWN_MAP);
    expect(plain.storageSpot).toBeNull();
  });

  it('store/take target=storage 站邻分流', () => {
    const { sim, spot } = storageSim();
    sim.spawnCharacter('c1', spot.x, spot.y + 1);
    const character = sim.character('c1');
    character.backpack['wood'] = 3;
    sim.requestStoreItem('c1', 'wood', 3, 'storage');
    expect(sim.storage).toEqual({ wood: 3 });
    expect(character.backpack['wood']).toBeUndefined();
    sim.requestTakeItem('c1', 'wood', 2, 'storage');
    expect(sim.storage).toEqual({ wood: 1 });
    expect(character.backpack['wood']).toBe(2);
  });

  it('非邻站/无镇核心/容积满均拒绝', () => {
    const { sim, spot } = storageSim();
    sim.spawnCharacter('far', 6, 8);
    sim.character('far').backpack['wood'] = 1;
    expect(() => sim.requestStoreItem('far', 'wood', 1, 'storage')).toThrow(/站单仓旁/);
    const plain = new Simulation();
    plain.setMap(TOWN_MAP);
    plain.spawnCharacter('c1', 8, 12);
    plain.character('c1').backpack['wood'] = 1;
    expect(() => plain.requestStoreItem('c1', 'wood', 1, 'storage')).toThrow(/无镇核心单仓/);
    const { sim: full } = storageSim();
    full.spawnCharacter('c1', spot.x, spot.y + 1);
    full.character('c1').backpack['wood'] = 1;
    full.storage['wood'] = 200;
    expect(() => full.requestStoreItem('c1', 'wood', 1, 'storage')).toThrow(/单仓已满/);
  });

  it('单仓容积可经世界参数收紧(S2批3)', () => {
    applyWorldParams();
    const { sim, spot } = storageSim();
    sim.spawnCharacter('c1', spot.x, spot.y + 1);
    sim.setParams({ STORAGE_VOLUME_LIMIT: 2 });
    sim.character('c1').backpack['wood'] = 3;
    sim.requestStoreItem('c1', 'wood', 2, 'storage');
    expect(sim.storage['wood']).toBe(2);
    expect(() => sim.requestStoreItem('c1', 'wood', 1, 'storage')).toThrow(/单仓已满/);
    applyWorldParams();
  });
});

describe('建造世界参数(S2批3)', () => {
  afterEach(() => applyWorldParams()); // BALANCE 是模块级可变单例,参数测试后复位防泄漏

  it('关知识门槛开关后 0 班可建(默认开则拒)', () => {
    applyWorldParams();
    const sim = survivalSim();
    spawnBuilder(sim, 'b0', 0);
    seedStorage(sim, { wood: 12, stone: 8, metal: 4 });
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    expect(() => requestBuild(sim, 'b0', 'build_home', rect.x, rect.y)).toThrow(/知识不足/);
    sim.setParams({ CONSTRUCTION_KNOWLEDGE_GATE: 0 });
    requestBuild(sim, 'b0', 'build_home', rect.x, rect.y);
    expect(sim.constructionSites.get('site-1')).toMatchObject({ blueprintId: 'build_home' });
  });

  it('工时倍率缩放 place 工时且工资不变,下单快照不追溯在制单', () => {
    applyWorldParams();
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    seedStorage(sim, { wood: 12, stone: 8, metal: 4 });
    sim.setParams({ CONSTRUCTION_TIME_SCALE: 2 });
    const rect = findFreeRect(TOWN_MAP, 7, 5);
    requestBuild(sim, 'b1', 'build_home', rect.x, rect.y);
    expect(sim.constructionSites.get('site-1')).toMatchObject({ durationMinutes: 960, pay: 60 });
    sim.setParams({ CONSTRUCTION_TIME_SCALE: 1 });
    expect(sim.constructionSites.get('site-1')!.durationMinutes).toBe(960);
  });

  it('围栏工时按倍率缩放: (15+6×3)×2=66', () => {
    applyWorldParams();
    const sim = survivalSim();
    spawnBuilder(sim, 'b1');
    seedStorage(sim, { wood: 6 });
    sim.setParams({ CONSTRUCTION_TIME_SCALE: 2 });
    const rect = findFreeRect(TOWN_MAP, 1, 3);
    requestBuild(sim, 'b1', 'build_fence', rect.x, rect.y, 1, 3);
    expect(sim.constructionSites.get('site-1')).toMatchObject({ durationMinutes: 66, pay: 6 });
  });
});
