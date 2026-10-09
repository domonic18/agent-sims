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

export const SYS_CONFIG_GROUPS = ['time', 'vitals', 'economy', 'social', 'resources'] as const;

export type SysConfigGroup = (typeof SYS_CONFIG_GROUPS)[number];

export const SYS_CONFIG_GROUP_LABELS: Record<SysConfigGroup, string> = {
  time: '昼夜与时间',
  vitals: '体力与生存',
  economy: '经济',
  social: '社交',
  resources: '资源与刷新',
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
  {
    key: 'SHOP_RESTOCK_DAILY', label: '商店每日补货', group: 'economy', type: 'int', min: 0, max: 50,
    effect: 'live', desc: '日翻转时每种货架食物补货份数(封顶初始存量);0=不补货——供给主渠道为居民采集制作后卖入商店,此值仅防死锁兜底',
  },
  {
    key: 'SELL_RATE', label: '商店收购价折率', group: 'economy', type: 'float', min: 0, max: 1, step: 0.05,
    effect: 'live', desc: 'sell_item 卖出价=售价×该折率(0.6=六折收购),金币即时入袋、货架余量+1',
  },
  {
    key: 'POVERTY_COIN_LINE', label: '贫困线金币', group: 'economy', type: 'int', min: 0, max: 100,
    effect: 'live', desc: '金币低于该值的空闲角色触发 rulePoverty 生存阀:按人设倾向选收入岗(服务/杂工)或卖掉背包货物',
  },
  {
    key: 'POVERTY_MIN_ENERGY', label: '贫困线体力', group: 'economy', type: 'int', min: 0, max: 100,
    effect: 'live', desc: 'rulePoverty 要求的最低体力(低于则交棒休息/睡眠压力,不硬派岗)',
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
  {
    key: 'SOCIAL_DESIRE_FIRE', label: '社交点火线', group: 'social', type: 'float', min: 0, max: 1, step: 0.05,
    effect: 'live', desc: '动机引擎欲望分达到该值的候选才主动搭话(0.7=熟人+久未聊即可)',
  },
  {
    key: 'SOCIAL_PAIR_COOLDOWN_MINUTES', label: '同对聊天冷却', group: 'social', type: 'int', min: 0, max: 720,
    effect: 'live', desc: '同一对角色两次聊天的最小间隔(游戏分钟),防 Agent 高频刷同一个人',
  },
  {
    key: 'SOCIAL_DAILY_INITIATE_CAP', label: '每日主动上限', group: 'social', type: 'int', min: 0, max: 50,
    effect: 'live', desc: '每角色每日主动发起聊天的次数上限(全部对象合计),0=不限制',
  },
  // —— 资源与刷新(采集节点存量/重生,04 §5.4 表值=出厂默认) ——
  {
    key: 'NODE_MAX_CHARGES_BERRY', label: '浆果丛存量', group: 'resources', type: 'int', min: 1, max: 99,
    effect: 'live', desc: '浆果丛可采集次数上限,采竭后按重生天数回满',
  },
  {
    key: 'NODE_MAX_CHARGES_JUNK', label: '拾荒堆存量', group: 'resources', type: 'int', min: -1, max: 99,
    effect: 'live', desc: '拾荒堆可采集次数上限;-1=无限(默认,不枯竭)',
  },
  {
    key: 'NODE_MAX_CHARGES_TREE', label: '树木存量', group: 'resources', type: 'int', min: 1, max: 99,
    effect: 'live', desc: '树木(生存)可采集次数上限',
  },
  {
    key: 'NODE_MAX_CHARGES_ROCK', label: '岩石存量', group: 'resources', type: 'int', min: 1, max: 99,
    effect: 'live', desc: '岩石(生存)可采集次数上限',
  },
  {
    key: 'NODE_MAX_CHARGES_METAL', label: '金属堆存量', group: 'resources', type: 'int', min: 1, max: 99,
    effect: 'live', desc: '金属堆(生存)可采集次数上限',
  },
  {
    key: 'NODE_MAX_CHARGES_APPLE', label: '苹果树存量', group: 'resources', type: 'int', min: 1, max: 99,
    effect: 'live', desc: '苹果树可采集次数上限',
  },
  {
    key: 'NODE_MAX_CHARGES_WHEAT', label: '麦丛存量', group: 'resources', type: 'int', min: 1, max: 99,
    effect: 'live', desc: '麦丛可采集次数上限',
  },
  {
    key: 'NODE_RESPAWN_DAYS', label: '节点重生天数', group: 'resources', type: 'int', min: 1, max: 7,
    effect: 'live', desc: '采竭节点回满所需天数(次日 00:00 计),1=次日回满',
  },
];

/** GET /api/admin/sys-config 响应 */
export interface SysConfigView {
  fields: readonly SysConfigField[];
  defaults: Record<string, number>;
  overrides: Record<string, number>;
  effective: Record<string, number>;
}
