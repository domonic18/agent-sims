/**
 * 后台模型槽位:四类模型(慢思考/轻量对话/Jev/embedding)的后台配置键,
 * model_configs.slot 与后台表单共用此枚举。
 */
export const MODEL_SLOTS = ['slow', 'light', 'jev', 'embedding'] as const;

export type ModelSlot = (typeof MODEL_SLOTS)[number];

export const MODEL_SLOT_LABELS: Record<ModelSlot, string> = {
  slow: '慢思考 LLM',
  light: '轻量 LLM',
  jev: 'Jev(systemone)',
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
  embedding: ['openai'],
};

/** Base URL 约定:填到版本段为止,探测路径由协议决定 */
export const MODEL_PROTOCOL_BASE_URL_HINT: Record<ModelProtocol, string> = {
  openai: '填到 /v1 为止,如 https://api.example.com/v1',
  anthropic: '填到 /v1 为止,如 https://api.minimaxi.com/anthropic/v1',
  systemone: '填到 /v1 为止,如 https://api.codiv.ai/v1',
};

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
  modelConfigs: '/api/admin/model-configs',
  modelConfig: (slot: ModelSlot) => `/api/admin/model-configs/${slot}`,
  modelConfigTest: (slot: ModelSlot) => `/api/admin/model-configs/${slot}/test`,
  modelConfigInvoke: (slot: ModelSlot) => `/api/admin/model-configs/${slot}/invoke`,
} as const;
