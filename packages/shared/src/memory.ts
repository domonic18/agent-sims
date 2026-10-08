/** 记忆面板与检索视图(M4b §5.3/§5.6):content 为真相源,向量只作检索索引不下发 */

export const MEMORY_TYPES = ['event', 'insight', 'dream', 'dialogue'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  event: '事件',
  insight: '洞察',
  dream: '梦境',
  dialogue: '对话',
};

/** 单条记忆;score/factors 仅检索模式返回(recency/importance/relevance 归一化明细) */
export interface MemoryPanelItem {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  gameMinutes: number | null;
  createdAt: string;
  score?: number;
  factors?: { recency: number; importance: number; relevance: number | null };
}

export interface MemoryPanelResponse {
  characterId: string;
  name: string;
  mode: 'recent' | 'search';
  /** 降级说明(如 embedding 槽不可用回退双因子排序);正常为 null */
  notice: string | null;
  items: MemoryPanelItem[];
}
