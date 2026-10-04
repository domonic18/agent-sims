/**
 * 商店目录(M3.2):与活动定义同层,游戏内容双端共用。
 * food 买入即结算 effects(一次性消耗,不入库存);
 * furniture 入角色库存,bonus 为摆放后每游戏分钟被动加成(M3.3 生效)。
 */
export const SHOP_CATEGORIES = ['furniture', 'food'] as const;

export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

export const SHOP_ITEM_IDS = ['lamp', 'chair', 'bookshelf', 'bed', 'bread', 'coffee', 'cake'] as const;

export type ShopItemId = (typeof SHOP_ITEM_IDS)[number];

export interface FoodShopItem {
  id: ShopItemId;
  name: string;
  category: 'food';
  price: number;
  /** 买入立即结算的一次性数值变化 */
  effects: { energy: number; happiness: number };
}

export interface FurnitureShopItem {
  id: ShopItemId;
  name: string;
  category: 'furniture';
  price: number;
  /** 摆放后每游戏分钟被动加成(未摆放不生效) */
  bonus: { energy: number; happiness: number };
}

export type ShopItemDefinition = FoodShopItem | FurnitureShopItem;

export const SHOP_ITEMS: readonly ShopItemDefinition[] = [
  // 家具: 买入入库存,待 M3.3 摆放生效
  { id: 'lamp', name: '台灯', category: 'furniture', price: 15, bonus: { energy: 0, happiness: 0.01 } },
  { id: 'chair', name: '座椅', category: 'furniture', price: 25, bonus: { energy: 0.01, happiness: 0 } },
  { id: 'bookshelf', name: '书架', category: 'furniture', price: 60, bonus: { energy: 0, happiness: 0.03 } },
  { id: 'bed', name: '单人床', category: 'furniture', price: 120, bonus: { energy: 0.04, happiness: 0 } },
  // 食物: 买入即食用
  { id: 'bread', name: '面包', category: 'food', price: 4, effects: { energy: 6, happiness: 0 } },
  { id: 'coffee', name: '咖啡', category: 'food', price: 6, effects: { energy: 10, happiness: 0 } },
  { id: 'cake', name: '蛋糕', category: 'food', price: 10, effects: { energy: 3, happiness: 10 } },
];

export function getShopItem(id: string): ShopItemDefinition | null {
  return SHOP_ITEMS.find((item) => item.id === id) ?? null;
}
