import { describe, expect, it } from 'vitest';
import { TOWN_MAP, type TileMapDefinition } from '@sims/shared';
import { TileMap } from './map.js';
import { findPath } from './pathfinding.js';
import { Simulation } from './simulation.js';

const miniMap: TileMapDefinition = {
  width: 8,
  height: 6,
  blockedRects: [{ x: 3, y: 1, w: 3, h: 2 }],
  paths: [],
  places: [{ id: 'hut', name: '小屋', x: 3, y: 1, w: 3, h: 2, entrance: { x: 4, y: 3 } }],
};

/** 带内景的最小房:占地 5x4,南墙门洞,一张床锚点 */
const roomMap: TileMapDefinition = {
  width: 10,
  height: 9,
  blockedRects: [],
  paths: [],
  places: [
    {
      id: 'room',
      name: '小房',
      x: 3,
      y: 2,
      w: 5,
      h: 4,
      entrance: { x: 5, y: 6 },
      door: { x: 5, y: 5 },
      furniture: [{ kind: 'bed', x: 4, y: 3, w: 1, h: 1, activityId: 'rest', use: { x: 4, y: 4 } }],
    },
  ],
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
    expect(map.placeAt(5, 5)?.id).toBe('home-a');
    expect(map.placeAt(10, 30)?.id).toBe('park');
    expect(map.placeAt(49, 12)).toBeNull(); // 入口格不算场所内
    expect(map.placeAt(54, 38)).toBeNull();
  });

  it('placeById 返回场所定义', () => {
    const map = TileMap.fromDefinition(TOWN_MAP);
    expect(map.placeById('office')?.name).toBe('办公楼');
    expect(map.placeById('nope')).toBeNull();
  });

  it('contains 按 id/kind 前缀匹配(生成图 kind-N 命名),非前缀不误伤', () => {
    const generatedMap: TileMapDefinition = {
      width: 10,
      height: 8,
      blockedRects: [],
      paths: [],
      places: [
        { id: 'shop-a', name: '商店', x: 3, y: 2, w: 3, h: 2, entrance: { x: 4, y: 4 } },
        { id: 'workshop-a', name: '工坊', x: 7, y: 2, w: 2, h: 2, entrance: { x: 7, y: 4 } },
      ],
    };
    const map = TileMap.fromDefinition(generatedMap);
    expect(map.contains('shop', 4, 3)).toBe(true); // 矩形内
    expect(map.contains('shop', 4, 4)).toBe(true); // 入口格
    expect(map.contains('shop-a', 4, 3)).toBe(true); // 精确 id 照常
    expect(map.contains('shop', 7, 3)).toBe(false); // workshop 不因子串误伤
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

  it('Simulation 持有城镇地图且 10 场所入口全部合法', () => {
    const sim = new Simulation();
    expect(sim.map.width).toBe(64);
    expect(sim.map.height).toBe(48);
    expect(sim.map.places).toHaveLength(10); // 构造已验证全部入口
  });

  it('广场喷泉不可行走,广场其余区域可行走', () => {
    const map = TileMap.fromDefinition(TOWN_MAP);
    expect(map.isWalkable(30, 19)).toBe(false); // 喷泉池心
    expect(map.isWalkable(31, 20)).toBe(false);
    expect(map.isWalkable(29, 19)).toBe(true); // 喷泉西侧环道
    expect(map.isWalkable(33, 18)).toBe(true);
  });

  it('围栏段(M-G.5 数据化): 北缘阻塞,入口列豁口通行,fenceTiles 展开全集', () => {
    const map = TileMap.fromDefinition(TOWN_MAP);
    expect(map.isWalkable(4, 26)).toBe(false); // 入口西侧段
    expect(map.isWalkable(12, 26)).toBe(false); // 入口东侧段
    expect(map.isWalkable(9, 26)).toBe(true); // 入口列豁口
    expect(map.isWalkable(9, 25)).toBe(true); // 入口格在豁口正上方
    const tiles = map.fenceTiles();
    expect(tiles).toHaveLength(11); // 6+5
    expect(tiles).toContainEqual({ x: 3, y: 26 });
    expect(tiles).toContainEqual({ x: 14, y: 26 });
    expect(tiles).not.toContainEqual({ x: 9, y: 26 });
  });

  it('围栏段缺省地图 fenceTiles 为空(旧定义兼容)', () => {
    const map = TileMap.fromDefinition(miniMap);
    expect(map.fenceTiles()).toEqual([]);
  });

  it('资源节点种子(M-G.6): 占格阻塞并随 definition 暴露;重叠/被覆盖构造即抛错', () => {
    const map = TileMap.fromDefinition(TOWN_MAP);
    expect(map.resourceSeeds).toHaveLength(6); // 公园 3 丛浆果+街道 3 堆拾荒
    for (const seed of map.resourceSeeds) {
      expect(map.isWalkable(seed.x, seed.y), `(${seed.x},${seed.y}) 须阻塞`).toBe(false);
    }
    expect(() =>
      TileMap.fromDefinition({
        ...miniMap,
        resources: [
          { kind: 'berry_bush', x: 1, y: 1 },
          { kind: 'junk_pile', x: 1, y: 1 },
        ],
      }),
    ).toThrow(/重叠/);
    expect(() =>
      TileMap.fromDefinition({ ...miniMap, resources: [{ kind: 'berry_bush', x: 3, y: 1 }] }),
    ).toThrow(/被既有障碍覆盖/);
  });
});

