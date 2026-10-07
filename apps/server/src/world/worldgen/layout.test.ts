import { describe, expect, it } from 'vitest';
import type { FurnitureSlot } from './blueprint.js';
import { Rng } from './prng.js';
import {
  alignedScan,
  attemptCoreSlots,
  directionalPool,
  layoutFurniture,
  type SlotWithPool,
} from './generate.js';

const slot = (s: FurnitureSlot, pool: readonly string[] = []): SlotWithPool => ({ ...s, pool });

/** 12×8 内景:室内圈 x1..10 / y1..6,门内格 (6,6) */
const LAYOUT = { px: 0, py: 0, pw: 12, ph: 8 };

describe('alignedScan 沿墙候选序列(06 §3③ align)', () => {
  it('start/缺省=主序,end=逆序,center=自中点向外交替(左先)', () => {
    expect(alignedScan(1, 10, 2, undefined)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(alignedScan(1, 10, 2, 'start')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(alignedScan(1, 6, 1, 'end')).toEqual([6, 5, 4, 3, 2, 1]);
    expect(alignedScan(1, 10, 2, 'center')).toEqual([5, 4, 6, 3, 7, 2, 8, 1, 9]);
  });

  it('放不下(size>墙长)返回空', () => {
    expect(alignedScan(1, 4, 6, 'start')).toEqual([]);
  });
});

describe('facing 朝向派生 + align 落位(layoutFurniture)', () => {
  it('锚点→面朝房间(north→south/south→north/west→east/east→west),center 无朝向', () => {
    const furniture = layoutFurniture(
      new Rng('layout-facing'),
      LAYOUT.px,
      LAYOUT.py,
      LAYOUT.pw,
      LAYOUT.ph,
      [
        slot({ kind: 'bed', w: 2, h: 3, anchor: 'north', align: 'start' }),
        slot({ kind: 'tv', w: 2, h: 1, anchor: 'north', align: 'center' }),
        slot({ kind: 'sofa', w: 2, h: 1, anchor: 'south', align: 'center' }),
        slot({ kind: 'desk', w: 2, h: 1, anchor: 'west' }),
        slot({ kind: 'bookshelf', w: 2, h: 1, anchor: 'east', align: 'end' }),
        slot({ kind: 'table', w: 2, h: 1, anchor: 'center' }),
      ],
      false,
      null,
    );
    const byKind = (kind: string): NonNullable<(typeof furniture)[number]> =>
      furniture.filter((f) => f.kind === kind)[0]!;
    // 北墙: 床贴西角(start),电视居中(center,10 宽室内中点 5..6)
    expect(byKind('bed')).toMatchObject({ x: 1, y: 1, facing: 'south' });
    expect(byKind('tv')).toMatchObject({ x: 5, y: 1, facing: 'south' });
    // 南墙沙发 center: 门内格 (6,6) 被 guard 拒 → 交替探位落到门西侧
    expect(byKind('sofa')).toMatchObject({ x: 4, y: 6, facing: 'north' });
    // 西墙 desk 主序落床下方;东墙 bookshelf end 贴东南角
    expect(byKind('desk')).toMatchObject({ x: 1, y: 4, facing: 'east' });
    expect(byKind('bookshelf')).toMatchObject({ x: 9, y: 6, facing: 'west' });
    // center 行主序: 无朝向
    expect(byKind('table')).toMatchObject({ x: 3, y: 1 });
    expect(byKind('table').facing).toBeUndefined();
  });
});

describe('directionalPool -b 背面件定向选材(05 §4 约定)', () => {
  it('facing north 取 -b 件,其余 facing/无朝向排除 -b 件', () => {
    expect(directionalPool(['sofa', 'sofa-b'], 'north')).toEqual(['sofa-b']);
    expect(directionalPool(['sofa', 'sofa-b'], 'south')).toEqual(['sofa']);
    expect(directionalPool(['sofa', 'sofa-b'], undefined)).toEqual(['sofa']);
  });

  it('过滤后为空回退整池', () => {
    expect(directionalPool(['sofa'], 'north')).toEqual(['sofa']);
    expect(directionalPool(['sofa-b'], 'south')).toEqual(['sofa-b']);
  });

  it('选材落图: 南锚沙发出 sofa-b,北锚电视(无 -b 池)出正面,center 排除 -b', () => {
    const furniture = layoutFurniture(
      new Rng('layout-sprite'),
      LAYOUT.px,
      LAYOUT.py,
      LAYOUT.pw,
      LAYOUT.ph,
      [
        slot({ kind: 'sofa', w: 2, h: 1, anchor: 'south' }, ['sofa', 'sofa-b']),
        slot({ kind: 'tv', w: 2, h: 1, anchor: 'north' }, ['tv']),
        slot({ kind: 'table', w: 2, h: 1, anchor: 'center' }, ['table', 'table-b']),
      ],
      false,
      null,
    );
    const byKind = (kind: string): NonNullable<(typeof furniture)[number]> =>
      furniture.filter((f) => f.kind === kind)[0]!;
    expect(byKind('sofa').sprite).toBe('sofa-b');
    expect(byKind('tv').sprite).toBe('tv');
    expect(byKind('table').sprite).toBe('table');
    // 池空槽仍发家具,sprite 省略回退 kind 同名纹理
    const bare = layoutFurniture(new Rng('layout-bare'), 0, 0, 12, 8, [
      slot({ kind: 'plant', w: 1, h: 1, anchor: 'north' }),
    ], false, null);
    expect(bare[0]).toMatchObject({ kind: 'plant', facing: 'south' });
    expect(bare[0]!.sprite).toBeUndefined();
  });
});

describe('attemptCoreSlots 第三轮过滤(06 §3⑤ 梯度降档中段)', () => {
  it('仅剔 chance<1 装饰槽;chance≥1 必选槽与无 chance 核心槽保留', () => {
    const source: FurnitureSlot[] = [
      { kind: 'bed', w: 2, h: 3, anchor: 'north' },
      { kind: 'bookshelf', w: 2, h: 1, anchor: 'east', chance: 1 },
      { kind: 'tv', w: 2, h: 1, anchor: 'south', chance: 0.6 },
      { kind: 'plant', w: 1, h: 1, anchor: 'center', chance: 0.5 },
    ];
    expect(attemptCoreSlots(source)).toEqual([
      { kind: 'bed', w: 2, h: 3, anchor: 'north' },
      { kind: 'bookshelf', w: 2, h: 1, anchor: 'east', chance: 1 },
    ]);
  });
});
