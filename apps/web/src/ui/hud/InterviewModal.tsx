import { useCallback, useEffect, useRef, useState } from 'react';
import type { InterviewView } from '@sims/shared';
import { getInterview, postInterviewAnswer } from '../../net/hostingApi';

const COMPILE_POLL_MS = 1_500;

/**
 * 人设访谈弹窗(M4e):对话式 5~8 问,LLM 动态追问;收尾后生成人设卡。
 * 打开即 GET 恢复进行中会话;idle 时 POST {} 领首问;compiling 轮询至 done。
 */
export function InterviewModal({
  characterId,
  characterName,
  onClose,
}: {
  characterId: string;
  characterName: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<InterviewView | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apply = useCallback((next: InterviewView) => {
    setView(next);
    setError(next.error);
  }, []);

  const send = useCallback(
    async (answer?: string): Promise<void> => {
      if (busy) return;
      setBusy(true);
      try {
        apply(await postInterviewAnswer(characterId, answer));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, characterId, apply],
  );

  // 打开即恢复会话;idle 自动领首问
  useEffect(() => {
    let cancelled = false;
    getInterview(characterId)
      .then((restored) => {
        if (cancelled) return;
        if (restored.status === 'idle') {
          void send();
        } else {
          apply(restored);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, apply, send]);

  // compiling 轮询(人设卡生成中)
  useEffect(() => {
    if (view?.status !== 'compiling') return;
    const timer = setInterval(() => {
      getInterview(characterId)
        .then(apply)
        .catch(() => {});
    }, COMPILE_POLL_MS);
    pollRef.current = timer;
    return () => {
      clearInterval(timer);
      pollRef.current = null;
    };
  }, [view?.status, characterId, apply]);

  // 新消息自动滚底
  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [view?.messages.length]);

  const submit = (): void => {
    const text = draft.trim();
    if (text === '') return;
    setDraft('');
    void send(text);
  };

  const status = view?.status ?? 'idle';
  const done = status === 'done';
  const card = view?.card ?? null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="px-box settings-modal interview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <h2>🗣 {characterName} · 人设访谈</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="hint">
          {done
            ? '访谈已完成,人设卡已生效(影响 TA 的日程与决策)。'
            : '聊几句让 Agent 认识你设想中的角色(5~8 问),完成后生成人设卡。'}
          {view !== null && !done && view.questionCount > 0 && (
            <span className="interview-count"> 第 {view.questionCount}/8 问</span>
          )}
        </p>

        <div className="interview-log" ref={logRef}>
          {(view?.messages ?? []).map((message, index) => (
            <p key={index} className={`interview-msg ${message.role}`}>
              <span>{message.role === 'agent' ? '🤖' : '🙂'}</span>
              <b>{message.text}</b>
            </p>
          ))}
          {status === 'compiling' && (
            <p className="interview-msg agent">
              <span>🤖</span>
              <b>正在整理你的人设卡…</b>
            </p>
          )}
        </div>

        {card !== null && (
          <div className="settings-section interview-card">
            <b>人设卡</b>
            <p>性格: {card['性格']}</p>
            <p>兴趣: {card['兴趣']}</p>
            <p>目标: {card['目标']}</p>
            <p>说话风格: {card['说话风格']}</p>
            {card.bio !== '' && <p className="hint">{card.bio}</p>}
          </div>
        )}

        {error !== null && <p className="feedback err">{error}</p>}

        {!done && status !== 'compiling' && (
          <div className="interview-input">
            <input
              autoFocus
              value={draft}
              placeholder="输入你的回答…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <button type="button" className="px-btn" disabled={busy || draft.trim() === ''} onClick={submit}>
              {busy ? '…' : '发送'}
            </button>
          </div>
        )}
        <div className="settings-actions">
          <button type="button" className="px-btn" onClick={onClose}>
            {done ? '完成' : '稍后再聊'}
          </button>
        </div>
      </div>
    </div>
  );
}
