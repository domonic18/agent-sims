import type { WorldEvent, WorldEventHistoryEntry } from '@sims/shared';
import { getWorldEvents } from '../../net/worldApi';
import { eventDedupeKey } from './eventLog';

/** 服务端历史回填共用段: 请求+与实时段按 eventDedupeKey 去重+reverse 成旧→新。
 * 失败语义(LogDrawer 静默可重试 / ChatLog 一次性置空)与请求时机由调用方 effect 表达,不在本层 */
export async function loadEventHistory(
  query: { limit: number; type?: string; types?: string[] },
  liveEvents: ReadonlyArray<{ event: WorldEvent }>,
): Promise<WorldEventHistoryEntry[]> {
  const resp = await getWorldEvents(query);
  const seen = new Set(liveEvents.map((item) => eventDedupeKey(item.event)));
  return resp.entries.filter((entry) => !seen.has(eventDedupeKey(entry.event))).reverse();
}
