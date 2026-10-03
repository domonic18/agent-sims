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

/** GET /api/admin/model-configs 响应条目(apiKey 只回掩码,密文永不外发) */
export interface ModelConfigView {
  slot: ModelSlot;
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
} as const;
