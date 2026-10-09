/**
 * 托管/意识访谈(游戏侧,M4e):独立轻客户端直连 admin API;
 * 游客态未登录直接抛错(入口引导登录弹窗)。token 与后台共用 sims.admin.token。
 */
import type { HostingStateView, MindTalkView } from '@sims/shared';
import { ADMIN_API } from '@sims/shared';
import { getToken } from './token';

async function call<T>(path: string, init: RequestInit, failLabel: string): Promise<T> {
  const token = getToken();
  if (token === null) throw new Error('请先以管理员身份登录');
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `${failLabel}(HTTP ${res.status})`);
  return body as T;
}

export async function getHosting(characterId: string): Promise<HostingStateView> {
  return await call<HostingStateView>(
    ADMIN_API.characterHosting(characterId),
    { method: 'GET' },
    '托管状态查询失败',
  );
}

export async function setHosting(
  characterId: string,
  payload: { enabled: boolean; mode?: 'full' | 'policy'; policyText?: string },
): Promise<HostingStateView> {
  return await call<HostingStateView>(
    ADMIN_API.characterHosting(characterId),
    { method: 'POST', body: JSON.stringify(payload) },
    '托管切换失败',
  );
}

export async function getMindTalk(characterId: string): Promise<MindTalkView> {
  return await call<MindTalkView>(
    ADMIN_API.characterMindTalk(characterId),
    { method: 'GET' },
    '访谈会话查询失败',
  );
}

export async function sendMindTalk(characterId: string, text: string): Promise<MindTalkView> {
  return await call<MindTalkView>(
    ADMIN_API.characterMindTalk(characterId),
    { method: 'POST', body: JSON.stringify({ text }) },
    '访谈发送失败',
  );
}
