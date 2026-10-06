/**
 * 物品注册表(M-G.6): 全部可持有物品单源目录——商店货架 food 与采集/制作
 * 产出(food/material)同层;背包/冰箱两级库存与体积容量统一按此结算。
 * 带 price 的项派生为商店货架(shop.ts SHOP_ITEMS),无 price 不可购买;
 * food 带 effects 可经 eat_item 进食,material 不可食用(制作/修补耗材)。
 * 数值出处: docs/design/04-numerical-design.md §3/§5.4。
 */

export const ITEM_IDS = [
  'bread',
  'coffee',
  'cake',
  'apple',
  'sandwich',
  'milk',
  'sushi',
  'hotdog',
  'berry',
  'scrap',
  'twig',
  'berry_pie',
  'repair_kit',
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export interface ItemDefinition {
  id: ItemId;
  name: string;
  category: 'food' | 'material';
  /** 占用背包/冰箱容积(数值文档 §3.1/§5.4) */
  volume: number;
  /** 进食(eat_item)一次性效果;缺省=material 不可食用 */
  effects?: { energy: number; happiness: number };
  /** 商店货架定价;缺省=非货架物品(采集/制作产出) */
  price?: number;
}

export const ITEMS: readonly ItemDefinition[] = [
  { id: 'apple', name: '苹果', category: 'food', price: 3, volume: 1, effects: { energy: 4, happiness: 1 } },
  { id: 'bread', name: '面包', category: 'food', price: 4, volume: 1, effects: { energy: 6, happiness: 0 } },
  { id: 'milk', name: '牛奶', category: 'food', price: 5, volume: 2, effects: { energy: 6, happiness: 3 } },
  { id: 'coffee', name: '咖啡', category: 'food', price: 6, volume: 1, effects: { energy: 10, happiness: 0 } },
  { id: 'sandwich', name: '三明治', category: 'food', price: 7, volume: 2, effects: { energy: 8, happiness: 2 } },
  { id: 'hotdog', name: '热狗', category: 'food', price: 8, volume: 1, effects: { energy: 9, happiness: 1 } },
  { id: 'cake', name: '蛋糕', category: 'food', price: 10, volume: 3, effects: { energy: 3, happiness: 10 } },
  { id: 'sushi', name: '寿司套餐', category: 'food', price: 12, volume: 2, effects: { energy: 12, happiness: 5 } },
  // 采集/制作产出(非货架,04-numerical §5.4)
  { id: 'berry', name: '浆果', category: 'food', volume: 1, effects: { energy: 2, happiness: 0 } },
  { id: 'berry_pie', name: '浆果派', category: 'food', volume: 2, effects: { energy: 8, happiness: 4 } },
  { id: 'scrap', name: '废料', category: 'material', volume: 1 },
  { id: 'twig', name: '树枝', category: 'material', volume: 1 },
  { id: 'repair_kit', name: '修补钉', category: 'material', volume: 1 },
];

export function getItem(id: string): ItemDefinition | null {
  return ITEMS.find((item) => item.id === id) ?? null;
}
