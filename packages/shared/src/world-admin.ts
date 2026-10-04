/**
 * 世界生命周期管理协议(M3.6k):后台创建/关闭/删除世界,替代 debug 脚本开荒。
 * 架构为"单活跃世界+归档":同时至多一个 active 世界,创建新世界时旧的转 closed。
 */

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

/** POST /api/admin/worlds 请求体 */
export interface CreateWorldRequest {
  name: string;
  characters: WorldCharacterConfig[];
}

/** 世界记录视图(GET /api/admin/worlds 列表元素) */
export interface WorldView {
  id: string;
  name: string;
  status: 'active' | 'closed';
  characters: WorldCharacterConfig[];
  createdAt: string;
  closedAt: string | null;
}

/** 世界生命周期端点(admin 鉴权同模型配置) */
export const WORLD_ADMIN_API = {
  /** GET 列表 / POST 创建 */
  worlds: '/api/admin/worlds',
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
