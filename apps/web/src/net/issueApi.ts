/**
 * 素材问题上报(游戏侧,UI-2 报错闭环):游戏页与后台页 token 存储键不同
 * (authStore sims.admin.token vs 后台 sims_admin_token),故独立轻客户端直连
 * /api/admin/asset-issues;游客态未登录直接抛错,按钮本就仅管理员可见。
 */
import type { AssetIssueScope, AssetIssueView } from '@sims/shared';
import { ADMIN_API } from '@sims/shared';
import { useAuthStore } from '../store/authStore';

export async function reportAssetIssue(payload: {
  scope: AssetIssueScope;
  refSlug: string;
  refId?: number | null;
  context?: Record<string, unknown> | null;
  note?: string | null;
}): Promise<AssetIssueView> {
  const token = useAuthStore.getState().token;
  if (token === null) throw new Error('请先以管理员身份登录');
  const res = await fetch(ADMIN_API.assetIssues, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `上报失败(HTTP ${res.status})`);
  return body as AssetIssueView;
}
