import { describe, expect, it } from 'vitest';
import { TileMap, type TileMapDefinition } from './map.js';
import { findPath } from './pathfinding.js';

const miniMap: TileMapDefinition = {
  width: 9,
  height: 7,
  blockedRects: [],
  places: [],
};
const withWall: TileMapDefinition = {
  width: 9,
  height: 7,
  // 竖墙 x=4,y=0..4,留 y=5..6 通道
  blockedRects: [{ x: 4, y: 0, w: 1, h: 5 }],
  places: [],
};

describe('A* 寻路', () => {
  it('直线可达:路径不含起点含终点,逐格相邻', () => {
    const map = TileMap.fromDefinition(miniMap);
    const path = findPath(map, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual({ x: 2, y: 1 });
    expect(path?.at(-1)).toEqual({ x: 4, y: 1 });
    expect(path).toHaveLength(3);
  });

  it('绕障:竖墙阻隔时绕行通道,仍是最短', () => {
    const map = TileMap.fromDefinition(withWall);
    const path = findPath(map, { x: 2, y: 2 }, { x: 6, y: 2 });
    expect(path).not.toBeNull();
    // 曼哈顿 4,绕行至少 +4(下到 y=5 再上回)
    expect(path!.length).toBeGreaterThanOrEqual(8);
    expect(path?.at(-1)).toEqual({ x: 6, y: 2 });
    // 全程可行走且逐格相邻
    for (let i = 0; i < path!.length; i += 1) {
      const step = path![i]!;
      expect(map.isWalkable(step.x, step.y)).toBe(true);
      if (i > 0) {
        const prev = path![i - 1]!;
        expect(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y)).toBe(1);
      }
    }
  });

  it('不可达返回 null(目标在障碍内/被完全包围)', () => {
    const map = TileMap.fromDefinition(withWall);
    expect(findPath(map, { x: 2, y: 2 }, { x: 4, y: 2 })).toBeNull(); // 目标在墙内
    // 目标 (4,3) 可走但四邻全被墙封死
    const sealed: TileMapDefinition = {
      width: 7,
      height: 7,
      blockedRects: [
        { x: 3, y: 2, w: 3, h: 1 },
        { x: 3, y: 4, w: 3, h: 1 },
        { x: 3, y: 3, w: 1, h: 1 },
        { x: 5, y: 3, w: 1, h: 1 },
      ],
      places: [],
    };
    const sealedMap = TileMap.fromDefinition(sealed);
    expect(sealedMap.isWalkable(4, 3)).toBe(true);
    expect(findPath(sealedMap, { x: 1, y: 1 }, { x: 4, y: 3 })).toBeNull();
  });

  it('同格返回空路径(原地)', () => {
    const map = TileMap.fromDefinition(miniMap);
    expect(findPath(map, { x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });

  it('城镇地图:home 入口到 park 入口可达且路径合理', () => {
    const map = TileMap.fromDefinition({
      width: 32,
      height: 24,
      blockedRects: [
        { x: 2, y: 2, w: 6, h: 5 },
        { x: 13, y: 11, w: 6, h: 4 },
      ],
      places: [
        { id: 'home', name: '公寓', x: 2, y: 2, w: 6, h: 5, entrance: { x: 5, y: 7 } },
        { id: 'park', name: '公园', x: 8, y: 17, w: 14, h: 5, entrance: { x: 14, y: 16 } },
      ],
    });
    const path = findPath(map, { x: 5, y: 7 }, { x: 14, y: 16 });
    expect(path).not.toBeNull();
    expect(path?.at(-1)).toEqual({ x: 14, y: 16 });
    // 曼哈顿下界 18,路径不劣于下界太多
    expect(path!.length).toBeLessThanOrEqual(30);
  });
});
