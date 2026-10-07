/**
 * 游戏平衡数值(分层规则 §4-2):tick 时长/时间倍率档位/昼夜时刻等。
 * 只放数值,不放逻辑。
 *
 * 热调分层(M4f 后台重构):
 * - 本文件仅收录 server-only 数值;BALANCE 为可变运行时持有者,参数已世界化:
 *   创建世界时 applyWorldParams 应用 config.rules.params,运行中经
 *   /api/world/settings 常开通道热调(全仓库均为 BALANCE.X 属性访问,无解构)。
 * - 双端同源常量(移速/容积/低体力阈值/聊天日上限,web 展示同源)与时序基建
 *   (TICK_MS/DRIVER_SLICE_MS/DAY_MINUTES 等,改动需重启驱动器或破坏时钟纪元)
 *   不开放热调,仍在 @sims/shared 或下方常量冻结。
 */
import {
  BACKPACK_VOLUME_LIMIT,
  CHAT_DAILY_GAINED,
  FRIDGE_VOLUME_LIMIT,
  LOW_ENERGY_THRESHOLD,
  SOCIAL_PRESENCE_DISTANCE,
  SYS_CONFIG_FIELDS,
  WALK_SPEED_TILES_PER_TICK,
} from '@sims/shared';

/** 时间倍率档位(时序基建,不开放热调;debug 端点校验依赖此字面量类型) */
export const TIME_SCALES = [1, 4, 16] as const;

export interface BalanceConfig {
  /** 1x 下每 tick 现实毫秒数:1 现实秒 = 1 游戏分钟 */
  TICK_MS: number;
  /** 实时驱动器泵间隔(真实定时器粒度,tick 换算在此粒度上累加) */
  DRIVER_SLICE_MS: number;
  /** 单次泵最大补跑 tick 数(进程挂起后防止猛追) */
  MAX_CATCHUP_TICKS: number;
  TIME_SCALES: readonly number[];
  DEFAULT_TIME_SCALE: number;
  /** 游戏日历:1 游戏日 = 1440 游戏分钟;纪元为第 1 日 08:00 */
  DAY_MINUTES: number;
  START_DAY: number;
  START_MINUTE_OF_DAY: number;
  /** 昼夜判定:22:00~次日 06:00 为夜 */
  NIGHT_START_MINUTE: number;
  NIGHT_END_MINUTE: number;
  /** 步行速度:格/游戏分钟(寻路路径按此逐 tick 推进;M3.6g 提速 1→2) */
  WALK_SPEED_TILES_PER_MINUTE: number;
  /** 数值系统:角色初始满值与各数值上限;M3.6g 净速率模型——仅待机走基础代谢衰减,
   * 活动期间走活动净速率(shared activities.ts / REST_RATES_BY_KIND),两者不叠加 */
  START_ENERGY: number;
  START_HAPPINESS: number;
  VITAL_MAX: number;
  IDLE_ENERGY_DECAY: number;
  IDLE_HAPPINESS_DECAY: number;
  /** 出生初始金币与预付租金天数(M3.6f 出生即租住公寓) */
  START_COINS: number;
  SPAWN_PREPAID_DAYS: number;
  /** 快照数值保留小数位(协议序列化口径) */
  SNAPSHOT_DECIMALS: number;
  /** 携带/囤粮体积上限(M3.6g,数值文档 §3.2):背包随身,冰箱家中存取 */
  BACKPACK_VOLUME_LIMIT: number;
  FRIDGE_VOLUME_LIMIT: number;
  /** 体力区段(M3.6f):≤阈值只允许基础活动(rest/stroll/meal),≤0 死亡转幽灵态 */
  LOW_ENERGY_THRESHOLD: number;
  /** Lab 复活(debug 通道)恢复的满状态数值 */
  REVIVE_ENERGY: number;
  REVIVE_HAPPINESS: number;
  /** 睡眠(M-G.2,数值文档 §2.7): 缺觉阈值(昨夜窗口累计分钟,低于即于 06:00 结算惩罚)
   * 与缺觉日正收益系数(金币/产出/正幸福增益乘该值) */
  SLEEP_MIN_MINUTES: number;
  SLEEP_DEBT_MULTIPLIER: number;
  /** 繁荣分死亡扣减(M3.6j,goal-design §7 方案B): 死亡时 lifeScore ×= (1 - 该值) */
  LIFE_SCORE_DEATH_DEDUCTION: number;
  /** 生存健康(M-S/S1,仅 survival 模式生效): 体力低于饥饿线持续损耗健康,
   * 高于康复线自然恢复;健康归零触发重伤休整(复用幽灵态窗口),超时苏醒回恢复线 */
  SURVIVAL_HUNGER_ENERGY_LINE: number;
  SURVIVAL_HEALTH_DECAY_PER_MIN: number;
  SURVIVAL_HEALTH_RECOVER_LINE: number;
  SURVIVAL_HEALTH_RECOVER_PER_MIN: number;
  SURVIVAL_INJURY_REVIVE_HEALTH: number;
  /** 世界创建批量出生点(M3.6k):公寓门前广场开阔带,按序轮询;不可行走时跳过 */
  SPAWN_SPOTS: readonly Readonly<{ x: number; y: number }>[];
  /** 社交 v1(social-design/numerical-design §社交): chat 收益=基础值×递减×相性 */
  CHAT_FAMILIARITY_GAIN: number;
  CHAT_AFFINITY_BASE: number;
  CHAT_HAPPINESS: number;
  /** 每游戏日「有收益」次数(超出不拒绝,收益 ×0);第 n 次收益 ×STEPS[n-1](六档 Σ2.6,数值文档 §6.2) */
  CHAT_DAILY_GAINED: number;
  CHAT_DECAY_STEPS: readonly number[];
  /** 同场增益: 曼哈顿 ≤ 距离且双方都在活动,按人数给幸福/分(封顶计人数;距离常量双端同源) */
  SOCIAL_PRESENCE_DISTANCE: number;
  SOCIAL_PRESENCE_CAP: number;
  SOCIAL_PRESENCE_BONUS: number;
  /** 熟悉度每日衰减(世界日翻转时结算) */
  FAMILIARITY_DECAY_PER_DAY: number;
}

