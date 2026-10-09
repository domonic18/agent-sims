import type { BlockedRect, PlaceDefinition } from '@sims/shared';
import { cellKey, mark0 } from './grid.js';
import { Rng } from './prng.js';

/** 镇外簇档(M-S/S1.5,07-survival §2):森林=伐木区(树资源+密树装饰),岩石区=采矿(石);
 * 簇须整个落进镇外环带——上下带深 ~6~8/左右带宽 ~10~16 约束了簇的最大外形 */
const SURVIVAL_FOREST_COUNT: readonly [number, number] = [2, 3];
const SURVIVAL_ROCK_AREA_COUNT: readonly [number, number] = [1, 2];
const FOREST_SIZE: readonly [[number, number], [number, number]] = [[10, 13], [6, 8]];
const ROCK_AREA_SIZE: readonly [[number, number], [number, number]] = [[9, 11], [5, 7]];
/** small 档(带最窄:上下深 ≤6/左右宽 ≤10)紧凑簇 */
const FOREST_SIZE_SMALL: readonly [[number, number], [number, number]] = [[8, 10], [5, 6]];
const ROCK_AREA_SIZE_SMALL: readonly [[number, number], [number, number]] = [[7, 9], [4, 5]];

/** 公园水系:先定池塘(家具/花木布局避开) */
export function parkPond(rng: Rng, x: number, y: number, w: number, h: number): BlockedRect {
  const pondW = rng.int(3, 4);
  const pondH = rng.int(3, 4);
  return { x: x + 1, y: rng.int(y + 2, Math.max(y + 2, y + h - pondH - 1)), w: pondW, h: pondH };
}

/** 公园北缘栅栏段(M-G.5 数据化):沿场所北缘两段,入口列留豁口(开放场所入口在上缘 x+1) */
export function parkFences(place: PlaceDefinition): BlockedRect[] {
  const gap = place.entrance.x;
  const westW = gap - place.x;
  const eastW = place.x + place.w - (gap + 1);
  return [
    ...(westW > 0 ? [{ x: place.x, y: place.y, w: westW, h: 1 }] : []),
    ...(eastW > 0 ? [{ x: gap + 1, y: place.y, w: eastW, h: 1 }] : []),
  ];
}

/** 墓地四边围栏(survival):每边中央 3 格豁口,北缝盖住入口列(entrance 天然连通);
 * 竖向围栏让出四角(角格归横向边),四向开口+确定性豁口免围死,connectivity 校验兜底 */
export function graveyardFences(place: PlaceDefinition): BlockedRect[] {
  const rects: BlockedRect[] = [];
  const pushH = (y: number, x0: number, x1: number): void => {
    if (x1 >= x0) rects.push({ x: x0, y, w: x1 - x0 + 1, h: 1 });
  };
  const pushV = (x: number, y0: number, y1: number): void => {
    if (y1 >= y0) rects.push({ x, y: y0, w: 1, h: y1 - y0 + 1 });
  };
  const gapX = place.entrance.x - 1; // 北缝 [gapX, gapX+2] 盖入口
  pushH(place.y, place.x, gapX - 1);
  pushH(place.y, gapX + 3, place.x + place.w - 1);
  const midX = place.x + Math.floor(place.w / 2) - 1;
  pushH(place.y + place.h - 1, place.x, midX - 1);
  pushH(place.y + place.h - 1, midX + 3, place.x + place.w - 1);
  const midY = place.y + Math.floor(place.h / 2) - 1;
  pushV(place.x, place.y + 1, midY - 1);
  pushV(place.x, midY + 3, place.y + place.h - 2);
  pushV(place.x + place.w - 1, place.y + 1, midY - 1);
  pushV(place.x + place.w - 1, midY + 3, place.y + place.h - 2);
  return rects;
}

/**
 * 镇内核心矩形(survival,M-S/S1.5):以地图中心为中心,三档统一 62%——
 * 镇内活动容量与 medium/large 已验证水位一致;镇外四向环带(上下带深 ~6/左右带宽 ~10)
 * 由 wild 蓝图与 small 覆写尺寸适配。四周边线即镇界围栏线(townFences),路格豁口为出口。
 */
export function buildTownCore(width: number, height: number): BlockedRect {
  const w = Math.round(width * 0.62);
  const h = Math.round(height * 0.62);
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h };
}

/**
 * 镇界围栏(survival):沿核心四周边线逐格成段(连续格合并为整条矩形),
 * 落在任何路格上的围栏位跳过——主干道臂横穿边线处即天然镇出口
 * (先路后栏:门前路 pass③ 已铺完)。角格归横边,竖边让出两角。
 */
