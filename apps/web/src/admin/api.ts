import {
  ADMIN_API,
  type AssetAiReviewResponse,
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
  type AddWorldCharacterRequest,
  type AddWorldCharacterResponse,
  type AuditLogEntriesResponse,
  type CharacterScheduleView,
  type CreateWorldRequest,
  type GameType,
  type ModelConfigInvokeResult,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelSlot,
  type MemoryPanelResponse,
  type MemoryImpressionsResponse,
  type MemoryType,
  type CharacterMoodResponse,
  type NarrativeDraft,
  type PersonaDraft,
  type PersonaSaveRequest,
  type PromptView,
  type PersonaView,
  type TechLogEntriesResponse,
  type TokenUsageEntriesResponse,
  type TokenUsageSummary,
  type TokenUsageWindow,
  type SysConfigView,
  type UiMetaView,
  type WorldArchiveView,
  type WorldEventEntriesResponse,
  type WorldRecipesView,
  WORLD_ADMIN_API,
  type WorldPreviewResponse,
  type WorldView,
} from '@sims/shared';

// 与 authStore(sims.admin.token)共用同一键:游戏页/后台/lab 同一登录态,
// 任意一侧登录三处可见(issueApi 曾因键分裂被迫直连 workaround)
const TOKEN_STORAGE_KEY = 'sims.admin.token';
const LEGACY_TOKEN_KEY = 'sims_admin_token';

