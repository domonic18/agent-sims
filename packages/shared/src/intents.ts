import { z } from 'zod';

/** 意图指令集(arch §5):玩家输入与 Agent 规划器共用的同一指令层 */

export const moveToIntentSchema = z.object({
  type: z.literal('move_to'),
  characterId: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
});

export type MoveToIntent = z.infer<typeof moveToIntentSchema>;

/** 停止移动(M3.6g 验收反馈):清空剩余路径下一 tick 起静止,不干预活动;WASD 松手/主动急停共用 */
export const stopMoveIntentSchema = z.object({
  type: z.literal('stop_move'),
  characterId: z.string().min(1),
});

export type StopMoveIntent = z.infer<typeof stopMoveIntentSchema>;

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

/** 聊天(社交 v1):双方同处一地(同场所或曼哈顿 ≤2),每日同对限次防刷。
 * line 缺省走模板池;事件响应等场景可携带具体台词(如获救道谢),≤80 字。
 * reply(10-cognition §7.2 C4 对话): Agent 一问一答的第二句(听者台词),
 * 由调度泵经 light 槽生成后随 chat 意图一次结算,事件 content 合并双句 */
export const chatIntentSchema = z.object({
  type: z.literal('chat'),
  characterId: z.string().min(1),
  targetId: z.string().min(1),
  line: z.string().min(1).max(80).optional(),
  reply: z.string().min(1).max(80).optional(),
});

export type ChatIntent = z.infer<typeof chatIntentSchema>;

/** 维护工单(M-G.5):targetId=维护点 id(litter/fence_damage→clean/repair)或待救治角色 id(rescue) */
export const workTaskIntentSchema = z.object({
  type: z.literal('work_task'),
  characterId: z.string().min(1),
  targetId: z.string().min(1),
});

export type WorkTaskIntent = z.infer<typeof workTaskIntentSchema>;

/** 配方制作(M-G.6):recipeId=配方/制作活动 id(浆果派@灶台,修补钉@木工台) */
export const craftIntentSchema = z.object({
  type: z.literal('craft'),
  characterId: z.string().min(1),
  recipeId: z.string().min(1),
});

export type CraftIntent = z.infer<typeof craftIntentSchema>;

export const intentSchema = z.discriminatedUnion('type', [
  moveToIntentSchema,
  stopMoveIntentSchema,
  startActivityIntentSchema,
  stopActivityIntentSchema,
  buyItemIntentSchema,
  eatItemIntentSchema,
  storeItemIntentSchema,
  takeItemIntentSchema,
  rentPropertyIntentSchema,
  buyPropertyIntentSchema,
  chatIntentSchema,
  workTaskIntentSchema,
  craftIntentSchema,
]);

export type Intent = z.infer<typeof intentSchema>;

export type IntentType = Intent['type'];

/** 意图类型全集:从 intentSchema 选项派生,与 union 定义单源(新增意图零双写) */
export const INTENT_TYPES = intentSchema.options.map(
  (option) => option.shape.type.value,
) as unknown as [IntentType, ...IntentType[]];
