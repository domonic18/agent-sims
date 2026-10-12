import { describe, expect, it } from 'vitest';
import { furnitureSlug, pondFrameSlug } from './mapRenderReal';

const POND = { x: 4, y: 30, w: 4, h: 4 };

describe('pondFrameSlug', () => {
  it('四角取斜向水岸,四边取正向,中心取水面', () => {
    expect(pondFrameSlug(4, 30, POND)).toBe('tile-shoreNW');
    expect(pondFrameSlug(7, 30, POND)).toBe('tile-shoreNE');
    expect(pondFrameSlug(4, 33, POND)).toBe('tile-shoreSW');
    expect(pondFrameSlug(7, 33, POND)).toBe('tile-shoreSE');
    expect(pondFrameSlug(5, 30, POND)).toBe('tile-shoreN');
    expect(pondFrameSlug(5, 33, POND)).toBe('tile-shoreS');
    expect(pondFrameSlug(4, 31, POND)).toBe('tile-shoreW');
    expect(pondFrameSlug(7, 31, POND)).toBe('tile-shoreE');
    expect(pondFrameSlug(5, 31, POND)).toBe('tile-water');
  });
});

describe('furnitureSlug', () => {
  it('显式 sprite 优先;宽 shelf 用矮凳;其余回退 kind 同名', () => {
    expect(furnitureSlug({ kind: 'bed', x: 1, y: 1, w: 1, h: 1, sprite: 'custom-bed' })).toBe('custom-bed');
    expect(furnitureSlug({ kind: 'shelf', x: 1, y: 1, w: 2, h: 1 })).toBe('bench');
    expect(furnitureSlug({ kind: 'shelf', x: 1, y: 1, w: 1, h: 3 })).toBe('shelf');
    expect(furnitureSlug({ kind: 'fridge', x: 1, y: 1, w: 1, h: 1 })).toBe('fridge');
  });
});
