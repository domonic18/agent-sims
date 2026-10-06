import { describe, expect, it } from 'vitest';
import { TOWN_MAP, type WorldgenParams } from '@sims/shared';
import { TileMap } from '../map.js';
import { BUILTIN_SEED, generateTownMap, type WorldgenInput } from './generate.js';

const PARAMS: WorldgenParams = { size: 'small', density: 'normal' };

const input = (seed: string, overrides: Partial<WorldgenInput> = {}): WorldgenInput => ({
  seed,
  gameType: 'growth',
  params: PARAMS,
  manifestVersion: 'test0001',
  ...overrides,
});

describe('generateTownMap 可复现性', () => {
  it('同种子两次生成 deep equal(地图+报告)', () => {
    const a = generateTownMap(input('alpha'));
    const b = generateTownMap(input('alpha'));
    expect(a.map).toEqual(b.map);
    expect(a.report).toEqual(b.report);
  });

  it('不同参数(尺寸/密度/类型/素材版本)派生不同世界', () => {
    const base = generateTownMap(input('alpha'));
    expect(generateTownMap(input('alpha', { params: { size: 'medium', density: 'normal' } })).map).not.toEqual(base.map);
    expect(generateTownMap(input('alpha', { params: { size: 'small', density: 'dense' } })).map).not.toEqual(base.map);
    expect(generateTownMap(input('alpha', { manifestVersion: 'test0002' })).map).not.toEqual(base.map);
  });

  it('不同种子布局不同', () => {
    const a = generateTownMap(input('alpha'));
    const b = generateTownMap(input('beta'));
    expect(a.map.places.map((p) => `${p.id}@${p.x},${p.y}`)).not.toEqual(
      b.map.places.map((p) => `${p.id}@${p.x},${p.y}`),
    );
  });

  it('内置种子返回固定地图', () => {
    const result = generateTownMap(input(BUILTIN_SEED));
    expect(result.map).toBe(TOWN_MAP);
    expect(result.report.checks.fallback).toBe(true);
  });
});

