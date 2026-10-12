import { describe, expect, it } from 'vitest';
import type { TileMapDefinition } from '@sims/shared';
import { describeDocNote } from './vision.js';

function doc(): TileMapDefinition {
  return {
    width: 64,
    height: 48,
    blockedRects: [],
    paths: [],
    places: [
      { id: 'shop-1', name: '商店', x: 10, y: 10, w: 4, h: 3, entrance: { x: 12, y: 13 } },
      { id: 'home-1', name: '家', x: 2, y: 2, w: 3, h: 2, entrance: { x: 3, y: 4 } },
    ],
    resources: [{ kind: 'berry_bush', x: 20, y: 20 }],
  } as unknown as TileMapDefinition;
}

describe('describeDocNote', () => {
  it('概况带尺寸/数量与场所清单(含占地)', () => {
    const note = describeDocNote(doc());
    expect(note).toContain('64x48');
    expect(note).toContain('场所 2 个');
    expect(note).toContain('资源节点 1 个');
    expect(note).toContain('商店(4x3)');
    expect(note).toContain('家(3x2)');
  });

  it('空场所图不产生空清单行尾', () => {
    const empty = { ...doc(), places: [], resources: [] } as unknown as TileMapDefinition;
    expect(describeDocNote(empty)).toContain('场所 0 个');
  });
});
