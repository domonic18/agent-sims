import {
  ADMIN_API,
  type AdminLoginRequest,
  type AdminLoginResponse,
  type CreateWorldRequest,
  type ModelConfigInvokeResult,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelSlot,
  type TokenUsageEntriesResponse,
  type TokenUsageSummary,
  type TokenUsageWindow,
  type SysConfigView,
  WORLD_ADMIN_API,
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

export async function updateSysConfig(updates: Record<string, number>): Promise<SysConfigView> {
  return await adminFetch<SysConfigView>(ADMIN_API.sysConfig, {
    method: 'PUT',
    body: JSON.stringify({ updates }),
  });
}

export async function resetSysConfig(): Promise<SysConfigView> {
  return await adminFetch<SysConfigView>(ADMIN_API.sysConfigReset, { method: 'POST' });
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
