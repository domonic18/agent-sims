import { useEffect, useRef, useState } from 'react';
import type { WorldEvent, WorldEventHistoryEntry } from '@sims/shared';
import { getWorldEvents } from '../../net/worldApi';
import { useWorldStore } from '../../store/worldStore';
import {
  EVENT_CATEGORY_LABEL,
  eventLogCategory,
  eventLogLabel,
} from './eventLog';
import { useEventClock } from './useEventClock';

const FILTERS = ['all', 'work', 'social', 'life', 'world'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: '全部',
  ...EVENT_CATEGORY_LABEL,
};

/** 历史段与实时段去重键(同 tick 同类型同角色视为同一条;环形窗口内事件即全量广播也全量落库) */
const dedupeKey = (event: WorldEvent): string =>
  `${event.type}|${event.tick}|${'characterId' in event ? event.characterId : ''}`;

/**
 * 世界日志抽屉(UI-1 C3/C4): 右上 📜 开关+未读角标(关抽屉期间 eventSeq 增量),
 * 实时流消费 worldStore.events;首次打开回填服务端历史段(分隔线之下为实时);
 * 筛选 chips;条目=游戏时间+icon+中文文本,数值增减着色;点击条目定位关联角色。
 */
export function LogDrawer(): JSX.Element {
  const events = useWorldStore((state) => state.events);
  const eventSeq = useWorldStore((state) => state.eventSeq);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  // 未读基准: 关抽屉时记录 eventSeq,重开清零;用计数差而非数组(环形队列会丢旧条目)
  const seenSeqRef = useRef(0);
  const [unread, setUnread] = useState(0);

  // 条目到达时的游戏时间(同 tick 内多条共用同一时刻)
  const timeOf = useEventClock(events, snapshot?.clock, eventSeq);

  // 历史段(C4): 首次打开时拉服务端最近事件回填,与实时段按 type+tick+characterId 去重
  const [history, setHistory] = useState<WorldEventHistoryEntry[] | null>(null);
  const historyTriedRef = useRef(false);

  const listRef = useRef<HTMLDivElement>(null);

  if (open && seenSeqRef.current !== eventSeq) {
    seenSeqRef.current = eventSeq;
  }
  const pendingUnread = eventSeq - seenSeqRef.current;
  if (!open && pendingUnread !== unread) {
    setUnread(pendingUnread);
  }

  // 开抽屉/新条目时滚到最新
  useEffect(() => {
    if (open && listRef.current !== null) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, events]);

  // 首次打开回填历史段;失败静默(下次重开重试),不影响实时流
  useEffect(() => {
    if (!open || historyTriedRef.current) return;
    historyTriedRef.current = true;
    void (async () => {
      try {
        const resp = await getWorldEvents({ limit: 100 });
        const seen = new Set(
          useWorldStore
            .getState()
            .events.map((item) => dedupeKey(item.event)),
        );
        setHistory(resp.entries.filter((entry) => !seen.has(dedupeKey(entry.event))).reverse());
      } catch {
        historyTriedRef.current = false;
      }
    })();
  }, [open]);

  const nameOf = (id: string): string =>
    snapshot?.characters.find((item) => item.id === id)?.name ?? id;

  const byCategory = (type: WorldEvent['type']): boolean =>
    filter === 'all' || eventLogCategory(type) === filter;

  const historyVisible = (history ?? []).filter((entry) => byCategory(entry.event.type));
  const visible = events.filter((item) => byCategory(item.event.type));

  const renderRow = (key: number, event: WorldEvent, timeText: string): JSX.Element => {
    const label = eventLogLabel(event, nameOf);
    return (
      <button
        key={key}
        type="button"
        className={`log-entry tone-${label.tone}${label.characterId !== null ? ' has-char' : ''}`}
        title={label.characterId !== null ? '点击定位该角色' : ''}
        onClick={() => {
          if (label.characterId !== null) selectCharacter(label.characterId);
        }}
      >
        <span className="log-time">{timeText}</span>
        <span className="log-icon">{label.icon}</span>
        <span className="log-text">{label.text}</span>
      </button>
    );
  };

  return (
    <div className="log-root">
      <button
        type="button"
        className="px-btn big"
        title="世界日志"
        onClick={() => setOpen((value) => !value)}
      >
        📜
        {unread > 0 && <span className="px-badge log-unread">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="px-box log-drawer">
          <div className="px-inner log-drawer-inner">
            <div className="log-head">
              <b>世界日志</b>
              <div className="log-chips">
                {FILTERS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`px-btn sq${filter === item ? ' on' : ''}`}
                    title={FILTER_LABEL[item]}
                    onClick={() => setFilter(item)}
                  >
                    {FILTER_LABEL[item]}
                  </button>
                ))}
              </div>
            </div>
            <div className="log-list" ref={listRef}>
              {history !== null &&
                historyVisible.map((entry) =>
                  renderRow(entry.id, entry.event, `第${entry.day}天 ${entry.time}`),
                )}
              {history !== null && historyVisible.length > 0 && (
                <p className="log-history-sep">以上为历史</p>
              )}
              {visible.length === 0 && historyVisible.length === 0 && (
                <p className="log-empty">暂无日志</p>
              )}
              {visible.map((item) =>
                renderRow(item.seq, item.event, timeOf(item.seq)),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
