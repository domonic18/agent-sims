/**
 * 世界生命周期管理协议(M3.6k):后台创建/关闭/删除世界,替代 debug 脚本开荒。
 * 架构为"单活跃世界+归档":同时至多一个 active 世界,创建新世界时旧的转 closed。
 */
import type { GameType, WorldgenParams, WorldgenReport } from './worldgen.js';

/** 性别:v1 为数据字段(入库+快照),暂不影响外观(精灵无性别素材) */
export const GENDERS = ['male', 'female', 'unspecified'] as const;

export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  male: '男',
  female: '女',
  unspecified: '不限',
};

/** 特质向量 v0(social-design §相性):0~1 五维,与 TraitVector 同型;配置可覆盖出生随机值 */
export const TRAIT_KEYS = [
  'ambition',
  'hedonism',
  'homebody',
  'sociability',
  'frugality',
] as const;

export type TraitKey = (typeof TRAIT_KEYS)[number];

export const TRAIT_LABELS: Record<TraitKey, string> = {
  ambition: '雄心',
  hedonism: '享乐',
  homebody: '宅',
  sociability: '社交',
  frugality: '节俭',
};

/** 世界人物配置:name/gender/traits 生效(traits 覆盖出生随机值,供相性计算);persona/modelSlot 只存不生效 */
export interface WorldCharacterConfig {
  name: string;
  gender: Gender;
  traits?: Partial<Record<TraitKey, number>>;
  /** 人设卡自由文本(未来 LLM 访谈产出),预留 */
  persona?: string;
  /** 绑定模型槽(model_configs.slot),预留 */
  modelSlot?: string;
}

export const WORLD_CHARACTER_LIMITS = { min: 1, max: 12 } as const;

/** 世界初始时间倍率档位(与 server TIME_SCALES 同源;rules 随世界定格,不改运行中倍率) */
export const WORLD_TIME_SCALES = [1, 4, 16] as const;

export type WorldTimeScale = (typeof WORLD_TIME_SCALES)[number];

/** 世界规则(M5):创建世界时一次性配置,随世界快照定格;旧世界无 rules 时兜底默认值 */
export interface WorldRules {
  /** 允许死亡:关闭后体力可归 0 但不转幽灵(躺平) */
  allowDeath: boolean;
  /** 允许角色间聊天:关闭后 chat 意图直接被世界规则拒绝 */
  allowChat: boolean;
  /** 创建世界时的初始时间倍率 */
  initialTimeScale: WorldTimeScale;
  /** 世界参数(键=balance.ts 目录键,缺省=BALANCE_DEFAULTS);Lab 调试台改参后回写 */
  params?: Record<string, number>;
}

export const DEFAULT_WORLD_RULES: WorldRules = {
  allowDeath: true,
  allowChat: true,
  initialTimeScale: 1,
};

/**
 * 运行时规则视图(world.rules 事件与设置通道携带;不含 params)。
 * initialTimeScale 为宽类型:wire 值恒来自 sim.rules(创建时已约束档位),
 * 运行档位变更走 timeScale 字段,本视图不承担创建期档位约束。
 */
export type WorldRulesView = {
  allowDeath: boolean;
  allowChat: boolean;
  initialTimeScale: number;
};

/** GET/POST /api/world/settings 响应(游戏内设置菜单与 Lab 共用的常开控制通道) */
export interface WorldSettingsView {
  paused: boolean;
  timeScale: number;
  params: Record<string, number>;
  rules: WorldRulesView;
}

/** POST /api/admin/worlds 请求体 */
/** 世界生成配置(缺省=内置固定地图;seed 为随机数数字串,同数复现同图) */
export interface WorldgenConfig {
  /** 十进制随机数串(1~10 位);服务端缺省自动生成 */
  seed?: string;
  gameType: GameType;
  params: WorldgenParams;
}

export interface CreateWorldRequest {
  name: string;
  characters: WorldCharacterConfig[];
  rules?: WorldRules;
  /** 随机世界生成配置;省略即内置固定地图 */
  worldgen?: WorldgenConfig;
}

/** 世界记录视图(GET /api/admin/worlds 列表元素) */
export interface WorldView {
  id: string;
  name: string;
  status: 'active' | 'closed';
  characters: WorldCharacterConfig[];
  rules: WorldRules;
  /** 生成配置(随机世界携带;固定地图省略) */
  worldgen?: Required<Pick<WorldgenConfig, 'seed' | 'gameType'>> & { params: WorldgenParams };
  /** 生成报告(场所清单/校验,创建时落档) */
  worldgenReport?: WorldgenReport;
  createdAt: string;
  closedAt: string | null;
}

/** dry-run 生成预览(POST /api/admin/worlds/preview,不落库) */
export interface WorldPreviewResponse {
  report: WorldgenReport;
  /** 拟出生点前 3 个(示意) */
  spawnSamples: ReadonlyArray<readonly [number, number]>;
}

/** 世界生命周期端点(admin 鉴权同模型配置) */
export const WORLD_ADMIN_API = {
  /** GET 列表 / POST 创建 */
  worlds: '/api/admin/worlds',
  /** POST 生成预览(dry-run,不落库) */
  worldPreview: '/api/admin/worlds/preview',
  /** POST 关闭(暂停+归档) */
  worldClose: '/api/admin/worlds/:id/close',
  /** DELETE 删除记录(人物级联清理) */
  world: '/api/admin/worlds/:id',
} as const;

const NAME_POOLS: Record<Exclude<Gender, 'unspecified'>, string[]> = {
  male: [
    '阿泽', '建安', '子谦', '沈砚', '陆离', '江野', '顾北', '林深',
    '周牧', '韩铮', '方屿', '程一', '秦朗', '许崇', '唐启', '冯遥',
    '曹默', '邓川', '蒋澈', '杨逍', '傅岩', '邱桐', '蒋翼', '郑拓',
  ],
  female: [
    '苏晚', '林溪', '沈知', '顾影', '白露', '江离', '温宁', '叶蓁',
    '许安', '姜妤', '秦桑', '陆萤', '唐薇', '孟夏', '傅锦', '韩霜',
    '曹颖', '蒋纯', '杨柳', '邱灵', '邓蔓', '冯橙', '周棠', '郑洁',
  ],
};

/** 随机抽一个中文名(表单内去重;池耗尽回退数字后缀) */
export function pickRandomName(gender: Gender, exclude: Iterable<string> = []): string {
  const used = new Set(exclude);
  const pool =
    gender === 'unspecified'
      ? [...NAME_POOLS.male, ...NAME_POOLS.female]
      : NAME_POOLS[gender];
  const available = pool.filter((name) => !used.has(name));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)]!;
  }
  const base = pool[Math.floor(Math.random() * pool.length)]!;
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}
