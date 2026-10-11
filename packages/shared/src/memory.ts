/** 记忆面板与检索视图(M4b §5.3/§5.6):content 为真相源,向量只作检索索引不下发 */

export const MEMORY_TYPES = ['event', 'insight', 'dream', 'dialogue'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  event: '事件',
  insight: '洞察',
  dream: '梦境',
  dialogue: '对话',
};

/** 对话记忆结构化元数据(dialogue 类可选): lines=交替台词原句,与 social.chat 事件 lines
 * 同源同序(偶数位=发起者=记忆属主,先说);空数组=无台词的叙述性对话(结交/初识),
 * 届时展示 content 转述句。旧数据无此字段,前端回退整条转述泡。 */
export interface MemoryChatMeta {
  otherId: string;
  lines: string[];
}

/** 单条记忆;score/factors 仅检索模式返回(recency/importance/relevance 归一化明细);
 * sourceIds/sources 仅 insight 类返回(溯源链: 引用的情景记忆 id 与原文,≤8 条);
 * chat 仅 dialogue 类返回(对话方与台词的结构化元数据) */
export interface MemoryPanelItem {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  gameMinutes: number | null;
  createdAt: string;
  score?: number;
  factors?: { recency: number; importance: number; relevance: number | null };
  sourceIds?: string[];
  sources?: string[];
  chat?: MemoryChatMeta;
}

export interface MemoryPanelResponse {
  characterId: string;
  name: string;
  mode: 'recent' | 'search';
  /** 降级说明(如 embedding 槽不可用回退双因子排序);正常为 null */
  notice: string | null;
  items: MemoryPanelItem[];
}

/** 关系印象(10-cognition §4.2): 对某熟人的第一人称叙事印象,定点覆盖更新 */
export interface MemoryImpressionItem {
  aboutId: string;
  aboutName: string;
  content: string;
  gameMinutes: number | null;
  updatedAt: string;
}

export interface MemoryImpressionsResponse {
  characterId: string;
  name: string;
  items: MemoryImpressionItem[];
}

/** 情绪(C2,10-cognition §4.4): 冲量流水与衰减后的当前态(面板/访谈间接观测,不进快照) */
export interface MoodPoint {
  gameMinutes: number | null;
  delta: number;
  labels: string[];
  createdAt: string;
}

export interface MoodCurrent {
  valence: number;
  labels: string[];
  since: number | null;
}

export interface CharacterMoodResponse {
  characterId: string;
  name: string;
  current: MoodCurrent;
  history: MoodPoint[];
}
