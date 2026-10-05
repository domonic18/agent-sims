import { eq } from 'drizzle-orm';
import type { WorldEvent } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { worlds } from '../db/schema/index.js';
import type { EventBus } from './event-bus.js';

/**
 * 世界参数持久化订阅:world.params 事件回写活跃世界 config.rules.params,
 * 世界记录成为参数存档真源(Lab 改参可追溯,创建向导 defaults 之外的世界差异留档)。
 * EventBus 承诺纯逻辑零 I/O,写操作挂宿主侧串行链(同 event-log),失败仅记 console。
 */
let tail: Promise<void> = Promise.resolve();

export function attachWorldParamPersist(handle: DbHandle, events: EventBus<WorldEvent>): void {
  let chain: Promise<void> = Promise.resolve();
  events.subscribe((event) => {
    if (event.type !== 'world.params') return;
    chain = chain
      .then(async () => {
        const [row] = await handle.db
          .select()
          .from(worlds)
          .where(eq(worlds.status, 'active'))
          .limit(1);
        if (!row) return;
        const config = row.config as Record<string, unknown>;
        const rules = (config.rules ?? {}) as Record<string, unknown>;
        await handle.db
          .update(worlds)
          .set({ config: { ...config, rules: { ...rules, params: event.params } } })
          .where(eq(worlds.id, row.id));
      })
      .catch((err: unknown) => {
        console.error('[param-persist] 世界参数落档失败', err);
      });
    tail = chain;
  });
}

/** 测试用:等待串行持久化链冲刷完毕 */
export function whenParamPersistIdle(): Promise<void> {
  return tail;
}
