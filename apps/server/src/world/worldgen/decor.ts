import {
  solidDecorRect,
  type BlockedRect,
  type DecorEntry,
  type GameType,
  type PlaceDefinition,
  type ResourceNodeSeed,
  type TileMapDefinition,
} from '@sims/shared';
import { DECOR_POOLS } from './blueprint.js';
import { cellKey, mark0 } from './grid.js';
import { Rng } from './prng.js';

/**
 * 户外装饰引擎(池驱动五 pass):街道街具路灯 → 宅前庭院 → 公园花木长椅 →
 * 场所间隙 → 边界树带。素材池(DECOR_POOLS)非空时出 props/flats 数据条目
 * (slug 即纹理,渲染层 propSprite/overlay),池空回退旧固定纹理字段
 * trees/lamps/flowers/bushes(stub/无素材路径行为不变)。
 * 通用避让:道路/广场/池塘/围栏/资源节点/场所占地/入口门邻域/彼此占用;
 * 密度档缩放撒点量(sparse 0.6/normal 1/dense 1.4)。
 */
export function buildDecor(
  rng: Rng,
  width: number,
  height: number,
  densityIndex: number,
  gameType: GameType,
  places: PlaceDefinition[],
  paths: BlockedRect[],
  plaza: BlockedRect,
  pond: BlockedRect | null,
  fences: BlockedRect[],
  resources: ResourceNodeSeed[],
  assetsByKind: Readonly<Record<string, readonly string[]>> | undefined,
  wild: { forests: BlockedRect[]; rocks: BlockedRect[] } | null,
  townCore: BlockedRect | null,
  assetSizes: Readonly<Record<string, readonly [number, number]>> | undefined,
): TileMapDefinition['decor'] {
  const densityScale = [0.6, 1, 1.4][densityIndex] ?? 1;
  const trees: Array<[number, number]> = [];
  const lamps: Array<[number, number]> = [];
  const flowers: Array<[number, number]> = [];
  const bushes: Array<[number, number]> = [];
  const props: DecorEntry[] = [];
  const flats: DecorEntry[] = [];
  const pools = {
    tree: assetsByKind?.[DECOR_POOLS.tree] ?? [],
    bush: assetsByKind?.[DECOR_POOLS.bush] ?? [],
    bench: assetsByKind?.[DECOR_POOLS.bench] ?? [],
    street: assetsByKind?.[DECOR_POOLS.street] ?? [],
    lamp: assetsByKind?.[DECOR_POOLS.lamp] ?? [],
    flat: assetsByKind?.[DECOR_POOLS.flat] ?? [],
    wreck: assetsByKind?.[DECOR_POOLS.wreck] ?? [],
  };
  type StandingKind = keyof typeof DECOR_POOLS;
  /** 落一件立式装饰:池非空出数据条目,池空回退旧字段(bench/street 无旧纹理,弃放) */
  const addStanding = (x: number, y: number, kind: StandingKind): void => {
    taken.add(cellKey(x, y));
    const pool = pools[kind];
    if (pool.length > 0) {
      props.push({ slug: rng.pick(pool), x, y });
      return;
    }
    if (kind === 'tree') trees.push([x, y]);
    else if (kind === 'bush') bushes.push([x, y]);
    else if (kind === 'lamp') lamps.push([x, y]);
  };
  const addFlat = (x: number, y: number): void => {
    taken.add(cellKey(x, y));
    if (pools.flat.length > 0) flats.push({ slug: rng.pick(pools.flat), x, y });
    else flowers.push([x, y]);
  };
  /** 落一件 solid 镇外装饰:全占地逐格避让校验后占格(占地式与 TileMap blockedRect 同源) */
  const addWreck = (x: number, y: number): boolean => {
    const slug = rng.pick(pools.wreck);
    const [w, h] = assetSizes?.[slug] ?? [1, 1];
    const entry: DecorEntry = { slug, x, y, w, h, solid: true };
    const rect = solidDecorRect(entry);
    for (let yy = rect.y; yy < rect.y + rect.h; yy += 1) {
      for (let xx = rect.x; xx < rect.x + rect.w; xx += 1) {
        if (!free(xx, yy)) return false;
      }
    }
    mark0(taken, rect);
    props.push(entry);
    return true;
  };

  const placeRects = places.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  const inAnyPlace = (x: number, y: number): boolean =>
    placeRects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  /** 全局禁放:道路/广场/池塘外扩/围栏/资源格(场所占地用 inAnyPlace 单查) */
  const noGo = new Set<string>();
  for (const r of paths) mark0(noGo, r);
  if (pond !== null) mark0(noGo, { x: pond.x - 1, y: pond.y - 1, w: pond.w + 2, h: pond.h + 2 });
  for (const f of fences) mark0(noGo, f);
  for (const res of resources) noGo.add(cellKey(res.x, res.y));
  const taken = new Set<string>();
  const free = (x: number, y: number): boolean =>
    x >= 1 && y >= 1 && x <= width - 2 && y <= height - 2 &&
    !taken.has(cellKey(x, y)) && !noGo.has(cellKey(x, y)) && !inAnyPlace(x, y);

  // pass1 街道:沿路段间隔一侧落路灯(survival 更稀疏,荒凉感;30% 换街具),广场四角灯
  const [lampGapMin, lampGapMax] = gameType === 'survival' ? [18, 27] : [12, 18];
  for (const road of paths) {
    if (road === plaza) continue;
    const horizontal = road.h <= road.w;
    const span = horizontal ? road.w : road.h;
    for (let s = 2; s < span - 1; s += rng.int(lampGapMin, lampGapMax)) {
      const side = rng.chance(0.5) ? -2 : 3;
      const x = horizontal ? road.x + s : road.x + side;
      const y = horizontal ? road.y + side : road.y + s;
      if (!free(x, y)) continue;
      addStanding(x, y, rng.chance(0.3) && pools.street.length > 0 ? 'street' : 'lamp');
    }
  }
  for (const [cx2, cy2] of [
    [plaza.x - 1, plaza.y - 1],
    [plaza.x + plaza.w, plaza.y - 1],
    [plaza.x - 1, plaza.y + plaza.h],
    [plaza.x + plaza.w, plaza.y + plaza.h],
  ] as const) {
    if (free(cx2, cy2)) addStanding(cx2, cy2, 'lamp');
  }

  // pass2 宅前庭院:有门场所门前三邻(先跑,再补入口门邻域禁放;survival 减半显荒凉)
  for (const place of places) {
    if (place.door === undefined) continue;
    const e = place.entrance;
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i += 1) {
      if (gameType === 'survival' && !rng.chance(0.5)) continue;
      const x = e.x + rng.pick([-2, -1, 1, 2]);
      const y = e.y + (rng.chance(0.3) ? rng.int(0, 1) : 0);
      if (x === e.x && y === e.y) continue;
      if (!free(x, y)) continue;
      if (rng.chance(0.5)) addStanding(x, y, 'bush');
      else addFlat(x, y);
    }
  }
  for (const place of places) {
    const e = place.entrance;
    mark0(noGo, { x: e.x - 1, y: e.y - 1, w: 3, h: 3 });
    if (place.door !== undefined) {
      mark0(noGo, { x: place.door.x - 1, y: place.door.y - 1, w: 3, h: 3 });
    }
  }

  // pass3 公园:树簇/贴地花丛(内部撒点,避池塘外扩/家具/使用格三邻)/长椅环塘缘
  const parkOccupied = new Set<string>();
  for (const place of places) {
    if (!place.id.startsWith('park')) continue;
    for (const f of place.furniture ?? []) {
      mark0(parkOccupied, { x: f.x, y: f.y, w: f.w, h: f.h });
      if (f.use !== undefined) mark0(parkOccupied, { x: f.use.x - 1, y: f.use.y - 1, w: 3, h: 3 });
    }
  }
  const parkFree = (park: PlaceDefinition, x: number, y: number): boolean =>
    x >= park.x + 1 && y >= park.y + 1 && x <= park.x + park.w - 2 && y <= park.y + park.h - 2 &&
    !parkOccupied.has(cellKey(x, y)) && !noGo.has(cellKey(x, y)) && !taken.has(cellKey(x, y));
  const pondRim = pond !== null
    ? [
        ...Array.from({ length: pond.w }, (_, i) => [{ x: pond.x + i, y: pond.y - 1 }, { x: pond.x + i, y: pond.y + pond.h }]).flat(),
        ...Array.from({ length: pond.h }, (_, i) => [{ x: pond.x - 1, y: pond.y + i }, { x: pond.x + pond.w, y: pond.y + i }]).flat(),
      ]
    : [];
  for (const place of places) {
    if (!place.id.startsWith('park')) continue;
    const clusters = Math.max(2, Math.round(rng.int(2, 4) * densityScale));
    for (let i = 0; i < clusters; i += 1) {
      const x = rng.int(place.x + 1, place.x + place.w - 2);
      const y = rng.int(place.y + 1, place.y + place.h - 2);
      if (parkFree(place, x, y)) addStanding(x, y, 'tree');
    }
    const flowerCount = Math.max(3, Math.round(rng.int(3, 6) * densityScale));
    for (let i = 0; i < flowerCount; i += 1) {
      const x = rng.int(place.x + 1, place.x + place.w - 2);
      const y = rng.int(place.y + 1, place.y + place.h - 2);
      if (parkFree(place, x, y)) addFlat(x, y);
    }
    const benches = Math.max(1, Math.round(rng.int(1, 2) * densityScale));
    for (let i = 0; i < benches * 3 && pondRim.length > 0; i += 1) {
      const rim = rng.pick(pondRim);
      if (parkFree(place, rim.x, rim.y)) addStanding(rim.x, rim.y, 'bench');
    }
  }

  // pass4 场所间隙:空草地随机点缀(乔木为主,灌木/花丛补充)
  const gapCount = Math.max(4, Math.round(10 * densityScale));
  for (let i = 0; i < gapCount; i += 1) {
    const x = rng.int(1, width - 2);
    const y = rng.int(1, height - 2);
    if (!free(x, y)) continue;
    const roll = rng.chance(0.65);
    if (roll) addStanding(x, y, 'tree');
    else if (rng.chance(0.5)) addStanding(x, y, 'bush');
    else addFlat(x, y);
  }

  // pass4.5 镇外簇密植(survival):森林簇密树/偶灌木成林,岩石区贴地碎石——
  // 资源节点已在 noGo,decor 只补视觉体量(growth 零变化)
  if (gameType === 'survival' && wild !== null) {
    for (const forest of wild.forests) {
      for (let y = forest.y; y < forest.y + forest.h; y += 1) {
        for (let x = forest.x; x < forest.x + forest.w; x += 1) {
          if (!free(x, y)) continue;
          if (rng.chance(0.3 * densityScale)) addStanding(x, y, 'tree');
          else if (rng.chance(0.08)) addStanding(x, y, 'bush');
        }
      }
    }
    for (const rock of wild.rocks) {
      for (let y = rock.y; y < rock.y + rock.h; y += 1) {
        for (let x = rock.x; x < rock.x + rock.w; x += 1) {
          if (!free(x, y)) continue;
          if (rng.chance(0.2 * densityScale)) addFlat(x, y);
        }
      }
    }
  }

  // pass4.6 镇外废土装饰(survival):残骸/电线杆/路障撒镇外带(solid 不可穿越,
  // 全占地避让;连通校验兜底)——growth 零变化
  if (gameType === 'survival' && wild !== null && townCore !== null && pools.wreck.length > 0) {
    const inCore = (x: number, y: number): boolean =>
      x >= townCore.x && x < townCore.x + townCore.w && y >= townCore.y && y < townCore.y + townCore.h;
    const wreckCount = Math.round(rng.int(8, 14) * densityScale);
    for (let i = 0, placed = 0; i < wreckCount * 4 && placed < wreckCount; i += 1) {
      const x = rng.int(1, width - 2);
      const y = rng.int(1, height - 2);
      if (inCore(x, y)) continue;
      if (addWreck(x, y)) placed += 1;
    }
  }

  // pass5 边界树带:内圈隔格交错(替代渲染层写死 cypress,生成图由数据驱动)
  const borderTree = (x: number, y: number): void => {
    if ((x + y) % 2 !== 0 || !free(x, y)) return;
    addStanding(x, y, 'tree');
  };
  for (let y = 1; y <= height - 2; y += 1) {
    borderTree(1, y);
    borderTree(width - 2, y);
  }
  for (let x = 2; x <= width - 3; x += 1) {
    borderTree(x, 1);
    borderTree(x, height - 2);
  }

  return {
    trees,
    lamps,
    flowers,
    bushes,
    ...(pond !== null ? { pond } : {}),
    ...(props.length > 0 ? { props } : {}),
    ...(flats.length > 0 ? { flats } : {}),
  };
}
