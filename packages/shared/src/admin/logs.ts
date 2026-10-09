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
