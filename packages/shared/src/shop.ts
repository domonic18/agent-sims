/**
 * 商店目录(M3.2;M3.6e 收敛):与活动定义同层,游戏内容双端共用。
 * food 买入即结算 effects(一次性消耗,不入库存)。
 * M3.6e: 家具购买/摆放删除——家具转为世界内置内容(室内活动锚点),
 * 角色通过走到家具使用格直接使用,不再经商店购买。
 */
export const SHOP_CATEGORIES = ['food'] as const;

export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

export const SHOP_ITEM_IDS = ['bread', 'coffee', 'cake'] as const;

export type ShopItemId = (typeof SHOP_ITEM_IDS)[number];

export interface FoodShopItem {
  id: ShopItemId;
  name: string;
  category: 'food';
  price: number;
  /** 买入立即结算的一次性数值变化 */
  effects: { energy: number; happiness: number };
}

export type ShopItemDefinition = FoodShopItem;

export const SHOP_ITEMS: readonly ShopItemDefinition[] = [
  { id: 'bread', name: '面包', category: 'food', price: 4, effects: { energy: 6, happiness: 0 } },
  { id: 'coffee', name: '咖啡', category: 'food', price: 6, effects: { energy: 10, happiness: 0 } },
  { id: 'cake', name: '蛋糕', category: 'food', price: 10, effects: { energy: 3, happiness: 10 } },
];

export function getShopItem(id: string): ShopItemDefinition | null {
  return SHOP_ITEMS.find((item) => item.id === id) ?? null;
}
