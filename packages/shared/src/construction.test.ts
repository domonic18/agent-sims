import { describe, expect, it } from 'vitest';
import {
  constructionBlueprints,
  definitionWithBuilt,
  entrancesConnected,
  evaluateBuildPlacement,
  getBuildBlueprint,
  requiredConstructionEnergy,
  stampBuiltPlace,
  type BuiltState,
} from './construction.js';
import { getActivityDefinition } from './activities.js';
import { LOW_ENERGY_THRESHOLD } from './constants.js';
import { blockedRectsOf, validateMapDefinition } from './map-validate.js';
import { TOWN_MAP, type BlockedRect, type TileMapDefinition } from './town-map.js';

const emptyBuilt: BuiltState = { places: [], fences: [], nextPlaceSeq: 1 };

/** 拒绝矩阵用合成底图:两屋对置+横段道路+单格资源,全部布局手工核算 */
const matrixBase: TileMapDefinition = {
  width: 30,
  height: 20,
  blockedRects: [],
  paths: [{ x: 20, y: 10, w: 4, h: 1 }],
  places: [
    { id: 'left', name: '左屋', x: 2, y: 2, w: 4, h: 4, entrance: { x: 4, y: 6 }, door: { x: 4, y: 5 } },
    { id: 'right', name: '右屋', x: 14, y: 2, w: 4, h: 4, entrance: { x: 16, y: 6 }, door: { x: 16, y: 5 } },
  ],
  resources: [{ kind: 'berry_bush', x: 24, y: 14 }],
};

/** 在底图上扫描第一块 w×h 空地(距边≥1,不压障碍/道路/资源);TOWN_MAP 布局无关断言用 */
function findFreeRect(base: TileMapDefinition, w: number, h: number): { x: number; y: number } {
  const rects = blockedRectsOf(base);
  const hits = (x: number, y: number, rect: BlockedRect): boolean =>
    x < rect.x + rect.w && rect.x < x + w && y < rect.y + rect.h && rect.y < y + h;
  for (let y = 1; y + h <= base.height - 1; y += 1) {
    for (let x = 1; x + w <= base.width - 1; x += 1) {
      if (rects.some((r) => hits(x, y, r))) continue;
      if ((base.paths ?? []).some((p) => hits(x, y, p))) continue;
      return { x, y };
    }
  }
  throw new Error('底图无空地');
}

describe('蓝图注册表', () => {
  it('v1 子集四条全 survival 门控,growth 拿不到', () => {
    expect(constructionBlueprints('growth')).toEqual([]);
    const survival = constructionBlueprints('survival');
    expect(survival.map((b) => b.id)).toEqual([
      'build_home',
      'build_cafe',
      'build_shop',
      'build_fence',
    ]);
    for (const b of survival) {
      expect(b.gameTypes).toEqual(['survival']);
      expect(b.level).toBe(1);
    }
  });

  it('getBuildBlueprint 命中与未命中', () => {
    expect(getBuildBlueprint('build_cafe')?.kind).toBe('place');
    expect(getBuildBlueprint('build_tower')).toBeNull();
  });

  it('接单体力线(R4): 时长×施工能耗率+低体力阈值,want 预检与 requestBuild 同公式', () => {
    const rate = Math.abs(getActivityDefinition('construction')?.effects.energy ?? 0);
    expect(rate).toBe(0.05); // S2-B R5 定档:总耗 24 在「采集日+待机」健康区间内
    const home = getBuildBlueprint('build_home')!;
    expect(requiredConstructionEnergy(home)).toBe(home.durationMinutes * rate + LOW_ENERGY_THRESHOLD);
    expect(requiredConstructionEnergy(home)).toBe(44);
    const fence = getBuildBlueprint('build_fence')!;
    expect(requiredConstructionEnergy(fence)).toBe(LOW_ENERGY_THRESHOLD); // 0 工时=只卡低体力线
  });
});

