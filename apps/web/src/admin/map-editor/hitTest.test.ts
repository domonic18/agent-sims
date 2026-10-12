/**
 * 命中检测回归:屋内家具优先于所属场所(物品级点选),层级链
 * 资源/装饰/围栏/铺装/障碍/家具/场所逐一钉死。
 */
import { describe, expect, it } from 'vitest';
import type { TileMapDefinition } from '@sims/shared';
import { hitTest } from './hitTest';
import { selectionPath } from './editorStore';

const doc = (): TileMapDefinition => ({
  width: 24,
  height: 18,
  blockedRects: [],
  paths: [{ x: 4, y: 8, w: 6, h: 1 }],
  places: [
    {
      id: 'home-1',
      name: '家',
      x: 2,
      y: 2,
      w: 5,
      h: 4,
      entrance: { x: 4, y: 6 },
      furniture: [
        { kind: 'bed', x: 3, y: 3, w: 1, h: 2, activityId: 'rest', use: { x: 4, y: 3 } },
        { kind: 'table', x: 5, y: 4, w: 1, h: 1 },
      ],
    },
  ],
  resources: [{ kind: 'berry_bush', x: 10, y: 10 }],
  decor: { trees: [[12, 12]], lamps: [], flowers: [], bushes: [] },
});

describe('hitTest', () => {
  it('屋内点家具 → furniture 选择(倒序在上层优先)', () => {
    expect(hitTest(doc(), 3, 3)).toEqual({ kind: 'furniture', placeId: 'home-1', index: 0 });
    expect(hitTest(doc(), 5, 4)).toEqual({ kind: 'furniture', placeId: 'home-1', index: 1 });
  });

  it('屋内非家具格 → place 选择;屋外空地 → null', () => {
    expect(hitTest(doc(), 2, 2)).toEqual({ kind: 'place', id: 'home-1' });
    expect(hitTest(doc(), 0, 0)).toBeNull();
  });

  it('点状与矩形层级:资源/装饰/铺装先于场所命中', () => {
    expect(hitTest(doc(), 10, 10)).toEqual({ kind: 'resource', index: 0 });
    expect(hitTest(doc(), 12, 12)).toEqual({ kind: 'decor', group: 'trees', index: 0 });
    expect(hitTest(doc(), 4, 8)).toEqual({ kind: 'path', index: 0 });
  });

  it('furniture 选择 → doc 路径为 places/[i]/furniture/[j]', () => {
    const d = doc();
    const path = selectionPath(d, { kind: 'furniture', placeId: 'home-1', index: 1 });
    expect(path).toEqual(['places', 0, 'furniture', 1]);
    // 场所被删 → 路径失效
    d.places = [];
    expect(selectionPath(d, { kind: 'furniture', placeId: 'home-1', index: 1 })).toBeNull();
  });
});
