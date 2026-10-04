/**
 * 游戏平衡数值(分层规则 §4-2):tick 时长/时间倍率档位/昼夜时刻等。
 * 只放数值,不放逻辑;需后台热调的项后续落 sys 域并经 admin-api 暴露。
 * 双端消费项(移速/容积/低体力阈值)从 @sims/shared 引用,web 展示同源(M3.6h)。
 */
import {
  BACKPACK_VOLUME_LIMIT,
  FRIDGE_VOLUME_LIMIT,
  LOW_ENERGY_THRESHOLD,
  WALK_SPEED_TILES_PER_TICK,
} from '@sims/shared';

export const BALANCE = {
  /** 1x 下每 tick 现实毫秒数:1 现实秒 = 1 游戏分钟 */
  TICK_MS: 1000,
  /** 实时驱动器泵间隔(真实定时器粒度,tick 换算在此粒度上累加) */
  DRIVER_SLICE_MS: 100,
  /** 单次泵最大补跑 tick 数(进程挂起后防止猛追) */
  MAX_CATCHUP_TICKS: 600,
  /** 时间倍率档位(1 tick 恒为 1 游戏分钟,倍率加快 tick 频率) */
  TIME_SCALES: [1, 4, 16] as const,
  DEFAULT_TIME_SCALE: 1,
  /** 游戏日历:1 游戏日 = 1440 游戏分钟;纪元为第 1 日 08:00 */
  DAY_MINUTES: 1440,
  START_DAY: 1,
  START_MINUTE_OF_DAY: 480,
  /** 昼夜判定:22:00~次日 06:00 为夜 */
  NIGHT_START_MINUTE: 22 * 60,
  NIGHT_END_MINUTE: 6 * 60,
  /** 步行速度:格/游戏分钟(寻路路径按此逐 tick 推进;M3.6g 提速 1→2) */
  WALK_SPEED_TILES_PER_MINUTE: WALK_SPEED_TILES_PER_TICK,
  /** 数值系统:角色初始满值与各数值上限;M3.6g 净速率模型——仅待机走基础代谢衰减,
   * 活动期间走活动净速率(shared activities.ts / REST_RATES_BY_KIND),两者不叠加 */
  START_ENERGY: 100,
  START_HAPPINESS: 100,
  VITAL_MAX: 100,
  IDLE_ENERGY_DECAY: 0.02,
  IDLE_HAPPINESS_DECAY: 0.015,
  /** 出生初始金币与预付租金天数(M3.6f 出生即租住公寓) */
  START_COINS: 0,
  SPAWN_PREPAID_DAYS: 1,
  /** 快照数值保留小数位(协议序列化口径) */
  SNAPSHOT_DECIMALS: 1,
  /** 携带/囤粮体积上限(M3.6g,数值文档 §3.2):背包随身,冰箱家中存取 */
  BACKPACK_VOLUME_LIMIT,
  FRIDGE_VOLUME_LIMIT,
  /** 体力区段(M3.6f):≤阈值只允许基础活动(rest/stroll/meal),≤0 死亡转幽灵态 */
  LOW_ENERGY_THRESHOLD,
  /** Lab 复活(debug 通道)恢复的满状态数值 */
  REVIVE_ENERGY: 100,
  REVIVE_HAPPINESS: 80,
  /** 繁荣分死亡扣减(M3.6j,goal-design §7 方案B): 死亡时 lifeScore ×= (1 - 该值) */
  LIFE_SCORE_DEATH_DEDUCTION: 0.2,
  /** 世界创建批量出生点(M3.6k):公寓门前广场开阔带,按序轮询;不可行走时跳过 */
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
  ] as const,
} as const;
