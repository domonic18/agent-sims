import { useEffect, useRef } from 'react';
import type { SequencedEvent } from '../../store/worldStore';

/**
 * 事件到达时刻表(UI-1 C3): 事件进流即打游戏时间标(无论抽屉/列表开关),
 * 同 tick 内多条共用同一时刻;环形队列丢条目时顺带清理防 map 无界增长。
 * 返回 seq → 「第N天 hh:mm」查取函数(未知 seq 返回空串)。
 */
export function useEventClock(
  events: SequencedEvent[],
  clock: { day: number; time: string } | undefined,
  eventSeq: number,
): (seq: number) => string {
  const clockBySeqRef = useRef(new Map<number, string>());

  useEffect(() => {
    const label = clock !== undefined ? `第${clock.day}天 ${clock.time}` : '';
    for (const item of events) {
      if (!clockBySeqRef.current.has(item.seq)) {
        clockBySeqRef.current.set(item.seq, label);
      }
    }
    if (clockBySeqRef.current.size > 256) {
      const minAlive = events[0]?.seq ?? eventSeq;
      for (const seq of clockBySeqRef.current.keys()) {
        if (seq < minAlive) clockBySeqRef.current.delete(seq);
      }
    }
  }, [events, clock, eventSeq]);

  return (seq: number): string => clockBySeqRef.current.get(seq) ?? '';
}
