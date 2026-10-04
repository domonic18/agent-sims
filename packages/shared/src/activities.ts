/**
 * 活动目录(游戏内容,双端共用): 六类活动的数值公式在此定稿
 * (关闭 requirement §10-5;M3.6g 净速率模型重定稿,数值文档 §2.1)。
 * 效果为"每游戏分钟"**净速率**(已含活动期间代谢,活动中不再叠加自然衰减;
 * 仅待机走基础代谢衰减)。rest 的体力/幸福实际按锚点家具档位
 * (world.ts REST_RATES_BY_KIND: 床/沙发/长椅)结算,此处 effects 置 0 占位。
 * 金币可为负(就餐花销),下限夹 0,余额不足时活动中断(insufficient_coins)。
 */

export const ACTIVITY_IDS = ['study', 'work', 'rest', 'workout', 'stroll', 'meal'] as const;

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

export interface ActivityDefinition {
  id: ActivityId;
  name: string;
  /** 可执行场所集合: 角色须位于其一的入口格或矩形内(场所与活动解耦,如学习=图书馆/家中书桌) */
  placeIds: readonly string[];
  /** 达到时长自动完成(游戏分钟) */
  durationMinutes: number;
  effects: ActivityEffects;
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
    name: '打工',
    placeIds: ['office'],
    durationMinutes: 120,
    effects: { energy: -0.18, happiness: -0.05, coins: 0.5 },
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
];

export function getActivityDefinition(id: string): ActivityDefinition | null {
  return ACTIVITY_DEFINITIONS.find((activity) => activity.id === id) ?? null;
}
