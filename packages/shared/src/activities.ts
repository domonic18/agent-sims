/**
 * 活动目录(游戏内容,双端共用): 活动数值公式在此定稿
 * (关闭 requirement §10-5;M3.6g 净速率模型重定稿,数值文档 §2.1)。
 * 效果为"每游戏分钟"**净速率**(已含活动期间代谢,活动中不再叠加自然衰减;
 * 仅待机走基础代谢衰减)。rest 的体力实际按锚点家具档位
 * (furniture.ts REST_RATES_BY_KIND: 床/沙发/长椅)结算,此处 effects 置 0 占位。
 * 金币可为负(就餐花销),下限夹 0,余额不足时活动中断(insufficient_coins)。
 * score 为每分钟得分速率(数值文档 §2.5 事件直加),仅正向活动>0,负值一律归 0。
 * 岗位活动(带 category)受知识门槛约束(M-G.4 职业类别模型,数值文档 §5.1)。
 */

export const ACTIVITY_IDS = [
  'study',
  'work',
  'rest',
  'sleep',
  'workout',
  'stroll',
  'socialize',
  'explore',
  'meal',
  'waiter',
  'vendor',
  'librarian',
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
  'craft_berry_pie',
  'craft_repair_kit',
  'craft_bread',
  'craft_sandwich',
] as const;

export type ActivityId = (typeof ACTIVITY_IDS)[number];

/**
 * 基础活动集合(M3.6f 体力区段):低体力(≤阈值)时仅可执行,
 * 高强度活动(学习/打工/健身)被拒绝。
 */
export const BASIC_ACTIVITY_IDS = ['rest', 'sleep', 'stroll', 'meal'] as const;

export interface ActivityEffects {
  energy: number;
  /** 每分钟得分速率(事件直加,§2.5);仅正向活动>0 */
  score: number;
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
  /** 事件可打断性(10-cognition §7.1 ③): none=不可打断(排事后处理,睡眠一律不打断),
   * low=仅高强度事件(≥8)可申请中断评估,缺省 high=显著事件(≥6)即可进中断评估 */
  interruptibility?: 'none' | 'low' | 'high';
}

