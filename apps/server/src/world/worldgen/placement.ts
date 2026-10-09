import type { BlockedRect, FacingDirection, PlaceDefinition } from '@sims/shared';
import {
  FLOOR_TILE_POOL,
  PLACE_BLUEPRINTS,
  WALL_TILE_POOL,
  type FurnitureSlot,
  type PlaceKind,
} from './blueprint.js';
import { cellKey, mark0 } from './grid.js';
import { Rng } from './prng.js';

/** 槽位素材池解析:主题道具池(theme/{slug}@{maxTiles})或域分键 kind 池({domain}/{kind}) */
function slotPool(
  slot: FurnitureSlot,
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
): readonly string[] {
  if (slot.themePick !== undefined) {
    const max = slot.themePick.maxTiles ?? 4;
    return assetsByKind?.[`theme/${slot.themePick.theme}@${max}`] ?? [];
  }
  return assetsByKind?.[`${slot.domain ?? 'indoor'}/${slot.kind}`] ?? [];
}

export type SlotWithPool = FurnitureSlot & { pool: readonly string[] };

/** 槽位解析:themePick 池空的装饰槽剔除(kind 仅作标签无同名纹理,发出必渲染缺纹理) */
function resolvedSlots(
  source: readonly FurnitureSlot[],
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
): SlotWithPool[] {
  return source
    .filter((slot) => slot.themePick === undefined || slotPool(slot, assetsByKind).length > 0)
    .map((slot) => ({ ...slot, pool: slotPool(slot, assetsByKind) }));
}

/** 第三轮槽位过滤(06-worldgen §3⑤ 梯度降档中段): 仅剔 chance<1 装饰槽,
 * chance≥1 必选槽保留——旧末轮把必选装饰槽一并剥掉,小房间被剥至仅剩锚点家具 */
export const attemptCoreSlots = (
  source: readonly FurnitureSlot[],
): readonly FurnitureSlot[] =>
  source.filter((slot) => slot.chance === undefined || slot.chance >= 1);

/** 沿墙候选起点序列(align 对齐,06-worldgen §3③): start=主序/end=逆序/center=自中点向外交替(左先);
 * 缺省=主序(与旧扫描一致,rng 流零影响——扫描不消费随机) */
export function alignedScan(
  min: number,
  max: number,
  size: number,
  align: 'start' | 'center' | 'end' | undefined,
): number[] {
  const last = max - size + 1;
  if (last < min) return [];
  const all: number[] = [];
  for (let v = min; v <= last; v += 1) all.push(v);
  if (align === undefined || align === 'start') return all;
  if (align === 'end') return [...all].reverse();
  const mid = Math.floor((all.length - 1) / 2);
  const order: number[] = [all[mid]!];
  for (let off = 1; off < all.length; off += 1) {
    if (mid - off >= 0) order.push(all[mid - off]!);
    if (mid + off < all.length) order.push(all[mid + off]!);
  }
  return order;
}

/** 锚点→朝向(06-worldgen §3③): 贴墙面朝房间;center/scatter 无朝向 */
const FACING_BY_ANCHOR: Partial<Record<FurnitureSlot['anchor'], FacingDirection>> = {
  north: 'south',
  south: 'north',
  west: 'east',
  east: 'west',
};

/** 背面素材定向选材(-b 后缀约定,05-asset §4): facing north(镜头看背面)池内 -b 件优先,
 * 其余 facing 排除 -b 件;过滤后为空回退整池。只改 pick 入参不改调用次数,rng 流不变 */
export function directionalPool(
  pool: readonly string[],
  facing: FacingDirection | undefined,
): readonly string[] {
  const wanted = facing === 'north';
  const filtered = pool.filter((slug) => slug.endsWith('-b') === wanted);
  return filtered.length > 0 ? filtered : pool;
}

/** 场所构建:门居南墙中点,入口在门外;室内地板/墙色随机;家具按模板布局。
 * 开放场所(公园类)无门无墙,入口在上缘。 */