describe('stampBuiltPlace 盖章', () => {
  it('模板平移+门洞底边中点+入口其下+seq 命名', () => {
    const home = getBuildBlueprint('build_home')!;
    const place = stampBuiltPlace(home, 10, 8, 7);
    expect(place.id).toBe('built-7');
    expect(place.name).toBe('住宅 7');
    expect(place.door).toEqual({ x: 13, y: 12 });
    expect(place.entrance).toEqual({ x: 13, y: 13 });
    const bed = place.furniture![0]!;
    expect(bed).toMatchObject({ kind: 'bed', x: 11, y: 9, w: 2, h: 2, use: { x: 13, y: 9 } });
    const fridge = place.furniture![2]!;
    expect(fridge).toMatchObject({ kind: 'fridge', x: 15, y: 11 });
  });
});

describe('definitionWithBuilt 纯合并', () => {
  it('基础图不动,places/fences 拼接为新数组', () => {
    const base: TileMapDefinition = {
      width: 10,
      height: 10,
      blockedRects: [],
      paths: [],
      places: [matrixBase.places[0]!],
    };
    const built: BuiltState = {
      places: [matrixBase.places[1]!],
      fences: [{ x: 1, y: 1, w: 3, h: 1 }],
      nextPlaceSeq: 2,
    };
    const merged = definitionWithBuilt(base, built);
    expect(base.places).toHaveLength(1);
    expect(base.fences).toBeUndefined();
    expect(merged.places).toHaveLength(2);
    expect(merged.fences).toEqual([{ x: 1, y: 1, w: 3, h: 1 }]);
    expect(merged).not.toBe(base);
  });
});

describe('entrancesConnected 连通 BFS', () => {
  const open: TileMapDefinition = {
    width: 10,
    height: 10,
    blockedRects: [],
    paths: [],
    places: [
      { id: 'a', name: 'A', x: 1, y: 1, w: 3, h: 3, entrance: { x: 2, y: 4 }, door: { x: 2, y: 3 } },
      { id: 'b', name: 'B', x: 6, y: 5, w: 3, h: 3, entrance: { x: 7, y: 8 }, door: { x: 7, y: 7 } },
    ],
  };

  it('无场所 vacuous true', () => {
    expect(entrancesConnected({ ...open, places: [] })).toBe(true);
  });

  it('开阔地图两入口互通', () => {
    expect(entrancesConnected(open)).toBe(true);
  });

  it('全高围栏墙隔断两入口', () => {
    expect(entrancesConnected({ ...open, fences: [{ x: 5, y: 0, w: 1, h: 10 }] })).toBe(false);
  });

  it('入口格被障碍覆盖', () => {
    expect(
      entrancesConnected({ ...open, blockedRects: [{ x: 2, y: 4, w: 1, h: 1 }] }),
    ).toBe(false);
  });
});

