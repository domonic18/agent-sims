/**
 * 世界参数目录:世界级可调的 server-only 数值(创建世界时在向导设置并随 config 存档,
 * 运行中经 Lab 调试台修改)。双端同源常量与时序基建不开放,见 balance.ts 注释。
 * 目录元数据驱动 server 校验与 web 表单——加参数=shared 加目录条目 + balance.ts 默认值,
 * 两处之外零改动。
 */

export const SYS_CONFIG_EFFECTS = ['live', 'spawn'] as const;

export type SysConfigEffect = (typeof SYS_CONFIG_EFFECTS)[number];

export const SYS_CONFIG_EFFECT_LABELS: Record<SysConfigEffect, string> = {
  live: '立即生效',
  spawn: '新角色生效',
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
  // —— 体力与生存 ——
  {
    key: 'VITAL_MAX', label: '体力上限', group: 'vitals', type: 'int', min: 50, max: 200,
    effect: 'live', desc: '体力数值的公共上限(救治/苏醒恢复基准)',
  },
  {
    key: 'START_ENERGY', label: '出生体力', group: 'vitals', type: 'int', min: 0, max: 200,
    effect: 'spawn', desc: '新角色出生时的初始体力',
  },
  {
    key: 'IDLE_ENERGY_DECAY', label: '待机体力衰减', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.005,
    effect: 'live', desc: '每游戏分钟衰减量(无活动时的基础代谢)',
  },
  {
    key: 'SCORE_WAKE_DEDUCTION', label: '累倒苏醒扣分', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.05,
    effect: 'live', desc: 'growth 累倒送医超时苏醒时得分按比例扣减(0.2=扣 20%);救治免扣',
  },
  {
    key: 'REVIVE_ENERGY', label: '复活体力', group: 'vitals', type: 'int', min: 0, max: 200,
    effect: 'spawn', desc: 'Lab 复活后恢复的体力值',
  },
  {
    key: 'SLEEP_MIN_MINUTES', label: '缺觉阈值', group: 'vitals', type: 'int', min: 0, max: 480,
    effect: 'live', desc: '昨夜睡眠窗口(22:00~06:00)累计低于该分钟数,于下一 06:00 结算缺觉惩罚;0=永不缺觉',
  },
  {
    key: 'SLEEP_DEBT_MULTIPLIER', label: '缺觉收益系数', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.05,
    effect: 'live', desc: '缺觉日正收益(金币/得分/产出)乘该值;体力与负项不动,于下一 06:00 结算生效',
  },
  // —— 生存健康(仅 survival 模式生效,growth 不衰减) ——
  {
    key: 'SURVIVAL_HUNGER_ENERGY_LINE', label: '饥饿线体力', group: 'vitals', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '生存模式体力低于该值开始损耗健康(饥饿压力)',
  },
  {
    key: 'SURVIVAL_HEALTH_DECAY_PER_MIN', label: '健康饥饿损耗', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.005,
    effect: 'live', desc: '生存模式每游戏分钟健康损耗量(体力低于饥饿线时)',
  },
  {
    key: 'SURVIVAL_HEALTH_RECOVER_LINE', label: '康复线体力', group: 'vitals', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '生存模式体力不低于该值时健康自然恢复',
  },
  {
    key: 'SURVIVAL_HEALTH_RECOVER_PER_MIN', label: '健康自然恢复', group: 'vitals', type: 'float', min: 0, max: 1, step: 0.005,
    effect: 'live', desc: '生存模式每游戏分钟健康恢复量(体力高于康复线时)',
  },
  {
    key: 'SURVIVAL_INJURY_REVIVE_HEALTH', label: '重伤苏醒恢复线', group: 'vitals', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '生存模式重伤超时苏醒后的健康/体力值(救治复活仍满状态)',
  },
  // —— 经济 ——
  {
    key: 'START_COINS', label: '出生金币', group: 'economy', type: 'int', min: 0, max: 1000,
    effect: 'spawn', desc: '新角色出生时的初始金币',
  },
  {
    key: 'SHOP_INITIAL_FOOD_STOCK', label: '商店初始食物存量', group: 'economy', type: 'int', min: 0, max: 50,
    effect: 'live', desc: '世界创建时每种货架食物的初始份数,售罄即止不再补货(采集/制作为长期食物来源);热调仅影响新世界,重启重建同样重置',
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
    key: 'CHAT_SCORE', label: '聊天得分收益', group: 'social', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '单次聊天的基础得分增益(×递减档×相性,负相性不扣分)',
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
