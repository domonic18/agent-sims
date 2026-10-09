import type { ModelSlot } from './model-config.js';

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
  sysConfigReset: '/api/admin/sys-config/reset',
  worldRecipes: '/api/admin/world-recipes',
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
  characterMemories: (id: string) => `/api/admin/characters/${id}/memories`,
  characterImpressions: (id: string) => `/api/admin/characters/${id}/impressions`,
  characterMood: (id: string) => `/api/admin/characters/${id}/mood`,
  characterAutonomy: (id: string) => `/api/admin/characters/${id}/autonomy`,
  characterSchedule: (id: string) => `/api/admin/characters/${id}/schedule`,
  characterReplan: (id: string) => `/api/admin/characters/${id}/replan`,
  characterHosting: (id: string) => `/api/admin/characters/${id}/hosting`,
  characterPersona: (id: string) => `/api/admin/characters/${id}/persona`,
  characterPersonaRandom: (id: string) => `/api/admin/characters/${id}/persona/random`,
  characterPersonaNarrativeGenerate: (id: string) => `/api/admin/characters/${id}/persona/narrative/generate`,
  characterMindTalk: (id: string) => `/api/admin/characters/${id}/mindtalk`,
  prompts: '/api/admin/prompts',
  uiSettings: '/api/admin/ui-settings',
} as const;

/** GET /api/world/ui-meta 响应(公开): 游戏页左下角模型徽标;
 * showModels 由后台「模型配置」页开关控制,模型名取自各槽位启用配置(未启用为 null) */
export interface UiMetaView {
  showModels: boolean;
  /** 慢思考 LLM(slow 槽)模型名 */
  slowModel: string | null;
  /** 轻量 LLM(light 槽)模型名 */
  lightModel: string | null;
  /** SystemOne(jev 槽)模型名 */
  jevModel: string | null;
}

/** 外置提示词查看视图(GET /api/admin/prompts,只读): 元数据+模板全文 */
export interface PromptView {
  id: string;
  title: string;
  description: string;
  slot: string;
  taskType: string;
  /** 模板内 {{var}} 占位清单(由代码注入) */
  variables: string[];
  content: string;
}
