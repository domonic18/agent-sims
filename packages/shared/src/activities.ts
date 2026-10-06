/**
 * 活动目录(游戏内容,双端共用): 活动数值公式在此定稿
 * (关闭 requirement §10-5;M3.6g 净速率模型重定稿,数值文档 §2.1)。
 * 效果为"每游戏分钟"**净速率**(已含活动期间代谢,活动中不再叠加自然衰减;
 * 仅待机走基础代谢衰减)。rest 的体力/幸福实际按锚点家具档位
 * (world.ts REST_RATES_BY_KIND: 床/沙发/长椅)结算,此处 effects 置 0 占位。
 * 金币可为负(就餐花销),下限夹 0,余额不足时活动中断(insufficient_coins)。
 * 岗位活动(带 category)受知识门槛约束(M-G.4 职业类别模型,数值文档 §5.1)。
 */

export const ACTIVITY_IDS = [
  'study',
  'work',
  'rest',
  'workout',
  'stroll',
  'meal',
  'waiter',
  'vendor',
  'librarian',
  'clean',
  'repair',
  'rescue',
] as const;

export type ActivityId = (typeof ACTIVITY_IDS)[number];

/**
 * 基础活动集合(M3.6f 体力区段):低体力(≤阈值)时仅可执行,
 * 高强度活动(学习/打工/健身)被拒绝。
 */
export const BASIC_ACTIVITY_IDS = ['rest', 'stroll', 'meal'] as const;

export interface ActivityEffects {
  energy: number;
  happiness: number;
  coins: number;
}

/** 岗位类别(M-G.4 类别平行模型): 门槛=累计学习班数(knowledge),类内同酬 */
export type JobCategoryId = 'fallback' | 'service' | 'gather' | 'build' | 'medical';

export const JOB_CATEGORIES: Readonly<
  Record<JobCategoryId, { label: string; requiredKnowledge: number }>
> = {
  fallback: { label: '兜底', requiredKnowledge: 0 },
  service: { label: '服务', requiredKnowledge: 3 },
  gather: { label: '采集', requiredKnowledge: 3 },
  build: { label: '建造', requiredKnowledge: 6 },
  medical: { label: '医疗', requiredKnowledge: 9 },
};

export interface ActivityDefinition {
  id: ActivityId;
  name: string;
  /** 可执行场所集合: 角色须位于其一的入口格或矩形内(场所与活动解耦,如学习=图书馆/家中书桌) */
  placeIds: readonly string[];
  /** 达到时长自动完成(游戏分钟) */
  durationMinutes: number;
  effects: ActivityEffects;
  /** 岗位类别(缺省=日常活动,无知识门槛);门槛查 JOB_CATEGORIES */
  category?: JobCategoryId;
}

export const ACTIVITY_DEFINITIONS: readonly ActivityDefinition[] = [
  {
    id: 'study',
    name: '学习',
    placeIds: ['library', 'home-a'],
    durationMinutes: 60,
    effects: { energy: -0.12, happiness: -0.02, coins: 0 },
  },
  {
    id: 'work',
    name: '杂工',
    placeIds: ['office'],
    durationMinutes: 120,
    effects: { energy: -0.15, happiness: -0.05, coins: 0.8 },
    category: 'fallback',
  },
  {
    id: 'rest',
    name: '休息',
    placeIds: ['home-a', 'home-b', 'home-c', 'home-d', 'park'],
    durationMinutes: 60,
    effects: { energy: 0, happiness: 0, coins: 0 },
  },
  {
    id: 'workout',
    name: '健身',
    placeIds: ['gym'],
    durationMinutes: 40,
    effects: { energy: -0.4, happiness: 0.35, coins: 0 },
  },
  {
    id: 'stroll',
    name: '散步',
    placeIds: ['park'],
    durationMinutes: 20,
    effects: { energy: -0.04, happiness: 0.15, coins: 0 },
  },
  {
    id: 'meal',
    name: '就餐',
    placeIds: ['restaurant'],
    durationMinutes: 30,
    effects: { energy: 0.05, happiness: 0.2, coins: -0.4 },
  },
  {
    id: 'waiter',
    name: '服务员',
    placeIds: ['restaurant'],
    durationMinutes: 120,
    effects: { energy: -0.15, happiness: -0.05, coins: 1.0 },
    category: 'service',
  },
  {
    id: 'vendor',
    name: '售货员',
    placeIds: ['shop'],
    durationMinutes: 120,
    effects: { energy: -0.15, happiness: -0.05, coins: 1.0 },
    category: 'service',
  },
  {
    id: 'librarian',
    name: '馆员',
    placeIds: ['library'],
    durationMinutes: 120,
    effects: { energy: -0.15, happiness: -0.05, coins: 1.0 },
    category: 'service',
  },
  // 维护工单三岗(M-G.5,design/08 §4/numerical §5.1):无场所锚点,经 work_task
  // 接单寻路作业,直发 start_activity 拒绝;金币不走每分钟速率,完成按单结算
  {
    id: 'clean',
    name: '清洁',
    placeIds: [],
    durationMinutes: 15,
    effects: { energy: -0.15, happiness: -0.05, coins: 0 },
    category: 'fallback',
  },
  {
    id: 'repair',
    name: '修理',
    placeIds: [],
    durationMinutes: 30,
    effects: { energy: -0.15, happiness: -0.05, coins: 0 },
    category: 'build',
  },
  {
    id: 'rescue',
    name: '救治',
    placeIds: [],
    durationMinutes: 30,
    effects: { energy: -0.15, happiness: -0.05, coins: 0 },
    category: 'medical',
  },
];

export function getActivityDefinition(id: string): ActivityDefinition | null {
  return ACTIVITY_DEFINITIONS.find((activity) => activity.id === id) ?? null;
}
