/**
 * 归一化回归:缺 decor/可选数组的地図进编辑器不再让 setAtPath/hitTest 崩
 * (问题3/4 根因);内置图烘焙装饰物化后可见可选可删。
 */
import { describe, expect, it } from 'vitest';
import type { TileMapDefinition } from '@sims/shared';
import { builtinDefaultDecor, normalizeDefinition } from './normalize';

const baseDoc = (): TileMapDefinition => ({
  width: 24,
  height: 18,
  blockedRects: [],
  paths: [],
  places: [],
});

describe('normalizeDefinition', () => {
  it('decor 缺省 → 内置兜底装饰物化为文档对象,四组齐全且为真实数组', () => {
    const doc = normalizeDefinition(baseDoc());
    expect(doc.decor).toBeDefined();
    expect(Array.isArray(doc.decor!.trees)).toBe(true);
    expect(Array.isArray(doc.decor!.lamps)).toBe(true);
    expect(Array.isArray(doc.decor!.flowers)).toBe(true);
    expect(Array.isArray(doc.decor!.bushes)).toBe(true);
    // 内置图有兜底灯/树/花可被选中编辑
    expect(doc.decor!.lamps.length).toBeGreaterThan(0);
    expect(doc.decor!.trees.length).toBeGreaterThan(0);
    expect(doc.decor!.flowers.length).toBeGreaterThan(0);
  });

  it('可选数组缺省 → 补齐空数组(patches/fences/resources)', () => {
    const doc = normalizeDefinition(baseDoc());
    expect(doc.patches).toEqual([]);
    expect(doc.fences).toEqual([]);
    expect(doc.resources).toEqual([]);
  });

  it('半残 decor(仅 flowers)→ 其余组补空数组,原组保序保留', () => {
    const doc = normalizeDefinition({
      ...baseDoc(),
      decor: { trees: [], lamps: [], flowers: [[3, 4]], bushes: [] },
    });
    expect(doc.decor!.flowers).toEqual([[3, 4]]);
    expect(doc.decor!.lamps).toEqual([]);
  });

  it('decor 附加字段(props/flats/pond)原样保留', () => {
    const pond = { x: 1, y: 1, w: 2, h: 2 };
    const doc = normalizeDefinition({
      ...baseDoc(),
      decor: {
        trees: [],
        lamps: [],
        flowers: [],
        bushes: [],
        pond,
        props: [{ x: 2, y: 2, slug: 'bench' }],
        flats: [{ x: 3, y: 3, slug: 'flower-a' }],
      },
    });
    expect(doc.decor!.pond).toEqual(pond);
    expect(doc.decor!.props).toEqual([{ x: 2, y: 2, slug: 'bench' }]);
    expect(doc.decor!.flats).toEqual([{ x: 3, y: 3, slug: 'flower-a' }]);
  });

  it('不改动入参(归一化返回新对象)', () => {
    const src = baseDoc();
    const doc = normalizeDefinition(src);
    expect(src.decor).toBeUndefined();
    expect(doc).not.toBe(src);
  });

  it('builtinDefaultDecor 与渲染兜底同源(灯/树/花非空)', () => {
    const decor = builtinDefaultDecor();
    expect(decor.lamps.length).toBeGreaterThan(0);
    expect(decor.trees.length).toBeGreaterThan(0);
    expect(decor.flowers.length).toBeGreaterThan(0);
  });
});
