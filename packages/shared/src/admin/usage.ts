import type { ModelSlot } from './model-config.js';

/** token 用量统计窗口 */
export const TOKEN_USAGE_WINDOWS = ['today', '7d', '30d', 'all'] as const;

export type TokenUsageWindow = (typeof TOKEN_USAGE_WINDOWS)[number];

export const TOKEN_USAGE_WINDOW_LABELS: Record<TokenUsageWindow, string> = {
  today: '今日',
  '7d': '近 7 日',
  '30d': '近 30 日',
  all: '全部',
};

/** 一组调用的 token 汇总(prompt+completion 分列) */
export interface TokenUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

/** 单次模型调用流水视图(明细表/单次大头共用) */
export interface TokenUsageCallView {
  id: string;
  slot: ModelSlot;
  taskType: string;
  characterId: string | null;
  characterName: string | null;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
}

/** GET /api/admin/token-usage/summary?window= 响应 */
export interface TokenUsageSummary {
  window: TokenUsageWindow;
  /** 趋势桶(今日按小时/其余按天,服务端补零到连续) */
  trend: Array<{ bucket: string; totalTokens: number; calls: number }>;
  kpi: TokenUsageTotals & {
    /** 平均单次 tokens(1 位小数) */
    avgTokensPerCall: number;
    /** completion 占比 0~1(生成密度信号) */
    completionShare: number;
    /** 窗口内产生过消耗的角色数(不含无角色的系统调用) */
    activeCharacters: number;
  };
  bySlot: Array<TokenUsageTotals & { slot: ModelSlot }>;
  byTaskType: Array<TokenUsageTotals & { taskType: string }>;
  byCharacter: Array<TokenUsageTotals & { characterId: string | null; name: string | null }>;
  /** 单次消耗大头 top5(发现 prompt 膨胀类异常) */
  topCalls: TokenUsageCallView[];
}

/** GET /api/admin/token-usage/entries 响应(明细流水分页) */
export interface TokenUsageEntriesResponse {
  total: number;
  page: number;
  pageSize: number;
  entries: TokenUsageCallView[];
}
