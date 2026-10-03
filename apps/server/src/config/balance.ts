/**
 * 游戏平衡数值(分层规则 §4-2):tick 时长/时间倍率档位/昼夜时刻等。
 * 只放数值,不放逻辑;需后台热调的项后续落 sys 域并经 admin-api 暴露。
 */
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
} as const;
