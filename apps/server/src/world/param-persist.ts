import { eq } from 'drizzle-orm';
import type { WorldEvent } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { worlds } from '../db/schema/index.js';
import type { EventBus } from './event-bus.js';

/**
 * 世界配置持久化订阅:world.params(参数全集)与 world.rules(规则三字段)
 * 事件回写活跃世界 config,世界记录成为参数/规则存档真源(Lab 与游戏内设置
 * 菜单的运行时修改均可追溯)。EventBus 承诺纯逻辑零 I/O,写操作挂宿主侧
 * 串行链(同 event-log),失败仅记 console。
 */
let tail: Promise<void> = Promise.resolve();

export function attachWorldParamPersist(handle: DbHandle, events: EventBus<WorldEvent>): void {
  let chain: Promise<void> = Promise.resolve();
  events.subscribe((event) => {
    if (event.type !== 'world.params' && event.type !== 'world.rules') return;
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
        const merged =
          event.type === 'world.params'
            ? { ...rules, params: event.params }
            : {
                ...rules,
                allowDeath: event.rules.allowDeath,
                allowChat: event.rules.allowChat,
                initialTimeScale: event.rules.initialTimeScale,
              };
        await handle.db
          .update(worlds)
          .set({ config: { ...config, rules: merged } })
          .where(eq(worlds.id, row.id));
      })
      .catch((err: unknown) => {
        console.error('[param-persist] 世界配置落档失败', err);
      });
    tail = chain;
  });
}

/** 测试用:等待串行持久化链冲刷完毕 */
export function whenParamPersistIdle(): Promise<void> {
  return tail;
}
