import type { CraftRecipeId, RecipeDef } from '../production.js';

/** GET/PUT /api/admin/world-recipes 与 GET /api/world/recipes 共用响应 */
export interface WorldRecipesView {
  recipes: Record<CraftRecipeId, RecipeDef>;
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

/** 认知 trace 行(agent-design §7): 每个认知周期一条,决策链六步观测面 */
export interface CognitionTraceEntryView {
  id: string;
  characterId: string;
  worldId: string | null;
  seq: number;
  gameMinutes: number;
  trigger: string;
  perception: Record<string, unknown> | null;
  retrieval: Record<string, unknown> | null;
  decision: Record<string, unknown>;
  calls: Array<Record<string, unknown>> | null;
  /** 关联 want(一张 want 从产欲到结算的追踪键;continue 采样行可为 null) */
  wantId: string | null;
  createdAt: string;
}

export interface CognitionTraceEntriesResponse {
  total: number;
  page: number;
  pageSize: number;
  entries: CognitionTraceEntryView[];
}

/** GET /api/admin/traces/wants/:characterId/:wantId — want 全生命周期聚合 */
export interface WantLifecycleResponse {
  /** 脑内在途快照(意图存储仍保有该 want 时;跨日/已清意图则 null,靠 traces 还原) */
  want: Record<string, unknown> | null;
  traces: CognitionTraceEntryView[];
  events: WorldEventEntryView[];
}
