import { z } from 'zod';

/**
 * 世界事件(离散事件即时触发,不占 tick):事件总线承载并供感知层消费。
 * 事件/消息 type 用点分字符串判别(命名约定)。
 */

export const characterArrivedEventSchema = z.object({
  type: z.literal('character.arrived'),
  characterId: z.string().min(1),
  tick: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
});

export type CharacterArrivedEvent = z.infer<typeof characterArrivedEventSchema>;

/** 活动结束原因: 按时长完成/手动停止/被移动打断/就餐余额不足/体力耗尽死亡 */
export const ACTIVITY_FINISH_REASONS = [
  'completed',
  'stopped',
  'interrupted',
  'insufficient_coins',
  'died',
] as const;

export type ActivityFinishReason = (typeof ACTIVITY_FINISH_REASONS)[number];

export const activityStartedEventSchema = z.object({
  type: z.literal('activity.started'),
  characterId: z.string().min(1),
  activityId: z.string().min(1),
  tick: z.number().int(),
});

export type ActivityStartedEvent = z.infer<typeof activityStartedEventSchema>;

export const activityFinishedEventSchema = z.object({
  type: z.literal('activity.finished'),
  characterId: z.string().min(1),
  activityId: z.string().min(1),
  tick: z.number().int(),
  /** 实际进行分钟数 */
  elapsedMinutes: z.number().int(),
  reason: z.enum(ACTIVITY_FINISH_REASONS),
});

export type ActivityFinishedEvent = z.infer<typeof activityFinishedEventSchema>;

/** 体力耗尽死亡:角色转幽灵态(M3.6f 生存机制) */
export const characterDiedEventSchema = z.object({
  type: z.literal('character.died'),
  characterId: z.string().min(1),
  tick: z.number().int(),
});

export type CharacterDiedEvent = z.infer<typeof characterDiedEventSchema>;

/** 复活(debug 通道):幽灵态解除,满状态回归 */
export const characterRevivedEventSchema = z.object({
  type: z.literal('character.revived'),
  characterId: z.string().min(1),
  tick: z.number().int(),
});

export type CharacterRevivedEvent = z.infer<typeof characterRevivedEventSchema>;

/** 暂停/倍率变更广播:多端 HUD 状态对齐 */
export const worldControlEventSchema = z.object({
  type: z.literal('world.control'),
  tick: z.number().int(),
  paused: z.boolean(),
  timeScale: z.number(),
});

export type WorldControlEvent = z.infer<typeof worldControlEventSchema>;

/** 世界参数变更广播(Lab 调试台改参):params 为目录全集生效值 */
export const worldParamsEventSchema = z.object({
  type: z.literal('world.params'),
  tick: z.number().int(),
  params: z.record(z.string(), z.number()),
});

export type WorldParamsEvent = z.infer<typeof worldParamsEventSchema>;

/** 世界重置(M3.6k 后台创建/删除世界):所有角色清场,快照流自动收敛 */
export const worldResetEventSchema = z.object({
  type: z.literal('world.reset'),
  tick: z.number().int(),
});

export type WorldResetEvent = z.infer<typeof worldResetEventSchema>;

/** 闲聊(社交 v1):content 为本句话气泡/日志显示用,affinityDelta 供日志展示 */
export const socialChatEventSchema = z.object({
  type: z.literal('social.chat'),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  tick: z.number().int(),
  content: z.string().min(1),
  affinityDelta: z.number(),
});

export type SocialChatEvent = z.infer<typeof socialChatEventSchema>;

/** 首次结成关系(朋友/挚友):观察者故事流事件 */
export const friendshipFormedEventSchema = z.object({
  type: z.literal('friendship.formed'),
  aId: z.string().min(1),
  bId: z.string().min(1),
  tick: z.number().int(),
  title: z.string().min(1),
});

export type FriendshipFormedEvent = z.infer<typeof friendshipFormedEventSchema>;

export const worldEventSchema = z.discriminatedUnion('type', [
  characterArrivedEventSchema,
  activityStartedEventSchema,
  activityFinishedEventSchema,
  characterDiedEventSchema,
  characterRevivedEventSchema,
  worldControlEventSchema,
  worldParamsEventSchema,
  worldResetEventSchema,
  socialChatEventSchema,
  friendshipFormedEventSchema,
]);

export type WorldEvent = z.infer<typeof worldEventSchema>;
