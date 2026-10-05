/**
 * 后台可调系统参数目录:仅收录 server-only 数值(双端同源常量与时序基建不开放,
 * 见 balance.ts 注释)。目录元数据驱动 server 校验与 web 表单——加参数=shared 加目录
 * 条目 + balance.ts 默认值,两处之外零改动。
 */

export const SYS_CONFIG_EFFECTS = ['live', 'spawn', 'world'] as const;

export type SysConfigEffect = (typeof SYS_CONFIG_EFFECTS)[number];

export const SYS_CONFIG_EFFECT_LABELS: Record<SysConfigEffect, string> = {
  live: '立即生效',
  spawn: '新角色生效',
  world: '下个世界生效',
};

export const SYS_CONFIG_GROUPS = ['time', 'vitals', 'economy', 'social'] as const;

export type SysConfigGroup = (typeof SYS_CONFIG_GROUPS)[number];

export const SYS_CONFIG_GROUP_LABELS: Record<SysConfigGroup, string> = {
  time: '昼夜与时间',
  vitals: '体力与生存',
  economy: '经济',
  social: '社交',
};

export interface SysConfigField {
  /** 对应 balance.ts BALANCE 上的字段名 */
  key: string;
  label: string;
  group: SysConfigGroup;
  type: 'int' | 'float';
  min: number;
  max: number;
  step?: number;
  effect: SysConfigEffect;
  desc: string;
}

export const SYS_CONFIG_FIELDS: readonly SysConfigField[] = [
  // —— 昼夜与时间 ——
  {
    key: 'NIGHT_START_MINUTE', label: '夜晚开始', group: 'time', type: 'int', min: 0, max: 1439,
    effect: 'live', desc: '当日分钟数,22:00=1320;影响室内灯光与休息行为判定',
  },
  {
    key: 'NIGHT_END_MINUTE', label: '夜晚结束', group: 'time', type: 'int', min: 0, max: 1439,
    effect: 'live', desc: '次日分钟数,06:00=360',
  },
  {
    key: 'DEFAULT_TIME_SCALE', label: '初始时间倍率', group: 'time', type: 'int', min: 1, max: 16,
    effect: 'world', desc: '新创建世界的默认时间流速(1/4/16)',
  },
  // —— 体力与生存 ——
  {
    key: 'VITAL_MAX', label: '体力/心情上限', group: 'vitals', type: 'int', min: 50, max: 200,
    effect: 'live', desc: '两项数值的公共上限',
  },
  {
    key: 'START_ENERGY', label: '出生体力', group: 'vitals', type: 'int', min: 0, max: 200,
    effect: 'spawn', desc: '新角色出生时的初始体力',
  },
  {
    key: 'START_HAPPINESS', label: '出生心情', group: 'vitals', type: 'int', min: 0, max: 200,
    effect: 'spawn', desc: '新角色出生时的初始心情',
  },
  {
    key: 'IDLE_ENERGY_DECAY', label: '待机体力衰减', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.005,
    effect: 'live', desc: '每游戏分钟衰减量(无活动时的基础代谢)',
  },
  {
    key: 'IDLE_HAPPINESS_DECAY', label: '待机心情衰减', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.005,
    effect: 'live', desc: '每游戏分钟衰减量(无活动时的基础代谢)',
  },
  {
    key: 'LIFE_SCORE_DEATH_DEDUCTION', label: '死亡繁荣分扣减', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.05,
    effect: 'live', desc: '死亡时繁荣分按比例扣减(0.2=扣 20%)',
  },
  {
    key: 'REVIVE_ENERGY', label: '复活体力', group: 'vitals', type: 'int', min: 0, max: 200,
    effect: 'spawn', desc: 'Lab 复活后恢复的体力值',
  },
  {
    key: 'REVIVE_HAPPINESS', label: '复活心情', group: 'vitals', type: 'int', min: 0, max: 200,
    effect: 'spawn', desc: 'Lab 复活后恢复的心情值',
  },
  // —— 经济 ——
  {
    key: 'START_COINS', label: '出生金币', group: 'economy', type: 'int', min: 0, max: 1000,
    effect: 'spawn', desc: '新角色出生时的初始金币',
  },
  {
    key: 'SPAWN_PREPAID_DAYS', label: '出生预付房租', group: 'economy', type: 'int', min: 0, max: 30,
    effect: 'spawn', desc: '新角色出生时预付的房租天数',
  },
  // —— 社交 ——
  {
    key: 'CHAT_FAMILIARITY_GAIN', label: '聊天熟悉度收益', group: 'social', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '单次聊天的基础熟悉度增益(受日次递减)',
  },
  {
    key: 'CHAT_AFFINITY_BASE', label: '聊天相性收益', group: 'social', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '单次聊天的基础相性增益',
  },
  {
    key: 'CHAT_HAPPINESS', label: '聊天心情收益', group: 'social', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '单次聊天的心情增益',
  },
  {
    key: 'SOCIAL_PRESENCE_CAP', label: '同场增益人数上限', group: 'social', type: 'int', min: 0, max: 10,
    effect: 'live', desc: '同场增益计费的最大在场人数',
  },
  {
    key: 'SOCIAL_PRESENCE_BONUS', label: '同场增益系数', group: 'social', type: 'float', min: 0, max: 1, step: 0.01,
    effect: 'live', desc: '每名同场活动角色的心情加成系数',
  },
  {
    key: 'FAMILIARITY_DECAY_PER_DAY', label: '熟悉度每日衰减', group: 'social', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '世界日翻转时未互动关系的衰减量',
  },
];

/** GET /api/admin/sys-config 响应 */
export interface SysConfigView {
  fields: readonly SysConfigField[];
  defaults: Record<string, number>;
  overrides: Record<string, number>;
  effective: Record<string, number>;
}