// 一次性迁移:历史后台登录留下的旧键并入统一键,避免已登录用户被迫重登
if (localStorage.getItem(TOKEN_STORAGE_KEY) === null) {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy !== null) {
    localStorage.setItem(TOKEN_STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

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

/** 游戏页模型徽标开关(PUT ui-settings,回传最新 UiMetaView) */
export async function updateUiSettings(showModels: boolean): Promise<UiMetaView> {
  return await adminFetch<UiMetaView>(ADMIN_API.uiSettings, {
    method: 'PUT',
    body: JSON.stringify({ showModels }),
  });
}

export async function fetchPrompts(): Promise<PromptView[]> {
  return await adminFetch<PromptView[]>(ADMIN_API.prompts);
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

export async function updateSysConfig(
  params: Record<string, number>,
  reset = false,
): Promise<SysConfigView> {
  return await adminFetch<SysConfigView>(ADMIN_API.sysConfig, {
    method: 'PUT',
    body: JSON.stringify(reset ? { params, reset: true } : { params }),
  });
}

export async function resetSysConfig(): Promise<SysConfigView> {
  return await adminFetch<SysConfigView>(ADMIN_API.sysConfigReset, { method: 'POST' });
}

export async function fetchWorldRecipes(): Promise<WorldRecipesView> {
  return await adminFetch<WorldRecipesView>(ADMIN_API.worldRecipes);
}

export async function updateWorldRecipes(
  recipes: WorldRecipesView['recipes'],
): Promise<WorldRecipesView> {
  return await adminFetch<WorldRecipesView>(ADMIN_API.worldRecipes, {
    method: 'PUT',
    body: JSON.stringify({ recipes }),
  });
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
  gameType: GameType;
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

export async function addWorldCharacter(
  payload: AddWorldCharacterRequest,
): Promise<AddWorldCharacterResponse> {
  return await adminFetch<AddWorldCharacterResponse>(WORLD_ADMIN_API.characters, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ============ 世界存档多档(C6) ============

export async function fetchWorldArchives(): Promise<WorldArchiveView[]> {
  return await adminFetch<WorldArchiveView[]>(WORLD_ADMIN_API.archives);
}

export async function saveWorldArchive(label?: string): Promise<WorldArchiveView> {
  return await adminFetch<WorldArchiveView>(WORLD_ADMIN_API.archives, {
    method: 'POST',
    body: JSON.stringify(label !== undefined && label.trim() !== '' ? { label: label.trim() } : {}),
  });
}

export async function loadWorldArchive(id: string): Promise<void> {
  await adminFetch<unknown>(WORLD_ADMIN_API.archiveLoad.replace(':id', id), { method: 'POST' });
}

export async function deleteWorldArchive(id: string): Promise<void> {
  await adminFetch<unknown>(WORLD_ADMIN_API.archive.replace(':id', id), { method: 'DELETE' });
}

// ============ 记忆面板(M4b/A3) ============

export interface CharacterMemoriesQuery {
  /** 检索词(缺省=按时间倒序浏览) */
  q?: string;
  limit?: number;
  /** 层过滤(C1): 事件/洞察/梦境/对话;缺省=全部 */
  type?: MemoryType;
}

export async function fetchCharacterMemories(
  characterId: string,
  query: CharacterMemoriesQuery = {},
): Promise<MemoryPanelResponse> {
  const params = new URLSearchParams();
  if (query.q !== undefined && query.q.trim() !== '') params.set('q', query.q.trim());
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.type !== undefined) params.set('type', query.type);
  const qs = params.toString();
  return await adminFetch<MemoryPanelResponse>(
    `${ADMIN_API.characterMemories(characterId)}${qs !== '' ? `?${qs}` : ''}`,
  );
}

/** 关系印象(C1): TA 对各熟人的第一人称叙事印象(10-cognition §4.2) */
export async function fetchCharacterImpressions(
  characterId: string,
): Promise<MemoryImpressionsResponse> {
  return await adminFetch<MemoryImpressionsResponse>(
    ADMIN_API.characterImpressions(characterId),
  );
}

/** 情绪(C2): 当前态(衰减聚合)+冲量历史 */
export async function fetchCharacterMood(characterId: string): Promise<CharacterMoodResponse> {
  return await adminFetch<CharacterMoodResponse>(ADMIN_API.characterMood(characterId));
}

/** 自治开关(M4c):开启后该角色进 AgentScheduler 泵(rule 阈值巡检+jev 事件微决策) */
export async function fetchCharacterAutonomy(characterId: string): Promise<{ enabled: boolean }> {
  return await adminFetch<{ enabled: boolean }>(ADMIN_API.characterAutonomy(characterId));
}

export async function setCharacterAutonomy(characterId: string, enabled: boolean): Promise<void> {
  await adminFetch(ADMIN_API.characterAutonomy(characterId), {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

/** M4d 日程面板:读当日计划(无计划 day=null);replan 清计划后泵 2s 内自动重生成 */
export async function fetchCharacterSchedule(characterId: string): Promise<CharacterScheduleView> {
  return await adminFetch<CharacterScheduleView>(ADMIN_API.characterSchedule(characterId));
}

export async function replanCharacter(characterId: string): Promise<void> {
  await adminFetch(ADMIN_API.characterReplan(characterId), { method: 'POST' });
}

// ============ 预置人设(M4e 观察者版:lab 查看/编辑/LLM 随机草稿) ============

export async function fetchPersona(characterId: string): Promise<PersonaView> {
  return await adminFetch<PersonaView>(ADMIN_API.characterPersona(characterId));
}

export async function putPersona(
  characterId: string,
  payload: PersonaSaveRequest,
): Promise<PersonaView> {
  return await adminFetch<PersonaView>(ADMIN_API.characterPersona(characterId), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function randomPersonaDraft(characterId: string): Promise<PersonaDraft> {
  return await adminFetch<PersonaDraft>(ADMIN_API.characterPersonaRandom(characterId), {
    method: 'POST',
  });
}

export async function generateNarrativeDraft(characterId: string): Promise<NarrativeDraft> {
  return await adminFetch<NarrativeDraft>(
    ADMIN_API.characterPersonaNarrativeGenerate(characterId),
    { method: 'POST' },
  );
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

export async function aiReviewAssets(ids: number[]): Promise<AssetAiReviewResponse> {
  return await adminFetch<AssetAiReviewResponse>(ADMIN_API.assetAiReview, {
    method: 'POST',
    body: JSON.stringify({ ids }),
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