describe('generateTownMap 生成质量(50 种子批量)', () => {
  const seeds = Array.from({ length: 50 }, (_, i) => `seed-${i}`);
  const results = seeds.map((seed) => generateTownMap(input(seed)));

  it('全部通过校验(无兜底回退)', () => {
    for (const result of results) {
      expect(result.report.checks.fallback).toBe(false);
      expect(result.report.checks.connectivity).toBe(true);
      expect(result.report.checks.anchorsComplete).toBe(true);
    }
  });

  it('场所配额齐备(公寓≥3/七类场所+诊所俱全)', () => {
    for (const result of results) {
      const kinds = new Set(result.map.places.map((p) => p.id.split('-')[0]));
      for (const kind of ['home', 'park', 'library', 'office', 'shop', 'restaurant', 'gym', 'clinic']) {
        expect(kinds.has(kind)).toBe(true);
      }
      expect(result.map.places.filter((p) => p.id.startsWith('home')).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('生成地图可直接构造 TileMap(复用世界层校验)', () => {
    for (const result of results) {
      expect(() => TileMap.fromDefinition(result.map)).not.toThrow();
    }
  });

  it('场所间无占地重叠', () => {
    for (const result of results) {
      const rects = result.map.places.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]!;
          const b = rects[j]!;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('场所撒放非行排(同 kind 不同行/列,防回归回退到行排布局)', () => {
    for (const result of results) {
      const homes = result.map.places.filter((p) => p.id.startsWith('home'));
      expect(homes.length).toBeGreaterThanOrEqual(3);
      // 旧行排:同 kind 全部同一 y(依次排开);撒放后纵/横向至少两个不同坐标
      expect(new Set(homes.map((p) => p.y)).size).toBeGreaterThanOrEqual(2);
      expect(new Set(homes.map((p) => p.x)).size).toBeGreaterThanOrEqual(2);
      // 全图场所不同时压在同一条横带上(旧布局四象限各一行的退化形态)
      const rows = new Set(result.map.places.map((p) => p.y));
      expect(rows.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('有门场所携带地板/墙 tile(渲染直配)', () => {
    for (const result of results) {
      for (const place of result.map.places) {
        if (place.door !== undefined) {
          expect(place.floorTile).toMatch(/^tile-floor/);
          expect(place.wallTile).toMatch(/^tile-wall/);
        }
      }
    }
  });

  it('公园北缘围栏段(M-G.5 数据化): 覆盖=宽-1,入口列豁口,段在场所北缘内', () => {
    for (const result of results) {
      const park = result.map.places.find((p) => p.id.startsWith('park'));
      if (park === undefined) continue;
      const fences = result.map.fences ?? [];
      expect(fences.length).toBeGreaterThanOrEqual(1);
      let covered = 0;
      for (const fence of fences) {
        expect(fence.y).toBe(park.y);
        expect(fence.x).toBeGreaterThanOrEqual(park.x);
        expect(fence.x + fence.w).toBeLessThanOrEqual(park.x + park.w);
        covered += fence.w;
      }
      expect(covered).toBe(park.w - 1);
      const gap = park.entrance.x;
      expect(fences.some((f) => gap >= f.x && gap < f.x + f.w)).toBe(false);
    }
  });
});

describe('站点与资源节点撒点(M-G.6)', () => {
  const results = Array.from({ length: 20 }, (_, i) => generateTownMap(input(`mg6-${i}`)));

  it('餐厅灶台/办公楼木工台必生成(绑定 craft 活动锚点且带使用格)', () => {
    for (const result of results) {
      const restaurant = result.map.places.find((p) => p.id.startsWith('restaurant'));
      const office = result.map.places.find((p) => p.id.startsWith('office'));
      expect(restaurant).toBeDefined();
      expect(office).toBeDefined();
      expect(
        restaurant!.furniture?.some(
          (f) => f.kind === 'stove' && f.activityId === 'craft_berry_pie' && f.use !== undefined,
        ),
      ).toBe(true);
      expect(
        office!.furniture?.some(
          (f) => f.kind === 'workbench' && f.activityId === 'craft_repair_kit' && f.use !== undefined,
        ),
      ).toBe(true);
    }
  });

  it('资源节点: 浆果丛 3~6 全落公园内部,拾荒堆 2~4 全落场所外,同格不重叠', () => {
    for (const result of results) {
      const resources = result.map.resources ?? [];
      const berries = resources.filter((r) => r.kind === 'berry_bush');
      const junk = resources.filter((r) => r.kind === 'junk_pile');
      expect(berries.length).toBeGreaterThanOrEqual(3);
      expect(berries.length).toBeLessThanOrEqual(6);
      expect(junk.length).toBeGreaterThanOrEqual(2);
      expect(junk.length).toBeLessThanOrEqual(4);
      const parks = result.map.places.filter((p) => p.id.startsWith('park'));
      for (const berry of berries) {
        expect(
          parks.some(
            (p) =>
              berry.x > p.x && berry.x < p.x + p.w - 1 && berry.y > p.y && berry.y < p.y + p.h - 1,
          ),
        ).toBe(true);
      }
      for (const node of junk) {
        expect(
          result.map.places.some(
            (p) => node.x >= p.x && node.x < p.x + p.w && node.y >= p.y && node.y < p.y + p.h,
          ),
        ).toBe(false);
      }
      const keys = new Set(resources.map((r) => `${r.x},${r.y}`));
      expect(keys.size).toBe(resources.length);
    }
  });
});

describe('鲁棒性扩量(300 例:100 种子×3 密度)', () => {
  it('零兜底回退', () => {
    let fallback = 0;
    for (let i = 0; i < 100; i += 1) {
      for (const density of ['sparse', 'normal', 'dense'] as const) {
        const result = generateTownMap(input(`seed-${i}`, { params: { size: 'small', density } }));
        if (result.report.checks.fallback) fallback += 1;
      }
    }
    expect(fallback).toBe(0);
  });
});

describe('全量素材驱动的场所扩展(重规划)', () => {
  /** 全 kind 全域素材池(键与 worlds.ts loadAssetsByKind 契约一致) */
  const POOLS: Record<string, string[]> = {
    ...Object.fromEntries(
      ['bed', 'desk', 'workstation', 'treadmill', 'table', 'bookshelf', 'shelf', 'counter', 'sofa', 'plant', 'fridge', 'tv', 'wardrobe', 'bench', 'stove', 'workbench'].map(
        (k) => [`indoor/${k}`, [`${k}-a`, `${k}-b`]],
      ),
    ),
    ...Object.fromEntries(
      ['bench', 'tent', 'chair', 'table', 'barrel', 'sign', 'lantern'].map(
        (k) => [`outdoor/${k}`, [`out-${k}-a`, `out-${k}-b`]],
      ),
    ),
    'theme/beach@1': ['beach-shell-a', 'beach-bucket-a'],
    'theme/beach@4': ['beach-towel-a', 'beach-castle-a'],
    'theme/camping@1': ['camping-lantern-a', 'camping-backpack-a'],
    ...Object.fromEntries(
      ['kitchen', 'grocery-store', 'clothing-store', 'japanese-interiors', 'museum'].map((t) => [
        `theme/${t}@2`,
        [`${t}-tall-a`, `${t}-tall-b`],
      ]),
    ),
    ...Object.fromEntries(
      ['kitchen', 'grocery-store', 'museum'].map((t) => [`theme/${t}@1`, [`${t}-small-a`]]),
    ),
  };

  const results = Array.from({ length: 50 }, (_, i) =>
    generateTownMap(input(`pool-${i}`, { assetsByKind: POOLS })),
  );
  const allFurniture = results.flatMap((r) => r.map.places.flatMap((p) => p.furniture ?? []));

  it('扩展场所会出现(50 种子并集非空);开放场所无门,室内扩展场所有门', () => {
    const newVenueKinds = ['cafe', 'school', 'hotel', 'clinic', 'plaza', 'beach', 'camping'];
    const openKinds = new Set(['park', 'plaza', 'beach', 'camping']);
    const seen = new Set<string>();
    for (const result of results) {
      for (const place of result.map.places) {
        const kind = place.id.split('-')[0]!;
        if (newVenueKinds.includes(kind)) seen.add(kind);
        if (openKinds.has(kind)) {
          expect(place.door).toBeUndefined();
        } else if (newVenueKinds.includes(kind)) {
          expect(place.door).toBeDefined();
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('池非空则家具必带 sprite,且选材来自对应池(域分键不混)', () => {
    const allSlugs = new Set(Object.values(POOLS).flat());
    for (const f of allFurniture) {
      expect(f.sprite).toBeDefined();
      expect(allSlugs.has(f.sprite!)).toBe(true);
    }
  });

  it('主题道具池选材不越池(themePick 槽位仅出本主题道具)', () => {
    const themeOf = (slug: string): string | null => {
      if (slug.startsWith('beach-')) return 'beach';
      if (slug.startsWith('camping-')) return 'camping';
      return null;
    };
    for (const result of results) {
      for (const place of result.map.places) {
        const kind = place.id.split('-')[0];
        if (kind !== 'beach' && kind !== 'camping') continue;
        for (const f of place.furniture ?? []) {
          // bench/tent 为 kind 池槽位,themePick 槽位才受主题约束
          if (f.kind === 'bench' || f.kind === 'tent') continue;
          expect(themeOf(f.sprite ?? '')).toBe(kind);
        }
      }
    }
  });

  it('户外道具家具渲染占位与声明占地一致(不越界)', () => {
    for (const result of results) {
      for (const place of result.map.places) {
        for (const f of place.furniture ?? []) {
          expect(f.x).toBeGreaterThanOrEqual(place.x);
          expect(f.y + f.h).toBeLessThanOrEqual(place.y + place.h);
        }
      }
    }
  });

  it('室内主题角挂点: 六类场所 themePick 槽位仅出本主题道具(50 种子并集非空)', () => {
    // 场所 kind → 挂点主题道具前缀(plant 等 kind 池槽位不受约束;shop 双主题)
    const hookTheme: Record<string, string[]> = {
      restaurant: ['kitchen'],
      cafe: ['kitchen'],
      shop: ['grocery-store', 'clothing-store'],
      library: ['museum'],
      school: ['museum'],
      hotel: ['japanese-interiors'],
    };
    const seenPlaces = new Set<string>();
    for (const result of results) {
      for (const place of result.map.places) {
        const themes = hookTheme[place.id.split('-')[0]!];
        if (themes === undefined) continue;
        for (const f of place.furniture ?? []) {
          if (!f.kind.endsWith('-prop')) continue;
          expect(themes.some((t) => (f.sprite ?? '').includes(t))).toBe(true);
          seenPlaces.add(place.id.split('-')[0]!);
        }
      }
    }
    expect(seenPlaces.size).toBeGreaterThanOrEqual(4);
  });

  it('themePick 池空的装饰槽不发出家具(kind 无同名纹理,必渲染缺素材)', () => {
    const noCampingPool: Record<string, string[]> = Object.fromEntries(
      Object.entries(POOLS).filter(([key]) => !key.startsWith('theme/camping')),
    );
    for (let i = 0; i < 20; i += 1) {
      const result = generateTownMap(input(`empty-pool-${i}`, { assetsByKind: noCampingPool }));
      expect(result.report.checks.fallback).toBe(false);
      for (const place of result.map.places) {
        if (place.id.split('-')[0] !== 'camping') continue;
        for (const f of place.furniture ?? []) {
          expect(f.kind).not.toBe('camping-prop');
          // 池非空槽位照常带 sprite
          expect(f.sprite).toBeDefined();
        }
      }
    }
  });
});
