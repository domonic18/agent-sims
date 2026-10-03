import type { TileMapDefinition } from './map.js';

/**
 * 城镇布局(M2.2):32x24 网格,7 场所。
 * 布局为固定游戏内容,代码静态定义(非 DB 数据);
 * 调整布局后跑 `GET /debug/map` 或 map 单测核对口。
 */
export const TOWN_MAP: TileMapDefinition = {
  width: 32,
  height: 24,
  blockedRects: [
    // 建筑占地
    { x: 2, y: 2, w: 6, h: 5 }, // 公寓
    { x: 12, y: 2, w: 8, h: 6 }, // 办公楼
    { x: 24, y: 2, w: 6, h: 5 }, // 图书馆
    { x: 2, y: 10, w: 6, h: 4 }, // 商店
    { x: 13, y: 11, w: 6, h: 4 }, // 餐厅
    { x: 24, y: 11, w: 6, h: 5 }, // 健身房
    // 装饰障碍
    { x: 2, y: 17, w: 3, h: 3 }, // 池塘
  ],
  places: [
    { id: 'home', name: '公寓', x: 2, y: 2, w: 6, h: 5, entrance: { x: 5, y: 7 } },
    { id: 'office', name: '办公楼', x: 12, y: 2, w: 8, h: 6, entrance: { x: 15, y: 8 } },
    { id: 'library', name: '图书馆', x: 24, y: 2, w: 6, h: 5, entrance: { x: 26, y: 7 } },
    { id: 'shop', name: '商店', x: 2, y: 10, w: 6, h: 4, entrance: { x: 5, y: 14 } },
    { id: 'restaurant', name: '餐厅', x: 13, y: 11, w: 6, h: 4, entrance: { x: 15, y: 15 } },
    { id: 'gym', name: '健身房', x: 24, y: 11, w: 6, h: 5, entrance: { x: 26, y: 16 } },
    // 公园=可行走场所(休闲活动区),无障碍占地
    { id: 'park', name: '公园', x: 8, y: 17, w: 14, h: 5, entrance: { x: 14, y: 16 } },
  ],
};
