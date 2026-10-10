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
  SOCIAL_CHAT_DISTANCE,
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
  VITAL_MAX: number;
  IDLE_ENERGY_DECAY: number;
  /** 出生初始金币与预付租金天数(M3.6f 出生即租住公寓) */
  START_COINS: number;
  SPAWN_PREPAID_DAYS: number;
  /** 商店初始食物存量(食物经济 2026-10-07,数值文档 §3.2): 每货架食物份数,
   * 世界创建/重启重建时初始化;E1 起供给主渠道=居民卖货(sell_item),每日小额补货仅兜底 */
  SHOP_INITIAL_FOOD_STOCK: number;
  /** 每日兜底补货份数(E1 生产经济):日翻转时每货架食物补货,封顶初始存量;0=不补 */
  SHOP_RESTOCK_DAILY: number;
  /** 商店收购价折率(E1):sell_item 卖出价=售价×该值 */
  SELL_RATE: number;
  /** 贫困生存阀(E1):金币低于线且体力高于线的空闲角色按人设倾向选收入岗/卖货 */
  POVERTY_COIN_LINE: number;
  POVERTY_MIN_ENERGY: number;
  /** 生存链路加固(E4):进食线提前于健康扣减线留缓冲;直采触发下界;
   * 采食自救接单豁免线(饿死边缘摘果子不该被体力闸拦);两段式转直发的距离 */
  HUNGER_EAT_ENERGY: number;
  FORAGE_MIN_ENERGY: number;
  FORAGE_EXEMPT_ENERGY: number;
  FORAGE_MOVE_THRESHOLD: number;
  /** 快照数值保留小数位(协议序列化口径) */
  SNAPSHOT_DECIMALS: number;
  /** 携带/囤粮体积上限(M3.6g,数值文档 §3.2):背包随身,冰箱家中存取 */
  BACKPACK_VOLUME_LIMIT: number;
  FRIDGE_VOLUME_LIMIT: number;
  /** 体力区段(M3.6f):≤阈值只允许基础活动(rest/stroll/meal) */
  LOW_ENERGY_THRESHOLD: number;
  /** Lab 复活(debug 通道)恢复的满状态数值 */
  REVIVE_ENERGY: number;
  /** 睡眠(M-G.2,数值文档 §2.7): 缺觉阈值(昨夜窗口累计分钟,低于即于 06:00 结算惩罚)
   * 与缺觉日正收益系数(金币/得分/产出乘该值) */
  SLEEP_MIN_MINUTES: number;
  /** 白天反思触发阈值(10-cognition §5): 未固化记忆 importance 累计达到即触发一次反思(去 dream 段) */
  REFLECTION_IMPORTANCE_THRESHOLD: number;
  /** 情绪半衰期(10-cognition §4.4): valence 冲量按 0.5^(经历游戏分钟/该值) 衰减,4 游戏时减半 */
  MOOD_HALF_LIFE_MINUTES: number;
  /** 事件强度门(10-cognition §7.1 ②③): importance≥STRONG 才可能打断忙碌角色
   * (空闲低强度走既有 rule→plan 管线);low 容忍度活动仅 importance≥DECISIVE 才评估 */
  EVENT_RESPONSE_STRONG: number;
  EVENT_RESPONSE_DECISIVE: number;
  /** 事件响应预算(10-cognition §7.1): 每角色每日中断评估(⑤ systemOne)次数上限+评估冷却 */
  EVENT_RESPONSE_DAILY_BUDGET: number;
  EVENT_RESPONSE_COOLDOWN_MINUTES: number;
  SLEEP_DEBT_MULTIPLIER: number;
  /** 累倒苏醒扣分(numerical §2.3/§2.5): growth 送医窗口超时苏醒 score ×= (1 - 该值);救治免扣 */
  SCORE_WAKE_DEDUCTION: number;
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
  CHAT_SCORE: number;
  /** 每游戏日「有收益」次数(超出不拒绝,收益 ×0);第 n 次收益 ×STEPS[n-1](六档 Σ2.6,数值文档 §6.2) */
  CHAT_DAILY_GAINED: number;
  CHAT_DECAY_STEPS: readonly number[];
  /** 闲聊同处一地距离(曼哈顿;双端同源常量,原 PRESENCE 更名) */
  SOCIAL_CHAT_DISTANCE: number;
  /** 自然终止多轮对话(E3):单场对话最多句数;每轮 light 调用搭终止信号,零额外调用 */
  CHAT_MAX_ROUNDS: number;
  /** 熟悉度每日衰减(世界日翻转时结算) */
  FAMILIARITY_DECAY_PER_DAY: number;
  /** 自治社交动机(10-cognition §7.2 C4): 欲望分点火线/同对聊天冷却(游戏分钟)/
   * 每角色每日主动上限/走散重试短冷却(E2 走散不罚) */
  SOCIAL_DESIRE_FIRE: number;
  SOCIAL_PAIR_COOLDOWN_MINUTES: number;
  SOCIAL_DAILY_INITIATE_CAP: number;
  SOCIAL_RETRY_COOLDOWN_MINUTES: number;
  /** 会合协议(E6.2 两阶段聊天): 召唤 want 紧迫度/召唤 want 半衰期(对方一直没空
   * 自然消退)/发起方放弃窗口(超时=被放鸽子,会合回收,零 token) */
  SOCIAL_SUMMON_URGENCY: number;
  SOCIAL_SUMMON_TTL_MINUTES: number;
  SOCIAL_SUMMON_GIVE_UP_MINUTES: number;
  /** jev 冲动 want(E6 统一意图架构):System 1 产出的紧迫度/半衰期(游戏分钟)/
   * confidence 门(低于视为没产生直觉,忽略本次) */
  JEV_IMPULSE_URGENCY: number;
  JEV_IMPULSE_TTL_MINUTES: number;
  JEV_CONFIDENCE_MIN: number;
  /** 驱力 want(E6.2 rule→驱力):恒稳态压力→urgency,执行归 wantSelect 分支。
   * 进食随亏空爬坡(base+scale×亏空比,压过夜间睡眠保先吃);直采=饥饿逃生档;
   * 谋生固定档;睡眠夜间压过 plan/白天让位;半衰期统一(压力在,巡检重发) */
  DRIVE_EAT_URGENCY_BASE: number;
  DRIVE_EAT_URGENCY_SCALE: number;
  DRIVE_FORAGE_URGENCY: number;
  DRIVE_EARN_URGENCY: number;
  DRIVE_SLEEP_NIGHT_URGENCY: number;
  DRIVE_SLEEP_DAY_URGENCY: number;
  DRIVE_TTL_MINUTES: number;
  /** 事件 want(E6.2 respond→冲动):响应注册表产出 intent 改 want——
   * 救人查看档+好感加权(关心的人多赶一分),道谢走 socialize 赴约档 */
  EVENT_WANT_RESCUE_URGENCY: number;
  EVENT_WANT_THANKS_URGENCY: number;
  EVENT_WANT_URGENCY_AFFINITY_SCALE: number;
  EVENT_WANT_TTL_MINUTES: number;
  /** 共处破冰(D1):同场所陌生对共处累计满阈值分钟自动相识;每世界每日建交上限防速熟;初识熟悉度 */
  ACQUAINTANCE_THRESHOLD_MINUTES: number;
  ACQUAINTANCE_DAILY_CAP: number;
  ACQUAINTANCE_FAMILIARITY: number;
  /** 弹性意图择行(D3):数值需求增益——金币低工作需求×1.5/高×0.6,体力低休息就餐×1.4,知识低学习×1.3 */
  WANT_WORK_COIN_PRESSURE: number;
  WANT_WORK_COIN_SATIETY: number;
  WANT_TIRED_ENERGY: number;
  WANT_KNOWLEDGE_LOW: number;
  /** 执行契约(E6.3):曾被选中(doing)=在契,空闲重评走「挑战者 vs 在位者」——挑战者
   * 评分须达在位者×此比例才许插队,否则在契者免评续做;抢占仍纯评分裁决(E6 哲学),
   * 只是把「更高分」从隐含 1.01 倍显式为比例阈值 */
  WANT_SEIZE_RATIO: number;
  /** 困倦压力(D3,纯数值替代 planNight 时间表):夜间/白天开始犯困的体力线,越困越想睡 */
  SLEEPY_NIGHT_ENERGY: number;
  SLEEPY_DAY_ENERGY: number;
  /** 记忆评价(D4):重要活动轻槽 LLM 一句话复盘的每角色每日上限,超限回模板句 */
  RETROSPECT_MAX_PER_DAY: number;
  /** 资源节点存量上限(04 §5.4 表值=出厂默认;junk -1=无限不枯竭) */
  NODE_MAX_CHARGES_BERRY: number;
  NODE_MAX_CHARGES_JUNK: number;
  NODE_MAX_CHARGES_TREE: number;
  NODE_MAX_CHARGES_ROCK: number;
  NODE_MAX_CHARGES_METAL: number;
  NODE_MAX_CHARGES_APPLE: number;
  NODE_MAX_CHARGES_WHEAT: number;
  /** 采竭节点回满所需天数(次日 00:00 计) */
  NODE_RESPAWN_DAYS: number;
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
  VITAL_MAX: 100,
  IDLE_ENERGY_DECAY: 0.02,
  START_COINS: 0,
  SPAWN_PREPAID_DAYS: 1,
  SHOP_INITIAL_FOOD_STOCK: 3,
  SHOP_RESTOCK_DAILY: 1,
  SELL_RATE: 0.6,
  POVERTY_COIN_LINE: 12,
  POVERTY_MIN_ENERGY: 35, // E4: 45→35,进食线提前到 30 后刚脱离饥饿区即可谋收入
  HUNGER_EAT_ENERGY: 30,
  FORAGE_MIN_ENERGY: 6,
  FORAGE_EXEMPT_ENERGY: 5,
  FORAGE_MOVE_THRESHOLD: 2,
  SNAPSHOT_DECIMALS: 1,
  BACKPACK_VOLUME_LIMIT,
  FRIDGE_VOLUME_LIMIT,
  LOW_ENERGY_THRESHOLD,
  REVIVE_ENERGY: 100,
  SLEEP_MIN_MINUTES: 240,
  REFLECTION_IMPORTANCE_THRESHOLD: 80,
  MOOD_HALF_LIFE_MINUTES: 240,
  EVENT_RESPONSE_STRONG: 6,
  EVENT_RESPONSE_DECISIVE: 8,
  EVENT_RESPONSE_DAILY_BUDGET: 4,
  EVENT_RESPONSE_COOLDOWN_MINUTES: 30,
  SLEEP_DEBT_MULTIPLIER: 0.7,
  SCORE_WAKE_DEDUCTION: 0.2,
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
  CHAT_SCORE: 2,
  CHAT_DAILY_GAINED,
  CHAT_DECAY_STEPS: [1, 0.6, 0.4, 0.3, 0.2, 0.1],
  SOCIAL_CHAT_DISTANCE,
  CHAT_MAX_ROUNDS: 4,
  FAMILIARITY_DECAY_PER_DAY: 1,
  // 0.35=放宽点火线(E2): 初识可达线降至 0.55,更多对子过线;熟客靠久未聊回升
  SOCIAL_DESIRE_FIRE: 0.35,
  SOCIAL_PAIR_COOLDOWN_MINUTES: 30,
  SOCIAL_DAILY_INITIATE_CAP: 8,
  SOCIAL_RETRY_COOLDOWN_MINUTES: 10,
  // E6.2 会合协议:召唤 want 紧迫度 0.9(赴约档——应答通常压过日常安排,但可被更高
  // 评分让位=婉拒);半衰 90 分(对方一直没空,召唤自然消退);发起方 120 分放弃
  // (>半衰,对方彻底没来即收,驱力日后可再点火)
  SOCIAL_SUMMON_URGENCY: 0.9,
  SOCIAL_SUMMON_TTL_MINUTES: 90,
  SOCIAL_SUMMON_GIVE_UP_MINUTES: 120,
  // E6:冲动紧迫度 0.3——低于 plan want 常规档,直觉让位计划但能被概率采样放大;
  // 半衰期 120 游戏分(冲动会消退);置信门 0.35(低置信兜底不产出冲动)
  JEV_IMPULSE_URGENCY: 0.3,
  JEV_IMPULSE_TTL_MINUTES: 120,
  JEV_CONFIDENCE_MIN: 0.35,
  // E6.2 rule→驱力:压力→urgency 评分竞争,不再直执——
  // 进食 0.75+亏空爬坡 ≤0.95(饿得越狠越压过一切);直采 0.8(店买不到的逃生档);
  // 谋生 0.7(贫困档,可被高优 plan 让位);睡 0.85 夜/0.7 昼(夜间压过计划,
  // 白天犯困让位要事);半衰 90 分,压力持续则巡检重发
  DRIVE_EAT_URGENCY_BASE: 0.75,
  DRIVE_EAT_URGENCY_SCALE: 0.2,
  DRIVE_FORAGE_URGENCY: 0.8,
  DRIVE_EARN_URGENCY: 0.7,
  DRIVE_SLEEP_NIGHT_URGENCY: 0.85,
  DRIVE_SLEEP_DAY_URGENCY: 0.7,
  DRIVE_TTL_MINUTES: 90,
  // E6.2 respond→冲动 want:救人查看 0.85+好感/100×0.1(陌生人也看,挚友飞奔);
  // 获救道谢 0.9 走 socialize(经 S1 会合协议当面聊);半衰 60 分(人没救到/已散场自然消退)
  EVENT_WANT_RESCUE_URGENCY: 0.85,
  EVENT_WANT_THANKS_URGENCY: 0.9,
  EVENT_WANT_URGENCY_AFFINITY_SCALE: 0.1,
  EVENT_WANT_TTL_MINUTES: 60,
  ACQUAINTANCE_THRESHOLD_MINUTES: 120,
  ACQUAINTANCE_DAILY_CAP: 2,
  ACQUAINTANCE_FAMILIARITY: 5,
  WANT_WORK_COIN_PRESSURE: 30,
  WANT_WORK_COIN_SATIETY: 150,
  WANT_TIRED_ENERGY: 50,
  WANT_KNOWLEDGE_LOW: 30,
  WANT_SEIZE_RATIO: 1.4,
  SLEEPY_NIGHT_ENERGY: 60,
  SLEEPY_DAY_ENERGY: 25,
  RETROSPECT_MAX_PER_DAY: 4,
  NODE_MAX_CHARGES_BERRY: 3,
  NODE_MAX_CHARGES_JUNK: -1,
  NODE_MAX_CHARGES_TREE: 5,
  NODE_MAX_CHARGES_ROCK: 4,
  NODE_MAX_CHARGES_METAL: 3,
  NODE_MAX_CHARGES_APPLE: 4,
  NODE_MAX_CHARGES_WHEAT: 3,
  NODE_RESPAWN_DAYS: 1,
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
