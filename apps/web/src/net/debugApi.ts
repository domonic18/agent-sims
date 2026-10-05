/**
 * /debug/* 联调通道(仅 development 注册的服务端端点)。
 * M2 阶段 HUD 暂停/加速经此下发;正式指令通道(角色权限)在 M4 落地后替换。
 * 世界参数读取/热调(Lab 控制面板)同走此通道。
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

const post = async (path: string, body: unknown): Promise<void> => {
  await request(path, 'POST', body);
};

export const setPaused = (paused: boolean): Promise<void> =>
  post('/debug/pause', { paused });

export const setTimeScale = (scale: number): Promise<void> =>
  post('/debug/time/scale', { scale });

/** 复活幽灵态角色(M3.6f 死亡机制) */
export const reviveCharacter = (characterId: string): Promise<void> =>
  post('/debug/revive', { characterId });

/** 世界参数生效值全集(目录键→数值) */
export const fetchDebugParams = (): Promise<Record<string, number>> =>
  request<{ params: Record<string, number> }>('/debug/params', 'GET').then((r) => r.params);

/** 提交改动键,返回热调后的生效值全集 */
export const setDebugParams = (updates: Record<string, number>): Promise<Record<string, number>> =>
  request<{ params: Record<string, number> }>('/debug/params', 'POST', { updates }).then(
    (r) => r.params,
  );