export const ACTIVITY_DEFINITIONS: readonly ActivityDefinition[] = [
  {
    id: 'study',
    name: '学习',
    placeIds: ['library', 'home-a'],
    durationMinutes: 60,
    effects: { energy: -0.12, score: 0, coins: 0 },
    interruptibility: 'low',
  },
  {
    id: 'work',
    name: '杂工',
    placeIds: ['office'],
    durationMinutes: 120,
    effects: { energy: -0.15, score: 0, coins: 0.8 },
    category: 'fallback',
    interruptibility: 'low',
  },
  {
    id: 'rest',
    name: '休息',
    placeIds: ['home-a', 'home-b', 'home-c', 'home-d', 'park'],
    durationMinutes: 60,
    effects: { energy: 0, score: 0, coins: 0 },
  },
  // 睡觉(M-G.2,数值文档 §2.7):夜间睡眠活动,自家床锚点(经服务端租约校验,
  // 公园长椅非 sleep 档位不可睡)。体力实际按床档速率(REST_RATES_BY_KIND.bed)
  // 结算,此处 effects 置 0 占位;睡眠分钟计入昨夜窗口账本,缺觉惩罚见 simulation 结算。
  {
    id: 'sleep',
    name: '睡觉',
    placeIds: ['home-a', 'home-b', 'home-c', 'home-d'],
    durationMinutes: 480,
    effects: { energy: 0, score: 0, coins: 0 },
    interruptibility: 'none',
  },
  {
    id: 'workout',
    name: '健身',
    placeIds: ['gym'],
    durationMinutes: 40,
    effects: { energy: -0.4, score: 0.35, coins: 0 },
  },
  {
    id: 'stroll',
    name: '散步',
    placeIds: ['park'],
    durationMinutes: 20,
    effects: { energy: -0.04, score: 0.15, coins: 0 },
  },
  // 社交(10-cognition §7.2 C4):闲聚类活动,动机引擎(idleSocialStep)负责找人聊天,
  // 本活动只提供日程块锚点(慢层可排);聊天收益走 social.chat 结算,活动本身低耗微得分
  {
    id: 'socialize',
    name: '社交',
    placeIds: ['park', 'restaurant', 'gym', 'library'],
    durationMinutes: 60,
    effects: { energy: -0.04, score: 0.15, coins: 0 },
  },
  // 探索(随机性迭代):多场所漫游块,慢层可排;目标场所按(角色,日,块)确定性随机——
  // 块内粘性(到位即开始),跨块/跨日换地方,是行动多样性的主要来源
  {
    id: 'explore',
    name: '探索',
    placeIds: ['park', 'shop', 'restaurant', 'gym', 'library', 'office'],
    durationMinutes: 30,
    effects: { energy: -0.05, score: 0.2, coins: 0 },
  },
  {
    id: 'meal',
    name: '就餐',
    placeIds: ['restaurant'],
    durationMinutes: 30,
    effects: { energy: 0.05, score: 0.2, coins: -0.4 },
    interruptibility: 'none',
  },
  {
    id: 'waiter',
    name: '服务员',
    placeIds: ['restaurant'],
    durationMinutes: 120,
    effects: { energy: -0.15, score: 0, coins: 1.0 },
    category: 'service',
  },
  {
    id: 'vendor',
    name: '售货员',
    placeIds: ['shop'],
    durationMinutes: 120,
    effects: { energy: -0.15, score: 0, coins: 1.0 },
    category: 'service',
  },
  {
    id: 'librarian',
    name: '馆员',
    placeIds: ['library'],
    durationMinutes: 120,
    effects: { energy: -0.15, score: 0, coins: 1.0 },
    category: 'service',
  },
  // 维护工单三岗(M-G.5,design/08 §4/numerical §5.1):无场所锚点,经 work_task
  // 接单寻路作业,直发 start_activity 拒绝;金币不走每分钟速率,完成按单结算
  {
    id: 'clean',
    name: '清洁',
    placeIds: [],
    durationMinutes: 15,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'fallback',
  },
  {
    id: 'repair',
    name: '修理',
    placeIds: [],
    durationMinutes: 30,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'build',
  },
  {
    id: 'rescue',
    name: '救治',
    placeIds: [],
    durationMinutes: 30,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'medical',
  },
  // 采集两岗(M-G.6,design/09 §2/numerical §5.4):无场所锚点,经 work_task
  // 接单寻路至资源节点;无工资以物代薪(产出入背包),直发 start_activity 拒绝
  {
    id: 'gather_berry',
    name: '采集浆果',
    placeIds: [],
    durationMinutes: 20,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'gather',
  },
  {
    id: 'scavenge',
    name: '拾荒',
    placeIds: [],
    durationMinutes: 15,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'gather',
  },
  // 生存采集三岗(M-S/S1,07-survival §2):同采集类门槛,产出入包为 S2 建造备料
  {
    id: 'chop_tree',
    name: '伐木',
    placeIds: [],
    durationMinutes: 25,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'gather',
  },
  {
    id: 'mine_rock',
    name: '采石',
    placeIds: [],
    durationMinutes: 30,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'gather',
  },
  {
    id: 'salvage_metal',
    name: '搜刮金属',
    placeIds: [],
    durationMinutes: 25,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'gather',
  },
  // 食物链采集两岗(2026-10-07,numerical §5.4):直采恢复<制作——苹果直食 +4,
  // 小麦为面包原料(经灶台制作 +6,再制三明治 +8)
  {
    id: 'pick_apple',
    name: '采摘苹果',
    placeIds: [],
    durationMinutes: 20,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'gather',
  },
  {
    id: 'harvest_wheat',
    name: '收割小麦',
    placeIds: [],
    durationMinutes: 20,
    effects: { energy: -0.15, score: 0, coins: 0 },
    category: 'gather',
  },
  // 制作配方(M-G.6+2026-10-07 食物链,design/09 §3/numerical §5.4):站点锚点活动(灶台/木工台),
  // 须经 craft 意图开始(验料扣料,中断退料,完成产出入包),直发 start_activity 拒绝
  {
    id: 'craft_berry_pie',
    name: '制作浆果派',
    placeIds: ['restaurant'],
    durationMinutes: 25,
    effects: { energy: -0.1, score: 0.05, coins: 0 },
    category: 'gather',
  },
  {
    id: 'craft_repair_kit',
    name: '制作修补钉',
    placeIds: ['office'],
    durationMinutes: 15,
    effects: { energy: -0.1, score: 0.05, coins: 0 },
    category: 'build',
  },
  // 食物链制作两配方(2026-10-07,numerical §5.4):产出复用货架同 ItemId,
  // 制作恢复>直采(面包 +6/三明治 +8 > 直采苹果 +4/浆果×2 = +4)
  {
    id: 'craft_bread',
    name: '制作面包',
    placeIds: ['restaurant'],
    durationMinutes: 20,
    effects: { energy: -0.1, score: 0.05, coins: 0 },
    category: 'gather',
  },
  {
    id: 'craft_sandwich',
    name: '制作三明治',
    placeIds: ['restaurant'],
    durationMinutes: 25,
    effects: { energy: -0.1, score: 0.05, coins: 0 },
    category: 'gather',
  },
];

export function getActivityDefinition(id: string): ActivityDefinition | null {
  return ACTIVITY_DEFINITIONS.find((activity) => activity.id === id) ?? null;
}
