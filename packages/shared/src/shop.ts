/**
 * 商店目录(M3.2;M3.6e 收敛;M-G.6 改由物品注册表单源派生):
 * 货架=ITEMS 中带定价的 food 子集(同一对象引用,保证 getShopItem(item.id)===item)。
 * food 须在商店内购买,买入入随身背包(受体积上限约束),任意地点经 eat_item 进食结算 effects;
 * 回家可经 store_item 存入冰箱 / take_item 取出到背包(均受容积约束)。
 * 品类拉开价格/体积/体力/得分梯度(蛋糕大体积高得分,咖啡小体积高体力)。
 * 数值出处: docs/design/04-numerical-design.md §3;物品全集见 items.ts。
 */
import { ITEMS } from './items.js';

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
  effects: { energy: number; score: number };
}

export type ShopItemDefinition = FoodShopItem;

/** 货架=物品注册表中带定价的子集(元素即 ITEMS 对象,不拷贝) */
export const SHOP_ITEMS = ITEMS.filter(
  (item) => item.price !== undefined,
) as readonly ShopItemDefinition[];

export function getShopItem(id: string): ShopItemDefinition | null {
  return SHOP_ITEMS.find((item) => item.id === id) ?? null;
}
