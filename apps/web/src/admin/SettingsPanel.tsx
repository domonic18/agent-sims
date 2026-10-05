import { useState } from 'react';
import { changePassword } from './api';

function AccountSecurityCard(props: { username: string }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (newPassword !== confirm) {
      setNotice({ kind: 'error', text: '两次输入的新密码不一致' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await changePassword({ oldPassword, newPassword });
      setNotice({ kind: 'ok', text: '密码已更新,当前登录态不受影响' });
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : '修改失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card">
      <h2>账户安全</h2>
      <p className="settings-card-sub">
        当前账户 <b>{props.username || 'admin'}</b> · 修改后下次登录使用新密码
      </p>
      <div className="settings-form">
        <label>
          原密码
          <input
            type="password"
            value={oldPassword}
            autoComplete="current-password"
            onChange={(e) => setOldPassword(e.target.value)}
          />
        </label>
        <label>
          新密码(8~64 位)
          <input
            type="password"
            value={newPassword}
            autoComplete="new-password"
            placeholder="至少 8 位"
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <label>
          确认新密码
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      </div>
      {notice && <p className={notice.kind === 'ok' ? 'admin-ok' : 'admin-error'}>{notice.text}</p>}
      <div className="settings-actions">
        <button
          type="button"
          disabled={busy || !oldPassword || newPassword.length < 8 || !confirm}
          onClick={() => void submit()}
        >
          {busy ? '提交中…' : '修改密码'}
        </button>
      </div>
    </section>
  );
}

export function SettingsPanel(props: { username: string }) {
  return (
    <div className="settings-panel">
      <AccountSecurityCard username={props.username} />
    </div>
  );
}
