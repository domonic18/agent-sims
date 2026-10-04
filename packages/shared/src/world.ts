/**
 * 世界静态内容:地图定义与城镇布局。协议面一部分——服务端模拟与
 * 客户端渲染共用同一份定义,避免双端漂移。
 */

/** 场所定义:占地矩形 + 入口格(入口必须在占地外且可行走) */
export interface PlaceDefinition {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  entrance: { x: number; y: number };
}

export interface BlockedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 地图定义:网格尺寸 + 障碍占地(建筑/装饰,默认全图可行走) + 铺装 + 场所 */
export interface TileMapDefinition {
  width: number;
  height: number;
  blockedRects: BlockedRect[];
  /** 铺装矩形(主街/广场/门前小路):仅视觉,可行走,客户端渲染用 */
  paths: BlockedRect[];
  places: PlaceDefinition[];
}

/**
 * 城镇布局(M3.5b):56x40 网格,7 场所。
 * 中央广场 + 十字主街;居住簇(公寓/公园,西南)、文教簇(图书馆/办公楼,东北)、
 * 商业簇(商店/餐厅/健身房,沿广场南缘一线排开);公园含水系收边。
 * 布局为固定游戏内容,代码静态定义(非 DB 数据);
 * 调整布局后跑 `GET /debug/map` 或 map 单测核对口。
 */
export const TOWN_MAP: TileMapDefinition = {
  width: 56,
  height: 40,
  blockedRects: [
    // 建筑占地
    { x: 3, y: 4, w: 12, h: 8 }, // 公寓
    { x: 31, y: 4, w: 11, h: 8 }, // 图书馆
    { x: 44, y: 4, w: 10, h: 8 }, // 办公楼
    { x: 20, y: 26, w: 7, h: 8 }, // 商店
    { x: 30, y: 26, w: 9, h: 8 }, // 餐厅
    { x: 42, y: 26, w: 11, h: 8 }, // 健身房
    // 装饰障碍
    { x: 4, y: 30, w: 4, h: 4 }, // 池塘(公园西缘水系)
  ],
  paths: [
    { x: 2, y: 19, w: 52, h: 2 }, // 东西主街
    { x: 27, y: 2, w: 2, h: 35 }, // 南北主街
    { x: 22, y: 15, w: 12, h: 11 }, // 中央广场
    // 门前小路:入口 → 主街/广场
    { x: 8, y: 12, w: 1, h: 7 }, // 公寓
    { x: 36, y: 12, w: 1, h: 7 }, // 图书馆
    { x: 49, y: 12, w: 1, h: 7 }, // 办公楼
    { x: 9, y: 21, w: 1, h: 5 }, // 公园
    { x: 47, y: 21, w: 1, h: 5 }, // 健身房
  ],
  places: [
    { id: 'home', name: '公寓', x: 3, y: 4, w: 12, h: 8, entrance: { x: 8, y: 12 } },
    { id: 'library', name: '图书馆', x: 31, y: 4, w: 11, h: 8, entrance: { x: 36, y: 12 } },
    { id: 'office', name: '办公楼', x: 44, y: 4, w: 10, h: 8, entrance: { x: 49, y: 12 } },
    { id: 'shop', name: '商店', x: 20, y: 26, w: 7, h: 8, entrance: { x: 23, y: 25 } },
    { id: 'restaurant', name: '餐厅', x: 30, y: 26, w: 9, h: 8, entrance: { x: 33, y: 25 } },
    { id: 'gym', name: '健身房', x: 42, y: 26, w: 11, h: 8, entrance: { x: 47, y: 25 } },
    // 公园=可行走场所(休闲活动区),无障碍占地(池塘除外)
    { id: 'park', name: '公园', x: 3, y: 26, w: 15, h: 10, entrance: { x: 9, y: 25 } },
  ],
};