export function buildPlace(
  rng: Rng,
  kind: PlaceKind,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  pond: BlockedRect | null,
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
): PlaceDefinition {
  const blueprint = PLACE_BLUEPRINTS[kind];
  if (blueprint.open === true) {
    const slots = resolvedSlots(blueprint.furniture, assetsByKind);
    const furniture = layoutFurniture(rng, x, y, w, h, slots, true, pond);
    return {
      id,
      name: blueprint.name,
      x, y, w, h,
      entrance: { x: x + 1, y: y - 1 },
      furniture,
    };
  }
  const doorX = x + Math.floor(w / 2);
  // 单场所最多重摇 4 次:门→全部使用格 BFS 可达才收(防 use 格被围死);
  // 梯度降档(06 §3⑤): 全量×2 → 保 chance≥1 必选槽 → 仅保无 chance 核心槽(必可达兜底)
  let furniture: PlaceDefinition['furniture'] = [];
  // 小档房间塞满会围死使用格——minPlaceW 槽位按占地宽启停(06 §3⑤)
  const sizeFits = (slot: FurnitureSlot): boolean =>
    slot.minPlaceW === undefined || w >= slot.minPlaceW;
  const attemptSources: ReadonlyArray<readonly FurnitureSlot[]> = [
    blueprint.furniture.filter(sizeFits),
    blueprint.furniture.filter(sizeFits),
    attemptCoreSlots(blueprint.furniture).filter(sizeFits),
    blueprint.furniture.filter((slot) => slot.chance === undefined),
  ];
  for (const source of attemptSources) {
    const slots = resolvedSlots(source, assetsByKind);
    furniture = layoutFurniture(rng, x, y, w, h, slots, false, null);
    if (interiorReachable(x, y, w, h, doorX, furniture)) break;
  }
  return {
    id,
    name: blueprint.name,
    x, y, w, h,
    entrance: { x: doorX, y: y + h },
    door: { x: doorX, y: y + h - 1 },
    furniture,
    floorTile: rng.pick(FLOOR_TILE_POOL),
    wallTile: rng.pick(WALL_TILE_POOL),
  };
}

