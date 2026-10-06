import { useEffect, useRef, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import {
  EVENT_CATEGORY_LABEL,
  eventLogCategory,
  eventLogLabel,
} from './eventLog';

const FILTERS = ['all', 'work', 'social', 'life', 'world'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: '全部',
  ...EVENT_CATEGORY_LABEL,
};

/**
 * 世界日志抽屉(UI-1 C3): 右上 📜 开关+未读角标(关抽屉期间 eventSeq 增量),
 * 实时流消费 worldStore.events;筛选 chips;条目=游戏时间+icon+中文文本,
 * 数值增减着色;点击条目定位关联角色。C4 将在打开时回填服务端历史段。
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

  // 条目到达时的游戏时间(同 tick 内多条共用同一时刻,环形足够)
  const clockBySeqRef = useRef(new Map<number, string>());
  const listRef = useRef<HTMLDivElement>(null);

  if (open && seenSeqRef.current !== eventSeq) {
    seenSeqRef.current = eventSeq;
  }
  const pendingUnread = eventSeq - seenSeqRef.current;
  if (!open && pendingUnread !== unread) {
    setUnread(pendingUnread);
  }

  // 事件到达即打时间标(无论抽屉开关),关闭期间到达的条目也保留到达时刻
  useEffect(() => {
    const clock = snapshot?.clock;
    const label = clock !== undefined ? `第${clock.day}天 ${clock.time}` : '';
    for (const item of events) {
      if (!clockBySeqRef.current.has(item.seq)) {
        clockBySeqRef.current.set(item.seq, label);
      }
    }
    // 环形队列丢掉的条目顺带清理,防 map 无界增长
    if (clockBySeqRef.current.size > 256) {
      const minAlive = events[0]?.seq ?? eventSeq;
      for (const seq of clockBySeqRef.current.keys()) {
        if (seq < minAlive) clockBySeqRef.current.delete(seq);
      }
    }
  }, [events, snapshot, eventSeq]);

  // 开抽屉/新条目时滚到最新
  useEffect(() => {
    if (open && listRef.current !== null) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, events]);

  const nameOf = (id: string): string =>
    snapshot?.characters.find((item) => item.id === id)?.name ?? id;

  const visible = events.filter(
    (item) => filter === 'all' || eventLogCategory(item.event.type) === filter,
  );

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
              {visible.length === 0 && <p className="log-empty">暂无日志</p>}
              {visible.map((item) => {
                const label = eventLogLabel(item.event, nameOf);
                return (
                  <button
                    key={item.seq}
                    type="button"
                    className={`log-entry tone-${label.tone}${label.characterId !== null ? ' has-char' : ''}`}
                    title={label.characterId !== null ? '点击定位该角色' : ''}
                    onClick={() => {
                      if (label.characterId !== null) selectCharacter(label.characterId);
                    }}
                  >
                    <span className="log-time">{clockBySeqRef.current.get(item.seq) ?? ''}</span>
                    <span className="log-icon">{label.icon}</span>
                    <span className="log-text">{label.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
