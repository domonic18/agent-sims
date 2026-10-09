/**
 * 管理员 token 存取唯一入口:游戏页/后台/lab 三端共用 sims.admin.token 键,
 * 任意一侧登录三处可见(issueApi 曾因键分裂被迫直连 workaround)。
 */

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
