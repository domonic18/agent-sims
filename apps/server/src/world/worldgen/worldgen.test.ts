import { describe, expect, it } from 'vitest';
import { TOWN_MAP, solidDecorRect, type WorldgenParams } from '@sims/shared';
import { TileMap } from '../map.js';
import { DECOR_POOLS } from './blueprint.js';
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

  it('蜿蜒路网:广场 patch 存在且近中心,横向路段跨多行带(折弯防回归直十字)', () => {
    for (const result of results) {
      const plazaPatch = (result.map.patches ?? []).find((pt) => pt.tile === 'tile-plaza');
      expect(plazaPatch).toBeDefined();
      const cx = plazaPatch!.x + plazaPatch!.w / 2;
      const cy = plazaPatch!.y + plazaPatch!.h / 2;
      expect(Math.abs(cx - result.map.width / 2)).toBeLessThanOrEqual(3);
      expect(Math.abs(cy - result.map.height / 2)).toBeLessThanOrEqual(3);
      const rows = new Set(result.map.paths.filter((p) => p.h === 2 && p.w >= 3).map((p) => p.y));
      expect(rows.size).toBeGreaterThanOrEqual(2);
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

  it('零兜底回退(survival 镇内外分区同规模,M-S/S1.5)', () => {
    let fallback = 0;
    for (let i = 0; i < 100; i += 1) {
      for (const density of ['sparse', 'normal', 'dense'] as const) {
        const result = generateTownMap(
          input(`seed-${i}`, { gameType: 'survival', params: { size: 'small', density } }),
        );
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
          // bench/tent/desk 为 kind 池槽位,themePick 槽位才受主题约束
          if (f.kind === 'bench' || f.kind === 'tent' || f.kind === 'desk') continue;
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

describe('池驱动户外装饰引擎(五 pass)', () => {
  const DECOR_STUB: Record<string, string[]> = {
    'decor/tree': ['tree-a', 'tree-b', 'tree-c'],
    'decor/bush': ['bush-a', 'bush-b'],
    'decor/bench': ['bench-a', 'bench-b'],
    'decor/street': ['hydrant-a', 'sign-a', 'mailbox-a'],
    'decor/lamp': ['lamp-a', 'lamp-b'],
    'decor/flat': ['flower-a', 'grass-a'],
  };
  const results = Array.from({ length: 20 }, (_, i) =>
    generateTownMap(input(`decor-${i}`, { assetsByKind: DECOR_STUB })),
  );

  it('带池时 props/flats 非空,slug 全部来自对应池,边界树带存在', () => {
    for (const result of results) {
      const decor = result.map.decor;
      expect(decor).toBeDefined();
      expect(decor!.props?.length ?? 0).toBeGreaterThan(0);
      expect(decor!.flats?.length ?? 0).toBeGreaterThan(0);
      const valid = new Set(Object.values(DECOR_STUB).flat());
      const map = result.map;
      for (const entry of decor!.props ?? []) {
        expect(valid.has(entry.slug)).toBe(true);
      }
      for (const entry of decor!.flats ?? []) {
        expect(DECOR_STUB['decor/flat']!.includes(entry.slug)).toBe(true);
      }
      const onBorder = (e: { x: number; y: number }): boolean =>
        e.x === 1 || e.y === 1 || e.x === map.width - 2 || e.y === map.height - 2;
      expect((decor!.props ?? []).some(onBorder)).toBe(true);
    }
  });

  it('全池覆盖时旧固定纹理字段清空(不与池驱动条目双份渲染)', () => {
    for (const result of results) {
      const decor = result.map.decor!;
      expect(decor.trees).toHaveLength(0);
      expect(decor.lamps).toHaveLength(0);
      expect(decor.flowers).toHaveLength(0);
      expect(decor.bushes).toHaveLength(0);
    }
  });

  it('装饰条目避让场所占地/道路/资源格', () => {
    for (const result of results) {
      const map = result.map;
      const roadCells = new Set<string>();
      for (const r of map.paths) {
        for (let y = r.y; y < r.y + r.h; y += 1) {
          for (let x = r.x; x < r.x + r.w; x += 1) roadCells.add(`${x},${y}`);
        }
      }
      // 公园内部装饰为设计内(树簇/花丛/长椅落在公园矩形内),其余场所占地禁入
      const inPlace = (x: number, y: number): boolean =>
        map.places.some(
          (p) => !p.id.startsWith('park') && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h,
        );
      const entries = [...(map.decor!.props ?? []), ...(map.decor!.flats ?? [])];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(inPlace(entry.x, entry.y)).toBe(false);
        expect(roadCells.has(`${entry.x},${entry.y}`)).toBe(false);
        for (const res of map.resources ?? []) {
          expect(entry.x === res.x && entry.y === res.y).toBe(false);
        }
      }
    }
  });

  it('密度档缩放撒点量(dense 装饰总量 > sparse)', () => {
    const total = (density: 'sparse' | 'dense'): number =>
      Array.from({ length: 20 }, (_, i) =>
        generateTownMap(
          input(`scale-${i}`, { params: { size: 'small', density }, assetsByKind: DECOR_STUB }),
        ),
      ).reduce((sum, r) => sum + (r.map.decor?.props?.length ?? 0) + (r.map.decor?.flats?.length ?? 0), 0);
    expect(total('dense')).toBeGreaterThan(total('sparse'));
  });
});

describe('末日生存模式(survival gameType)', () => {
  const results = Array.from({ length: 50 }, (_, i) =>
    generateTownMap(input(`surv-${i}`, { gameType: 'survival' })),
  );

  it('全部通过校验(零兜底回退,复用世界层 TileMap 校验)', () => {
    for (const result of results) {
      expect(result.report.checks.fallback).toBe(false);
      expect(result.report.checks.connectivity).toBe(true);
      expect(result.report.checks.anchorsComplete).toBe(true);
      expect(() => TileMap.fromDefinition(result.map)).not.toThrow();
    }
  });

  it('场所末日化重配: 营地/墓地/废墟/医院/警察局/诊所/商店俱全,公寓 2~3', () => {
    for (const result of results) {
      const kinds = new Set(result.map.places.map((p) => p.id.split('-')[0]));
      for (const kind of ['camping', 'graveyard', 'ruins', 'hospital', 'police', 'clinic', 'shop']) {
        expect(kinds.has(kind)).toBe(true);
      }
      const homes = result.map.places.filter((p) => p.id.startsWith('home')).length;
      expect(homes).toBeGreaterThanOrEqual(2);
      expect(homes).toBeLessThanOrEqual(3);
    }
  });

  it('墓地四边围栏: 每边恰 3 格豁口且豁口格可行走,入口格可达', () => {
    for (const result of results) {
      const tileMap = TileMap.fromDefinition(result.map);
      for (const grave of result.map.places.filter((p) => p.id.startsWith('graveyard'))) {
        const fences = (result.map.fences ?? []).filter(
          (f) => f.x >= grave.x && f.x < grave.x + grave.w && f.y >= grave.y && f.y < grave.y + grave.h,
        );
        expect(fences.length).toBeGreaterThanOrEqual(4);
        const fenced = (x: number, y: number): boolean =>
          fences.some((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
        // 边格互斥归属:横边含角格,竖边让出两角(与 graveyardFences 布局一致)
        const sides: Array<Array<[number, number]>> = [
          Array.from({ length: grave.w }, (_, i) => [grave.x + i, grave.y] as [number, number]),
          Array.from({ length: grave.w }, (_, i) => [grave.x + i, grave.y + grave.h - 1] as [number, number]),
          Array.from({ length: grave.h - 2 }, (_, i) => [grave.x, grave.y + 1 + i] as [number, number]),
          Array.from({ length: grave.h - 2 }, (_, i) => [grave.x + grave.w - 1, grave.y + 1 + i] as [number, number]),
        ];
        for (const side of sides) {
          const gaps = side.filter(([x, y]) => !fenced(x, y));
          expect(gaps.length).toBe(3);
          for (const [x, y] of gaps) expect(tileMap.isWalkable(x, y)).toBe(true);
        }
        expect(tileMap.isWalkable(grave.entrance.x, grave.entrance.y)).toBe(true);
      }
    }
  });

  it('资源加密: 浆果 4~8 落公园/营地内部,拾荒堆 5~9 全落场所外', () => {
    for (const result of results) {
      const resources = result.map.resources ?? [];
      const berries = resources.filter((r) => r.kind === 'berry_bush');
      const junk = resources.filter((r) => r.kind === 'junk_pile');
      expect(berries.length).toBeGreaterThanOrEqual(4);
      expect(berries.length).toBeLessThanOrEqual(8);
      expect(junk.length).toBeGreaterThanOrEqual(5);
      expect(junk.length).toBeLessThanOrEqual(9);
      const sites = result.map.places.filter(
        (p) => p.id.startsWith('park') || p.id.startsWith('camping'),
      );
      expect(sites.length).toBeGreaterThanOrEqual(1);
      for (const berry of berries) {
        expect(
          sites.some(
            (p) => berry.x > p.x && berry.x < p.x + p.w - 1 && berry.y > p.y && berry.y < p.y + p.h - 1,
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
    }
  });

  it('生存资源三件套: 树 6~10/岩石 4~7 迁镇外(不在镇内场所),金属堆 3~6 落废墟(M-S/S1.5)', () => {
    for (const result of results) {
      const resources = result.map.resources ?? [];
      const trees = resources.filter((r) => r.kind === 'tree');
      const rocks = resources.filter((r) => r.kind === 'rock');
      const metals = resources.filter((r) => r.kind === 'metal_pile');
      expect(trees.length).toBeGreaterThanOrEqual(6);
      expect(trees.length).toBeLessThanOrEqual(10);
      expect(rocks.length).toBeGreaterThanOrEqual(4);
      expect(rocks.length).toBeLessThanOrEqual(7);
      expect(metals.length).toBeGreaterThanOrEqual(3);
      expect(metals.length).toBeLessThanOrEqual(6);
      const core = result.map.townCore;
      expect(core).toBeDefined();
      const ruins = result.map.places.filter((p) => p.id.startsWith('ruins'));
      const insidePlace = (node: { x: number; y: number }): boolean =>
        result.map.places.some(
          (p) => node.x >= p.x && node.x < p.x + p.w && node.y >= p.y && node.y < p.y + p.h,
        );
      const inTown = (node: { x: number; y: number }): boolean =>
        core !== undefined &&
        node.x >= core.x - 1 &&
        node.x < core.x + core.w + 1 &&
        node.y >= core.y - 1 &&
        node.y < core.y + core.h + 1;
      for (const t of [...trees, ...rocks]) {
        expect(inTown(t)).toBe(false);
        expect(insidePlace(t)).toBe(false);
      }
      const inside = (node: { x: number; y: number }, areas: typeof ruins): boolean =>
        areas.some(
          (p) => node.x > p.x && node.x < p.x + p.w - 1 && node.y > p.y && node.y < p.y + p.h - 1,
        );
      for (const m of metals) expect(inside(m, ruins)).toBe(true);
    }
  });

  it('镇内外分区: townCore 透传(~62% 中心矩形),镇内场所含于核心,镇外场所与核心不相交(M-S/S1.5)', () => {
    for (const result of results) {
      const core = result.map.townCore;
      expect(core).toBeDefined();
      if (core === undefined) continue;
      expect(core.w).toBe(Math.round(result.map.width * 0.62));
      expect(core.h).toBe(Math.round(result.map.height * 0.62));
      const contained = (p: { x: number; y: number; w: number; h: number }): boolean =>
        p.x >= core.x && p.y >= core.y &&
        p.x + p.w <= core.x + core.w && p.y + p.h <= core.y + core.h;
      const intersects = (p: { x: number; y: number; w: number; h: number }): boolean =>
        p.x < core.x + core.w && core.x < p.x + p.w &&
        p.y < core.y + core.h && core.y < p.y + p.h;
      for (const place of result.map.places) {
        const kind = place.id.split('-')[0]!;
        if (['graveyard', 'ruins', 'hospital', 'police'].includes(kind)) {
          expect(intersects(place)).toBe(false);
        } else {
          expect(contained(place)).toBe(true);
        }
      }
    }
  });

  it('镇界围栏+出口: 围栏沿核心边线留豁口,豁口可行走,主街 BFS 穿豁口可达镇外(M-S/S1.5)', () => {
    for (const result of results) {
      const core = result.map.townCore;
      expect(core).toBeDefined();
      if (core === undefined) continue;
      const tileMap = TileMap.fromDefinition(result.map);
      const fences = result.map.fences ?? [];
      const fenced = (x: number, y: number): boolean =>
        fences.some((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
      const border: Array<[number, number]> = [
        ...Array.from({ length: core.w }, (_, i) => [core.x + i, core.y] as [number, number]),
        ...Array.from({ length: core.w }, (_, i) => [core.x + i, core.y + core.h - 1] as [number, number]),
        ...Array.from({ length: core.h - 2 }, (_, i) => [core.x, core.y + 1 + i] as [number, number]),
        ...Array.from({ length: core.h - 2 }, (_, i) => [core.x + core.w - 1, core.y + 1 + i] as [number, number]),
      ];
      const gaps = border.filter(([x, y]) => !fenced(x, y));
      expect(gaps.length).toBeGreaterThanOrEqual(1);
      for (const [x, y] of gaps) expect(tileMap.isWalkable(x, y)).toBe(true);
      // 出口全链: 自图中心环形扩散找最近可行走格作起点,穿豁口抵达核心外格
      const cx = Math.floor(result.map.width / 2);
      const cy = Math.floor(result.map.height / 2);
      let start: { x: number; y: number } | null = null;
      for (let r = 0; r < 20 && start === null; r += 1) {
        for (let dy = -r; dy <= r && start === null; dy += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (tileMap.isWalkable(cx + dx, cy + dy)) {
              start = { x: cx + dx, y: cy + dy };
              break;
            }
          }
        }
      }
      expect(start).not.toBeNull();
      if (start === null) continue;
      const seen = new Set<string>([`${start.x},${start.y}`]);
      const queue = [start];
      let outside = false;
      while (queue.length > 0 && !outside) {
        const cur = queue.shift()!;
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          const key = `${nx},${ny}`;
          if (seen.has(key) || !tileMap.isWalkable(nx, ny)) continue;
          seen.add(key);
          if (nx < core.x || nx >= core.x + core.w || ny < core.y || ny >= core.y + core.h) {
            outside = true;
            break;
          }
          queue.push({ x: nx, y: ny });
        }
      }
      expect(outside).toBe(true);
    }
  });

  it('wreck 废土装饰: solid 条目全落镇外且避让路/场所,占地即 blockedRect;growth 同池零 solid(M-S/S1.5 C3)', () => {
    const wreckInput = {
      assetsByKind: { [DECOR_POOLS.wreck]: ['car-wreck-a', 'pole-a', 'barrier-a'] },
      assetSizes: { 'car-wreck-a': [4, 2], 'pole-a': [1, 4], 'barrier-a': [2, 1] } as const,
    };
    const wrecked = Array.from({ length: 20 }, (_, i) =>
      generateTownMap(input(`surv-${i}`, { gameType: 'survival', ...wreckInput })),
    );
    for (const result of wrecked) {
      const core = result.map.townCore;
      expect(core).toBeDefined();
      if (core === undefined) continue;
      const solid = (result.map.decor?.props ?? []).filter((p) => p.solid === true);
      expect(solid.length).toBeGreaterThanOrEqual(1);
      const onRect = (x: number, y: number, rs: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): boolean =>
        rs.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      for (const entry of solid) {
        const rect = solidDecorRect(entry);
        for (let y = rect.y; y < rect.y + rect.h; y += 1) {
          for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            expect(x < core.x || x >= core.x + core.w || y < core.y || y >= core.y + core.h).toBe(true);
            expect(onRect(x, y, result.map.paths)).toBe(false);
            expect(onRect(x, y, result.map.places)).toBe(false);
          }
        }
      }
    }
    const growth = generateTownMap(input('surv-0', wreckInput));
    expect((growth.map.decor?.props ?? []).some((p) => p.solid === true)).toBe(false);
  });

  it('growth/survival 隔离: growth 并集无墓地废墟,同 seed 两模式地图不同', () => {
    for (let i = 0; i < 20; i += 1) {
      const growth = generateTownMap(input(`iso-${i}`));
      const kinds = new Set(growth.map.places.map((p) => p.id.split('-')[0]));
      expect(kinds.has('graveyard')).toBe(false);
      expect(kinds.has('ruins')).toBe(false);
      expect(
        (growth.map.resources ?? []).some(
          (r) => r.kind === 'tree' || r.kind === 'rock' || r.kind === 'metal_pile',
        ),
      ).toBe(false);
      const survival = generateTownMap(input(`iso-${i}`, { gameType: 'survival' }));
      expect((survival.map.resources ?? []).some((r) => r.kind === 'tree')).toBe(true);
      expect(survival.map).not.toEqual(growth.map);
    }
  });
});
