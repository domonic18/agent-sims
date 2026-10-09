import { useEffect, useRef, useState } from 'react';
import type { WorldEvent, WorldEventHistoryEntry } from '@sims/shared';
import { useWorldStore } from '../../store/worldStore';
import { eventDedupeKey, eventLogLabel, eventParticipantsKnown } from './eventLog';
import { useEventClock } from './useEventClock';
import { useCharacterLookup } from './useCharacterLookup';
import { loadEventHistory } from './loadEventHistory';
import { useScrollToBottom } from './useScrollToBottom';

const CHAT_TYPE = 'social.chat';
const HISTORY_LIMIT = 30;
const COLLAPSE_KEY = 'chat-log-collapsed';

/**
 * 左下角对话记录(社交 v1):谁跟谁说了什么的常驻轻量流——头顶气泡 3.5 秒即逝,
 * 错过就没了;这里按 social.chat 事件留存(打开时回填服务端最近 30 条+实时流续写)。
 * 半透明窄面板贴边不遮画面,游客/管理员同样可见;▾ 收起为一枚小药丸。
 */
export function ChatLog(): JSX.Element {
  const events = useWorldStore((state) => state.events);
  const snapshot = useWorldStore((state) => state.snapshot);
  const eventSeq = useWorldStore((state) => state.eventSeq);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const timeOf = useEventClock(events, snapshot?.clock, eventSeq);
  const listRef = useRef<HTMLDivElement>(null);

  // 历史段: 首次装载拉服务端最近对话(与实时段按 type+tick+characterId 去重);失败静默不重试
  const [history, setHistory] = useState<WorldEventHistoryEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await loadEventHistory(
          { limit: HISTORY_LIMIT, type: CHAT_TYPE },
          events,
        );
        if (!cancelled) setHistory(entries);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { nameOf, known } = useCharacterLookup(snapshot);

  // 当事人不在当前世界快照的条目(旧世界残留)整条隐去,避免裸 id 行
  const chatKnown = (event: WorldEvent): boolean => eventParticipantsKnown(event, known);
  const live = events.filter((item) => item.event.type === CHAT_TYPE && chatKnown(item.event));
  const seen = new Set(live.map((item) => eventDedupeKey(item.event)));
  const historyVisible = (history ?? []).filter(
    (entry) => !seen.has(eventDedupeKey(entry.event)) && chatKnown(entry.event),
  );

  useScrollToBottom(listRef, [collapsed, history, live], !collapsed);

  const toggle = (): void => {
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1');
      return !value;
    });
  };

  const renderRow = (key: number | string, event: WorldEvent, timeText: string): JSX.Element => {
    const label = eventLogLabel(event, nameOf);
    return (
      <div key={key} className="chat-entry">
        <span className="log-time">{timeText}</span>
        <span className="log-icon">{label.icon}</span>
        <span className="chat-text">{label.text}</span>
      </div>
    );
  };

  if (collapsed) {
    return (
      <button type="button" className="px-box chat-log chat-log-collapsed" title="展开对话记录" onClick={toggle}>
        <span className="chat-log-pill">💬 对话</span>
      </button>
    );
  }

  return (
    <div className="px-box chat-log">
      <div className="px-inner chat-log-inner">
        <div className="chat-log-head">
          <b>对话记录</b>
          <button
            type="button"
            className="px-btn sq chat-log-toggle"
            title="收起(不遮挡画面)"
            onClick={toggle}
          >
            ▾
          </button>
        </div>
        <div className="chat-log-list" ref={listRef}>
          {history === null && <p className="log-empty">加载中…</p>}
          {history !== null && historyVisible.length === 0 && live.length === 0 && (
            <p className="log-empty">还没有人聊过天</p>
          )}
          {historyVisible.map((entry) => renderRow(entry.id, entry.event, `第${entry.day}天 ${entry.time}`))}
          {live.map((item) => renderRow(item.seq, item.event, timeOf(item.seq)))}
        </div>
      </div>
    </div>
  );
}