export const BALANCE: BalanceConfig = {
  TICK_MS: 1000,
  DRIVER_SLICE_MS: 100,
  MAX_CATCHUP_TICKS: 600,
  TIME_SCALES,
  DEFAULT_TIME_SCALE: 1,
  DAY_MINUTES: 1440,
  START_DAY: 1,
  START_MINUTE_OF_DAY: 480,
  NIGHT_START_MINUTE: 22 * 60,
  NIGHT_END_MINUTE: 6 * 60,
  WALK_SPEED_TILES_PER_MINUTE: WALK_SPEED_TILES_PER_TICK,
  START_ENERGY: 100,
  START_HAPPINESS: 100,
  VITAL_MAX: 100,
  IDLE_ENERGY_DECAY: 0.02,
  IDLE_HAPPINESS_DECAY: 0.015,
  START_COINS: 0,
  SPAWN_PREPAID_DAYS: 1,
  SNAPSHOT_DECIMALS: 1,
  BACKPACK_VOLUME_LIMIT,
  FRIDGE_VOLUME_LIMIT,
  LOW_ENERGY_THRESHOLD,
  REVIVE_ENERGY: 100,
  REVIVE_HAPPINESS: 80,
  SLEEP_MIN_MINUTES: 240,
  SLEEP_DEBT_MULTIPLIER: 0.7,
  LIFE_SCORE_DEATH_DEDUCTION: 0.2,
  SURVIVAL_HUNGER_ENERGY_LINE: 20,
  SURVIVAL_HEALTH_DECAY_PER_MIN: 0.03,
  SURVIVAL_HEALTH_RECOVER_LINE: 60,
  SURVIVAL_HEALTH_RECOVER_PER_MIN: 0.02,
  SURVIVAL_INJURY_REVIVE_HEALTH: 30,
  SPAWN_SPOTS: [
    { x: 8, y: 12 },
    { x: 9, y: 12 },
    { x: 10, y: 12 },
    { x: 11, y: 12 },
    { x: 8, y: 13 },
    { x: 9, y: 13 },
    { x: 10, y: 13 },
    { x: 11, y: 13 },
    { x: 12, y: 14 },
    { x: 13, y: 14 },
    { x: 12, y: 15 },
    { x: 13, y: 15 },
  ],
  CHAT_FAMILIARITY_GAIN: 6,
  CHAT_AFFINITY_BASE: 4,
  CHAT_HAPPINESS: 2,
  CHAT_DAILY_GAINED,
  CHAT_DECAY_STEPS: [1, 0.6, 0.4, 0.3, 0.2, 0.1],
  SOCIAL_PRESENCE_DISTANCE,
  SOCIAL_PRESENCE_CAP: 3,
  SOCIAL_PRESENCE_BONUS: 0.05,
  FAMILIARITY_DECAY_PER_DAY: 1,
};

/** 开放字段出厂默认快照(模块加载即固化,与 DB overrides 无关;sys-config GET 用) */
export const BALANCE_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(
  SYS_CONFIG_FIELDS.map((field) => [field.key, (BALANCE as unknown as Record<string, number>)[field.key]!]),
);

export interface BalanceOverrideError {
  key: string;
  reason: string;
}

/** 按 SYS_CONFIG_FIELDS 目录校验覆盖值(未知 key/类型/越界均拒);返回错误列表,空=全部合法 */
export function validateBalanceOverrides(overrides: Record<string, unknown>): BalanceOverrideError[] {
  const errors: BalanceOverrideError[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const field = SYS_CONFIG_FIELDS.find((f) => f.key === key);
    if (!field) {
      errors.push({ key, reason: '未知参数' });
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push({ key, reason: '必须为数字' });
      continue;
    }
    if (field.type === 'int' && !Number.isInteger(value)) {
      errors.push({ key, reason: '必须为整数' });
      continue;
    }
    if (value < field.min || value > field.max) {
      errors.push({ key, reason: `取值范围 ${field.min}~${field.max}` });
      continue;
    }
  }
  return errors;
}

/** 应用已通过 validateBalanceOverrides 的覆盖值(非法 key 静默跳过) */
export function applyBalanceOverrides(overrides: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (SYS_CONFIG_FIELDS.some((f) => f.key === key) && typeof value === 'number') {
      (BALANCE as unknown as Record<string, number>)[key] = value;
    }
  }
}

/** 当前生效参数全集(目录键→BALANCE 值;world.params 事件与设置通道 GET 用) */
export function currentWorldParams(): Record<string, number> {
  const balance = BALANCE as unknown as Record<string, number>;
  return Object.fromEntries(SYS_CONFIG_FIELDS.map((field) => [field.key, balance[field.key]!]));
}

/**
 * 世界参数应用(创建世界入口):先按出厂默认复位全部目录键再应用覆盖,天然清除
 * 上一世界的参数残留;缺省=纯复位。BALANCE 是进程内运行时持有者,世界记录
 * config.rules.params 才是存档真源。
 */
export function applyWorldParams(params?: Record<string, number>): void {
  for (const [key, value] of Object.entries(BALANCE_DEFAULTS)) {
    (BALANCE as unknown as Record<string, number>)[key] = value;
  }
  if (params) applyBalanceOverrides(params);
}
