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

  it('场所配额齐备(公寓≥3/七类场所俱全)', () => {
    for (const result of results) {
      const kinds = new Set(result.map.places.map((p) => p.id.split('-')[0]));
      for (const kind of ['home', 'park', 'library', 'office', 'shop', 'restaurant', 'gym']) {
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
      ['bed', 'desk', 'workstation', 'treadmill', 'table', 'bookshelf', 'shelf', 'counter', 'sofa', 'plant', 'fridge', 'tv', 'wardrobe', 'bench'].map(
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
});
