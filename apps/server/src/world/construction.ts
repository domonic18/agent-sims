/**
 * 建造层 server 接线(S2批1 落图 + S2批2 建造流程):
 * applyBuilt 是建造产物唯一落地点——definitionWithBuilt 纯拼接合并图,
 * setMap 重建阻塞层/锚点/围栏格(fromDefinition 构造即校验,坏图直接抛);
 * asBase:false 防止合并图反客为主,基础图保持 config.map 不动,
 * 后续建造始终在 base 上叠加 built。debug 端点与 build 意图走完全相同的
 * 评估链(evaluateBuildPlacement),自批1 即同门禁。
 * 批2 工单流(work_task 式,craft.ts 同构):requestBuild 校验链(模式/知识/
 * 选区/单仓预检)→扣料建单→寻路→stepConstruction 逐分钟(到位才计时,
 * 时长按挂单快照)→完成落地 applyBuilt+按单入账;中断经 finishActivity
 * 钩子退料销单无薪(诚实原则同 craft 中断退料)。
 */
import type {
  ActivityDefinition,
  BlockedRect,
  BuildBlueprint,
  BuildIssue,
  ConstructionCompletedEvent,
  ConstructionPlacedEvent,
  ConstructionSite,
  PlaceDefinition,
  TileMapDefinition,
  WorldMapChangedEvent,
} from '@sims/shared';
import {
  LOW_ENERGY_THRESHOLD,
  definitionWithBuilt,
  evaluateBuildPlacement,
  getBuildBlueprint,
  getItem,
  stampBuiltPlace,
} from '@sims/shared';
import type { Point } from './pathfinding.js';
import { findPath } from './pathfinding.js';
import { settleActivityMinute, finishActivity } from './activity.js';
import { debtFactor } from './settlement.js';
import { BALANCE } from '../config/balance.js';
import type { Simulation } from './simulation.js';
import { ensureAlive, ensureNotCollapsed, type WorldCharacter } from './character.js';

/**
 * 建造产物落图:重建阻塞层/锚点/围栏格(built 建筑对寻路与活动天然生效)。
 * 资源存量跨 setMap 保留——setMap 会把资源节点重建为满仓,凭空补仓会白送
 * 采集成果;重建后按 id 回填枯竭现场。world.map_changed 在此单点广播
 * (debug 建造与施工完成共用同一漏斗),前端 refetch 合并图重绘。
 */
export function applyBuilt(sim: Simulation): void {
  const nodes = [...sim.resourceNodes.values()];
  sim.setMap(definitionWithBuilt(sim.baseDefinition, sim.built), { asBase: false });
  for (const prev of nodes) {
    const fresh = sim.resourceNodes.get(prev.id);
    if (fresh !== undefined) {
      fresh.charges = prev.charges;
      fresh.respawnAtDay = prev.respawnAtDay;
    }
  }
  const event: WorldMapChangedEvent = { type: 'world.map_changed', tick: sim.tick };
  sim.events.emit(event);
}

/** 单仓实体格:镇核心区底边中点(townCore 是分区概念不阻塞行走,实体格本身
 * 可走,角色站格或四邻即可存取);无镇核心(内置图/growth 生成图)返回
 * null=单仓存取禁用——建造同样无料可扣,与蓝图 survival 门控天然对齐 */
export function deriveStorageSpot(definition: TileMapDefinition): { x: number; y: number } | null {
  const core = definition.townCore;
  if (core === undefined) return null;
  return { x: core.x + Math.floor(core.w / 2), y: core.y + core.h - 1 };
}

export type BuildOpResult = { ok: true } | { ok: false; issues: BuildIssue[] };

/**
 * 建造接单(S2批2):发起者即施工者。校验序:蓝图解析→模式门控→存活/互斥→
 * 知识门槛→体力线→选区评估(尺寸/越界/重叠/道路/结构/连通+在建单重叠)→
 * 单仓材料预检→站位(足迹圈外,防完工瞬间被困墙内)→扣料建单→寻路→挂单。
 */
