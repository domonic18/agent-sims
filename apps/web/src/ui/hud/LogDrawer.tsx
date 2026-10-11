import { useEffect, useRef, useState } from 'react';
import type { WorldEvent, WorldEventHistoryEntry } from '@sims/shared';
import { useWorldStore } from '../../store/worldStore';
import { useToastStore } from '../../store/toastStore';
import {
  CATEGORY_EVENT_TYPES,
  EVENT_CATEGORY_LABEL,
  eventLogCategory,
  eventLogLabel,
  eventLogNotable,
  eventParticipantsKnown,
} from './eventLog';
import { useEventClock } from './useEventClock';
import { useCharacterLookup } from './useCharacterLookup';
import { loadEventHistory } from './loadEventHistory';
import { useScrollToBottom } from './useScrollToBottom';
import { ChatBlock } from './chatBlock';

const FILTERS = ['all', 'work', 'social', 'life', 'world'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: '全部',
  ...EVENT_CATEGORY_LABEL,
};

/**
 * 世界日志抽屉(UI-1 C3/C4): 右上 📜 开关+未读角标(关抽屉期间 eventSeq 增量),
 * 实时流消费 worldStore.events;打开时按当前分类回填服务端历史段(分隔线之下为实时,
 * 全部=最近 500 条,单分类=按 types 过滤——到达/活动类事件刷屏,整段拉取会把
 * 工作/社交类挤空,分类页签显示成永远「暂无日志」);
 * 筛选 chips;条目=游戏时间+icon+中文文本,数值增减着色;点击条目定位关联角色。
 * UI-R.3: social.chat 渲染为对话块(奇偶分侧气泡),其余事件走时间线;
 * 「精简/全部」降噪档(默认精简,VERBOSE_HIDDEN 之外的才显示,localStorage 持久,
 * 未读角标恒全量计);相邻游戏日插天分隔线。
 */
