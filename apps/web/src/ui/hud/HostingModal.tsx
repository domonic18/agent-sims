import { useEffect, useState } from 'react';
import type { HostingStateView } from '@sims/shared';
import { getHosting, setHosting } from '../../net/hostingApi';

/**
 * 托管弹窗(M4e):全托管/生活方针两模式切换,托管中可一键接管。
 * 打开即 GET 回填;切换走 POST(<1s 生效,方针编译异步不阻塞),
 * 徽标跨端经 hosting_changed 事件保鲜,此处不再直写 store。
 */
export function HostingModal({
  characterId,
  characterName,
  onClose,
}: {
  characterId: string;
  characterName: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<HostingStateView | null>(null);
  const [mode, setMode] = useState<'full' | 'policy'>('policy');
  const [policyText, setPolicyText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHosting(characterId)
      .then((view) => {
        if (cancelled) return;
        setState(view);
        if (view.mode === 'full') setMode('full');
        if (view.policyText !== null) {
          setMode('policy');
          setPolicyText(view.policyText);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  const submit = async (enabled: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload =
        enabled && mode === 'policy' ? { enabled, mode, policyText } : { enabled, mode };
      const view = await setHosting(characterId, payload);
      setState(view);
      if (view.mode === 'policy' && view.policyText !== null) setPolicyText(view.policyText);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hosted = state?.hosted ?? false;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="px-box settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <h2>🤖 {characterName} · 托管</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="hint">
          {hosted
            ? '托管中:角色的日程与行动由 Agent 接管,你的操作会被拒绝;点击「接管」收回操控权。'
            : '把角色托管给 Agent 自主生活:全托管=Agent 完全自主;生活方针=Agent 按你写下的方针安排日程(推荐)。'}
        </p>

        {!hosted && (
          <>
            <div className="settings-section">
              <label className="hosting-mode-row">
                <input
                  type="radio"
                  checked={mode === 'policy'}
                  onChange={() => setMode('policy')}
                />
                <span>
                  <b>生活方针(推荐)</b>
                  <small>用一段话写下你希望 TA 怎么生活,Agent 据此安排日程</small>
                </span>
              </label>
              <label className="hosting-mode-row">
                <input
                  type="radio"
                  checked={mode === 'full'}
                  onChange={() => setMode('full')}
                />
                <span>
                  <b>全托管</b>
                  <small>Agent 完全自主安排,不附加约束</small>
                </span>
              </label>
            </div>
            {mode === 'policy' && (
              <div className="settings-section">
                <label className="hosting-policy">
                  <span>生活方针</span>
                  <textarea
                    rows={4}
                    maxLength={2000}
                    placeholder="例: 专注学习攒钱,少到处闲逛;身体是本钱,每天锻炼。"
                    value={policyText}
                    onChange={(e) => setPolicyText(e.target.value)}
                  />
                </label>
              </div>
            )}
          </>
        )}

        {hosted && state !== null && (
          <div className="settings-section">
            <p className="hint">
              当前模式:
              <b>{state.mode === 'policy' ? '生活方针' : '全托管'}</b>
              {state.policyText !== null && (
                <>
                  <br />
                  方针: {state.policyText}
                </>
              )}
            </p>
          </div>
        )}

        {error !== null && <p className="feedback err">{error}</p>}

        <div className="settings-actions">
          {hosted ? (
            <button
              type="button"
              className="px-btn go"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              {busy ? '处理中…' : '🎮 接管'}
            </button>
          ) : (
            <button
              type="button"
              className="px-btn go"
              disabled={busy || (mode === 'policy' && policyText.trim() === '')}
              onClick={() => void submit(true)}
            >
              {busy ? '处理中…' : '🤖 开始托管'}
            </button>
          )}
          <button type="button" className="px-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
