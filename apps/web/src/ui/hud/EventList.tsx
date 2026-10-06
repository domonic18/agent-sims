import { useWorldStore } from '../../store/worldStore';
import { eventLogLabel } from './eventLog';
import { useEventClock } from './useEventClock';

/** 世界事件紧凑列表(UI-1 C5): Lab 右栏实时事件流,倒序最新在上,复用日志中文格式化 */
export function EventList({ limit = 80 }: { limit?: number }): JSX.Element {
  const events = useWorldStore((state) => state.events);
  const eventSeq = useWorldStore((state) => state.eventSeq);
  const snapshot = useWorldStore((state) => state.snapshot);

  const timeOf = useEventClock(events, snapshot?.clock, eventSeq);
  const nameOf = (id: string): string =>
    snapshot?.characters.find((item) => item.id === id)?.name ?? id;

  const rows = events.slice(-limit).reverse();

  if (rows.length === 0) {
    return <p className="hint">暂无事件——世界运行后此处实时滚动</p>;
  }
  return (
    <ul className="event-list">
      {rows.map((item) => {
        const label = eventLogLabel(item.event, nameOf);
        return (
          <li key={item.seq} className={`tone-${label.tone}`}>
            <span className="event-time">{timeOf(item.seq)}</span>
            <span className="event-icon">{label.icon}</span>
            <span className="event-text">{label.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
