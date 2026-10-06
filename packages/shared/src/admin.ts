import type { AssetAnimConfig, AssetStatus } from './asset-manifest.js';

/**
 * 后台模型槽位:五类模型(慢思考/轻量对话/Jev/视觉审核/embedding)的后台配置键,
 * model_configs.slot 与后台表单共用此枚举。
 */
export const MODEL_SLOTS = ['slow', 'light', 'jev', 'vision', 'embedding'] as const;

export type ModelSlot = (typeof MODEL_SLOTS)[number];

export const MODEL_SLOT_LABELS: Record<ModelSlot, string> = {
  slow: '慢思考 LLM',
  light: '轻量 LLM',
  jev: 'Jev(systemone)',
  vision: '视觉审核(多模态)',
  embedding: 'Embedding',
};

/**
 * 模型接入协议:openai=OpenAI 兼容(/chat/completions、/embeddings),
 * anthropic=Anthropic Messages(/v1/messages),
 * systemone=Jev 原生(/systemone,类型化问答 choice/score/noul)。
 */
export const MODEL_PROTOCOLS = ['openai', 'anthropic', 'systemone'] as const;

export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number];

export const MODEL_PROTOCOL_LABELS: Record<ModelProtocol, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  systemone: 'Jev 原生(SystemOne)',
};

/** 槽位×协议矩阵(协议按用途锁定,ai-invest 同款交互):embedding 无对话形态,jev 双轨 */
export const MODEL_SLOT_PROTOCOLS: Record<ModelSlot, readonly ModelProtocol[]> = {
  slow: ['openai', 'anthropic'],
  light: ['openai', 'anthropic'],
  jev: ['openai', 'systemone'],
  vision: ['openai', 'anthropic'],
  embedding: ['openai'],
};

/** Base URL 约定:填到版本段为止,探测路径由协议决定 */
export const MODEL_PROTOCOL_BASE_URL_HINT: Record<ModelProtocol, string> = {
  openai: '填到 /v1 为止,如 https://api.example.com/v1',
  anthropic: '填到 /v1 为止,如 https://api.minimaxi.com/anthropic/v1',
  systemone: '填到 /v1 为止,如 https://api.codiv.ai/v1',
};

/** 模型能力分组(后台页按组渲染;新增模型类型=新槽位挂入对应组) */
export const MODEL_SLOT_GROUPS = [
  { id: 'language', label: '语言模型', desc: '认知推理、对话与行为决策', slots: ['slow', 'light', 'jev'] },
  { id: 'vision', label: '多模态', desc: '图片素材识别与 AI 审核', slots: ['vision'] },
  { id: 'embedding', label: '向量化', desc: '记忆检索的语义索引', slots: ['embedding'] },
] as const;

export type ModelSlotGroupId = (typeof MODEL_SLOT_GROUPS)[number]['id'];

export type ModelSlotGroup = (typeof MODEL_SLOT_GROUPS)[number];

/** 供应商预设(选即自动填 Base URL;协议无对应端点时不填) */
export interface ModelProviderPreset {
  id: string;
  label: string;
  baseUrlByProtocol: Partial<Record<ModelProtocol, string>>;
}

export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  {
    id: 'minimax',
    label: 'MiniMax',
    baseUrlByProtocol: {
      openai: 'https://api.minimaxi.com/v1',
      anthropic: 'https://api.minimaxi.com/anthropic/v1',
    },
  },
  { id: 'deepseek', label: 'DeepSeek', baseUrlByProtocol: { openai: 'https://api.deepseek.com/v1' } },
  { id: 'zhipu', label: '智谱', baseUrlByProtocol: { openai: 'https://open.bigmodel.cn/api/paas/v4' } },
  { id: 'codiv', label: 'Codiv(Jev)', baseUrlByProtocol: { openai: 'https://api.codiv.ai/v1', systemone: 'https://api.codiv.ai/v1' } },
  { id: 'anthropic', label: 'Anthropic', baseUrlByProtocol: { anthropic: 'https://api.anthropic.com/v1' } },
  { id: 'openai', label: 'OpenAI', baseUrlByProtocol: { openai: 'https://api.openai.com/v1' } },
];

/** GET /api/admin/model-configs 响应条目(apiKey 只回掩码,密文永不外发) */
export interface ModelConfigView {
  slot: ModelSlot;
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | null;
  lastTestError: string | null;
  updatedAt: string;
}

/** PUT /api/admin/model-configs/:slot 请求(apiKey 只写:空/缺省=保留原值) */
export interface ModelConfigUpdate {
  protocol?: ModelProtocol;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  enabled?: boolean;
}

/** POST /api/admin/model-configs/:slot/test 响应 */
export interface ModelConfigTestResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

/** POST /api/admin/model-configs/:slot/invoke 响应(走 ModelRouter 真实调用链+记账) */
export interface ModelConfigInvokeResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
  /** chat/systemone 槽位的文本或类型化答案 JSON */
  content?: string;
  /** embedding 槽位的向量维度 */
  dims?: number;
  usage?: { promptTokens: number; completionTokens: number };
}