/** 门 → 全部使用格 局部 BFS(use 格被四面围死即 false) */
function interiorReachable(
  px: number,
  py: number,
  pw: number,
  ph: number,
  doorX: number,
  furniture: PlaceDefinition['furniture'],
): boolean {
  const blocked = new Set<string>();
  for (const f of furniture ?? []) mark0(blocked, { x: f.x, y: f.y, w: f.w, h: f.h });
  const uses = (furniture ?? []).filter((f) => f.use !== undefined).map((f) => f.use!);
  if (uses.length === 0) return true;
  const entry = { x: doorX, y: py + ph - 2 }; // 门内第一格
  if (blocked.has(cellKey(entry.x, entry.y))) return false;
  const seen = new Set<string>([cellKey(entry.x, entry.y)]);
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = cellKey(nx, ny);
      if (nx <= px || nx >= px + pw - 1 || ny <= py || ny >= py + ph - 1) continue;
      if (seen.has(key) || blocked.has(key)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return uses.every((use) => seen.has(cellKey(use.x, use.y)));
}

/** 家具布局器:按锚定语义(北墙/西墙/东墙/居中/南缘)+align 对齐找空位,冲突跳过;
 * 槽位带池时落位即随机选材(sprite,按 facing 定向),朝向由锚点派生写入 */
export function layoutFurniture(
  rng: Rng,
  px: number,
  py: number,
  pw: number,
  ph: number,
  slots: readonly SlotWithPool[],
  outdoor: boolean,
  pond: BlockedRect | null,
): NonNullable<PlaceDefinition['furniture']> {
  // 占用网格:有墙场所=室内圈(px+1..px+pw-2);公园=整个场所(留边界)
  const minX = outdoor ? px + 1 : px + 1;
  const maxX = outdoor ? px + pw - 2 : px + pw - 2;
  const minY = outdoor ? py + 1 : py + 1;
  const maxY = outdoor ? py + ph - 2 : py + ph - 2;
  const occupied = new Set<string>();
  if (pond !== null) mark0(occupied, pond);
  const mark = (x: number, y: number, w: number, h: number): void => {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) occupied.add(cellKey(xx, yy));
    }
  };
  const free = (x: number, y: number, w: number, h: number): boolean => {
    if (x < minX || y < minY || x + w > maxX + 1 || y + h > maxY + 1) return false;
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        if (occupied.has(cellKey(xx, yy))) return false;
      }
    }
    return true;
  };
  const furniture: NonNullable<PlaceDefinition['furniture']> = [];
  /** 已定 use 格(守卫:任何新家具不得使其四邻全堵) */
  const uses: Array<{ x: number; y: number }> = [];
  /** 门内格(南锚家具不得覆盖,保门畅通) */
  const doorCell = outdoor ? null : { x: px + Math.floor(pw / 2), y: py + ph - 2 };
  /** 模拟放置后仍满足:每个 use 至少留一个空邻(放置后口径) + 门内格不被占 */
  const guardOk = (x: number, y: number, w: number, h: number): boolean => {
    if (doorCell !== null && x <= doorCell.x && doorCell.x < x + w && y <= doorCell.y && doorCell.y < y + h) {
      return false;
    }
    const touched = new Set<string>();
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) touched.add(cellKey(xx, yy));
    }
    return uses.every((use) => !neighborsBlockedBy(use, touched));
  };
  const neighborsBlockedBy = (use: { x: number; y: number }, newlyBlocked: Set<string>): boolean => {
    let still = 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const k = cellKey(use.x + dx, use.y + dy);
      if (!occupied.has(k) && !newlyBlocked.has(k)) still += 1;
    }
    return still === 0;
  };
  const tryPlace = (x: number, y: number, w: number, h: number): boolean =>
    free(x, y, w, h) && guardOk(x, y, w, h);

  for (const slot of slots) {
    if (slot.chance !== undefined && !rng.chance(slot.chance)) continue;
    let placed: { x: number; y: number } | null = null;
    if (slot.anchor === 'north') {
      for (const xx of alignedScan(minX, maxX, slot.w, slot.align)) {
        if (tryPlace(xx, minY, slot.w, slot.h)) {
          placed = { x: xx, y: minY };
          break;
        }
      }
    } else if (slot.anchor === 'south') {
      const sy = maxY - slot.h + 1;
      for (const xx of alignedScan(minX, maxX, slot.w, slot.align)) {
        if (tryPlace(xx, sy, slot.w, slot.h)) {
          placed = { x: xx, y: sy };
          break;
        }
      }
    } else if (slot.anchor === 'west') {
      for (const yy of alignedScan(minY, maxY, slot.h, slot.align)) {
        if (tryPlace(minX, yy, slot.w, slot.h)) {
          placed = { x: minX, y: yy };
          break;
        }
      }
    } else if (slot.anchor === 'east') {
      const ex = maxX - slot.w + 1;
      for (const yy of alignedScan(minY, maxY, slot.h, slot.align)) {
        if (tryPlace(ex, yy, slot.w, slot.h)) {
          placed = { x: ex, y: yy };
          break;
        }
      }
    } else if (slot.anchor === 'scatter') {
      // 全场散撒(开放装饰场所):从全部可放位 rng 随机取一,道具自然分布不成排
      const candidates: Array<{ x: number; y: number }> = [];
      for (let yy = minY; yy + slot.h <= maxY + 1; yy += 1) {
        for (let xx = minX; xx + slot.w <= maxX + 1; xx += 1) {
          if (tryPlace(xx, yy, slot.w, slot.h)) candidates.push({ x: xx, y: yy });
        }
      }
      if (candidates.length > 0) placed = rng.pick(candidates);
    } else {
      for (let yy = minY; yy + slot.h <= maxY + 1 && placed === null; yy += 1) {
        for (let xx = minX; xx + slot.w <= maxX + 1 && placed === null; xx += 1) {
          if (tryPlace(xx, yy, slot.w, slot.h)) placed = { x: xx, y: yy };
        }
      }
    }
    if (placed === null) continue;
    mark(placed.x, placed.y, slot.w, slot.h);
    // 素材库随机选材:池非空即挑具体 sprite(缺省回退 kind 同名纹理);朝向由锚点派生
    const facing = FACING_BY_ANCHOR[slot.anchor];
    const pool = directionalPool(slot.pool, facing);
    const sprite = pool.length > 0 ? rng.pick([...pool]) : undefined;
    const facingField = facing !== undefined ? { facing } : {};
    if (slot.activityId !== undefined) {
      const use = deriveUse(placed.x, placed.y, slot.w, slot.h, minX, maxX, minY, maxY, occupied);
      if (use === null) continue; // 无合法使用格(过度拥挤),放弃该件
      occupied.add(cellKey(use.x, use.y)); // use 格反占,防后续家具覆盖
      uses.push(use);
      furniture.push({
        kind: slot.kind,
        x: placed.x,
        y: placed.y,
        w: slot.w,
        h: slot.h,
        activityId: slot.activityId,
        use,
        ...facingField,
        ...(sprite !== undefined ? { sprite } : {}),
      });
    } else {
      furniture.push({
        kind: slot.kind,
        x: placed.x,
        y: placed.y,
        w: slot.w,
        h: slot.h,
        ...facingField,
        ...(sprite !== undefined ? { sprite } : {}),
      });
    }
  }
  return furniture;
}

/** use 格推导:家具四邻(下/右/左/上)首个界内且未被家具占用格 */
function deriveUse(
  x: number,
  y: number,
  w: number,
  h: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  occupied: Set<string>,
): { x: number; y: number } | null {
  const candidates = [
    { x: x + Math.floor(w / 2), y: y + h },
    { x: x + w, y: y + Math.floor(h / 2) },
    { x: x - 1, y: y + Math.floor(h / 2) },
    { x: x + Math.floor(w / 2), y: y - 1 },
  ];
  for (const c of candidates) {
    if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY && !occupied.has(cellKey(c.x, c.y))) {
      return c;
    }
  }
  return null;
}
