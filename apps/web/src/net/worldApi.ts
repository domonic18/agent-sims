/**
 * /api/world/settings 常开控制通道(游戏内设置菜单):暂停/倍率/世界参数/世界规则
 * 的生产可用读写口(不同于 /debug 仅 development 注册)。
 */
import type { WorldSettingsView } from '@sims/shared';

export interface WorldSettingsUpdate {
  paused?: boolean;
  timeScale?: number;
  /** 参数覆盖项(缺省键不变);resetParams=true 时先复位出厂默认再应用 */
  params?: Record<string, number>;
  resetParams?: boolean;
  rules?: { allowDeath?: boolean; allowChat?: boolean };
}

const request = async (path: string, method: 'GET' | 'POST', body?: unknown): Promise<WorldSettingsView> => {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
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
