import type { WorldEvent } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { dialogues, worldEvents } from '../db/schema/index.js';
import type { EventBus } from './event-bus.js';
import { getWorldId } from './world-id.js';

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
export function attachWorldEventLog(
  handle: DbHandle,
  events: EventBus<WorldEvent>,
): { dispose(): void } {
  let chain: Promise<void> = Promise.resolve();
  const unsubscribe = events.subscribe((event) => {
    chain = chain
      .then(async () => {
        await handle.db.insert(worldEvents).values({
          type: event.type,
          characterId: eventCharacterId(event),
          worldId: getWorldId(),
          tick: event.tick,
          payload: event,
        });
        // D5:对话原文落 dialogues(此前表无写入方);与事件流同链串行,失败不回灌世界
        if (event.type === 'social.chat') {
          await handle.db.insert(dialogues).values({
            speakerId: event.fromId,
            listenerId: event.toId,
            content: event.content,
          });
        }
      })
      .catch((err: unknown) => {
        console.error('[event-log] 世界事件落库失败', err);
      });
  });
  return { dispose: unsubscribe };
}
