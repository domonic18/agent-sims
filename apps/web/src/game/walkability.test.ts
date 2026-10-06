import { TOWN_MAP } from '@sims/shared';
import { describe, expect, it } from 'vitest';
import { createIsWalkable } from './walkability';

/** web 首个单测(M3.6h):可行走判定与 server TileMap 同规则的回归锚点 */
describe('可行走判定', () => {
  const isWalkable = createIsWalkable(TOWN_MAP);

  it('边界墙与越界不可行走', () => {
    expect(isWalkable(0, 0)).toBe(false);
    expect(isWalkable(TOWN_MAP.width - 1, 5)).toBe(false);
    expect(isWalkable(5, TOWN_MAP.height - 1)).toBe(false);
    expect(isWalkable(-1, 5)).toBe(false);
    expect(isWalkable(TOWN_MAP.width, 5)).toBe(false);
  });

  it('障碍占地(池塘/喷泉)不可行走', () => {
    expect(isWalkable(5, 31)).toBe(false); // 公园池塘
    expect(isWalkable(31, 19)).toBe(false); // 广场喷泉
  });

  it('公园北缘围栏段阻塞,入口列豁口通行(M-G.5 数据化)', () => {
    expect(isWalkable(4, 26)).toBe(false);
    expect(isWalkable(12, 26)).toBe(false);
    expect(isWalkable(9, 26)).toBe(true);
  });

  it('全部场所入口可行走(寻路可达的前提)', () => {
    for (const place of TOWN_MAP.places) {
      expect(isWalkable(place.entrance.x, place.entrance.y), place.id).toBe(true);
    }
  });
});
