import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_DEFINITIONS,
  FURNITURE_KINDS,
  REST_ANCHOR_KINDS,
  TOWN_MAP,
  findActivityAnchorAt,
  furnitureRectsOf,
  getActivityDefinition,
  isBesideFootprint,
  wallRectsOf,
  type BlockedRect,
  type PlaceDefinition,
} from '../src';

const inRect = (x: number, y: number, r: BlockedRect): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

const overlaps = (a: BlockedRect, b: BlockedRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('TOWN_MAP 结构不变量', () => {
  it('全图矩形(障碍/铺装/场所)均在网格边界内', () => {
    const rects: BlockedRect[] = [
      ...TOWN_MAP.blockedRects,
      ...TOWN_MAP.paths,
      ...TOWN_MAP.places,
    ];
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(TOWN_MAP.width);
      expect(r.y + r.h).toBeLessThanOrEqual(TOWN_MAP.height);
    }
  });

  it('场所 id 唯一且互不重叠', () => {
    const ids = TOWN_MAP.places.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < TOWN_MAP.places.length; i += 1) {
      for (let j = i + 1; j < TOWN_MAP.places.length; j += 1) {
        expect(overlaps(TOWN_MAP.places[i], TOWN_MAP.places[j])).toBe(false);
      }
    }
  });

  it('入口在自身占地外且不被墙体/障碍覆盖', () => {
    for (const place of TOWN_MAP.places) {
      const { x, y } = place.entrance;
      expect(inRect(x, y, place), `${place.id} 入口须在占地外`).toBe(false);
      const blockers: BlockedRect[] = [...TOWN_MAP.blockedRects, ...wallRectsOf(place)];
      for (const r of blockers) {
        expect(inRect(x, y, r), `${place.id} 入口(${x},${y})须可行走`).toBe(false);
      }
    }
  });

  it('门洞格位于自身占地边缘且墙体在其周留豁口', () => {
    for (const place of TOWN_MAP.places) {
      if (place.door === undefined) continue;
      const { x, y } = place.door;
      const onEdge =
        inRect(x, y, place) && (y === place.y || y === place.y + place.h - 1 || x === place.x || x === place.x + place.w - 1);
      expect(onEdge, `${place.id} 门洞须在占地边缘`).toBe(true);
      for (const wall of wallRectsOf(place)) {
        expect(inRect(x, y, wall), `${place.id} 门洞格须豁口`).toBe(false);
      }
    }
  });

  it('家具在场所内、互不重叠,use 格在场所内且紧邻锚点家具', () => {
    for (const place of TOWN_MAP.places) {
      const furniture = place.furniture ?? [];
      for (const f of furniture) {
        expect(
          f.x >= place.x && f.y >= place.y && f.x + f.w <= place.x + place.w && f.y + f.h <= place.y + place.h,
          `${place.id} 家具 ${f.kind} 越界`,
        ).toBe(true);
      }
      for (let i = 0; i < furniture.length; i += 1) {
        for (let j = i + 1; j < furniture.length; j += 1) {
          expect(overlaps(furniture[i], furniture[j]), `${place.id} 家具重叠`).toBe(false);
        }
      }
      for (const f of furniture) {
        if (f.use === undefined) continue;
        const { x, y } = f.use;
        expect(
          x >= place.x && x < place.x + place.w && y >= place.y && y < place.y + place.h,
          `${place.id} use 格须在场所内`,
        ).toBe(true);
        const adjacent =
          ((y === f.y - 1 || y === f.y + f.h) && x >= f.x && x < f.x + f.w) ||
          ((x === f.x - 1 || x === f.x + f.w) && y >= f.y && y < f.y + f.h);
        expect(adjacent, `${place.id} use 格须四邻相接 ${f.kind}`).toBe(true);
        for (const other of furnitureRectsOf(place)) {
          expect(inRect(x, y, other), `${place.id} use 格须可行走`).toBe(false);
        }
      }
    }
  });

  it('rest 锚点档位 ⊆ 家具全集,且 TOWN_MAP 无越档 rest 锚点', () => {
    for (const kind of REST_ANCHOR_KINDS) {
      expect(FURNITURE_KINDS).toContain(kind);
    }
    for (const place of TOWN_MAP.places) {
      for (const f of place.furniture ?? []) {
        if (f.activityId !== 'rest') continue;
        expect(REST_ANCHOR_KINDS).toContain(f.kind);
      }
    }
  });

  it('锚点家具绑定的活动均已定义,活动引用的场所均存在', () => {
    const placeIds = new Set(TOWN_MAP.places.map((p) => p.id));
    for (const place of TOWN_MAP.places) {
      for (const f of place.furniture ?? []) {
        if (f.activityId !== undefined) {
          expect(getActivityDefinition(f.activityId)).not.toBeNull();
        }
      }
    }
    for (const def of ACTIVITY_DEFINITIONS) {
      for (const id of def.placeIds) {
        expect(placeIds.has(id), `活动 ${def.id} 引用未知场所 ${id}`).toBe(true);
      }
    }
  });

  it('有墙场所(非公园)均设门洞且入口与门四邻相接', () => {
    for (const place of TOWN_MAP.places) {
      if (place.id === 'park') continue;
      expect(place.door, `${place.id} 须设门洞`).toBeDefined();
      const dist =
        Math.abs(place.entrance.x - place.door!.x) + Math.abs(place.entrance.y - place.door!.y);
      expect(dist, `${place.id} 入口须紧邻门洞`).toBe(1);
    }
  });
});

describe('锚点命中(M3.6i 放宽: 使用格或紧邻占地)', () => {
  it('isBesideFootprint: 四邻相接为真,对角/远格为假', () => {
    const treadmill = TOWN_MAP.places
      .find((p) => p.id === 'gym')!
      .furniture!.find((f) => f.kind === 'treadmill' && f.x === 44)!;
    expect(isBesideFootprint(treadmill, 45, 27)).toBe(true); // 声明使用格(右侧)
    expect(isBesideFootprint(treadmill, 45, 28)).toBe(true); // 下半格右侧,同样紧邻
    expect(isBesideFootprint(treadmill, 44, 26)).toBe(true); // 正上方
    expect(isBesideFootprint(treadmill, 45, 26)).toBe(false); // 对角不算
    expect(isBesideFootprint(treadmill, 46, 27)).toBe(false); // 两机间隙,不邻
  });

  it('findActivityAnchorAt: 使用格与紧邻格命中同锚点,间隙/远处未命中', () => {
    const hitUse = findActivityAnchorAt('workout', 45, 27);
    expect(hitUse).toMatchObject({ placeId: 'gym', kind: 'treadmill' });
    expect(findActivityAnchorAt('workout', 45, 28)).toMatchObject({ placeId: 'gym' });
    expect(findActivityAnchorAt('workout', 46, 27)).toBeNull();
    expect(findActivityAnchorAt('workout', 10, 10)).toBeNull();
    expect(findActivityAnchorAt('stroll', 45, 27)).toBeNull(); // 无锚点活动
  });
});

describe('PlaceDefinition 类型样例', () => {
  it('场所对象满足 PlaceDefinition 形状', () => {
    const park: PlaceDefinition = TOWN_MAP.places.find((p) => p.id === 'park')!;
    expect(park.door).toBeUndefined();
    expect(park.furniture?.length).toBeGreaterThan(0);
  });
});
