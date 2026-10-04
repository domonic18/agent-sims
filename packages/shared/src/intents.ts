import { z } from 'zod';

/** 意图指令集(arch §5):玩家输入与 Agent 规划器共用的同一指令层 */

export const INTENT_TYPES = [
  'move_to',
  'start_activity',
  'stop_activity',
  'buy_item',
  'eat_item',
  'store_item',
  'take_item',
  'rent_property',
  'buy_property',
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

export const moveToIntentSchema = z.object({
  type: z.literal('move_to'),
  characterId: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
});

export type MoveToIntent = z.infer<typeof moveToIntentSchema>;

export const startActivityIntentSchema = z.object({
  type: z.literal('start_activity'),
  characterId: z.string().min(1),
  activityId: z.string().min(1),
});

export type StartActivityIntent = z.infer<typeof startActivityIntentSchema>;

export const stopActivityIntentSchema = z.object({
  type: z.literal('stop_activity'),
  characterId: z.string().min(1),
});

export type StopActivityIntent = z.infer<typeof stopActivityIntentSchema>;

export const buyItemIntentSchema = z.object({
  type: z.literal('buy_item'),
  characterId: z.string().min(1),
  itemId: z.string().min(1),
});

export type BuyItemIntent = z.infer<typeof buyItemIntentSchema>;

export const eatItemIntentSchema = z.object({
  type: z.literal('eat_item'),
  characterId: z.string().min(1),
  itemId: z.string().min(1),
});

export type EatItemIntent = z.infer<typeof eatItemIntentSchema>;

/** 存入冰箱(M3.6g):背包→家中冰箱,须在自家住房内且租约有效 */
export const storeItemIntentSchema = z.object({
  type: z.literal('store_item'),
  characterId: z.string().min(1),
  itemId: z.string().min(1),
  count: z.number().int().min(1),
});

export type StoreItemIntent = z.infer<typeof storeItemIntentSchema>;

/** 取出(M3.6g):家中冰箱→背包,须在自家住房内且租约有效 */
export const takeItemIntentSchema = z.object({
  type: z.literal('take_item'),
  characterId: z.string().min(1),
  itemId: z.string().min(1),
  count: z.number().int().min(1),
});

export type TakeItemIntent = z.infer<typeof takeItemIntentSchema>;

const propertyIntentShape = { characterId: z.string().min(1), propertyId: z.string().min(1) };

export const rentPropertyIntentSchema = z.object({
  type: z.literal('rent_property'),
  ...propertyIntentShape,
});

export type RentPropertyIntent = z.infer<typeof rentPropertyIntentSchema>;

export const buyPropertyIntentSchema = z.object({
  type: z.literal('buy_property'),
  ...propertyIntentShape,
});

export type BuyPropertyIntent = z.infer<typeof buyPropertyIntentSchema>;

export const intentSchema = z.discriminatedUnion('type', [
  moveToIntentSchema,
  startActivityIntentSchema,
  stopActivityIntentSchema,
  buyItemIntentSchema,
  eatItemIntentSchema,
  storeItemIntentSchema,
  takeItemIntentSchema,
  rentPropertyIntentSchema,
  buyPropertyIntentSchema,
]);

export type Intent = z.infer<typeof intentSchema>;