describe('evaluateBuildPlacement 选位评估', () => {
  it('合成底图自身合法且两入口连通(矩阵前提自检)', () => {
    expect(validateMapDefinition(matrixBase)).toEqual([]);
    expect(entrancesConnected(matrixBase)).toBe(true);
  });

  it('place 占地尺寸不符拒绝', () => {
    const home = getBuildBlueprint('build_home')!;
    const { issues } = evaluateBuildPlacement(matrixBase, emptyBuilt, home, {
      x: 8,
      y: 12,
      w: 5,
      h: 4,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('placement');
  });

  it('fence 非条形拒绝', () => {
    const fence = getBuildBlueprint('build_fence')!;
    const { issues } = evaluateBuildPlacement(matrixBase, emptyBuilt, fence, {
      x: 8,
      y: 12,
      w: 2,
      h: 2,
    });
    expect(issues[0]!.code).toBe('placement');
  });

  it('距边留白不足拒绝', () => {
    const home = getBuildBlueprint('build_home')!;
    const { issues } = evaluateBuildPlacement(matrixBase, emptyBuilt, home, {
      x: 0,
      y: 1,
      w: 7,
      h: 5,
    });
    expect(issues[0]!.code).toBe('placement');
    expect(issues[0]!.message).toContain('越界');
  });

  it('压既有建筑拒绝且不产出合并产物', () => {
    const home = getBuildBlueprint('build_home')!;
    const built: BuiltState = { ...emptyBuilt, nextPlaceSeq: 3 };
    const { merged, issues } = evaluateBuildPlacement(matrixBase, built, home, {
      x: 1,
      y: 1,
      w: 7,
      h: 5,
    });
    expect(issues[0]!.code).toBe('placement');
    expect(issues[0]!.message).toContain('重叠');
    expect(merged.places).toHaveLength(2);
    expect(built.nextPlaceSeq).toBe(3);
  });

  it('压道路拒绝', () => {
    const home = getBuildBlueprint('build_home')!;
    const { issues } = evaluateBuildPlacement(matrixBase, emptyBuilt, home, {
      x: 18,
      y: 8,
      w: 7,
      h: 5,
    });
    expect(issues[0]!.message).toContain('道路');
  });

  it('压资源拒绝', () => {
    const home = getBuildBlueprint('build_home')!;
    const { issues } = evaluateBuildPlacement(matrixBase, emptyBuilt, home, {
      x: 22,
      y: 12,
      w: 7,
      h: 5,
    });
    expect(issues[0]!.message).toContain('重叠');
  });

  it('围栏盖门洞报结构问题', () => {
    const fence = getBuildBlueprint('build_fence')!;
    const { issues } = evaluateBuildPlacement(matrixBase, emptyBuilt, fence, {
      x: 16,
      y: 5,
      w: 1,
      h: 1,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('structure');
  });

  it('全高围栏隔断对侧入口报连通问题', () => {
    const fence = getBuildBlueprint('build_fence')!;
    const { issues } = evaluateBuildPlacement(matrixBase, emptyBuilt, fence, {
      x: 10,
      y: 1,
      w: 1,
      h: 18,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('connectivity');
  });

  it('合法 placement 产出合并图,built 入参不被改动', () => {
    const home = getBuildBlueprint('build_home')!;
    const built: BuiltState = { ...emptyBuilt, nextPlaceSeq: 1 };
    const { merged, issues } = evaluateBuildPlacement(matrixBase, built, home, {
      x: 8,
      y: 12,
      w: 7,
      h: 5,
    });
    expect(issues).toEqual([]);
    expect(validateMapDefinition(merged)).toEqual([]);
    expect(entrancesConnected(merged)).toBe(true);
    expect(merged.places).toHaveLength(3);
    const stamped = merged.places.find((p) => p.id === 'built-1')!;
    expect(stamped.entrance).toEqual({ x: 11, y: 17 });
    expect(built.places).toHaveLength(0);
    expect(built.nextPlaceSeq).toBe(1);
  });
});

describe('TOWN_MAP 实图集成', () => {
  it('v1 三建筑模板在实图空地盖章通过全部校验', () => {
    for (const id of ['build_home', 'build_cafe', 'build_shop'] as const) {
      const blueprint = getBuildBlueprint(id)!;
      const size = blueprint.size!;
      const rect = findFreeRect(TOWN_MAP, size.w, size.h);
      const { merged, issues } = evaluateBuildPlacement(TOWN_MAP, emptyBuilt, blueprint, {
        ...rect,
        ...size,
      });
      expect(issues).toEqual([]);
      expect(validateMapDefinition(merged)).toEqual([]);
      expect(entrancesConnected(merged)).toBe(true);
    }
  });

  it('围栏条在实图空地可落', () => {
    const fence = getBuildBlueprint('build_fence')!;
    const rect = findFreeRect(TOWN_MAP, 1, 3);
    const { issues, merged } = evaluateBuildPlacement(TOWN_MAP, emptyBuilt, fence, {
      ...rect,
      w: 1,
      h: 3,
    });
    expect(issues).toEqual([]);
    expect(merged.fences).toHaveLength((TOWN_MAP.fences?.length ?? 0) + 1);
  });
});
