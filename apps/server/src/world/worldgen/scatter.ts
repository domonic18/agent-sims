/**
 * worldgen 撒放件(自 generate.ts 原文迁入,R2 管线化):tryScatterPlace=
 * 场所随机撒放(偏好区 20 试→全图 60 试→核心兜底扫描);scatterResources=
 * 资源节点撒点(profile resourcePlacement 组驱动,组序即 rng 消耗序)。
 * 两函数体保持逐行等价——R0 特征化快照钉死 rng 流。
 */
import type { BlockedRect, PlaceDefinition, ResourceNodeSeed } from '@sims/shared';
import type { ResourcePlacementRule, WorldgenModeOptions } from '../game-mode.js';
import { cellKey, mark0 } from './grid.js';
import { Rng } from './prng.js';

/**
 * 随机撒放坐标:偏好象限试 20 次 → 全图再试 60 次 → 核心场所无缓冲确定性扫描(必得);
 * 可选场所两轮皆败即裁(锦上添花型,空间不足自然消失)。随机轮查缓冲占用
 * (场所间留缝/不贴路),兜底轮只查核心占用(矩形本身不重叠)——支路把象限切成
 * 窄条时核心场所允许贴路而立,不再触发整图重试。
 * 镇内外分区(survival,M-S/S1.5):town 矩形含于核心内圈(入口行不越围栏),
 * wild 矩形与核心外扩一圈不相交(围栏外留走环);两轮随机与兜底扫描全带约束。
 */
export function tryScatterPlace(
  rng: Rng,
  zone: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  w: number,
  h: number,
  occupied: Set<string>,
  occupiedCore: Set<string>,
  entrances: Set<string>,
  essential: boolean,
  area: 'town' | 'wild' | null,
  townCore: BlockedRect | null,
  label: string,
): { x: number; y: number } | null {
  // y 界保持 2/height-2:入口格在 y-1 或 y+h 行,须落在可行走带内(0/末行为边界墙)
  const inBounds = (x: number, y: number): boolean =>
    x >= 1 && y >= 2 && x + w <= width - 1 && y + h <= height - 2;
  /** 入口/门前格自由:有门场所入口在 (中列, y+h),开放场所入口在 (x+1, y-1) */
  const entranceFree = (x: number, y: number, grid: Set<string>): boolean =>
    !grid.has(cellKey(x + Math.floor(w / 2), y + h)) && !grid.has(cellKey(x + 1, y - 1));
  /** 新矩形不得覆盖任何已放场所入口格(先放者的入口不在占用网格里) */
  const coversEntrance = (x: number, y: number): boolean => {
    for (const key of entrances) {
      const comma = key.indexOf(',');
      const ex = Number(key.slice(0, comma));
      const ey = Number(key.slice(comma + 1));
      if (ex >= x && ex < x + w && ey >= y && ey < y + h) return true;
    }
    return false;
  };
  const areaOk = (x: number, y: number): boolean => {
    if (area === null || townCore === null) return true;
    if (area === 'town') {
      // 核心内圈(围栏线内缩 1):有门场所入口行 y+h 与开放场所入口行 y-1 均不出栏
      return (
        x >= townCore.x + 1 &&
        y >= townCore.y + 2 &&
        x + w <= townCore.x + townCore.w - 2 &&
        y + h <= townCore.y + townCore.h - 2
      );
    }
    // 与核心外扩一圈不相交(镇界围栏外留一圈走环)
    return (
      x + w <= townCore.x - 1 ||
      x >= townCore.x + townCore.w + 1 ||
      y + h <= townCore.y - 1 ||
      y >= townCore.y + townCore.h + 1
    );
  };
  const fits = (x: number, y: number, grid: Set<string>): boolean => {
    if (!inBounds(x, y)) return false;
    if (!areaOk(x, y)) return false;
    if (coversEntrance(x, y)) return false;
    const pad = grid === occupiedCore ? 0 : 1;
    for (let yy = y - pad; yy <= y + h - 1 + pad; yy += 1) {
      for (let xx = x - pad; xx <= x + w - 1 + pad; xx += 1) {
        if (grid.has(cellKey(xx, yy))) return false;
      }
    }
    return entranceFree(x, y, grid);
  };
  const randSpot = (zx: number, zy: number, zw: number, zh: number): { x: number; y: number } | null => {
    const x0 = Math.max(zx, 1);
    const y0 = Math.max(zy, 2);
    const x1 = Math.min(zx + zw - w, width - 1 - w);
    const y1 = Math.min(zy + zh - h, height - 2 - h);
    if (x1 < x0 || y1 < y0) return null;
    return { x: rng.int(x0, x1), y: rng.int(y0, y1) };
  };
  for (let i = 0; i < 20; i += 1) {
    const spot = randSpot(zone.x, zone.y, zone.w, zone.h);
    if (spot !== null && fits(spot.x, spot.y, occupied)) return spot;
  }
  for (let i = 0; i < 60; i += 1) {
    const spot = randSpot(1, 2, width - 2, height - 4);
    if (spot !== null && fits(spot.x, spot.y, occupied)) return spot;
  }
  // 可选场所也兜底一次无缓冲扫描(紧凑贴靠优于整段缺席);扫无可选即裁,核心必得
  for (let y = 2; y + h <= height - 2; y += 1) {
    for (let x = 1; x + w <= width - 1; x += 1) {
      if (fits(x, y, occupiedCore)) return { x, y };
    }
  }
  if (!essential) return null;
  throw new Error(`撒放空间不足:${label}`);
}