export function LogDrawer(): JSX.Element {
  const events = useWorldStore((state) => state.events);
  const eventSeq = useWorldStore((state) => state.eventSeq);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  // 降噪档(默认精简): 精简隐藏移动/活动起止等 tick 级噪音,localStorage 持久;
  // 未读角标仍按全量 eventSeq 计,不受此档影响
  const [verbose, setVerbose] = useState(() => localStorage.getItem('sims.log.verbose') === '1');
  const verboseToastedRef = useRef(false);
  const toastPush = useToastStore((state) => state.push);
  // 未读基准: 关抽屉时记录 eventSeq,重开清零;用计数差而非数组(环形队列会丢旧条目)
  const seenSeqRef = useRef(0);
  const [unread, setUnread] = useState(0);

  const applyVerbose = (next: boolean): void => {
    setVerbose(next);
    localStorage.setItem('sims.log.verbose', next ? '1' : '0');
    if (!verboseToastedRef.current) {
      verboseToastedRef.current = true;
      toastPush(true, next ? '已显示全部事件(含移动/活动等噪音)' : '已精简:移动/活动等噪音已隐藏');
    }
  };

  // 条目到达时的游戏时间(同 tick 内多条共用同一时刻)
  const timeOf = useEventClock(events, snapshot?.clock, eventSeq);

  // 历史段(C4): 打开时按当前分类回填服务端历史(每分类拉一次,切换页签按需补拉,
  // 失败静默可重试),与实时段按 type+tick+characterId 去重
  const [historyByFilter, setHistoryByFilter] = useState<Map<Filter, WorldEventHistoryEntry[]>>(
    () => new Map(),
  );
  const fetchingRef = useRef(false);

  const listRef = useRef<HTMLDivElement>(null);

  if (open && seenSeqRef.current !== eventSeq) {
    seenSeqRef.current = eventSeq;
  }
  const pendingUnread = eventSeq - seenSeqRef.current;
  if (!open && pendingUnread !== unread) {
    setUnread(pendingUnread);
  }

  // 开抽屉/新条目时滚到最新
  useScrollToBottom(listRef, [open, events], open);

  // 按分类回填历史段;失败静默(切回该页签重试),不影响实时流
  useEffect(() => {
    if (!open || historyByFilter.has(filter) || fetchingRef.current) return;
    fetchingRef.current = true;
    void (async () => {
      try {
        const entries = await loadEventHistory(
          filter === 'all'
            ? { limit: 500 }
            : { limit: 200, types: CATEGORY_EVENT_TYPES[filter] },
          useWorldStore.getState().events,
        );
        setHistoryByFilter((prev) => new Map(prev).set(filter, entries));
      } catch {
        // 留空待重试
      } finally {
        fetchingRef.current = false;
      }
    })();
  }, [open, filter, historyByFilter]);

  const { nameOf, known } = useCharacterLookup(snapshot);

  const byCategory = (event: WorldEvent): boolean =>
    filter === 'all' || eventLogCategory(event) === filter;
  // 降噪过滤只在此处(去重与当事人校验之后)追加,历史段与实时段同规则
  const byVerbose = (event: WorldEvent): boolean => verbose || eventLogNotable(event);

  const history = historyByFilter.get(filter) ?? null;
  const historyVisible = (history ?? []).filter(
    (entry) =>
      byCategory(entry.event) && eventParticipantsKnown(entry.event, known) && byVerbose(entry.event),
  );
  const visible = events.filter((item) => byCategory(item.event) && byVerbose(item.event));

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

  /** social.chat 走对话块(微信式气泡),其余事件走时间线行 */
  const renderItem = (key: number, event: WorldEvent, timeText: string): JSX.Element => {
    if (event.type === 'social.chat') {
      return (
        <ChatBlock
          key={`chat-${key}`}
          event={event}
          nameOf={nameOf}
          timeText={timeText}
          onLocate={selectCharacter}
        />
      );
    }
    return renderRow(key, event, timeText);
  };

  /** 相邻条目游戏日变化时插天分隔线(timeText 形如「第N天 hh:mm」,解析不出不插) */
  const withDaySeparators = (prefix: string, rows: Array<{ day: number | null; el: JSX.Element }>): JSX.Element[] => {
    const out: JSX.Element[] = [];
    let lastDay: number | null = null;
    for (const row of rows) {
      if (row.day !== null && row.day !== lastDay) {
        out.push(
          <p key={`${prefix}-day-${row.day}-${out.length}`} className="log-day-sep">
            第 {row.day} 天
          </p>,
        );
        lastDay = row.day;
      }
      out.push(row.el);
    }
    return out;
  };

  const dayOf = (timeText: string): number | null => {
    const match = /^第(\d+)天/.exec(timeText);
    return match === null ? null : Number(match[1]);
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
                <span className="log-chip-sep" />
                <button
                  type="button"
                  className={`px-btn sq${verbose ? '' : ' on'}`}
                  title="只看关键事件(隐藏移动/活动等噪音)"
                  onClick={() => applyVerbose(false)}
                >
                  精简
                </button>
                <button
                  type="button"
                  className={`px-btn sq${verbose ? ' on' : ''}`}
                  title="显示全部事件"
                  onClick={() => applyVerbose(true)}
                >
                  全部
                </button>
              </div>
            </div>
            <div className="log-list" ref={listRef}>
              {history !== null &&
                withDaySeparators(
                  'h',
                  historyVisible.map((entry) => ({
                    day: entry.day,
                    el: renderItem(entry.id, entry.event, `第${entry.day}天 ${entry.time}`),
                  })),
                )}
              {history !== null && historyVisible.length > 0 && (
                <p className="log-history-sep">以上为历史</p>
              )}
              {history === null && <p className="log-empty">加载中…</p>}
              {history !== null && visible.length === 0 && historyVisible.length === 0 && (
                <p className="log-empty">暂无日志</p>
              )}
              {withDaySeparators(
                'r',
                visible.map((item) => ({
                  day: dayOf(timeOf(item.seq)),
                  el: renderItem(item.seq, item.event, timeOf(item.seq)),
                })),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
