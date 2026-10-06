/**
 * Lab 调试台控制通道:暂停/倍率/参数走 /api/world/settings 常开端点
 * (开发/生产通用);复活等纯调试动作仍走 /debug/*(仅 development 注册)。
 */

const request = async <T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> => {
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
  return (await response.json()) as T;
};

const postSettings = async (body: Record<string, unknown>): Promise<void> => {
  await request('/api/world/settings', 'POST', body);
};

export const setPaused = (paused: boolean): Promise<void> =>
  postSettings({ paused });

export const setTimeScale = (scale: number): Promise<void> =>
  postSettings({ timeScale: scale });

/** 复活幽灵态角色(M3.6f 死亡机制,仅 dev) */
export const reviveCharacter = (characterId: string): Promise<void> =>
  request('/debug/revive', 'POST', { characterId }).then(() => undefined);

/** 手动快进 n tick(1 tick=1 游戏分钟,仅 dev;n 走 query) */
export const debugTick = (n: number): Promise<void> =>
  request(`/debug/tick?n=${n}`, 'POST').then(() => undefined);

/** 生成居民(仅 dev):坐标须为可站立格 */
export const debugSpawn = (body: { id: string; name?: string; x: number; y: number }): Promise<void> =>
  request('/debug/spawn', 'POST', body).then(() => undefined);

/** 探测 /debug 通道是否可用(生产未注册 → 404),控制 Lab dev 区块显隐 */
export const probeDebugAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch('/debug/state');
    return response.ok;
  } catch {
    return false;
  }
};

/** 世界参数生效值全集(目录键→数值) */
export const fetchDebugParams = (): Promise<Record<string, number>> =>
  request<{ params: Record<string, number> }>('/api/world/settings', 'GET').then((r) => r.params);

/** 提交改动键,返回热调后的生效值全集 */
export const setDebugParams = (updates: Record<string, number>): Promise<Record<string, number>> =>
  request<{ params: Record<string, number> }>('/api/world/settings', 'POST', { params: updates }).then(
    (r) => r.params,
  );