export function requestBuild(
  sim: Simulation,
  characterId: string,
  blueprintId: string,
  x: number,
  y: number,
  w?: number,
  h?: number,
): WorldCharacter {
  const blueprint = getBuildBlueprint(blueprintId);
  if (blueprint === null) {
    throw new Error(`未知建造蓝图: ${blueprintId}`);
  }
  if (!blueprint.gameTypes.includes(sim.gameType)) {
    throw new Error(`「${blueprint.label}」未在当前模式开放`);
  }
  const character = sim.character(characterId);
  ensureAlive(character);
  ensureNotCollapsed(character);
  if (character.activity !== null) {
    throw new Error(`${character.name} 已在进行活动: ${character.activity.activityId}`);
  }
  if (character.path.length > 0) {
    throw new Error(`${character.name} 移动中,到达后再接单`);
  }
  if (BALANCE.CONSTRUCTION_KNOWLEDGE_GATE === 1 && character.knowledge < blueprint.requiredKnowledge) {
    throw new Error(
      `${character.name} 知识不足: 建造需学习 ${blueprint.requiredKnowledge} 班(当前 ${character.knowledge})`,
    );
  }
  if (character.energy <= LOW_ENERGY_THRESHOLD) {
    throw new Error(
      `${character.name} 体力过低(${Math.floor(character.energy)}≤${LOW_ENERGY_THRESHOLD}),先休息再接单`,
    );
  }
  const rect = resolveBuildRect(blueprint, x, y, w, h);
  const materials = buildOrderCosts(blueprint, rect);
  ensureStorageHas(sim, materials);
  const { issues } = evaluateBuildPlacement(sim.baseDefinition, sim.built, blueprint, rect);
  const siteOverlap = [...sim.constructionSites.values()].find((site) => intersects(rect, site));
  if (siteOverlap !== undefined) {
    issues.push({ code: 'placement', message: `选区与在建工单 ${siteOverlap.id} 重叠` });
  }
  if (issues.length > 0) {
    throw new Error(issues[0]!.message);
  }
  const standTile = standTileOutsideFootprint(sim, character, rect);
  if (standTile === null) {
    throw new Error(`选区四周无可站位或不可达: (${rect.x},${rect.y})`);
  }
  // 扣料建单(预检已验足额,此处直接扣;0 存量清键保快照干净)
  for (const [itemId, count] of Object.entries(materials)) {
    const left = (sim.storage[itemId] ?? 0) - count;
    if (left > 0) {
      sim.storage[itemId] = left;
    } else {
      delete sim.storage[itemId];
    }
  }
  const site: ConstructionSite = {
    id: `site-${sim.nextSiteSeq}`,
    blueprintId: blueprint.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    createdAtGameMinute: sim.clock.gameMinutes,
    builderId: character.id,
    materials,
    durationMinutes: orderDurationMinutes(blueprint, rect),
    pay: orderPay(blueprint, rect),
  };
  sim.nextSiteSeq += 1;
  sim.constructionSites.set(site.id, site);
  const path = findPath(sim.map, { x: character.x, y: character.y }, standTile);
  if (path === null) {
    // 守卫回滚(站位已验可达,理论不达):销单退料不留半挂单
    cancelConstructionSite(sim, site.id, character.id);
    throw new Error('前往选区不可达,建造单已撤销');
  }
  character.activity = { activityId: 'construction', elapsed: 0, anchorKind: null, targetId: site.id };
  character.path = path;
  const event: ConstructionPlacedEvent = {
    type: 'construction.placed',
    siteId: site.id,
    characterId: character.id,
    blueprintId: blueprint.id,
    tick: sim.tick,
  };
  sim.events.emit(event);
  return character;
}

/** 施工逐分钟结算(work_task 同构):在途不计时;到位时长按挂单快照;完成落地 */
export function stepConstruction(
  sim: Simulation,
  character: WorldCharacter,
  definition: ActivityDefinition,
): void {
  const activity = character.activity;
  if (activity === null || character.path.length > 0) {
    return; // 在途不结算
  }
  const site = sim.constructionSites.get(activity.targetId ?? '');
  if (site === undefined || site.builderId !== character.id) {
    // 工单已消失(debug 拆图等外部变更):无薪收尾(退料钩子对不存在工单 no-op)
    finishActivity(sim, character, 'interrupted');
    return;
  }
  const result = settleActivityMinute(
    activity,
    character,
    definition,
    debtFactor(character, sim.clock.gameMinutes),
    site.durationMinutes,
  );
  if (result !== 'completed') {
    return;
  }
  completeConstruction(sim, character, site);
}

