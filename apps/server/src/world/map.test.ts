import { describe, expect, it } from 'vitest';
import { TOWN_MAP, type TileMapDefinition } from '@sims/shared';
import { TileMap } from './map.js';
import { Simulation } from './simulation.js';

const miniMap: TileMapDefinition = {
  width: 8,
  height: 6,
  blockedRects: [{ x: 3, y: 1, w: 3, h: 2 }],
  places: [{ id: 'hut', name: '小屋', x: 3, y: 1, w: 3, h: 2, entrance: { x: 4, y: 3 } }],
};

describe('TileMap 可行走层', () => {
  it('默认地面可行走,障碍占地不可行走', () => {
    const map = TileMap.fromDefinition(miniMap);
    expect(map.isWalkable(1, 4)).toBe(true);
    expect(map.isWalkable(3, 1)).toBe(false); // 障碍内
    expect(map.isWalkable(5, 2)).toBe(false);
    expect(map.isWalkable(4, 3)).toBe(true); // 入口格在占地外
  });

  it('边界一圈不可行走(越界视同不可行走)', () => {
    const map = TileMap.fromDefinition(miniMap);
    expect(map.isWalkable(-1, 0)).toBe(false);
    expect(map.isWalkable(0, 0)).toBe(false); // 边界墙
    expect(map.isWalkable(1, 1)).toBe(true); // 内圈可走
    expect(map.isWalkable(6, 4)).toBe(true);
    expect(map.isWalkable(7, 4)).toBe(false); // 右墙
    expect(map.isWalkable(8, 4)).toBe(false); // 越界
    expect(map.isWalkable(4, 4)).toBe(true);
    expect(map.isWalkable(4, 5)).toBe(false); // 下墙
    expect(map.isWalkable(4, 6)).toBe(false); // 越界
  });

  it('placeAt 命中场所占地,含可行走场所(公园)', () => {
    const map = TileMap.fromDefinition(TOWN_MAP);
    expect(map.placeAt(3, 3)?.id).toBe('home');
    expect(map.placeAt(14, 18)?.id).toBe('park');
    expect(map.placeAt(15, 8)).toBeNull(); // 入口格不算场所内
    expect(map.placeAt(31, 23)).toBeNull();
  });

  it('placeById 返回场所定义', () => {
    const map = TileMap.fromDefinition(TOWN_MAP);
    expect(map.placeById('office')?.name).toBe('办公楼');
    expect(map.placeById('nope')).toBeNull();
  });

  it('入口非法(在占地内/在障碍上)构造即抛错', () => {
    expect(
      () =>
        TileMap.fromDefinition({
          ...miniMap,
          places: [{ id: 'bad', name: '坏入口', x: 3, y: 1, w: 3, h: 2, entrance: { x: 4, y: 2 } }],
        }),
    ).toThrow(/入口非法/);
    expect(
      () =>
        TileMap.fromDefinition({
          ...miniMap,
          places: [{ id: 'bad2', name: '越界入口', x: 3, y: 1, w: 3, h: 2, entrance: { x: 0, y: 0 } }],
        }),
    ).toThrow(/入口非法/); // (0,0) 是边界墙
  });

  it('toAscii 标注障碍与入口', () => {
    const map = TileMap.fromDefinition(miniMap);
    const rows = map.toAscii().split('\n');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe('########'); // 上边界
    expect(rows[1]?.charAt(3)).toBe('#');
    expect(rows[3]?.charAt(4)).toBe('E');
  });

  it('Simulation 持有城镇地图且 7 场所入口全部合法', () => {
    const sim = new Simulation();
    expect(sim.map.width).toBe(32);
    expect(sim.map.height).toBe(24);
    expect(sim.map.places).toHaveLength(7); // 构造已验证全部入口
  });
});
