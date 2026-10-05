import { useCallback, useEffect, useState } from 'react';
import type { ModelConfigView } from '@sims/shared';
import { ApiError, clearToken, fetchModelConfigs, getToken, login, setToken } from './api';
import { ModelConfigPanel } from './ModelConfigPanel';
import { TokenUsagePanel } from './TokenUsagePanel';
import { WorldPanel } from './WorldPanel';
import './admin.css';

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
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
      onSuccess();
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

type AdminTab = 'world' | 'models' | 'usage';

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
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
    return <LoginForm onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <nav className="admin-tabs">
          <button
            type="button"
            className={tab === 'world' ? 'admin-tab active' : 'admin-tab'}
            onClick={() => setTab('world')}
          >
            世界管理
          </button>
          <button
            type="button"
            className={tab === 'models' ? 'admin-tab active' : 'admin-tab'}
            onClick={() => setTab('models')}
          >
            模型配置
          </button>
          <button
            type="button"
            className={tab === 'usage' ? 'admin-tab active' : 'admin-tab'}
            onClick={() => setTab('usage')}
          >
            Token 用量
          </button>
        </nav>
        <button
          className="admin-secondary"
          onClick={() => {
            clearToken();
            setConfigs(null);
            setAuthed(false);
          }}
        >
          退出登录
        </button>
      </header>
      {tab === 'world' ? (
        <WorldPanel />
      ) : tab === 'usage' ? (
        <TokenUsagePanel />
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
  );
}
