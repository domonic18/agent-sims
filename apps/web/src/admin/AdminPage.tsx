import { useCallback, useEffect, useState } from 'react';
import type { ModelConfigView } from '@sims/shared';
import { ApiError, clearToken, fetchModelConfigs, getToken, login, setToken } from './api';
import { ModelConfigPanel } from './ModelConfigPanel';
import { TokenUsagePanel } from './TokenUsagePanel';
import { WorldPanel } from './WorldPanel';
import { SettingsPanel } from './SettingsPanel';
import './admin.css';

function LoginForm({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await login({ username, password });
      setToken(result.token);
      onSuccess(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <h1>agent-sims 后台</h1>
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error && <p className="admin-error">{error}</p>}
        <button type="submit" disabled={submitting || !password}>
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}

type AdminTab = 'world' | 'models' | 'usage' | 'settings';

const NAV_GROUPS: Array<{ label: string; items: Array<{ key: AdminTab; icon: string; label: string }> }> = [
  {
    label: '运营',
    items: [
      { key: 'world', icon: '🌍', label: '世界管理' },
      { key: 'models', icon: '🤖', label: '模型配置' },
      { key: 'usage', icon: '📊', label: 'Token 用量' },
    ],
  },
  {
    label: '系统',
    items: [{ key: 'settings', icon: '⚙️', label: '系统设置' }],
  },
];

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const [username, setUsername] = useState('');
  const [tab, setTab] = useState<AdminTab>('world');
  const [configs, setConfigs] = useState<ModelConfigView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConfigs(await fetchModelConfigs());
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthed(false);
        return;
      }
      setLoadError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    // 挂载即探测 token 有效性(401 统一回登录页),模型 tab 激活时再刷新
    if (authed) void load();
  }, [authed, load]);

  useEffect(() => {
    if (authed && tab === 'models') void load();
  }, [authed, tab, load]);

  if (!authed) {
    return <LoginForm onSuccess={(name) => { setUsername(name); setAuthed(true); }} />;
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">agent-sims 后台</div>
        <nav className="admin-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="admin-nav-group">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={tab === item.key ? 'admin-nav-item active' : 'admin-nav-item'}
                  onClick={() => setTab(item.key)}
                >
                  <span className="admin-nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <span className="admin-sidebar-user">{username || '已登录'}</span>
          <button
            type="button"
            className="admin-secondary"
            onClick={() => {
              clearToken();
              setConfigs(null);
              setAuthed(false);
            }}
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-content">
          {tab === 'world' ? (
            <WorldPanel />
          ) : tab === 'usage' ? (
            <TokenUsagePanel />
          ) : tab === 'settings' ? (
            <SettingsPanel username={username} />
          ) : (
            <>
              {loadError && <p className="admin-error">{loadError}</p>}
              {!configs ? (
                <p>加载中…</p>
              ) : (
                <ModelConfigPanel configs={configs} onChanged={() => void load()} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