/** 完工落地:盖章/围栏入 built→applyBuilt 换图→清困在足迹内角色→按单入账 */
function completeConstruction(sim: Simulation, character: WorldCharacter, site: ConstructionSite): void {
  const blueprint = getBuildBlueprint(site.blueprintId)!;
  let placeId: string | null = null;
  if (blueprint.kind === 'place') {
    const stamped = stampBuiltPlace(blueprint, site.x, site.y, sim.built.nextPlaceSeq);
    sim.built.nextPlaceSeq += 1;
    sim.built.places.push(stamped);
    placeId = stamped.id;
    applyBuilt(sim);
    relocateCharactersInFootprint(sim, stamped);
  } else {
    sim.built.fences.push({ x: site.x, y: site.y, w: site.w, h: site.h });
    applyBuilt(sim);
  }
  sim.constructionSites.delete(site.id);
  const pay = site.pay * debtFactor(character, sim.clock.gameMinutes);
  character.coins += pay;
  const event: ConstructionCompletedEvent = {
    type: 'construction.completed',
    siteId: site.id,
    characterId: character.id,
    blueprintId: site.blueprintId,
    placeId,
    pay,
    tick: sim.tick,
  };
  sim.events.emit(event);
  finishActivity(sim, character, 'completed');
}

/**
 * 中断销单(finishActivity reason!=='completed' 钩子;stepConstruction 的
 * 工单失效路径亦复用):材料退回单仓+工单撤销+construction.cancelled。
 * 不存在/非本人工单静默 no-op(重复收尾安全)。
 */
export function cancelConstructionSite(sim: Simulation, siteId: string | null, characterId: string): void {
  if (siteId === null) return;
  const site = sim.constructionSites.get(siteId);
  if (site === undefined || site.builderId !== characterId) return;
  for (const [itemId, count] of Object.entries(site.materials)) {
    sim.storage[itemId] = (sim.storage[itemId] ?? 0) + count;
  }
  sim.constructionSites.delete(siteId);
  sim.events.emit({
    type: 'construction.cancelled',
    siteId: site.id,
    characterId,
    blueprintId: site.blueprintId,
    tick: sim.tick,
  });
}

const intersects = (a: BlockedRect, b: BlockedRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 选区:place 类按蓝图尺寸(客户端只报左上角,尺寸服务端权威);fence 类须显式条形 */
function resolveBuildRect(blueprint: BuildBlueprint, x: number, y: number, w?: number, h?: number): BlockedRect {
  if (blueprint.kind === 'place') {
    const size = blueprint.size!;
    return { x, y, w: size.w, h: size.h };
  }
  if (w === undefined || h === undefined) {
    throw new Error('围栏蓝图须指定条形尺寸 w/h(横条 h=1 或竖条 w=1)');
  }
  return { x, y, w, h };
}

/** 订单材料(place 全量;fence 按格数乘每格用料) */
function buildOrderCosts(blueprint: BuildBlueprint, rect: BlockedRect): Record<string, number> {
  if (blueprint.kind !== 'fence') {
    return { ...blueprint.materials };
  }
  const cells = rect.w * rect.h;
  return Object.fromEntries(
    Object.entries(blueprint.materials).map(([itemId, count]) => [itemId, count * cells]),
  );
}

function orderDurationMinutes(blueprint: BuildBlueprint, rect: BlockedRect): number {
  const raw =
    blueprint.kind !== 'fence'
      ? blueprint.durationMinutes
      : blueprint.fenceWork!.baseMinutes + blueprint.fenceWork!.minutesPerCell * rect.w * rect.h;
  // 工时倍率(S2批3 世界参数):下单时快照,工资与在制单不追溯
  return Math.max(1, Math.round(raw * BALANCE.CONSTRUCTION_TIME_SCALE));
}

function orderPay(blueprint: BuildBlueprint, rect: BlockedRect): number {
  if (blueprint.kind !== 'fence') return blueprint.wage;
  return blueprint.fenceWork!.wagePerCell * rect.w * rect.h;
}

function ensureStorageHas(sim: Simulation, materials: Record<string, number>): void {
  const missing = Object.entries(materials)
    .filter(([itemId, count]) => (sim.storage[itemId] ?? 0) < count)
    .map(([itemId, count]) => `${getItem(itemId)?.name ?? itemId}×${count}`);
  if (missing.length > 0) {
    throw new Error(`单仓材料不足,需 ${missing.join('、')}(先采集入仓)`);
  }
}

/**
 * 站位:足迹圈外一圈(完工落地即成墙圈,站圈内完工瞬间被困室内)。
 * 候选=可行走的圈外格,按距角色曼哈顿排序,取首个可达者。
 */
function standTileOutsideFootprint(sim: Simulation, character: WorldCharacter, rect: BlockedRect): Point | null {
  const candidates: Point[] = [];
  for (let x = rect.x - 1; x <= rect.x + rect.w; x += 1) {
    candidates.push({ x, y: rect.y - 1 }, { x, y: rect.y + rect.h });
  }
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    candidates.push({ x: rect.x - 1, y }, { x: rect.x + rect.w, y });
  }
  return (
    candidates
      .filter((tile) => sim.map.isWalkable(tile.x, tile.y))
      .sort(
        (a, b) =>
          Math.abs(a.x - character.x) + Math.abs(a.y - character.y) -
          (Math.abs(b.x - character.x) + Math.abs(b.y - character.y)),
      )
      .find((tile) => findPath(sim.map, { x: character.x, y: character.y }, tile) !== null) ?? null
  );
}

