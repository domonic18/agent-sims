import {
  ADMIN_API,
  type AssetBulkStatusResult,
  type AssetCategoryView,
  type AssetIssueListResponse,
  type AssetIssueScope,
  type AssetIssueStatus,
  type AssetIssueView,
  type AssetListResponse,
  type AssetPublishResult,
  type AssetStatus,
  type AdminLoginRequest,
  type AdminLoginResponse,
  type AuditLogEntriesResponse,
  type CreateWorldRequest,
  type ModelConfigInvokeResult,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelSlot,
  type TechLogEntriesResponse,
  type TokenUsageEntriesResponse,
  type TokenUsageSummary,
  type TokenUsageWindow,
  type SysConfigView,
  type WorldEventEntriesResponse,
  WORLD_ADMIN_API,
  type WorldPreviewResponse,
  type WorldView,
} from '@sims/shared';

const TOKEN_STORAGE_KEY = 'sims_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  if (res.status === 401 && token) {
    clearToken();
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `请求失败(HTTP ${res.status})`);
  }
  return body as T;
}

export async function login(payload: AdminLoginRequest): Promise<AdminLoginResponse> {
  return await adminFetch<AdminLoginResponse>(ADMIN_API.login, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchModelConfigs(): Promise<ModelConfigView[]> {
  return await adminFetch<ModelConfigView[]>(ADMIN_API.modelConfigs);
}

export async function fetchMe(): Promise<{ username: string }> {
  return await adminFetch<{ username: string }>(ADMIN_API.me);
}

export async function changePassword(payload: {
  oldPassword: string;
  newPassword: string;
}): Promise<{ ok: true }> {
  return await adminFetch<{ ok: true }>(ADMIN_API.changePassword, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchSysConfig(): Promise<SysConfigView> {
  return await adminFetch<SysConfigView>(ADMIN_API.sysConfig);
}

export async function updateModelConfig(
  slot: ModelSlot,
  data: ModelConfigUpdate,
): Promise<ModelConfigView> {
  return await adminFetch<ModelConfigView>(ADMIN_API.modelConfig(slot), {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function testModelConfig(slot: ModelSlot): Promise<ModelConfigTestResult> {
  return await adminFetch<ModelConfigTestResult>(ADMIN_API.modelConfigTest(slot), {
    method: 'POST',
  });
}

export async function invokeModelConfig(
  slot: ModelSlot,
  prompt?: string,
): Promise<ModelConfigInvokeResult> {
  return await adminFetch<ModelConfigInvokeResult>(ADMIN_API.modelConfigInvoke(slot), {
    method: 'POST',
    body: JSON.stringify(prompt ? { prompt } : {}),
  });
}

export async function fetchTokenUsageSummary(
  window: TokenUsageWindow,
): Promise<TokenUsageSummary> {
  return await adminFetch<TokenUsageSummary>(`${ADMIN_API.tokenUsageSummary}?window=${window}`);
}

export interface TokenUsageEntriesQuery {
  window: TokenUsageWindow;
  slot?: string;
  characterId?: string;
  taskType?: string;
  page: number;
  pageSize: number;
}

export async function fetchTokenUsageEntries(
  query: TokenUsageEntriesQuery,
): Promise<TokenUsageEntriesResponse> {
  const params = new URLSearchParams({ window: query.window, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.slot) params.set('slot', query.slot);
  if (query.characterId) params.set('characterId', query.characterId);
  if (query.taskType) params.set('taskType', query.taskType);
  return await adminFetch<TokenUsageEntriesResponse>(`${ADMIN_API.tokenUsageEntries}?${params.toString()}`);
}

export async function fetchWorlds(): Promise<WorldView[]> {
  return await adminFetch<WorldView[]>(WORLD_ADMIN_API.worlds);
}

export async function createWorld(payload: CreateWorldRequest): Promise<WorldView> {
  return await adminFetch<WorldView>(WORLD_ADMIN_API.worlds, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface WorldPreviewRequest {
  seed?: string;
  gameType: 'growth';
  params: { size: 'small' | 'medium' | 'large'; density: 'sparse' | 'normal' | 'dense' };
}

export async function previewWorld(payload: WorldPreviewRequest): Promise<WorldPreviewResponse> {
  return await adminFetch<WorldPreviewResponse>(WORLD_ADMIN_API.worldPreview, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function closeWorld(id: string): Promise<WorldView> {
  return await adminFetch<WorldView>(WORLD_ADMIN_API.worldClose.replace(':id', id), {
    method: 'POST',
  });
}

export async function deleteWorld(id: string): Promise<void> {
  await adminFetch<unknown>(WORLD_ADMIN_API.world.replace(':id', id), {
    method: 'DELETE',
  });
}

// ============ 素材管理(M-L.2) ============

export interface AssetListQuery {
  categoryId?: number;
  status?: AssetStatus | '';
  q?: string;
  page: number;
  pageSize: number;
}

export async function fetchAssetCategories(): Promise<AssetCategoryView[]> {
  return await adminFetch<AssetCategoryView[]>(ADMIN_API.assetCategories);
}

export async function fetchAssets(query: AssetListQuery): Promise<AssetListResponse> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.categoryId !== undefined) params.set('categoryId', String(query.categoryId));
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  return await adminFetch<AssetListResponse>(`${ADMIN_API.assets}?${params.toString()}`);
}

export interface AssetPatch {
  name?: string;
  gridW?: number;
  gridH?: number;
  anchor?: string;
  tier?: number;
  tags?: string[];
  status?: AssetStatus;
  categoryId?: number;
}

export async function updateAsset(id: number, patch: AssetPatch): Promise<void> {
  await adminFetch<unknown>(ADMIN_API.asset(id), { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function bulkAssetStatus(ids: number[], status: AssetStatus): Promise<AssetBulkStatusResult> {
  return await adminFetch<AssetBulkStatusResult>(ADMIN_API.assetBulkStatus, {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
}

export async function publishAssets(): Promise<AssetPublishResult> {
  return await adminFetch<AssetPublishResult>(ADMIN_API.assetPublish, { method: 'POST' });
}

export async function createAssetCategory(
  name: string,
  slug: string,
  parentId: number | null,
): Promise<AssetCategoryView> {
  return await adminFetch<AssetCategoryView>(ADMIN_API.assetCategories, {
    method: 'POST',
    body: JSON.stringify({ name, slug, parentId }),
  });
}

export async function renameAssetCategory(id: number, name: string): Promise<void> {
  await adminFetch<unknown>(`${ADMIN_API.assetCategories}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteAssetCategory(id: number): Promise<void> {
  await adminFetch<unknown>(`${ADMIN_API.assetCategories}/${id}`, { method: 'DELETE' });
}

// ============ 素材问题单(UI-2 报错闭环) ============

export async function fetchAssetIssues(
  query: { status?: string; scope?: string; refSlug?: string } = {},
): Promise<AssetIssueListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.scope) params.set('scope', query.scope);
  if (query.refSlug) params.set('refSlug', query.refSlug);
  const qs = params.toString();
  return await adminFetch<AssetIssueListResponse>(`${ADMIN_API.assetIssues}${qs !== '' ? `?${qs}` : ''}`);
}

export async function createAssetIssue(payload: {
  scope: AssetIssueScope;
  refSlug: string;
  refId?: number | null;
  context?: Record<string, unknown> | null;
  note?: string | null;
}): Promise<AssetIssueView> {
  return await adminFetch<AssetIssueView>(ADMIN_API.assetIssues, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAssetIssue(id: number, status: AssetIssueStatus): Promise<AssetIssueView> {
  return await adminFetch<AssetIssueView>(ADMIN_API.assetIssue(id), {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// ============ 三日志查询(M-G.1) ============

export interface WorldEventEntriesQuery {
  characterId?: string;
  type?: string;
  page: number;
  pageSize: number;
}

export async function fetchWorldEventEntries(
  query: WorldEventEntriesQuery,
): Promise<WorldEventEntriesResponse> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.characterId) params.set('characterId', query.characterId);
  if (query.type) params.set('type', query.type);
  return await adminFetch<WorldEventEntriesResponse>(`${ADMIN_API.logWorldEvents}?${params.toString()}`);
}

export interface TechLogEntriesQuery {
  level?: string;
  source?: string;
  page: number;
  pageSize: number;
}

export async function fetchTechLogEntries(query: TechLogEntriesQuery): Promise<TechLogEntriesResponse> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.level) params.set('level', query.level);
  if (query.source) params.set('source', query.source);
  return await adminFetch<TechLogEntriesResponse>(`${ADMIN_API.logTechLogs}?${params.toString()}`);
}

export interface AuditLogEntriesQuery {
  username?: string;
  page: number;
  pageSize: number;
}

export async function fetchAuditLogEntries(
  query: AuditLogEntriesQuery,
): Promise<AuditLogEntriesResponse> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.username) params.set('username', query.username);
  return await adminFetch<AuditLogEntriesResponse>(`${ADMIN_API.logAuditLogs}?${params.toString()}`);
}

/** 素材图片经鉴权 fetch 转 objectURL(带会话级缓存;<img> 无法携带 Bearer 头,不走 JSON 通道) */
const assetImageCache = new Map<number, string>();

export async function fetchAssetImage(id: number): Promise<string> {
  const cached = assetImageCache.get(id);
  if (cached !== undefined) return cached;
  const token = getToken();
  const res = await fetch(ADMIN_API.assetImage(id), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401 && token) clearToken();
  if (!res.ok) throw new ApiError(res.status, `素材图片加载失败(HTTP ${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  assetImageCache.set(id, url);
  return url;
}
