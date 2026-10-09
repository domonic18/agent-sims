import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { toErrorMessage } from './errors';

/**
 * 管理员登录弹窗(游戏界面零依赖,不用 antd):凭证与后台共用同一签发端点,
 * 成功后 token 入 authStore——socket 重连升 player、操作 HUD 解锁。
 */
export function LoginModal({ onClose }: { onClose: () => void }) {
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      onClose();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-overlay" onClick={onClose}>
      <div className="px-box login-modal" onClick={(event) => event.stopPropagation()}>
        <div className="px-inner login-modal-inner">
          <h3>🔑 管理员登录</h3>
          <p className="hint">登录后可操控居民与 world;游客仅浏览</p>
          <label className="login-row">
            <span>用户名</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </label>
          <label className="login-row">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </label>
          {error !== null && <p className="feedback err">{error}</p>}
          <div className="login-actions">
            <button type="button" className="px-btn" disabled={busy} onClick={() => void submit()}>
              {busy ? '登录中…' : '登录'}
            </button>
            <button type="button" className="px-btn" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