describe('TileMap 内景层(M3.6e)', () => {
  it('有门洞建筑: 墙体阻塞,门洞可行走,室内可行走,家具阻塞,使用格可行走', () => {
    const map = TileMap.fromDefinition(roomMap);
    expect(map.isWalkable(3, 2)).toBe(false); // 西北墙角
    expect(map.isWalkable(5, 2)).toBe(false); // 北墙
    expect(map.isWalkable(5, 5)).toBe(true); // 门洞(南墙豁口)
    expect(map.isWalkable(4, 3)).toBe(false); // 床占地
    expect(map.isWalkable(4, 4)).toBe(true); // 床使用格(室内)
    expect(map.isWalkable(6, 4)).toBe(true); // 室内空地
    expect(map.isWalkable(5, 6)).toBe(true); // 入口格(门外)
  });

  it('门洞在 ASCII 图标注为 D', () => {
    const rows = TileMap.fromDefinition(TOWN_MAP).toAscii().split('\n');
    expect(rows[11]?.charAt(8)).toBe('D'); // 公寓 A 门洞
    expect(rows[11]?.charAt(7)).toBe('#'); // 同排墙体
    expect(rows[11]?.charAt(20)).toBe('D'); // 公寓 B 门洞
    expect(rows[10]?.charAt(58)).toBe('D'); // 公寓 C 门洞
    expect(rows[43]?.charAt(36)).toBe('D'); // 公寓 D 门洞
  });

  it('activityAnchors: 汇总各场所锚点使用格,无锚点活动返回空', () => {
    const map = TileMap.fromDefinition(TOWN_MAP);
    expect(map.activityAnchors('study')).toEqual(
      expect.arrayContaining([
        { x: 33, y: 9, placeId: 'library', kind: 'desk' },
        { x: 11, y: 6, placeId: 'home-a', kind: 'desk' },
      ]),
    );
    expect(map.activityAnchors('rest')).toEqual(
      expect.arrayContaining([
        { x: 9, y: 31, placeId: 'park', kind: 'bench' },
        { x: 17, y: 8, placeId: 'home-b', kind: 'bed' },
        { x: 37, y: 40, placeId: 'home-d', kind: 'bed' },
        // M3.6g 沙发升 rest 锚点(三档: 床>沙发>长椅)
        { x: 5, y: 10, placeId: 'home-a', kind: 'sofa' },
        { x: 32, y: 8, placeId: 'library', kind: 'sofa' },
        { x: 50, y: 30, placeId: 'gym', kind: 'sofa' },
      ]),
    );
    expect(map.activityAnchors('stroll')).toEqual([]);
  });

  it('门洞非法: 不在边缘/不邻入口/被障碍覆盖均抛错', () => {
    const base = roomMap.places[0]!;
    expect(() =>
      TileMap.fromDefinition({ ...roomMap, places: [{ ...base, door: { x: 5, y: 4 } }] }),
    ).toThrow(/边缘/); // 室内格非边缘
    expect(() =>
      TileMap.fromDefinition({ ...roomMap, places: [{ ...base, entrance: { x: 5, y: 7 } }] }),
    ).toThrow(/四邻相接/); // 门洞与入口隔 2 格
    expect(() =>
      TileMap.fromDefinition({ ...roomMap, blockedRects: [{ x: 5, y: 5, w: 1, h: 1 }] }),
    ).toThrow(/被障碍覆盖/);
  });

  it('家具非法: 出墙/锚点不成对/使用格不邻家具或被阻塞均抛错', () => {
    const base = roomMap.places[0]!;
    expect(() =>
      TileMap.fromDefinition({
        ...roomMap,
        places: [{ ...base, furniture: [{ kind: 'sofa', x: 3, y: 3, w: 1, h: 1 }] }],
      }),
    ).toThrow(/室内/); // 占西墙
    expect(() =>
      TileMap.fromDefinition({
        ...roomMap,
        places: [{ ...base, furniture: [{ kind: 'sofa', x: 6, y: 4, w: 1, h: 1, activityId: 'rest' }] }],
      }),
    ).toThrow(/成对/); // 有绑定无使用格
    expect(() =>
      TileMap.fromDefinition({
        ...roomMap,
        places: [
          { ...base, furniture: [{ ...base.furniture![0]!, use: { x: 6, y: 4 } }] },
        ],
      }),
    ).toThrow(/紧邻/); // 使用格与床隔 2 格
    expect(() =>
      TileMap.fromDefinition({
        ...roomMap,
        blockedRects: [{ x: 4, y: 4, w: 1, h: 1 }],
      }),
    ).toThrow(/被阻塞/); // 使用格被定制障碍压住
  });

  it('无墙场所家具合法(公园长椅),越界非法;室内割裂仍抛错', () => {
    // TOWN_MAP 公园长椅即 doorless 锚点家具,构造通过且进锚点表
    const town = TileMap.fromDefinition(TOWN_MAP);
    expect(town.isWalkable(8, 31)).toBe(false); // 长椅占地阻塞
    expect(town.isWalkable(9, 31)).toBe(true); // 使用格可行走
    expect(() =>
      TileMap.fromDefinition({
        ...roomMap,
        places: [
          { id: 'yard', name: '院子', x: 3, y: 2, w: 5, h: 4, entrance: { x: 5, y: 6 }, furniture: [{ kind: 'bench', x: 2, y: 3, w: 1, h: 1 }] },
        ],
      }),
    ).toThrow(/矩形内/); // doorless 家具越出场所占地
    // 横贯室内的柜台把床的使用格隔在门洞不可达侧
    const hall: TileMapDefinition = {
      width: 12,
      height: 9,
      blockedRects: [],
      paths: [],
      places: [
        {
          id: 'hall',
          name: '大厅',
          x: 3,
          y: 2,
          w: 6,
          h: 5,
          entrance: { x: 5, y: 7 },
          door: { x: 5, y: 6 },
          furniture: [
            { kind: 'counter', x: 4, y: 4, w: 4, h: 1 },
            { kind: 'bed', x: 4, y: 3, w: 1, h: 1, activityId: 'rest', use: { x: 5, y: 3 } },
          ],
        },
      ],
    };
    expect(() => TileMap.fromDefinition(hall)).toThrow(/不连通/);
  });

  it('寻路可穿门入内: A* 从入口到床使用格经门洞', () => {
    const map = TileMap.fromDefinition(roomMap);
    const path = findPath(map, { x: 5, y: 6 }, { x: 4, y: 4 });
    expect(path).not.toBeNull();
    expect(path?.at(-1)).toEqual({ x: 4, y: 4 });
    expect(path).toContainEqual({ x: 5, y: 5 }); // 必经门洞
  });
});
