/**
 * 建造层 server 接线(S2批1):建造产物落图/撤销与 debug 操作逻辑。
 * applyBuilt 是建造产物唯一落地点——definitionWithBuilt 纯拼接合并图,
 * setMap 重建阻塞层/锚点/围栏格(fromDefinition 构造即校验,坏图直接抛);
 * asBase:false 防止合并图反客为主,基础图保持 config.map 不动,
 * 后续建造始终在 base 上叠加 built。debug 端点走与批2 requestBuild
 * 完全相同的评估链(evaluateBuildPlacement),自批1 即同门禁。
 */
import {
  definitionWithBuilt,
  evaluateBuildPlacement,
  getBuildBlueprint,
  stampBuiltPlace,
  type BlockedRect,
  type BuildIssue,
} from '@sims/shared';
import type { Simulation } from './simulation.js';

/** 建造产物落图:重建阻塞层/锚点/围栏格(built 建筑对寻路与活动天然生效) */
export function applyBuilt(sim: Simulation): void {
  sim.setMap(definitionWithBuilt(sim.baseDefinition, sim.built), { asBase: false });
}

export type BuildOpResult = { ok: true } | { ok: false; issues: BuildIssue[] };

/** debug:按蓝图落建筑(place 类,占地图纸上尺寸) */
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
