import { z } from 'zod';
import { maintenanceSpotSchema, type MaintenanceSpot } from './maintenance.js';
import type { CraftRecipeId, RecipeDef } from './production.js';

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

/** 活动结束原因: 按时长完成/手动停止/被移动打断/就餐余额不足/倒下(累倒送医或重伤)/虚脱倒地 */
export const ACTIVITY_FINISH_REASONS = [
  'completed',
  'stopped',
  'interrupted',
  'insufficient_coins',
  'died',
  'collapsed',
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

/** 倒下(numerical §2.3): growth 体力耗尽=累倒送医,survival 健康归零=重伤休整;
 * 同转幽灵态挂救治窗口,得分扣减挂起(growth 超时苏醒扣,survival 免扣) */
export const characterDiedEventSchema = z.object({
  type: z.literal('character.died'),
  characterId: z.string().min(1),
  tick: z.number().int(),
  /** 本次倒下可被救治(窗口内 rescue/debug 免扣复活);超时后走 auto_revived */
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

/** 世界配方热改广播(admin 配方页 PUT):recipes 为四配方全集(每世界快照) */
export interface WorldRecipesEvent {
  type: 'world.recipes';
  tick: number;
  recipes: Record<CraftRecipeId, RecipeDef>;
}

// 配方合法性由 validateRecipes 单点负责,协议面仅约束形状(record 宽松放行)
export const worldRecipesEventSchema = z.object({
  type: z.literal('world.recipes'),
  tick: z.number().int(),
  recipes: z.record(z.string(), z.unknown()) as z.ZodType<Record<CraftRecipeId, RecipeDef>>,
});

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

/** 工单任务全集(M-G.5 维护三岗+M-G.6 采集两岗+M-S/S1 生存三岗+食物链两岗):事件与门槛查表共用 */
const workTaskIdSchema = z.enum([
  'clean',
  'repair',
  'rescue',
  'gather_berry',
  'scavenge',
  'chop_tree',
  'mine_rock',
  'salvage_metal',
  'pick_apple',
  'harvest_wheat',
]);

export type WorkTaskId = z.infer<typeof workTaskIdSchema>;

/** 工单受理:寻路前往,到位后计时作业 */
export const workTaskAcceptedEventSchema = z.object({
  type: z.literal('work_task.accepted'),
  characterId: z.string().min(1),
  targetId: z.string().min(1),
  task: workTaskIdSchema,
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

/** 工单完成:维护点清除/救治复活/采集入包,按单结算(采集 pay=0 以物代薪) */
export const workTaskCompletedEventSchema = z.object({
  type: z.literal('work_task.completed'),
  characterId: z.string().min(1),
  targetId: z.string().min(1),
  task: workTaskIdSchema,
  pay: z.number(),
  tick: z.number().int(),
});

export type WorkTaskCompletedEvent = z.infer<typeof workTaskCompletedEventSchema>;

/** 配方完成(M-G.6):产出入包(产出物查 RECIPES[recipeId].outputs) */
export const craftCompletedEventSchema = z.object({
  type: z.literal('craft.completed'),
  characterId: z.string().min(1),
  recipeId: z.string().min(1),
  tick: z.number().int(),
});

export type CraftCompletedEvent = z.infer<typeof craftCompletedEventSchema>;

/** 缺觉惩罚结算(M-G.2,数值文档 §2.7):昨夜睡眠窗口累计 < SLEEP_MIN_MINUTES,
 * 当日正收益(金币/产出/正幸福增益)×SLEEP_DEBT_MULTIPLIER;sleptMinutes 为窗口实际入睡分钟 */
export const sleepDebtAppliedEventSchema = z.object({
  type: z.literal('sleep.debt_applied'),
  characterId: z.string().min(1),
  sleptMinutes: z.number().int(),
  tick: z.number().int(),
});

export type SleepDebtAppliedEvent = z.infer<typeof sleepDebtAppliedEventSchema>;

/** 托管状态切换(M4e):玩家⇄Agent 指令来源原子切换的广播,world 域零感知仅转发;
 * hosted=false 时 mode=null */
export const hostingChangedEventSchema = z.object({
  type: z.literal('character.hosting_changed'),
  characterId: z.string().min(1),
  hosted: z.boolean(),
  mode: z.enum(['full', 'policy']).nullable(),
  tick: z.number().int(),
});

export type HostingChangedEvent = z.infer<typeof hostingChangedEventSchema>;

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
  worldRecipesEventSchema,
  worldResetEventSchema,
  socialChatEventSchema,
  friendshipFormedEventSchema,
  maintenanceSpawnedEventSchema,
  workTaskAcceptedEventSchema,
  workTaskCancelledEventSchema,
  workTaskCompletedEventSchema,
  craftCompletedEventSchema,
  sleepDebtAppliedEventSchema,
  hostingChangedEventSchema,
]);

export type WorldEvent = z.infer<typeof worldEventSchema>;

/** 历史事件条目(C4 日志抽屉回填):落库行+按 tick 换算的游戏时刻(1 tick=1 游戏分钟) */
export interface WorldEventHistoryEntry {
  id: number;
  event: WorldEvent;
  day: number;
  time: string;
}

export interface WorldEventsHistoryResponse {
  entries: WorldEventHistoryEntry[];
}
