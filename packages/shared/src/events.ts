import { z } from 'zod';
import { maintenanceSpotSchema, type MaintenanceSpot } from './maintenance.js';

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

/** 体力耗尽死亡:角色转幽灵态,繁荣分扣减挂起进入救治窗口(M-G.5,goal-design §7) */
export const characterDiedEventSchema = z.object({
  type: z.literal('character.died'),
  characterId: z.string().min(1),
  tick: z.number().int(),
  /** 本次死亡可被救治(窗口内 rescue/debug 免扣复活);超时后走 auto_revived */
  revivable: z.boolean(),
});

export type CharacterDiedEvent = z.infer<typeof characterDiedEventSchema>;

/** 复活(救治/debug 通道):幽灵态解除,满状态回归且免扣繁荣分 */
export const characterRevivedEventSchema = z.object({
  type: z.literal('character.revived'),
  characterId: z.string().min(1),
  tick: z.number().int(),
});

export type CharacterRevivedEvent = z.infer<typeof characterRevivedEventSchema>;

/** 救治窗口超时自动复活(M-G.5):挂起的繁荣分扣减按超时时刻现值生效 */
export const characterAutoRevivedEventSchema = z.object({
  type: z.literal('character.auto_revived'),
  characterId: z.string().min(1),
  tick: z.number().int(),
});

export type CharacterAutoRevivedEvent = z.infer<typeof characterAutoRevivedEventSchema>;

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

/** 世界规则运行时变更广播(游戏内设置菜单/难度预设):三字段全集,不含 params */
export const worldRulesEventSchema = z.object({
  type: z.literal('world.rules'),
  tick: z.number().int(),
  rules: z.object({
    allowDeath: z.boolean(),
    allowChat: z.boolean(),
    initialTimeScale: z.number(),
  }),
});

export type WorldRulesEvent = z.infer<typeof worldRulesEventSchema>;

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

/** 维护点生成(M-G.5 损耗系统):litter/fence_damage 新增,web diff 渲染 */
export const maintenanceSpawnedEventSchema = z.object({
  type: z.literal('maintenance.spawned'),
  spot: maintenanceSpotSchema,
  tick: z.number().int(),
});

export type MaintenanceSpawnedEvent = z.infer<typeof maintenanceSpawnedEventSchema>;
export type { MaintenanceSpot };

/** 维护工单任务 id(M-G.5 三岗) */
export type WorkTaskId = 'clean' | 'repair' | 'rescue';

/** 工单受理:寻路前往,到位后计时作业 */
export const workTaskAcceptedEventSchema = z.object({
  type: z.literal('work_task.accepted'),
  characterId: z.string().min(1),
  targetId: z.string().min(1),
  task: z.enum(['clean', 'repair', 'rescue']),
  tick: z.number().int(),
});

export type WorkTaskAcceptedEvent = z.infer<typeof workTaskAcceptedEventSchema>;

/** 工单目标失效:维护点被清/幽灵被抢先救治,无薪中断 */
export const workTaskCancelledEventSchema = z.object({
  type: z.literal('work_task.cancelled'),
  characterId: z.string().min(1),
  targetId: z.string().min(1),
  tick: z.number().int(),
});

export type WorkTaskCancelledEvent = z.infer<typeof workTaskCancelledEventSchema>;

/** 工单完成:维护点清除或救治复活,按单结算 */
export const workTaskCompletedEventSchema = z.object({
  type: z.literal('work_task.completed'),
  characterId: z.string().min(1),
  targetId: z.string().min(1),
  task: z.enum(['clean', 'repair', 'rescue']),
  pay: z.number(),
  tick: z.number().int(),
});

export type WorkTaskCompletedEvent = z.infer<typeof workTaskCompletedEventSchema>;

export const worldEventSchema = z.discriminatedUnion('type', [
  characterArrivedEventSchema,
  activityStartedEventSchema,
  activityFinishedEventSchema,
  characterDiedEventSchema,
  characterRevivedEventSchema,
  characterAutoRevivedEventSchema,
  worldControlEventSchema,
  worldParamsEventSchema,
  worldRulesEventSchema,
  worldResetEventSchema,
  socialChatEventSchema,
  friendshipFormedEventSchema,
  maintenanceSpawnedEventSchema,
  workTaskAcceptedEventSchema,
  workTaskCancelledEventSchema,
  workTaskCompletedEventSchema,
]);

export type WorldEvent = z.infer<typeof worldEventSchema>;
