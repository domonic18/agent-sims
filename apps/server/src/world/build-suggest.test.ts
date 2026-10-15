import { getBuildBlueprint, type TileMapDefinition } from '@sims/shared';
import { describe, expect, it } from 'vitest';
import { standTileNearRect, suggestBuildRect } from './build-suggest.js';

/** 带镇核心的合成底图:核心区居中,四周留大片空地 */
function base(townCore: { x: number; y: number; w: number; h: number }): TileMapDefinition {
  return {
    width: 40,
    height: 30,
    blockedRects: [],
    paths: [],
    places: [],
    resources: [],
    townCore,
  };
}

const EMPTY_BUILT = { places: [], fences: [], nextPlaceSeq: 1 };
const HOME = getBuildBlueprint('build_home')!;

describe('suggestBuildRect(agent 建造选址,S2-A)', () => {
  it('空地图:镇核心外扩第 1 环即命中首个合法选区,尺寸=蓝图 size', () => {
    const core = { x: 18, y: 12, w: 4, h: 4 };
    const rect = suggestBuildRect(base(core), EMPTY_BUILT, HOME);
    expect(rect).not.toBeNull();
    expect(rect!.w).toBe(7);
    expect(rect!.h).toBe(5);
    // 首环顶行按行按列:首个不越界的候选(y=core.y-1=11,x 从 core.x-1=17 起,
    // 7 宽须 x+7≤39 且 x≥1——x=17 即合法),距边留白满足
    expect(rect!.x).toBe(17);
    expect(rect!.y).toBe(11);
  });

  it('确定性:同 (base, built, blueprint) 恒同结果', () => {
    const core = { x: 18, y: 12, w: 4, h: 4 };
    const map = base(core);
    const first = suggestBuildRect(map, EMPTY_BUILT, HOME);
    const second = suggestBuildRect(map, EMPTY_BUILT, HOME);
    expect(first).toEqual(second);
  });

  it('已有建筑占位:跳过重叠候选,顺延下一合法位', () => {
    const core = { x: 18, y: 12, w: 4, h: 4 };
    const map = base(core);
    const first = suggestBuildRect(map, EMPTY_BUILT, HOME)!;
    const built = {
      places: [
        {
          id: 'built-1',
          name: '先建的住宅',
          x: first.x,
          y: first.y,
          w: first.w,
          h: first.h,
          entrance: { x: first.x + 3, y: first.y + 5 },
          door: { x: first.x + 3, y: first.y + 4 },
          furniture: [],
        },
      ],
      fences: [],
      nextPlaceSeq: 2,
    };
    const second = suggestBuildRect(map, built, HOME)!;
    expect(second).not.toBeNull();
    expect(second).not.toEqual(first); // 不与既有建筑重叠
  });

  it('无镇核心(growth/内置图)返回 null;非 place 蓝图返回 null', () => {
    const noCore: TileMapDefinition = {
      width: 40,
      height: 30,
      blockedRects: [],
      paths: [],
      places: [],
      resources: [],
    };
    expect(suggestBuildRect(noCore, EMPTY_BUILT, HOME)).toBeNull();
    const fence = getBuildBlueprint('build_fence')!;
    expect(suggestBuildRect(base({ x: 18, y: 12, w: 4, h: 4 }), EMPTY_BUILT, fence)).toBeNull();
  });

  it('环带扫满无合法位返回 null(小图挤满建筑)', () => {
    // 14×12 小图,镇核心几乎占满,7×5 蓝图外扩 6 环必越界
    const tiny: TileMapDefinition = {
      width: 14,
      height: 12,
      blockedRects: [],
      paths: [],
      places: [],
      resources: [],
      townCore: { x: 1, y: 1, w: 12, h: 10 },
    };
    expect(suggestBuildRect(tiny, EMPTY_BUILT, HOME)).toBeNull();
  });
});

describe('standTileNearRect(选区站位搜索,S2-A)', () => {
  const RECT = { x: 20, y: 20, w: 7, h: 5 };
  const ALL_STAND = (): boolean => true;

  it('外圈取离 from 最近的可站立格,四角格排除', () => {
    // from (30,30) 在选区东南:角格 (27,25) 距选区 dx+dy=2 不可作站位(施工贴身
    // 口径 dx+dy≤1),次近右边缘 (27,24) 与底边 (26,25) 同距 9,按扫描序取前者
    expect(standTileNearRect(RECT, { x: 30, y: 30 }, ALL_STAND)).toEqual({ x: 27, y: 24 });
    // from (10,10) 在西北:角格 (19,19) 排除,顶边 (20,19) 先于左边 (19,20)(同距 19)
    expect(standTileNearRect(RECT, { x: 10, y: 10 }, ALL_STAND)).toEqual({ x: 20, y: 19 });
  });

  it('跳过不可站立格(围栏/墙体),环上取次近可走点', () => {
    // 封死最近点 (27,24) 后,(30,30) 的次近是底边 (26,25)(角格本就不在候选内)
    const blocked = (x: number, y: number): boolean => !(x === 27 && y === 24);
    expect(standTileNearRect(RECT, { x: 30, y: 30 }, blocked)).toEqual({ x: 26, y: 25 });
  });

  it('全环不可站立返回 null(调用方本轮跳过)', () => {
    expect(standTileNearRect(RECT, { x: 30, y: 30 }, (): boolean => false)).toBeNull();
  });
});