/**
 * 资源节点撒点(M-G.6+2026-10-07 食物链):数量档与落点全部来自 profile
 * resourcePlacement 组表——组序即 rng 消耗序;batchDraw=true 整组先抽齐数量档
 * 再依次撒放(浆果/拾荒、苹果/麦丛两种既有节拍),false 逐条抽取撒放(镇外三件套)。
 * 食物节点落食物区场所(20 试,无区即弃),街面节点全镇空地(30 试),
 * 簇节点落镇外森林/岩石区与废墟(20 试)。占格不可行走,重摇尽力放置。
 */
export function scatterResources(
  rng: Rng,
  worldgen: WorldgenModeOptions,
  width: number,
  height: number,
  places: PlaceDefinition[],
  paths: BlockedRect[],
  fences: BlockedRect[],
  pond: BlockedRect | null,
  wild: { forests: BlockedRect[]; rocks: BlockedRect[] } | null,
): ResourceNodeSeed[] {
  const parkBlocked = new Set<string>();
  for (const path of paths) mark0(parkBlocked, path); // 食物节点不落路面
  for (const fence of fences) mark0(parkBlocked, fence); // 公园北缘围栏段
  if (pond !== null) {
    mark0(parkBlocked, { x: pond.x - 1, y: pond.y - 1, w: pond.w + 2, h: pond.h + 2 });
  }
  const streetBlocked = new Set<string>();
  for (const path of paths) mark0(streetBlocked, path); // 街面节点不上路面
  if (pond !== null) mark0(streetBlocked, pond);
  if (worldgen.townCore) {
    for (const fence of fences) mark0(streetBlocked, fence); // 镇界围栏格不落堆(S1.5;growth 零变化)
  }
  const parks = places.filter((p) =>
    worldgen.foodPlacePrefixes.some((prefix) => p.id.startsWith(prefix)),
  );
  for (const park of parks) {
    for (const fence of fences) mark0(parkBlocked, fence);
    for (const f of park.furniture ?? []) {
      mark0(parkBlocked, { x: f.x, y: f.y, w: f.w, h: f.h });
      if (f.use !== undefined) {
        mark0(parkBlocked, { x: f.use.x - 1, y: f.use.y - 1, w: 3, h: 3 }); // 使用格保持四邻可站
      }
    }
    mark0(parkBlocked, { x: park.entrance.x - 1, y: park.entrance.y - 1, w: 3, h: 2 });
    // 街道侧:场所占格 ±1 缓冲,拾荒堆不贴墙堵门口
    mark0(streetBlocked, { x: park.x - 1, y: park.y - 1, w: park.w + 2, h: park.h + 2 });
  }
  for (const place of places) {
    if (place.id.startsWith('park')) continue; // 公园已在上方处理;营地等食物区场所同样吃街道缓冲
    mark0(streetBlocked, { x: place.x - 1, y: place.y - 1, w: place.w + 2, h: place.h + 2 });
  }
  const taken = new Set<string>();
  const seeds: ResourceNodeSeed[] = [];
  /** 食物区节点:场所内空地撒放(无食物区即弃) */
  const scatterFood = (kind: ResourceNodeSeed['kind'], count: number): void => {
    for (let n = 0; n < count && parks.length > 0; n += 1) {
      const park = rng.pick(parks);
      for (let tries = 0; tries < 20; tries += 1) {
        const x = rng.int(park.x + 1, park.x + park.w - 2);
        const y = rng.int(park.y + 1, park.y + park.h - 2);
        const key = cellKey(x, y);
        if (parkBlocked.has(key) || taken.has(key)) continue;
        taken.add(key);
        seeds.push({ kind, x, y });
        break;
      }
    }
  };
  /** 街面节点:全镇空地撒放 */
  const scatterStreet = (kind: ResourceNodeSeed['kind'], count: number): void => {
    for (let n = 0; n < count; n += 1) {
      for (let tries = 0; tries < 30; tries += 1) {
        const x = rng.int(2, width - 3);
        const y = rng.int(2, height - 3);
        const key = cellKey(x, y);
        if (streetBlocked.has(key) || taken.has(key)) continue;
        taken.add(key);
        seeds.push({ kind, x, y });
        break;
      }
    }
  };
  /** 簇节点:镇外森林/岩石区与废墟撒放 */
  const clusterBlocked = new Set<string>();
  for (const path of paths) mark0(clusterBlocked, path);
  const ruins = places.filter((p) => p.id.startsWith('ruins'));
  const ruinsBlocked = new Set<string>(parkBlocked);
  for (const ruin of ruins) {
    for (const f of ruin.furniture ?? []) {
      mark0(ruinsBlocked, { x: f.x, y: f.y, w: f.w, h: f.h });
      if (f.use !== undefined) {
        mark0(ruinsBlocked, { x: f.use.x - 1, y: f.use.y - 1, w: 3, h: 3 }); // 使用格保持四邻可站
      }
    }
    mark0(ruinsBlocked, { x: ruin.entrance.x - 1, y: ruin.entrance.y - 1, w: 3, h: 2 });
  }
  const scatterCluster = (
    kind: ResourceNodeSeed['kind'],
    count: number,
    areas: readonly BlockedRect[],
    blocked: Set<string>,
  ): void => {
    for (let n = 0; n < count && areas.length > 0; n += 1) {
      const area = rng.pick(areas);
      for (let tries = 0; tries < 20; tries += 1) {
        const x = rng.int(area.x + 1, area.x + area.w - 2);
        const y = rng.int(area.y + 1, area.y + area.h - 2);
        const key = cellKey(x, y);
        if (blocked.has(key) || taken.has(key)) continue;
        taken.add(key);
        seeds.push({ kind, x, y });
        break;
      }
    }
  };
  const scatterByArea = (rule: ResourcePlacementRule, count: number): void => {
    if (rule.area === 'food') return scatterFood(rule.kind, count);
    if (rule.area === 'streets') return scatterStreet(rule.kind, count);
    if (rule.area === 'forests') return scatterCluster(rule.kind, count, wild?.forests ?? [], clusterBlocked);
    if (rule.area === 'rocks') return scatterCluster(rule.kind, count, wild?.rocks ?? [], clusterBlocked);
    return scatterCluster(rule.kind, count, ruins, ruinsBlocked);
  };
  for (const group of worldgen.resourcePlacement) {
    if (group.batchDraw) {
      const plans = group.rules.map((rule) => ({ rule, count: rng.int(...rule.count) }));
      for (const { rule, count } of plans) scatterByArea(rule, count);
    } else {
      for (const rule of group.rules) scatterByArea(rule, rng.int(...rule.count));
    }
  }
  return seeds;
}