export function townFences(core: BlockedRect, paths: readonly BlockedRect[]): BlockedRect[] {
  const onPath = (x: number, y: number): boolean =>
    paths.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const rects: BlockedRect[] = [];
  const runH = (y: number, x0: number, x1: number): void => {
    let start: number | null = null;
    for (let x = x0; x <= x1 + 1; x += 1) {
      const solid = x <= x1 && !onPath(x, y);
      if (solid && start === null) start = x;
      if (!solid && start !== null) {
        rects.push({ x: start, y, w: x - start, h: 1 });
        start = null;
      }
    }
  };
  const runV = (x: number, y0: number, y1: number): void => {
    let start: number | null = null;
    for (let y = y0; y <= y1 + 1; y += 1) {
      const solid = y <= y1 && !onPath(x, y);
      if (solid && start === null) start = y;
      if (!solid && start !== null) {
        rects.push({ x, y: start, w: 1, h: y - start });
        start = null;
      }
    }
  };
  runH(core.y, core.x, core.x + core.w - 1);
  runH(core.y + core.h - 1, core.x, core.x + core.w - 1);
  runV(core.x, core.y + 1, core.y + core.h - 2);
  runV(core.x + core.w - 1, core.y + 1, core.y + core.h - 2);
  return rects;
}

/**
 * 镇外簇(survival,M-S/S1.5):森林(伐木)/岩石区(采矿)矩形落位——整簇须落进
 * 镇外环带(避核心外扩一圈=围栏外走环),再避道路/场所 ±1 缓冲/已放簇(簇间隔一圈);
 * 簇本身不阻塞行走,仅承载资源撒点与 buildDecor 密植。small 档带最窄,取紧凑簇。
 */
export function buildWildClusters(
  rng: Rng,
  width: number,
  height: number,
  townCore: BlockedRect,
  paths: readonly BlockedRect[],
  places: readonly PlaceDefinition[],
  small: boolean,
): { forests: BlockedRect[]; rocks: BlockedRect[] } {
  const expandedCore = { x: townCore.x - 1, y: townCore.y - 1, w: townCore.w + 2, h: townCore.h + 2 };
  const inRect = (x: number, y: number, r: BlockedRect): boolean =>
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const onPath = (x: number, y: number): boolean =>
    paths.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const nearPlace = (x: number, y: number): boolean =>
    places.some((p) => x >= p.x - 1 && x < p.x + p.w + 1 && y >= p.y - 1 && y < p.y + p.h + 1);
  const taken = new Set<string>();
  const cellFree = (x: number, y: number): boolean =>
    !inRect(x, y, expandedCore) && !onPath(x, y) && !nearPlace(x, y) && !taken.has(cellKey(x, y));
  const place = (count: number, size: readonly [[number, number], [number, number]]): BlockedRect[] => {
    const rects: BlockedRect[] = [];
    // 野带窄且被路/镇外场所/邻簇切碎,整矩形落位命中率低——
    // 先按全尺寸 50 试,再退最小尺寸 80 试兜底(小图单岩石区全败即 0 采矿点)
    const tryPlace = (w: number, h: number, tries: number): BlockedRect | null => {
      for (let i = 0; i < tries; i += 1) {
        const x = rng.int(1, width - 1 - w);
        const y = rng.int(2, height - 2 - h);
        let ok = true;
        for (let yy = y; yy < y + h && ok; yy += 1) {
          for (let xx = x; xx < x + w && ok; xx += 1) ok = cellFree(xx, yy);
        }
        if (!ok) continue;
        mark0(taken, { x: x - 1, y: y - 1, w: w + 2, h: h + 2 }); // 簇间隔一圈
        return { x, y, w, h };
      }
      return null;
    };
    for (let n = 0; n < count; n += 1) {
      const w = rng.int(size[0][0], size[0][1]);
      const h = rng.int(size[1][0], size[1][1]);
      const rect = tryPlace(w, h, 50) ?? tryPlace(size[0][0], size[1][0], 80);
      if (rect !== null) rects.push(rect);
    }
    return rects;
  };
  // 岩石区先放:数量少(小图 1 个,全败即 0 采矿点)且矩形更小,优先占带内完整空位
  const rocks = place(
    small ? 1 : rng.int(...SURVIVAL_ROCK_AREA_COUNT),
    small ? ROCK_AREA_SIZE_SMALL : ROCK_AREA_SIZE,
  );
  const forests = place(
    small ? 2 : rng.int(...SURVIVAL_FOREST_COUNT),
    small ? FOREST_SIZE_SMALL : FOREST_SIZE,
  );
  return { forests, rocks };
}
