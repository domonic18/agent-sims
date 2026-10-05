/**
 * 商店目录(M3.2;M3.6e 收敛;M3.6g 背包/冰箱两级库存):与活动定义同层,游戏内容双端共用。
 * food 须在商店内购买,买入入随身背包(受体积上限约束),任意地点经 eat_item 进食结算 effects;
 * 回家可经 store_item 存入冰箱 / take_item 取出到背包(均受容积约束)。
 * 品类拉开价格/体积/体力/幸福梯度(蛋糕大体积高幸福,咖啡小体积高体力)。
 * 数值出处: docs/design/04-numerical-design.md §3。
 * M3.6e: 家具购买/摆放删除——家具转为世界内置内容(室内活动锚点),
 * 角色通过走到家具使用格直接使用,不再经商店购买。
 */
export const SHOP_CATEGORIES = ['food'] as const;

export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

export const SHOP_ITEM_IDS = [
  'bread',
  'coffee',
  'cake',
  'apple',
  'sandwich',
  'milk',
  'sushi',
  'hotdog',
] as const;

export type ShopItemId = (typeof SHOP_ITEM_IDS)[number];

export interface FoodShopItem {
  id: ShopItemId;
  name: string;
  category: 'food';
  price: number;
  /** 占用背包/冰箱容积(M3.6g 体积制,数值文档 §3.1) */
  volume: number;
  /** 进食(eat_item)时结算的一次性数值变化 */
  effects: { energy: number; happiness: number };
}

export type ShopItemDefinition = FoodShopItem;

export const SHOP_ITEMS: readonly ShopItemDefinition[] = [
  { id: 'apple', name: '苹果', category: 'food', price: 3, volume: 1, effects: { energy: 4, happiness: 1 } },
  { id: 'bread', name: '面包', category: 'food', price: 4, volume: 1, effects: { energy: 6, happiness: 0 } },
  { id: 'milk', name: '牛奶', category: 'food', price: 5, volume: 2, effects: { energy: 6, happiness: 3 } },
  { id: 'coffee', name: '咖啡', category: 'food', price: 6, volume: 1, effects: { energy: 10, happiness: 0 } },
  { id: 'sandwich', name: '三明治', category: 'food', price: 7, volume: 2, effects: { energy: 8, happiness: 2 } },
  { id: 'hotdog', name: '热狗', category: 'food', price: 8, volume: 1, effects: { energy: 9, happiness: 1 } },
  { id: 'cake', name: '蛋糕', category: 'food', price: 10, volume: 3, effects: { energy: 3, happiness: 10 } },
  { id: 'sushi', name: '寿司套餐', category: 'food', price: 12, volume: 2, effects: { energy: 12, happiness: 5 } },
];

export function getShopItem(id: string): ShopItemDefinition | null {
  return SHOP_ITEMS.find((item) => item.id === id) ?? null;
}
