import { useCallback, useEffect, useRef, useState } from 'react';
import type { MindTalkView } from '@sims/shared';
import { getMindTalk, sendMindTalk } from '../../net/hostingApi';

/**
 * 意识访谈弹窗(观察者定位): 与 agent 自由对话,TA 基于自身记忆/最近念头/人设第一人称回答;
 * 每轮问答写回 TA 的记忆(访谈本身成为 TA 的经历)。打开即 GET 恢复会话(服务端 15 分钟内存会话)。
 */
export function MindTalkModal({
  characterId,
  characterName,
  onClose,
}: {
  characterId: string;
  characterName: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<MindTalkView | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  // 打开即恢复会话(断线重连不丢上下文)
  useEffect(() => {
    let cancelled = false;
    getMindTalk(characterId)
      .then((restored) => {
        if (!cancelled) setView(restored);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (busy) return;
      setBusy(true);
      try {
        setView(await sendMindTalk(characterId, text));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, characterId],
  );

  // 新消息自动滚底
  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [view?.messages.length, busy]);

  const submit = (): void => {
    const text = draft.trim();
    if (text === '' || busy) return;
    setDraft('');
    void send(text);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="px-box settings-modal mindtalk-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <h2>🗣 {characterName} · 意识访谈</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="hint">
          以观察者身份和 TA 聊聊——TA 会基于自己的记忆、最近念头与人设第一人称回答;问答也会成为 TA 的经历。
        </p>

        <div className="mindtalk-log" ref={logRef}>
          {(view?.messages ?? []).map((message, index) => (
            <p key={index} className={`mindtalk-msg ${message.role}`}>
              <span>{message.role === 'agent' ? '🤖' : '🙂'}</span>
              <b>{message.text}</b>
            </p>
          ))}
          {busy && (
            <p className="mindtalk-msg agent">
              <span>🤖</span>
              <b>……</b>
            </p>
          )}
        </div>

        {error !== null && <p className="feedback err">{error}</p>}

        <div className="mindtalk-input">
          <input
            autoFocus
            value={draft}
            placeholder="问点 TA 什么…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button type="button" className="px-btn" disabled={busy || draft.trim() === ''} onClick={submit}>
            {busy ? '…' : '发送'}
          </button>
        </div>
        <div className="settings-actions">
          <button type="button" className="px-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
