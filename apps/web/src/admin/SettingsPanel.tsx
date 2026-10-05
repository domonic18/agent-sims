import { useCallback, useEffect, useState } from 'react';
import {
  SYS_CONFIG_EFFECT_LABELS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
  type SysConfigField,
  type SysConfigView,
} from '@sims/shared';
import { changePassword, fetchSysConfig, resetSysConfig, updateSysConfig } from './api';

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

const formatValue = (field: SysConfigField, value: number): string =>
  field.type === 'float' ? String(value) : String(Math.round(value));

function SystemParamsCard() {
  const [view, setView] = useState<SysConfigView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyView = useCallback((data: SysConfigView) => {
    setView(data);
    setDraft(
      Object.fromEntries(data.fields.map((field) => [field.key, formatValue(field, data.effective[field.key] ?? data.defaults[field.key] ?? 0)])),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchSysConfig()
      .then((data) => {
        if (!cancelled) applyView(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [applyView]);

  const save = async (): Promise<void> => {
    if (view === null) return;
    const updates: Record<string, number> = {};
    for (const field of view.fields) {
      const raw = draft[field.key]?.trim() ?? '';
      const value = field.type === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
      if (!Number.isFinite(value)) {
        setError(`「${field.label}」不是合法数字`);
        return;
      }
      updates[field.key] = value;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      applyView(await updateSysConfig(updates));
      setNotice('参数已保存并热更新生效');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const restoreDefaults = async (): Promise<void> => {
    if (!window.confirm('恢复全部系统参数为出厂默认值?')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      applyView(await resetSysConfig());
      setNotice('已恢复默认值(覆盖记录已清空)');
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败');
    } finally {
      setBusy(false);
    }
  };

  const dirty =
    view !== null &&
    view.fields.some(
      (field) => (draft[field.key]?.trim() ?? '') !== formatValue(field, view.effective[field.key] ?? 0),
    );

  return (
    <section className="settings-card">
      <h2>系统参数</h2>
      <p className="settings-card-sub">
        运行时数值热调(保存即生效);仅含服务端参数——移速/背包容积/时间倍率档位等双端同源常量与时序基建不开放
      </p>
      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-ok">{notice}</p>}
      {!view && !error && <p className="admin-muted">加载中…</p>}
      {view && (
        <>
          {SYS_CONFIG_GROUPS.map((group) => (
            <div className="settings-group" key={group}>
              <h3>{SYS_CONFIG_GROUP_LABELS[group]}</h3>
              <div className="settings-grid">
                {view.fields
                  .filter((field) => field.group === group)
                  .map((field) => (
                    <label key={field.key} className="settings-field">
                      <span className="settings-field-head">
                        <span>{field.label}</span>
                        <span className={`settings-effect ${field.effect}`}>
                          {SYS_CONFIG_EFFECT_LABELS[field.effect]}
                        </span>
                      </span>
                      <input
                        inputMode="decimal"
                        value={draft[field.key] ?? ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      />
                      <small>
                        {field.desc} · 范围 {field.min}~{field.max}
                        {view.overrides[field.key] !== undefined ? ' · 已自定义' : ''}
                      </small>
                    </label>
                  ))}
              </div>
            </div>
          ))}
          <div className="settings-actions">
            <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? '保存中…' : '保存并生效'}
            </button>
            <button type="button" className="admin-secondary" disabled={busy} onClick={() => void restoreDefaults()}>
              恢复默认
            </button>
            <button type="button" className="admin-secondary" disabled={busy || !dirty} onClick={() => applyView(view)}>
              放弃改动
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function SettingsPanel(props: { username: string }) {
  return (
    <div className="settings-panel">
      <AccountSecurityCard username={props.username} />
      <SystemParamsCard />
    </div>
  );
}