/** 完工落地善后:困在新足迹内的角色挪到入口,穿越足迹的剩余路径作废(重新规划) */
function relocateCharactersInFootprint(sim: Simulation, place: PlaceDefinition): void {
  const inside = (x: number, y: number): boolean =>
    x >= place.x && x < place.x + place.w && y >= place.y && y < place.y + place.h;
  for (const other of sim.characters.values()) {
    if (inside(other.x, other.y)) {
      other.x = place.entrance.x;
      other.y = place.entrance.y;
      other.path = [];
    } else if (other.path.some((point) => inside(point.x, point.y))) {
      other.path = [];
    }
  }
}

/* ---------- debug 操作(S2批1,/debug/built 直落不走工单) ---------- */

/** debug:按蓝图落建筑(place 类,占地图纸尺寸) */
export function debugBuildPlace(
  sim: Simulation,
  blueprintId: string,
  x: number,
  y: number,
): BuildOpResult {
  const blueprint = getBuildBlueprint(blueprintId);
  if (!blueprint || blueprint.kind !== 'place') {
    return { ok: false, issues: [{ code: 'placement', message: `非建筑蓝图: ${blueprintId}` }] };
  }
  const size = blueprint.size!;
  const { issues } = evaluateBuildPlacement(sim.baseDefinition, sim.built, blueprint, {
    x,
    y,
    w: size.w,
    h: size.h,
  });
  if (issues.length > 0) return { ok: false, issues };
  sim.built.places.push(stampBuiltPlace(blueprint, x, y, sim.built.nextPlaceSeq));
  sim.built.nextPlaceSeq += 1;
  applyBuilt(sim);
  return { ok: true };
}

/** debug:落围栏段(横条/竖条) */
export function debugBuildFence(sim: Simulation, rect: BlockedRect): BuildOpResult {
  const blueprint = getBuildBlueprint('build_fence')!;
  const { issues } = evaluateBuildPlacement(sim.baseDefinition, sim.built, blueprint, rect);
  if (issues.length > 0) return { ok: false, issues };
  sim.built.fences.push({ ...rect });
  applyBuilt(sim);
  return { ok: true };
}

/** debug:拆 built 建筑(id 形如 built-1) */
export function debugRemoveBuiltPlace(sim: Simulation, id: string): BuildOpResult {
  const index = sim.built.places.findIndex((p) => p.id === id);
  if (index < 0) {
    return { ok: false, issues: [{ code: 'placement', message: `不存在 built 建筑: ${id}` }] };
  }
  sim.built.places.splice(index, 1);
  applyBuilt(sim);
  return { ok: true };
}

/** debug:拆围栏段(按精确矩形匹配) */
export function debugRemoveBuiltFence(sim: Simulation, rect: BlockedRect): BuildOpResult {
  const index = sim.built.fences.findIndex((f) => f.x === rect.x && f.y === rect.y && f.w === rect.w && f.h === rect.h);
  if (index < 0) {
    return { ok: false, issues: [{ code: 'placement', message: '不存在该围栏段' }] };
  }
  sim.built.fences.splice(index, 1);
  applyBuilt(sim);
  return { ok: true };
}
