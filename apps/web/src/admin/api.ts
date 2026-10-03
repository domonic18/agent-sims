import {
  ADMIN_API,
  type AdminLoginRequest,
  type AdminLoginResponse,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelSlot,
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
