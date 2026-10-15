/**
 * agent 建造选址(S2-A 自主建造):确定性环带搜索,纯函数零 I/O 零 rng——
 * 同 (base, built, blueprint) 恒同结果,可测可复现。玩家选址靠 UI 拖画,
 * agent 靠这里;合法性由 evaluateBuildPlacement 全门禁判定
 * (placement/structure/connectivity 同源,server 权威校验兜底)。
 * 独立成文件:world/construction.ts 已超 350 行上限,选址搜索是独立关注点。
 */
import type { BlockedRect, BuildBlueprint, BuiltState, TileMapDefinition } from '@sims/shared';
import { evaluateBuildPlacement } from '@sims/shared';

/** 环带外扩上限(环):扫满仍无合法选区即弃(角色本轮放弃该建造 want)——
 * 过远选址既不美观也拉长赶路,首版求合法不求美 */
const SUGGEST_BUILD_RING_LIMIT = 6;

/**
 * 蓝图选址搜索:镇核心(growth/内置图无 townCore→null,与单仓禁用同口径)
 * 外扩环带逐环扫描(环内按行按列),每候选按蓝图 size 组 rect 调
 * evaluateBuildPlacement,首个零 issue 返回;扫满 SUGGEST_BUILD_RING_LIMIT
 * 环无合法返回 null。仅 place 类蓝图(place 类才有 size;围栏段自主布局随 S3)。
 */
export function suggestBuildRect(
  base: TileMapDefinition,
  built: BuiltState,
  blueprint: BuildBlueprint,
): BlockedRect | null {
  const core = base.townCore;
  if (core === undefined || blueprint.kind !== 'place' || blueprint.size === undefined) return null;
  for (let ring = 1; ring <= SUGGEST_BUILD_RING_LIMIT; ring += 1) {
    const x0 = core.x - ring;
    const y0 = core.y - ring;
    const x1 = core.x + core.w + ring - 1;
    const y1 = core.y + core.h + ring - 1;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (!(y === y0 || y === y1 || x === x0 || x === x1)) continue;
        const rect = { x, y, w: blueprint.size.w, h: blueprint.size.h };
        if (evaluateBuildPlacement(base, built, blueprint, rect).issues.length === 0) {
          return rect;
        }
      }
    }
  }
  return null;
}

/**
 * 选区站位搜索:选区外圈一格(footprint 环)中取离 from 最近的可站立格——
 * 与采集站位(nearestWalkableAdjacent)同口径。钳位算出的环点可能是围栏/墙体
 * 等不可走格,move_to 硬拒会 3 连拒清意图(2026-10-12 走查镇实证),故逐环点
 * 验可站立。全环不可站返回 null,调用方本轮跳过(pending 保留)。
 */
export function standTileNearRect(
  rect: BlockedRect,
  from: { x: number; y: number },
  canStand: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = rect.y - 1; y <= rect.y + rect.h; y += 1) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x += 1) {
      const onRing =
        y === rect.y - 1 || y === rect.y + rect.h || x === rect.x - 1 || x === rect.x + rect.w;
      // 四角格排除:施工执行闸按 dx+dy≤1 判贴身,角格距选区 2,到位后永远被
      // 再次 move_to(2026-10-13 建造链闭环走查实证)
      const isCorner =
        (x === rect.x - 1 || x === rect.x + rect.w) &&
        (y === rect.y - 1 || y === rect.y + rect.h);
      if (!onRing || isCorner || !canStand(x, y)) continue;
      const dist = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}
