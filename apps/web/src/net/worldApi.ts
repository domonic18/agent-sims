/**
 * /api/world 常开控制通道(游戏内设置菜单):暂停/倍率/世界参数/世界规则
 * 的生产可用读写口(不同于 /debug 仅 development 注册),及历史事件查询。
 */
import type {
  MemoryImpressionsResponse,
  MemoryPanelResponse,
  MemoryType,
  UiMetaView,
  WorldEventsHistoryResponse,
  WorldRecipesView,
  WorldSettingsView,
} from '@sims/shared';
import { useAuthStore } from '../store/authStore';

export interface WorldSettingsUpdate {
  paused?: boolean;
  timeScale?: number;
  /** 参数覆盖项(缺省键不变);resetParams=true 时先复位出厂默认再应用 */
  params?: Record<string, number>;
  resetParams?: boolean;
  rules?: { allowDeath?: boolean; allowChat?: boolean };
}

const request = async (path: string, method: 'GET' | 'POST', body?: unknown): Promise<WorldSettingsView> => {
  // 写操作在生产环境须 admin Bearer(canControlWorld 校验);游客态无头走只读
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  };
  const response = await fetch(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path} 失败(${response.status}): ${detail.slice(0, 120)}`);
  }
  return (await response.json()) as WorldSettingsView;
};

export const getWorldSettings = (): Promise<WorldSettingsView> =>
  request('/api/world/settings', 'GET');

export const updateWorldSettings = (update: WorldSettingsUpdate): Promise<WorldSettingsView> =>
  request('/api/world/settings', 'POST', update);

/** 每世界配方公开读口(游客免登录;游戏页装载回填 worldStore) */
export const getWorldRecipes = async (): Promise<WorldRecipesView> => {
  const response = await fetch('/api/world/recipes', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`/api/world/recipes 失败(${response.status})`);
  }
  return (await response.json()) as WorldRecipesView;
};

/** 游戏页模型徽标(公开读):开关与模型名由服务端裁定,失败静默由调用方处理 */
export const getUiMeta = async (): Promise<UiMetaView> => {
  const response = await fetch('/api/world/ui-meta', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`/api/world/ui-meta 失败(${response.status})`);
  }
  return (await response.json()) as UiMetaView;
};

export const getWorldEvents = async (query: { limit?: number; characterId?: string; type?: string } = {}): Promise<WorldEventsHistoryResponse> => {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.characterId !== undefined) params.set('characterId', query.characterId);
  if (query.type !== undefined) params.set('type', query.type);
  const qs = params.toString();
  const response = await fetch(`/api/world/events${qs !== '' ? `?${qs}` : ''}`);
  if (!response.ok) {
    throw new Error(`/api/world/events 失败(${response.status})`);
  }
  return (await response.json()) as WorldEventsHistoryResponse;
};

/** 记忆面板公开只读镜像(游客/观众可看;与 admin 端 fetchCharacterMemories 同形) */
export const getCharacterMemories = async (
  characterId: string,
  query: { q?: string; limit?: number; type?: MemoryType } = {},
): Promise<MemoryPanelResponse> => {
  const params = new URLSearchParams();
  if (query.q !== undefined && query.q.trim() !== '') params.set('q', query.q.trim());
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.type !== undefined) params.set('type', query.type);
  const qs = params.toString();
  const response = await fetch(`/api/world/characters/${characterId}/memories${qs !== '' ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`/api/world/characters/${characterId}/memories 失败(${response.status})`);
  }
  return (await response.json()) as MemoryPanelResponse;
};

export const getCharacterImpressions = async (characterId: string): Promise<MemoryImpressionsResponse> => {
  const response = await fetch(`/api/world/characters/${characterId}/impressions`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`/api/world/characters/${characterId}/impressions 失败(${response.status})`);
  }
  return (await response.json()) as MemoryImpressionsResponse;
};
