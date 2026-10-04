/**
 * /debug/* 联调通道(仅 development 注册的服务端端点)。
 * M2 阶段 HUD 暂停/加速经此下发;正式指令通道(角色权限)在 M4 落地后替换。
 */

const post = async (path: string, body: unknown): Promise<void> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path} 失败(${response.status}): ${detail.slice(0, 120)}`);
  }
};

export const setPaused = (paused: boolean): Promise<void> =>
  post('/debug/pause', { paused });

export const setTimeScale = (scale: number): Promise<void> =>
  post('/debug/time/scale', { scale });

/** 复活幽灵态角色(M3.6f 死亡机制) */
export const reviveCharacter = (characterId: string): Promise<void> =>
  post('/debug/revive', { characterId });
