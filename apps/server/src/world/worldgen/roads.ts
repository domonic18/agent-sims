import type { BlockedRect } from '@sims/shared';
import { Rng } from './prng.js';

/** 广场地表覆块 tile(与渲染层 TILE_SLUG.plaza 同名素材) */
export const PLAZA_TILE = 'tile-plaza';

/**
 * 蜿蜒路网:中心广场(边长 4~6,随机偏移 ±2)+ 四方向随机游走延伸——段宽 2/段长 3~6,
 * 折弯垂直偏移 2~4(连接段锚定刚铺段前端 2 格,路网必连通),距边 4~6 停;
 * 短枝路自随机已铺段垂直引出(长 5~10)。growth 折弯 30%/枝路 1-2-4 不变;
 * survival 降折弯(12%)/减枝路(0-1-2)——镇内核心容量吃紧,整片内圈不被
 * 折弯带切碎是 essential 场所撒放前提(M-S/S1.5)。
 */
export function buildRoadNetwork(
  rng: Rng,
  width: number,
  height: number,
  densityIndex: number,
  survival: boolean,
): { rects: BlockedRect[]; plaza: BlockedRect } {
  const rects: BlockedRect[] = [];
  const bendChance = survival ? 0.12 : 0.3;
  const plazaSize = rng.int(4, 6);
  const plaza: BlockedRect = {
    x: Math.floor(width / 2) + rng.int(-2, 2) - Math.floor(plazaSize / 2),
    y: Math.floor(height / 2) + rng.int(-2, 2) - Math.floor(plazaSize / 2),
    w: plazaSize,
    h: plazaSize,
  };
  rects.push(plaza);
  for (const arm of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }] as const) {
    const horizontal = arm.dx !== 0;
    const s = horizontal ? arm.dx : arm.dy;
    const margin = rng.int(4, 6);
    const limit = (horizontal ? width : height) - margin;
    let x = horizontal
      ? s > 0 ? plaza.x + plaza.w : plaza.x - 1
      : plaza.x + rng.int(0, plaza.w - 2);
    let y = horizontal
      ? plaza.y + rng.int(0, plaza.h - 2)
      : s > 0 ? plaza.y + plaza.h : plaza.y - 1;
    const front = (): number => (horizontal ? x : y);
    const room = (): number => (s > 0 ? limit - front() : front() - margin);
    while (room() >= 3) {
      const len = Math.min(rng.int(3, 6), room());
      if (horizontal) {
        rects.push({ x: s > 0 ? x : x - len + 1, y, w: len, h: 2 });
        x += s * len;
      } else {
        rects.push({ x, y: s > 0 ? y : y - len + 1, w: 2, h: len });
        y += s * len;
      }
      // 折弯:垂直偏移 2~4,连接段跨新旧行带并锚定刚铺段前端
      if (!rng.chance(bendChance)) continue;
      const k = rng.int(2, 4);
      if (horizontal) {
        const opts: number[] = [];
        if (y + 1 + k <= height - 2) opts.push(1);
        if (y - k >= 2) opts.push(-1);
        if (opts.length === 0) continue;
        const j = rng.pick(opts);
        const ny = y + j * k;
        rects.push({ x: s > 0 ? x - 2 : x, y: Math.min(y, ny), w: 2, h: k + 2 });
        y = ny;
      } else {
        const opts: number[] = [];
        if (x + 1 + k <= width - 2) opts.push(1);
        if (x - k >= 2) opts.push(-1);
        if (opts.length === 0) continue;
        const j = rng.pick(opts);
        const nx = x + j * k;
        rects.push({ x: Math.min(x, nx), y: s > 0 ? y - 2 : y, w: k + 2, h: 2 });
        x = nx;
      }
    }
  }
  // 短枝路:自随机已铺段(含广场)垂直引出,长 5~10,越界侧自动改向
  const branchCount = survival ? [0, 1, 2][densityIndex] ?? 1 : [1, 2, 4][densityIndex] ?? 2;
  for (let i = 0; i < branchCount; i += 1) {
    const base = rng.pick(rects);
    const len = rng.int(5, 10);
    if (base.h <= base.w) {
      const canUp = base.y - len >= 2;
      const canDown = base.y + base.h + len <= height - 2;
      if (!canUp && !canDown) continue;
      const up = canUp && (!canDown || rng.chance(0.5));
      rects.push({
        x: rng.int(base.x, base.x + base.w - 2),
        y: up ? base.y - len : base.y + base.h,
        w: 2,
        h: len,
      });
    } else {
      const canLeft = base.x - len >= 2;
      const canRight = base.x + base.w + len <= width - 2;
      if (!canLeft && !canRight) continue;
      const left = canLeft && (!canRight || rng.chance(0.5));
      rects.push({
        x: left ? base.x - len : base.x + base.w,
        y: rng.int(base.y, base.y + base.h - 2),
        w: len,
        h: 2,
      });
    }
  }
  return { rects, plaza };
}

/** 最近道路格:入口到任一路段矩形内格的最小曼哈顿距离点(路段间经锚定彼此连通) */
export function nearestRoadCell(
  rects: readonly BlockedRect[],
  p: { x: number; y: number },
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const r of rects) {
    const cx = Math.min(Math.max(p.x, r.x), r.x + r.w - 1);
    const cy = Math.min(Math.max(p.y, r.y), r.y + r.h - 1);
    const d = Math.abs(cx - p.x) + Math.abs(cy - p.y);
    if (d < bestD) {
      bestD = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}