/** POST /api/admin/assets/ai-review 单件结论(视觉模型审核) */
export interface AssetAiReviewResult {
  match: 'yes' | 'no' | 'unsure';
  see: string;
  kindGuess: string | null;
  problems: string[];
  suggestion: string | null;
}

export interface AssetAiReviewItem {
  id: number;
  slug: string;
  ok: boolean;
  error?: string;
  result?: AssetAiReviewResult;
}

export interface AssetAiReviewResponse {
  items: AssetAiReviewItem[];
}

/** POST /api/admin/auth/login 请求/响应 */
export interface AdminLoginRequest {
  username: string;
  password: string;
}

export interface AdminLoginResponse {
  token: string;
  /** token 有效期(秒) */
  expiresIn: number;
}

export const ADMIN_API = {
  login: '/api/admin/auth/login',
  me: '/api/admin/auth/me',
  changePassword: '/api/admin/auth/change-password',
  modelConfigs: '/api/admin/model-configs',
  modelConfig: (slot: ModelSlot) => `/api/admin/model-configs/${slot}`,
  modelConfigTest: (slot: ModelSlot) => `/api/admin/model-configs/${slot}/test`,
  modelConfigInvoke: (slot: ModelSlot) => `/api/admin/model-configs/${slot}/invoke`,
  tokenUsageSummary: '/api/admin/token-usage/summary',
  tokenUsageEntries: '/api/admin/token-usage/entries',
  sysConfig: '/api/admin/sys-config',
  assetCategories: '/api/admin/assets/categories',
  assets: '/api/admin/assets',
  asset: (id: number) => `/api/admin/assets/${id}`,
  assetImage: (id: number) => `/api/admin/assets/${id}/image`,
  assetBulkStatus: '/api/admin/assets/bulk-status',
  assetPublish: '/api/admin/assets/publish',
  assetIssues: '/api/admin/asset-issues',
  assetIssue: (id: number) => `/api/admin/asset-issues/${id}`,
  assetAiReview: '/api/admin/assets/ai-review',
  logWorldEvents: '/api/admin/logs/world-events',
  logTechLogs: '/api/admin/logs/tech-logs',
  logAuditLogs: '/api/admin/logs/audit-logs',
} as const;

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

// ============ 素材管理(M-L.2,design/05) ============

export interface AssetCategoryView {
  id: number;
  parentId: number | null;
  level: number;
  slug: string;
  name: string;
  sortOrder: number;
  /** 直挂素材数(不含子孙分类) */
  assetCount: number;
}

export interface AssetAdminView {
  id: number;
  slug: string;
  name: string;
  categoryId: number;
  /** 挂载分类 slug(kind 层;tile/props 挂 theme 层) */
  categorySlug: string;
  domain: string;
  width: number;
  height: number;
  gridW: number;
  gridH: number;
  anchor: string;
  tier: number;
  tags: string[];
  status: AssetStatus;
  source: string;
  anim: AssetAnimConfig | null;
}

export interface AssetListResponse {
  total: number;
  items: AssetAdminView[];
}

export interface AssetPublishResult {
  version: string;
  assetCount: number;
}

export interface AssetBulkStatusResult {
  updated: number;
}

// ============ 素材问题反馈(UI-2 报错闭环) ============

/** 问题作用域:asset=素材图错误(画错/裁错/分类错),anim=角色表动画异常(朝向/残帧) */
export const ASSET_ISSUE_SCOPES = ['asset', 'anim'] as const;

export type AssetIssueScope = (typeof ASSET_ISSUE_SCOPES)[number];

export const ASSET_ISSUE_STATUSES = ['open', 'resolved'] as const;

export type AssetIssueStatus = (typeof ASSET_ISSUE_STATUSES)[number];

/** 素材问题单(游戏内信息卡/动画演示器/审查页三处上报,后台清单流转) */
export interface AssetIssueView {
  id: number;
  scope: AssetIssueScope;
  /** asset=素材 slug;anim=角色表 slug */
  refSlug: string;
  /** scope=asset 时关联的素材 id(可空:动画问题无素材行) */
  refId: number | null;
  /** 上报上下文(anim: group/dir/row/frames/fps;asset: kind/theme 等) */
  context: Record<string, unknown> | null;
  note: string | null;
  status: AssetIssueStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AssetIssueListResponse {
  total: number;
  items: AssetIssueView[];
}

export interface WorldEventEntryView {
  id: number;
  type: string;
  characterId: string | null;
  tick: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorldEventEntriesResponse {
  total: number;
  page: number;
  pageSize: number;
  entries: WorldEventEntryView[];
}

export interface TechLogEntryView {
  id: number;
  level: string;
  source: string;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface TechLogEntriesResponse {
  total: number;
  page: number;
  pageSize: number;
  entries: TechLogEntryView[];
}

export interface AuditLogEntryView {
  id: number;
  username: string | null;
  method: string;
  path: string;
  statusCode: number;
  createdAt: string;
}

export interface AuditLogEntriesResponse {
  total: number;
  page: number;
  pageSize: number;
  entries: AuditLogEntryView[];
}
