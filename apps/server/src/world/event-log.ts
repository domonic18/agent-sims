import type { WorldEvent } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { worldEvents } from '../db/schema/index.js';
import type { EventBus } from './event-bus.js';

/** 事件各形态角色字段(characterId/fromId/aId…)统一提取为筛选用主角色 */
export function eventCharacterId(event: WorldEvent): string | null {
  if ('characterId' in event) return event.characterId;
  if ('fromId' in event) return event.fromId;
  if ('aId' in event) return event.aId;
  return null;
}

/**
 * 世界事件落库订阅(M-G.1①):EventBus 承诺纯逻辑零 I/O,落库挂在宿主侧;
 * 串行异步链写入(事件高峰不并发挤爆连接),写失败仅记 console 不回灌世界。
 */
export function attachWorldEventLog(handle: DbHandle, events: EventBus<WorldEvent>): void {
  let chain: Promise<void> = Promise.resolve();
  events.subscribe((event) => {
    chain = chain
      .then(async () => {
        await handle.db.insert(worldEvents).values({
          type: event.type,
          characterId: eventCharacterId(event),
          tick: event.tick,
          payload: event,
        });
      })
      .catch((err: unknown) => {
        console.error('[event-log] 世界事件落库失败', err);
      });
  });
}
