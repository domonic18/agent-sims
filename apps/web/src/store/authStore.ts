import { create } from 'zustand';
import { clearToken, getToken, setToken } from '../net/token';

interface AdminUser {
  username: string;
}

interface AuthState {
  /** admin Bearer token;null=游客(浏览态) */
  token: string | null;
  username: string | null;
  /** 启动时 localStorage 恢复 + /me 校验是否完成(未完成前不渲染登录入口防闪) */
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restore: () => Promise<void>;
}

async function requestMe(token: string): Promise<AdminUser> {
  const response = await fetch('/api/admin/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`凭证已失效(${response.status})`);
  return (await response.json()) as AdminUser;
}

/**
 * 会话权限(web 游览/操控分层):游客=浏览(看状态/日志/信息卡,意图通道 spectator 被
 * 服务端拒),管理员=登录后操控(WASD/地图移动/动作条/世界控制)。token 与后台共用
 * 同一签发端点(/api/admin/auth/login),socket 握手带上供服务端校验 player 角色。
 */
export const useAuthStore = create<AuthState>((set) => ({
  token: getToken(),
  username: null,
  ready: false,
  login: async (username, password) => {
    const response = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `登录失败(${response.status})`);
    }
    const issued = (await response.json()) as { token: string };
    const me = await requestMe(issued.token);
    setToken(issued.token);
    set({ token: issued.token, username: me.username });
  },
  logout: () => {
    clearToken();
    set({ token: null, username: null });
  },
  restore: async () => {
    const token = getToken();
    if (token === null) {
      set({ ready: true });
      return;
    }
    try {
      const me = await requestMe(token);
      set({ token, username: me.username, ready: true });
    } catch {
      clearToken();
      set({ token: null, username: null, ready: true });
    }
  },
}));
