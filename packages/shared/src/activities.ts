/**
 * 活动目录(游戏内容,双端共用): 六类活动的数值公式在此定稿
 * (关闭 requirement §10-5)。效果为"每游戏分钟"净增量,与自然衰减叠加;
 * 金币可为负(就餐花销),下限夹 0,余额不足时活动中断(insufficient_coins)。
 */

export const ACTIVITY_IDS = ['study', 'work', 'rest', 'workout', 'stroll', 'meal'] as const;

export type ActivityId = (typeof ACTIVITY_IDS)[number];

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
    placeIds: ['library', 'home'],
    durationMinutes: 60,
    effects: { energy: -0.15, happiness: -0.05, coins: 0 },
  },
  {
    id: 'work',
    name: '打工',
    placeIds: ['office'],
    durationMinutes: 120,
    effects: { energy: -0.25, happiness: -0.1, coins: 0.5 },
  },
  {
    id: 'rest',
    name: '休息',
    placeIds: ['home'],
    durationMinutes: 60,
    effects: { energy: 0.5, happiness: 0.1, coins: 0 },
  },
  {
    id: 'workout',
    name: '健身',
    placeIds: ['gym'],
    durationMinutes: 40,
    effects: { energy: -0.3, happiness: 0.35, coins: 0 },
  },
  {
    id: 'stroll',
    name: '散步',
    placeIds: ['park'],
    durationMinutes: 20,
    effects: { energy: -0.05, happiness: 0.15, coins: 0 },
  },
  {
    id: 'meal',
    name: '就餐',
    placeIds: ['restaurant'],
    durationMinutes: 30,
    effects: { energy: 0.3, happiness: 0.2, coins: -0.4 },
  },
];

export function getActivityDefinition(id: string): ActivityDefinition | null {
  return ACTIVITY_DEFINITIONS.find((activity) => activity.id === id) ?? null;
}
